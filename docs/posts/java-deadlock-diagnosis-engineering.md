---
title: Java 死锁诊断与预防：锁顺序、jstack 与超时策略
date: 2026-10-09
category: 后端开发
cover: /covers/backend.svg
tags: [java, 死锁, 并发, jstack, 排查]
excerpt: 死锁的成因只有一句话：多个线程以不同顺序持有并等待对方持有的锁。定位靠线程转储里的持有与等待关系，预防靠全局锁顺序、超时放弃与缩小锁范围，事后再用 ThreadMXBean 做运行期自检。
---

# Java 死锁诊断与预防：锁顺序、jstack 与超时策略

<img src="/images/posts/java-deadlock-diagnosis-engineering-knowledge-map.png" alt="Java 死锁诊断与预防：锁顺序、jstack 与超时策略知识串联图" style="border-radius: 10px;" />

死锁的成因只有一句话：多个线程以不同顺序持有并等待对方持有的锁。定位靠线程转储里的持有与等待关系，预防靠全局锁顺序、超时放弃与缩小锁范围，事后再用 ThreadMXBean 做运行期自检。

## 先说结论：四个必要条件与唯一可行解法

死锁需要同时满足互斥、持有并等待、不可抢占、循环等待。前三条是锁的固有属性（`synchronized` 不可被抢占），能打破的通常只有**循环等待**：

- **统一加锁顺序**：所有代码路径按同一全局顺序获取多把锁；
- **超时放弃**：`tryLock(timeout)` 失败即释放已持有的锁并重试；
- **一次性申请**：把多把锁合并成一个锁对象，或把临界区合并到一个方法内；
- **缩小锁范围**：用不可变对象、无锁结构（`ConcurrentHashMap`、原子类）替代多锁协作。

## 一、完整分类：五种典型死锁

### 1. 顺序死锁（最常见）

线程 A 先锁账户 1 再锁账户 2，线程 B 反之。转账场景的经典形态。

### 2. 动态顺序死锁

参数顺序来自调用方，例如 `transfer(from, to)` 直接按入参顺序加锁——看似已固定顺序，实际由调用参数决定，仍然随机。

### 3. 嵌套锁 + 回调

持锁调用外部代码（监听器、RPC、`toString`），外部代码再回头获取同一批锁。真实系统里最难查，因为调用链跨模块。

### 4. 数据库与 JVM 混合死锁

线程持 DB 行锁后申请 JVM 锁，另一线程反向。表现为应用卡住且 DB 有锁等待，单看一边都正常。

### 5. 线程池饥饿型假死锁

任务 A 提交任务 B 并等待其完成，而线程池已满无法执行 B。线程状态是 `WAITING` 而非 `BLOCKED`，`jstack` 不会标记为死锁，但现象等价。

## 二、诊断：三件工具，一条主线

### 1. 线程转储（jstack / jcmd）

```bash
# 抓取线程转储：连续抓 3 次，间隔 5 秒，便于看"谁一直卡在同一位置"
jcmd <pid> Thread.print > dump1.txt
jstack -l <pid> > dump2.txt
```

关键阅读顺序：

1. 找 `Found one Java-level deadlock` 段（JVM 会自动探测 `synchronized` 与 `ReentrantLock` 的循环等待）；
2. 看 `waiting to lock <0x...>` 与 `locked <0x...>` 的地址配对；
3. 若无 deadlock 段但大量线程 `BLOCKED`，追同一个锁地址；
4. 若大量线程 `WAITING` 在队列 `take`，考虑线程池饥饿或下游阻塞。

### 2. 运行期自检：ThreadMXBean

```java
/**
 * 死锁巡检：定期检测 JVM 级死锁并输出持有关系，适合接入健康检查端点。
 */
@Component
public class DeadlockInspector {

    private final ThreadMXBean threadMXBean = ManagementFactory.getThreadMXBean();

    /**
     * @return 死锁线程 ID 数组；无死锁返回空数组
     */
    public long[] detect() {
        long[] ids = threadMXBean.findDeadlockedThreads();
        return ids == null ? new long[0] : ids;
    }

    /** 定时任务：发现死锁立即打印线程栈，便于事后定位 */
    @Scheduled(fixedDelay = 60_000)
    public void check() {
        long[] ids = detect();
        if (ids.length == 0) {
            return;
        }
        ThreadInfo[] infos = threadMXBean.getThreadInfo(ids, true, true);
        for (ThreadInfo info : infos) {
            // lockOwnerName/lockName 直接给出"谁持有、在等谁"
            log.error("检测到死锁: thread={}, state={}, waitingLock={}, owner={}",
                    info.getThreadName(), info.getThreadState(),
                    info.getLockName(), info.getLockOwnerName());
        }
    }
}
```

### 3. 火焰图与阻塞队列指标

线程转储是快照，无法反映"偶发 200 ms 阻塞"。持续型问题用 async-profiler 的 `lock` 模式采样，或在应用层记录持锁时长。

## 三、真实示例：统一顺序 + 超时放弃

