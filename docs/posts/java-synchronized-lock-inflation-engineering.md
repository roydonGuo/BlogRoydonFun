---
title: Java synchronized 原理与锁膨胀：Monitor、轻量级锁与版本边界
date: 2026-08-24
category: 后端开发
cover: /images/posts/java-synchronized-lock-inflation-engineering-knowledge-map.webp
tags: [java, synchronized, concurrency, monitor, hotspot, lock]
excerpt: synchronized 的语义核心是同一 Monitor 上的互斥、可重入与内存可见性；所谓锁升级则是 HotSpot 为降低不同竞争强度下的加锁成本而选择的实现路径。本文以 JDK 25 为基线，讲清字节码、Mark Word、轻量级锁、ObjectMonitor 膨胀及线上诊断边界。
top: true
---

# Java synchronized 原理与锁膨胀：Monitor、轻量级锁与版本边界

<img src="/images/posts/java-synchronized-lock-inflation-engineering-knowledge-map.webp" alt="Java synchronized 原理与锁膨胀：Monitor、轻量级锁与版本边界知识串联图" style="border-radius: 10px;" />

synchronized 的语义核心是同一 Monitor 上的互斥、可重入与内存可见性；所谓锁升级则是 HotSpot 为降低不同竞争强度下的加锁成本而选择的实现路径。本文以 JDK 25 为基线，讲清字节码、Mark Word、轻量级锁、ObjectMonitor 膨胀及线上诊断边界。

## 先给结论：不要再死记四级锁口诀

`synchronized` 首先是 Java 语言提供的同步语义，锁状态才是具体 JVM 的实现策略。工程上应记住四点：

- 同一时刻只有一个线程能持有同一对象的 Monitor，但未使用同一把锁的代码不会被自动保护；
- 锁可重入，同一线程重复进入只增加重入深度，不会把自己阻塞；
- 对同一 Monitor 的一次解锁 happens-before 之后的加锁，因此临界区写入对后续持锁线程可见；
- 在现代 HotSpot 中，默认路径应理解为“无锁 → 轻量级快路径 → 必要时膨胀为 `ObjectMonitor`”，而不是把偏向锁当作必经阶段。

本文以 Java SE 25、OpenJDK HotSpot 25 为事实基线，核对日期为 2026-08-24。JDK 15 已默认关闭并废弃偏向锁；JDK 23 又将新的轻量级锁实现设为默认。因而“无锁 → 偏向锁 → 轻量级锁 → 重量级锁”只适合解释特定旧版 HotSpot，不能当成跨版本规范。

## synchronized 到底锁住了谁

锁的身份由对象引用决定，而不是由代码块名称决定：

```java
public final class InventoryService {
    private int stock = 100;
    private static int globalSequence = 0;

    // 锁是当前 InventoryService 实例，也就是 this
    public synchronized boolean deduct(int quantity) {
        if (quantity <= 0 || stock < quantity) {
            return false;
        }
        stock -= quantity;
        return true;
    }

    // 锁是 InventoryService.class，所有实例共享
    public static synchronized int nextSequence() {
        return ++globalSequence;
    }

    public int currentStock() {
        synchronized (this) {
            return stock;
        }
    }
}
```

三种写法对应三种锁对象：

| 写法 | Monitor 所属对象 |
| --- | --- |
| 实例同步方法 | 当前实例 `this` |
| 静态同步方法 | 当前类的 `Class` 对象 |
| 同步代码块 | 括号中表达式求值所得对象 |

下面的写法看似加锁，实际每次调用都创建新对象，不同线程根本没有竞争同一个 Monitor：

```java
public void unsafeDeduct(int quantity) {
    Object lock = new Object();
    synchronized (lock) { // 每次调用都是不同锁，不能保护共享 stock
        stock -= quantity;
    }
}
```

锁对象必须稳定、私有且与受保护状态生命周期一致。不要锁字符串字面量、包装类型或调用方可获得的公共对象；它们可能被缓存、复用或被外部代码意外占用。

## 语言语义：互斥、可重入与可见性

每个对象都关联一个 Monitor。线程进入同步区域前必须先获得它，离开时释放它。Monitor 维护拥有者和重入计数：同一线程再次获得已经持有的 Monitor 时计数加一，对应次数的退出后才真正释放。

