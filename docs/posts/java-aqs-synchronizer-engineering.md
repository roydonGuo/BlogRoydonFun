---
title: Java AQS 工程实践：state、同步队列、共享模式与 Condition
date: 2026-08-25
category: 后端开发
cover: /images/posts/java-aqs-synchronizer-engineering-knowledge-map.webp
tags: [java, aqs, concurrency, lock, juc]
excerpt: AQS 把同步器拆成两层：子类只定义 state 的获取与释放规则，框架统一处理排队、阻塞、唤醒、中断和超时。理解独占、共享与 Condition 三条链路，才能读懂 ReentrantLock、Semaphore、CountDownLatch，也能避免自定义同步器里的并发漏洞。
top: true
---

# Java AQS 工程实践：state、同步队列、共享模式与 Condition

<img src="/images/posts/java-aqs-synchronizer-engineering-knowledge-map.webp" alt="Java AQS 工程实践：state、同步队列、共享模式与 Condition知识串联图" style="border-radius: 10px;" />

AQS 把同步器拆成两层：子类只定义 state 的获取与释放规则，框架统一处理排队、阻塞、唤醒、中断和超时。理解独占、共享与 Condition 三条链路，才能读懂 ReentrantLock、Semaphore、CountDownLatch，也能避免自定义同步器里的并发漏洞。

## 先说结论：AQS 是同步器骨架，不是一把锁

`AbstractQueuedSynchronizer` 提供的是状态管理、FIFO 等待队列以及阻塞唤醒框架。它不规定 `state` 的业务含义，也不直接决定公平性。子类通过以下钩子定义规则：

| 模式 | 获取钩子 | 释放钩子 | 典型组件 |
|---|---|---|---|
| 独占 | `tryAcquire` | `tryRelease` | `ReentrantLock` |
| 共享 | `tryAcquireShared` | `tryReleaseShared` | `Semaphore`、`CountDownLatch` |
| 条件等待 | `isHeldExclusively` + `ConditionObject` | 依赖独占获取/释放 | `ReentrantLock.newCondition()` |

以 JDK 25 为事实基线，AQS 使用一个 `int state`、一个按需初始化的同步队列，以及 CAS 和 volatile 访问组织并发。内部实现会随 JDK 演进；业务代码应依赖公开契约，不应反射 Node 字段或复制某个版本的私有算法。事实核对日期为 2026-08-25。

## state 只是整数，语义由子类定义

常见映射如下：

- 互斥锁：`0` 表示未持有，正数表示重入次数；
- 信号量：`state` 表示剩余许可数；
- 倒计时器：`state` 表示尚未完成的任务数；
- 位域同步器：不同 bit 可以表达读写计数或阶段状态。

`getState`、`setState` 和 `compareAndSetState` 负责可见性与原子更新，但不会自动保证业务不变量。多字段状态如果无法压入一个 `int`，不要勉强套 AQS；可考虑 `AbstractQueuedLongSynchronizer`、原子类或更合适的数据结构。

## 独占获取：失败后排队，不是 CAS 一次就结束

独占获取可以压缩为四步：

```text
调用 acquire
  → tryAcquire 尝试拿 state
  → 失败后进入同步队列
  → 前驱合适时 park
  → 被唤醒后重新检查并竞争
```

等待队列是 CLH 思想的变体，但不是教科书里的纯自旋 CLH 锁。当前 OpenJDK 节点显式维护 `prev`、`next`、等待线程与状态，以支持阻塞、取消、中断和超时；真正挂起与唤醒由 `LockSupport.park/unpark` 完成。`park` 允许无理由返回，因此所有正确实现都必须在循环中重新检查条件。

队首线程只是获得再次竞争的资格，不代表一定成功。非公平同步器允许新线程插队，以换取吞吐；公平同步器通常在 `tryAcquire` 中结合 `hasQueuedPredecessors()` 拒绝插队。公平性属于子类策略，不是 FIFO 队列自动赠送的结果。

## 共享获取：成功后可能继续传播

独占模式一次通常只放行一个拥有者；共享模式允许多个线程同时通过。`tryAcquireShared` 的返回值有明确语义：

- 小于 `0`：获取失败，需要等待；
- 等于 `0`：获取成功，但后续共享获取不能保证成功；
- 大于 `0`：获取成功，并且后续共享获取可能继续成功。

例如 `Semaphore` 获取许可时递减 `state`，释放时递增；`CountDownLatch` 等待方在计数归零后共同通过。共享不等于无竞争：state 更新仍需 CAS，许可耗尽时线程同样会排队和阻塞。

还有一个容易忽略的边界：`Semaphore` 没有线程所有权，许可可以由另一个线程释放；`ReentrantLock` 则必须由持有线程解锁。不要用二元信号量替代需要所有权校验和重入语义的锁。

## Condition：先离开条件队列，再回同步队列

每个 `ConditionObject` 都维护独立的条件等待队列。`await()` 不是简单地 park：

1. 校验当前线程独占持有同步器；
2. 保存 state，并完全释放锁；
3. 把线程放入条件队列等待；
4. `signal()` 将节点转移到同步队列；
5. 线程重新竞争锁，成功后恢复原持有次数并返回。

所以 `signal()` 不等于线程立即继续执行，它只让等待者重新获得竞争资格。条件谓词也必须用 `while` 重检：