```java
/**
 * 账户转账：演示三种防死锁写法。
 * 核心是"加锁顺序必须与参数顺序无关"。
 */
public class AccountTransferService {

    /** 账户对象：余额只在本对象锁内修改 */
    public static final class Account {
        private final long id;
        private long balance;

        public Account(long id, long balance) {
            this.id = id;
            this.balance = balance;
        }

        public long id() {
            return id;
        }
    }

    /**
     * 写法一（推荐）：按账户 ID 升序加锁，彻底消除循环等待。
     */
    public void transferOrdered(Account from, Account to, long amount) {
        Account first = from.id() < to.id() ? from : to;
        Account second = from.id() < to.id() ? to : from;
        synchronized (first) {
            synchronized (second) {
                from.balance -= amount;
                to.balance += amount;
            }
        }
    }

    /**
     * 写法二：显式锁 + 超时，拿不到就放弃，避免无限期等待。
     * 注意：必须在 finally 中释放已获得的锁。
     */
    public boolean transferWithTimeout(Account from, Account to, long amount) {
        ReentrantLock firstLock = from.id() < to.id() ? lockOf(from) : lockOf(to);
        ReentrantLock secondLock = from.id() < to.id() ? lockOf(to) : lockOf(from);
        boolean firstAcquired = false;
        boolean secondAcquired = false;
        try {
            firstAcquired = firstLock.tryLock(200, TimeUnit.MILLISECONDS);
            if (!firstAcquired) {
                return false;
            }
            secondAcquired = secondLock.tryLock(200, TimeUnit.MILLISECONDS);
            if (!secondAcquired) {
                return false;
            }
            from.balance -= amount;
            to.balance += amount;
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();   // 恢复中断标记，交给上层处理
            return false;
        } finally {
            if (secondAcquired) {
                secondLock.unlock();
            }
            if (firstAcquired) {
                firstLock.unlock();
            }
        }
    }

    /** 账户到锁的映射，生产实现应放在 Account 内部或用 WeakHashMap 管理 */
    private ReentrantLock lockOf(Account account) {
        return LOCKS.computeIfAbsent(account.id(), id -> new ReentrantLock());
    }

    private static final ConcurrentHashMap<Long, ReentrantLock> LOCKS = new ConcurrentHashMap<>();
}
```

写法三：把"两个账户的余额变更"收敛为一条带条件的 SQL（`UPDATE ... WHERE balance >= ?`），用数据库行锁替代 JVM 锁，天然只有一种加锁顺序。

## 四、常见追问

**问：`jstack` 没报 deadlock，但服务就是不动了？**
常见于线程池饥饿、`WAITING` 在无界队列、线程全部阻塞在下游 IO。看线程数与状态分布，而不是只看死锁段。

**问：`ReentrantLock` 死锁能被自动探测吗？**
能，`findDeadlockedThreads` 覆盖对象监视器与 `AQS` 系锁；但通过 `Semaphore`、自定义等待队列造成的循环等待不一定被识别。

**问：`synchronized` 能设置超时吗？**
不能。需要超时语义只能用 `ReentrantLock.tryLock(timeout)`，或改造成无锁/单锁设计。

**问：加锁顺序统一了还会死锁吗？**
仍可能：嵌套锁跨越不同子系统（DB、缓存、消息），或锁粒度在演进中被打乱。统一顺序必须写进规范并靠评审守住。

**问：为什么线上复现不了？**
死锁依赖时序窗口，压测流量与真实分布不同。可靠做法是静态审查"多锁路径"+ 运行期巡检。

## 五、踩坑记录

- **按入参顺序加锁**：`transfer(a, b)` 与 `transfer(b, a)` 并发时互锁。
- **持锁调用外部服务**：锁内发起 RPC，超时期间锁一直被持有，放大争用。
- **`tryLock` 成功后未在 finally 释放**：异常路径漏解锁，线程永久阻塞。
- **`lockInterruptibly` 忘记恢复中断位**：上层取消逻辑失效。
- **锁对象是可变字段**：`synchronized(this.field)` 在字段被替换后锁失效。
- **线程池里嵌套提交并等待**：池满即自我饿死，`jstack` 看不出死锁标记。

## 六、选择建议

| 场景 | 建议 |
|---|---|
| 两个资源互转（转账、库存转移） | 按 ID 排序加锁 |
| 需要失败快速返回 | `tryLock(timeout)` + 重试上限 |
| 跨进程共享资源 | 用 DB 行锁/分布式锁，别混用两层锁 |
| 高并发读多写少 | 换无锁结构（原子类、`ConcurrentHashMap`） |
| 已有历史包袱 | 先加巡检告警，再逐步收敛锁顺序 |

## 七、最佳实践清单

1. 多锁路径必须有全局顺序约定，写进编码规范；
2. 禁止持锁调用外部 IO/RPC；
3. 用 `tryLock` 给等待设上限，并在 `finally` 中成对释放；
4. 锁对象声明为 `private final`，避免锁对象被替换；
5. 线程池内禁止"提交任务并同步等待"；
6. 接入 `ThreadMXBean` 巡检 + 线程数/`BLOCKED` 数指标告警；
7. 事故后按"加锁顺序表"复盘代码，而不是只修出事的那一处。

## 总结

Java 死锁不是玄学：四个必要条件里，工程上唯一能系统性打破的是循环等待。统一加锁顺序解决绝大多数场景，超时放弃作为兜底，缩小锁范围与无锁结构从源头减少多锁协作。诊断上以线程转储为主线，配合 `ThreadMXBean` 巡检，才能把"偶发卡死"变成可观测、可复现的问题。