```java
public final class ReentrantOrderService {
    public synchronized void submit(String orderId) {
        validate(orderId); // 同一线程再次进入 this 的 Monitor
        // 持锁完成状态变更
    }

    private synchronized void validate(String orderId) {
        if (orderId == null || orderId.isBlank()) {
            throw new IllegalArgumentException("orderId 不能为空");
        }
    }
}
```

可见性来自 Java 内存模型：线程 A 释放某个 Monitor，happens-before 线程 B 随后成功获取同一 Monitor。前提仍然是读写双方使用同一把锁；如果读取方绕过锁，不能依靠 `synchronized` 自动获得一致快照。

## 字节码：代码块与同步方法不是同一种标记

同步代码块通常编译为 `monitorenter` 与 `monitorexit`。编译器还会生成异常处理路径，保证临界区抛异常时也执行退出：

```java
public void update(Object lock) {
    synchronized (lock) {
        // 临界区
    }
}
```

可以这样检查：

```bash
javac SyncDemo.java
javap -c -v SyncDemo
```

不要期待同步方法中也一定出现这两条指令。同步方法由方法访问标志 `ACC_SYNCHRONIZED` 表示，JVM 调用该方法时隐式获取实例或 `Class` 对象的 Monitor。两种写法语义等价，但字节码表达不同。

## HotSpot 的锁信息放在哪里

在 HotSpot 中，对象头的 Mark Word 可保存身份哈希、GC 年龄以及锁状态位。JDK 25 源码中，最低两位能区分未锁定、快速锁定和已膨胀 Monitor 等状态；轻量级加锁还会使用当前线程的 lock stack。

但 Mark Word 不是 Java 语言规范或 JVM 规范承诺的固定布局。32/64 位、压缩对象头、锁模式以及后续 HotSpot 版本都可能改变具体位数，所以生产代码和面试答案都不应依赖一张永久不变的对象头位图。

## JDK 25 的锁膨胀流程

可以把一次典型加锁理解为以下决策，而不是固定执行完所有阶段。

### 1. 未锁定：先走轻量级快路径

对象最初处于未锁定状态。没有竞争时，HotSpot 尝试用原子操作把对象头的锁标记从未锁定切为快速锁定，并在线程的 lock stack 中记录锁对象。成功后即可进入临界区，不需要先创建重量级 Monitor。

### 2. 同线程再次进入：记录重入

当前线程已经持有该锁时，JVM 会识别为重入，继续进入临界区并维护对应的嵌套关系。`synchronized` 的可重入性是规范语义，具体记录位置属于 HotSpot 实现细节。

### 3. 出现真实竞争：可能短暂自旋

另一个线程获取失败时，JVM可能先尝试有限自旋，期待持锁线程很快退出。自旋是否发生、持续多久都由运行时决定。因此“轻量级锁就是自旋锁”并不准确：轻量级描述的是加锁表示和快路径，自旋只是竞争处理的一种优化。

### 4. 快路径无法处理：膨胀为 ObjectMonitor

竞争加剧、执行 `Object.wait()` 或其他需要完整 Monitor 能力的场景，会促使锁膨胀为 `ObjectMonitor`。它保存拥有者、重入次数、竞争队列和 Wait Set；竞争线程不能取得锁时可能被挂起，等待后续唤醒和重新竞争。

```text
未锁定
  └─ CAS 成功 → 轻量级持有
                  ├─ 同线程进入 → 重入
                  ├─ 正常退出 → 未锁定
                  └─ 竞争或 wait → ObjectMonitor
                                      ├─ 自旋后取得
                                      └─ 挂起后再竞争
```

这条路径也不是业务生命周期内“只升不降”的绝对规则。膨胀后的 Monitor 在繁忙期间不会为了每次解锁立即降级，但 HotSpot 支持对空闲 Monitor 做异步收缩（deflation）。把“不降级”理解为一次竞争过程中的简化模型即可。

## 偏向锁为什么不再是默认流程

偏向锁曾让对象偏向第一个加锁线程：该线程再次进入时尽量避免原子操作，其他线程竞争则触发撤销。它对旧式、频繁无竞争同步代码有收益，但撤销需要的全局协调越来越昂贵，而现代应用大量使用线程池。