```java
lock.lock();
try {
    while (queue.isEmpty()) {
        // await 会完整释放锁，返回前重新获取锁
        notEmpty.await();
    }
    return queue.removeFirst();
} finally {
    lock.unlock();
}
```

`Condition` 的价值是把一个锁下的不同等待原因分组。例如有界队列可分别维护 `notEmpty` 与 `notFull`，减少无关线程被唤醒后的空转。

## 一个最小的独占同步器

下面实现不可重入互斥锁，用来展示 AQS 的职责边界；生产项目优先使用成熟的 `ReentrantLock`。

```java
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.AbstractQueuedSynchronizer;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.Lock;

public final class Mutex implements Lock {

    private static final class Sync extends AbstractQueuedSynchronizer {

        @Override
        protected boolean tryAcquire(int arg) {
            if (arg != 1) {
                throw new IllegalArgumentException("arg must be 1");
            }
            // 只允许 0 -> 1；同一线程再次获取也会失败，因此不可重入
            if (compareAndSetState(0, 1)) {
                setExclusiveOwnerThread(Thread.currentThread());
                return true;
            }
            return false;
        }

        @Override
        protected boolean tryRelease(int arg) {
            if (arg != 1 || getState() == 0
                    || getExclusiveOwnerThread() != Thread.currentThread()) {
                throw new IllegalMonitorStateException();
            }
            // 先清所有者，再发布空闲状态
            setExclusiveOwnerThread(null);
            setState(0);
            return true;
        }

        @Override
        protected boolean isHeldExclusively() {
            return getState() == 1
                    && getExclusiveOwnerThread() == Thread.currentThread();
        }

        Condition newCondition() {
            return new ConditionObject();
        }
    }

    private final Sync sync = new Sync();

    @Override
    public void lock() {
        sync.acquire(1);
    }

    @Override
    public void lockInterruptibly() throws InterruptedException {
        sync.acquireInterruptibly(1);
    }

    @Override
    public boolean tryLock() {
        return sync.tryAcquire(1);
    }

    @Override
    public boolean tryLock(long time, TimeUnit unit) throws InterruptedException {
        return sync.tryAcquireNanos(1, unit.toNanos(time));
    }

    @Override
    public void unlock() {
        sync.release(1);
    }

    @Override
    public Condition newCondition() {
        return sync.newCondition();
    }
}
```

自定义同步器时，外部方法调用 AQS 的模板方法，状态规则留在内部 `Sync`。不要直接暴露 `acquire/release` 参数，也不要让业务层修改 state。

## 中断、超时与取消必须成套设计

AQS 已提供三类等待入口：

- 不响应中断的 `acquire`：等待期间记录中断，成功后恢复中断标记；
- 可中断的 `acquireInterruptibly`：中断时取消等待并抛出 `InterruptedException`；
- 有超时的 `tryAcquireNanos`：在截止时间前循环尝试，超时后取消节点。

上层 API 应明确选择语义。远程调用、任务调度和资源池通常更适合可中断或有界等待；无限不可中断等待会放大停机、线程池耗尽和故障恢复时间。捕获 `InterruptedException` 后若无法继续向上抛出，应恢复中断标记：

```java
try {
    lock.lockInterruptibly();
} catch (InterruptedException ex) {
    Thread.currentThread().interrupt(); // 保留取消信号
    return;
}
```

## 工程上最容易踩的坑

1. 把 `state == 0/1` 当成 AQS 固定定义。它只是某些互斥锁的约定。
2. 只修改 state，不维护独占所有者。诊断、重入和非法释放检查都会失真。
3. 在 `tryAcquire` 中阻塞或执行耗时业务。钩子应快速判断并更新状态，排队由框架负责。
4. 认为公平模式绝不插队。某些非阻塞 `tryLock/tryAcquire` 明确不遵守公平策略，应以具体 API 契约为准。
5. 用 `if` 包围 `await`。虚假唤醒、竞争失败或条件变化都会让线程在条件不满足时继续执行。
6. 用队列长度做强一致业务判断。AQS 的监控方法主要用于观测与调优，结果可能瞬时变化。
7. 自研已有同步器。除非语义确实无法由 Lock、Semaphore、CountDownLatch、Phaser 等表达，否则维护成本通常高于收益。

## 排障与观测

线程转储里，AQS 等待通常表现为 `WAITING (parking)` 或 `TIMED_WAITING (parking)`，栈上可见 `LockSupport.park` 与具体同步器。定位时同时回答三件事：

- 谁持有或长期占用资源；
- 哪些线程排队，等待是否可中断、有超时；
- state 代表的业务量是否还能向可用方向变化。

监控可以记录等待耗时、超时数、中断数、当前许可或队列估算，但不要输出高基数线程名。若线程长期停在 Condition，还要检查是否遗漏 `signal/signalAll`、是否在错误条件上等待，以及通知后能否重新获得锁。

## 参考资料

- [Java SE 25：AbstractQueuedSynchronizer](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/AbstractQueuedSynchronizer.html)
- [OpenJDK：AbstractQueuedSynchronizer 源码](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/concurrent/locks/AbstractQueuedSynchronizer.java)
- [Java SE 25：ReentrantLock](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html)
- [Java SE 25：Semaphore](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html)
- [Java SE 25：LockSupport](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/LockSupport.html)