[JEP 374](https://openjdk.org/jeps/374) 从 JDK 15 起默认关闭并废弃偏向锁相关选项。[JDK-8327089](https://bugs.openjdk.org/browse/JDK-8327089) 说明 JDK 23 将 `LockingMode` 默认值从 legacy 改为新的 lightweight 模式。因此，讨论 JDK 25 默认行为时，应从轻量级锁开始；只有分析旧 JDK、旧参数或历史实现时才展开偏向锁撤销流程。

## wait、sleep 与 Monitor 队列

`wait()` 必须由当前 Monitor 的拥有者调用。调用后线程释放 Monitor 并进入该对象的 Wait Set；被 `notify()` 或 `notifyAll()` 唤醒后，也必须重新竞争并获得 Monitor 才能继续。因此条件检查必须用 `while`，不能用 `if`：

```java
public final class BoundedSignal {
    private boolean ready;

    public synchronized void awaitReady() throws InterruptedException {
        while (!ready) { // 防止虚假唤醒，也要应对条件被其他线程再次改变
            wait();
        }
    }

    public synchronized void markReady() {
        ready = true;
        notifyAll();
    }
}
```

`Thread.sleep()` 只暂停当前线程，不释放已经持有的 Monitor。不要在同步区中执行远程调用、文件 I/O、长时间睡眠或无界重试，否则一个慢操作会把后续请求全部堵在同一把锁上。

## 真实项目如何控制锁粒度

锁只包住共享状态的不变量，耗时工作移到锁外。下面先在锁内领取任务，再在锁外调用下游：

```java
public final class JobDispatcher {
    private final Object queueLock = new Object();
    private final java.util.ArrayDeque<String> pending = new java.util.ArrayDeque<>();

    public String takeAndExecute() {
        final String jobId;
        synchronized (queueLock) {
            jobId = pending.pollFirst();
        }

        if (jobId == null) {
            return "NO_JOB";
        }

        // RPC 不占用 queueLock，避免慢下游扩大临界区
        return callRemoteWorker(jobId);
    }

    private String callRemoteWorker(String jobId) {
        return "DONE:" + jobId;
    }
}
```

涉及多把锁时必须定义统一顺序，否则两个线程可能各持一把再等待另一把，形成死锁。需要可中断、超时、公平策略或多个条件队列时，使用 `ReentrantLock` 更直接；只需小范围互斥且结构简单时，`synchronized` 通常更不容易漏解锁。

## 线上如何判断锁竞争

不要仅凭“CPU 高”猜锁升级，按证据排查：

1. 用 JFR 观察 `Java Monitor Blocked` 事件，定位阻塞时长、锁类与调用栈；
2. 用 `jcmd <pid> Thread.print -l` 连续采样，关注长时间处于 `BLOCKED (on object monitor)` 的线程；
3. 把持锁栈与等待栈配对，确认是否同一锁对象、同一业务热点；
4. 检查临界区是否包含网络、数据库、磁盘 I/O、日志同步写或大循环；
5. 优先缩短持锁时间或拆分独立状态，确认瓶颈后再考虑更换锁结构。

JDK 24 的 [JEP 491](https://openjdk.org/jeps/491) 已让虚拟线程在 `synchronized` 中阻塞时不再因为该 Monitor 固定载体线程，但这不等于竞争消失：业务线程仍要串行进入临界区，吞吐量仍受锁粒度和持锁时间约束。

## 版本边界与核对来源

- Java 语言层的同步语句、可重入与异常退出规则：[JLS 14.19](https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html#jls-14.19)；
- Monitor 的拥有者、进入计数及字节码规则：[JVMS 2.11.10](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-2.html#jvms-2.11.10)、[`monitorenter`](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-6.html#jvms-6.5.monitorenter)；
- JDK 25 Mark Word 锁状态布局：[OpenJDK 25 `markWord.hpp`](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/hotspot/share/oops/markWord.hpp)；
- 偏向锁的默认关闭与废弃：[JEP 374](https://openjdk.org/jeps/374)；
- JDK 23 起默认采用 lightweight 锁模式：[JDK-8327089](https://bugs.openjdk.org/browse/JDK-8327089)。

最后把判断顺序压缩成一句话：先确认所有访问者是否锁住同一个稳定对象，再控制临界区长度，最后用 JFR 和线程栈证明是否真的存在 Monitor 竞争；不要从一张过时的锁升级图反推线上问题。
