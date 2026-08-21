---
title: Java 线程池 ThreadPoolExecutor 工程实践：核心参数、执行流程与拒绝策略
date: 2026-08-18
category: 后端开发
cover: /images/posts/java-threadpool-executor-engineering-knowledge-map.webp
tags: [java, concurrency, threadpool, executor, 并发编程]
excerpt: 从 7 个核心参数和执行流程四步法讲清 ThreadPoolExecutor 为什么“先占核心、再入队、队满才扩容、再满才拒”，并把队列选型、拒绝策略、线程数估算与 Spring Boot 接入落到真实订单异步场景。
---

# Java 线程池 ThreadPoolExecutor 工程实践：核心参数、执行流程与拒绝策略

<img src="/images/posts/java-threadpool-executor-engineering-knowledge-map.webp" alt="Java 线程池 ThreadPoolExecutor 工程实践：核心参数、执行流程与拒绝策略知识串联图" style="border-radius: 10px;" />

从 7 个核心参数和执行流程四步法讲清 ThreadPoolExecutor 为什么“先占核心、再入队、队满才扩容、再满才拒”，并把队列选型、拒绝策略、线程数估算与 Spring Boot 接入落到真实订单异步场景。

线程池解决的不是“要不要多线程”，而是“用多少个线程、任务排队到哪、满了怎么办”。手写 `new Thread(() -> ...).start()` 在并发稍高时就会失控：线程无节制创建拖垮调度，异常丢失无人感知，也无法统一监控。ThreadPoolExecutor 把线程生命周期、任务队列、拒绝边界集中管理，是 Java 服务端并发的基石。

> 本文以 **JDK 21（LTS）** 为适用版本，事实核对日期 **2026-08-18**。核心行为依据 [Java SE 21 `java.util.concurrent.ThreadPoolExecutor` JavaDoc](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html) 与 `Executors` 工厂说明。执行顺序、拒绝策略等属于长期稳定的契约，但 `Executors` 各工厂的具体队列/线程数实现以对应版本 JavaDoc 为准，升级 JDK 时应重新核对。

## 一、先用一句话理解线程池

提交一个任务后，ThreadPoolExecutor 不是简单地“有线程就跑、没线程就建”，而是按固定顺序在 **核心线程、工作队列、最大线程、拒绝策略** 之间做决策：

```text
提交任务
   ↓
当前线程数 < corePoolSize ?
   ├─ 是：新建线程直接执行（即使有空闲线程也优先扩到核心数）
   └─ 否：尝试放入 workQueue
                ↓ 入队成功？
                ├─ 是：排队等待，由空闲线程领取
                └─ 否（队列已满）：当前线程数 < maximumPoolSize ?
                          ├─ 是：新建线程执行
                          └─ 否：触发 RejectedExecutionHandler
```

最常见的误判是“线程数达到 maximumPoolSize 才会排队”。实际顺序是 **先 core，再 queue，queue 满了才扩到 max，最后才 reject**。这个顺序直接决定了队列容量和最大线程数该怎么配。

## 二、完整组成：7 个核心参数

构造函数签名：

```java
public ThreadPoolExecutor(
        int corePoolSize,
        int maximumPoolSize,
        long keepAliveTime,
        TimeUnit unit,
        BlockingQueue<Runnable> workQueue,
        ThreadFactory threadFactory,
        RejectedExecutionHandler handler)
```

| 参数 | 含义 | 工程注意点 |
|---|---:|---|
| `corePoolSize` | 核心线程数，常驻不回收（除非 `allowCoreThreadTimeOut`） | 决定“常态并行能力”，不是最小线程数 |
| `maximumPoolSize` | 允许的最大线程数 | 队列满后还能再扩的余额上限 |
| `keepAliveTime` + `unit` | 超过核心数的空闲线程存活时间 | 仅对“超出核心数”的线程生效 |
| `workQueue` | 任务等待队列（BlockingQueue） | 容量与类型决定排队行为和风险 |
| `threadFactory` | 线程创建工厂 | 必须给线程命名，否则排查时无堆栈线索 |
| `handler` | 拒绝策略 | 队列满且线程达 max 时如何处理新任务 |

补充：`allowCoreThreadTimeOut(true)` 可让核心线程也在空闲超时后被回收，适合流量极不均匀的场景，但会增加线程重建开销。

## 三、工作队列：选错类型等于埋雷

队列容量决定了“是先排队还是先扩容”。常见实现必须完整了解：

- **`ArrayBlockingQueue`**：有界队列，构造时必须指定容量。队列满才会触发扩容到 max，控制力强，是最稳妥的生产选择。
- **`LinkedBlockingQueue`**：默认构造为**无界**（容量 `Integer.MAX_VALUE`）。队列永远不会满，于是 `maximumPoolSize` 形同虚设，任务无限堆积会 OOM。
- **`SynchronousQueue`**：不存储任务，直接把任务交给线程；没有空闲线程就立即尝试扩容或拒绝。适合短任务、高吞吐，对应 `newCachedThreadPool`。
- **`PriorityBlockingQueue`**：支持按优先级出队的无界队列，需注意任务饿死问题。

> 经验结论：生产环境**优先用有界 `ArrayBlockingQueue`**，把“背压”显式交给拒绝策略，而不是让内存默默膨胀。

## 四、拒绝策略：满了之后怎么办

当队列已满且线程数到达 `maximumPoolSize`，新提交的任务交给 `RejectedExecutionHandler`。JDK 内置四种：

| 策略 | 行为 | 适用场景 |
|---|---|---|
| `AbortPolicy`（默认） | 抛出 `RejectedExecutionException` | 需要明确感知过载，配合上游降级 |
| `CallerRunsPolicy` | 由提交任务的线程自己执行 | 削峰填谷，不丢任务但会拖慢调用方 |
| `DiscardPolicy` | 静默丢弃新任务 | 可丢弃的采样/日志类任务 |
| `DiscardOldestPolicy` | 丢弃队列中最旧任务，重试提交当前任务 | 只关心最新状态（如行情推送） |

注意 `AbortPolicy` 抛出的是 **RuntimeException**，如果不捕获，异步任务里会直接打断提交线程。自定义拒绝策略应记录指标和上下文，而不是只打日志。

## 五、Executors 快捷工厂的坑

`Executors` 提供的快捷方法看着方便，但生产长期被阿里 Java 规范等要求手动创建：

- `newFixedThreadPool(n)`：`core = max = n`，队列是**无界** `LinkedBlockingQueue` → 任务堆积 OOM。
- `newCachedThreadPool()`：`core = 0`，`max = Integer.MAX_VALUE`，`SynchronousQueue` → 瞬时高并发创建海量线程 → 耗尽资源。
- `newSingleThreadExecutor()`：单线程 + 无界队列，任务堆积同样 OOM，且异常会终止唯一线程。

正确做法：显式 `new ThreadPoolExecutor(...)`，给队列定容量、给线程起名字、给拒绝策略配监控。

## 六、线程数怎么估算

这是工程指导而非版本契约，常见两类经验值：

- **CPU 密集型**（计算多、等待少）：线程数 ≈ `CPU 核心数 + 1`。过多线程只会增加上下文切换。
- **I/O 密集型**（等待 DB、RPC、网络）：线程数可更高。一个被广泛引用的经验公式是 `N_threads ≈ N_cpu × (1 + W/C)`（W 为等待时间占比，C 为计算时间占比，出自 *Java Concurrency in Practice*）。在实践中常简化为 `N_cpu × 2` 起步，再压测调优。

真实系统的瓶颈往往不是公式，而是下游连接池、DB 并发度和 GC。线程数应配合 `ThreadPoolExecutor` 的 `getActiveCount`、`getQueue().size()` 等运行时指标动态观察。

## 七、真实订单场景：异步发通知

订单支付成功后，需要异步发送短信、站内信、风控上报。这些任务彼此独立、允许短暂延迟，适合放进独立线程池，避免阻塞主流程。

### 1. 显式创建带命名的线程池

```java
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public class OrderNotifyPools {

    // 有界队列 + 命名线程 + 可观测的拒绝策略，避免 Executors 的隐藏风险
    public static final ThreadPoolExecutor NOTIFY_POOL = new ThreadPoolExecutor(
            8,                                          // corePoolSize：常态并行 8 个通知任务
            16,                                         // maximumPoolSize：峰值可扩到 16
            60, TimeUnit.SECONDS,                       // 超出核心的空闲线程 60s 后回收
            new ArrayBlockingQueue<>(1024),             // 有界队列，满则触发扩容/拒绝，防止 OOM
            new ThreadFactory() {                       // 必须命名，便于排查堆栈
                private final AtomicInteger seq = new AtomicInteger(1);
                @Override
                public Thread newThread(Runnable r) {
                    Thread t = new Thread(r, "order-notify-" + seq.getAndIncrement());
                    t.setDaemon(false);
                    return t;
                }
            },
            new RejectedExecutionHandler() {             // 自定义拒绝：记录指标，不静默丢弃
                @Override
                public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
                    // 生产可上报 Prometheus；这里退化为由调用方同步执行，保证不丢
                    Metrics.counter("order_notify_rejected").inc();
                    if (!e.isShutdown()) {
                        // 严格场景可改为抛出异常触发上游降级
                        r.run();
                    }
                }
            });
}
```

### 2. 在业务代码中提交

```java
public void onOrderPaid(OrderPaidEvent event) {
    // 主流程不等待，把三类通知异步化
    OrderNotifyPools.NOTIFY_POOL.execute(() -> sendSms(event));
    OrderNotifyPools.NOTIFY_POOL.execute(() -> sendInbox(event));
    OrderNotifyPools.NOTIFY_POOL.execute(() -> reportRisk(event));
}
```

### 3. Spring Boot 中声明为 Bean

```java
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

@Configuration
public class AsyncConfig {

    @Bean("orderNotifyExecutor")
    public Executor orderNotifyExecutor() {
        // Spring 封装：本质仍是 ThreadPoolExecutor，配置项一一对应
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(8);
        executor.setMaxPoolSize(16);
        executor.setQueueCapacity(1024);          // 对应 ArrayBlockingQueue 的有界容量
        executor.setThreadNamePrefix("order-notify-");
        executor.setRejectedExecutionHandler(
                new ThreadPoolExecutor.CallerRunsPolicy()); // 满了由调用方兜底执行
        executor.initialize();
        return executor;
    }
}
```

配合 `@Async("orderNotifyExecutor")` 即可把方法异步化，线程池名称与拒绝行为完全可控。

## 八、常见追问与踩坑

### 1. 为什么任务没按 maximumPoolSize 并发？

多半用了无界 `LinkedBlockingQueue`：队列永远不满，`max` 永远用不上，所有任务都在排队。换成有界队列后，队列满才会扩容。

### 2. `submit` 和 `execute` 有什么区别？

`execute(Runnable)` 直接交给池；`submit(Callable/Runnable)` 返回 `Future`，任务内异常会被封装进 `Future`，不主动 `get()` 就不会抛出来，容易“静默吞异常”。需要结果或异常可见时用 `submit` 并务必处理 `Future`。

### 3. 线程池里的异常去哪了？

未捕获异常会被线程池的 `afterExecute` 兜底，默认仅记录到线程 `uncaughtExceptionHandler`。Worker 线程异常后会被回收重建，不会拖垮整个池，但异常可能被吞掉。务必在任务内 `try-catch` 并上报，或用 `submit` 拿 `Future` 检查。

### 4. `shutdown` 和 `shutdownNow` 怎么选？

`shutdown()` 拒绝新任务、等待已提交任务跑完，最常用；`shutdownNow()` 尝试中断正在运行的任务并返回未执行任务列表，只在必须快速退出时使用。Spring 容器关闭时会自动调用 `shutdown`，但自定义池要确认 Bean 实现了 `DisposableBean` 或加了 `@PreDestroy`。

### 5. 核心线程会预创建吗？

默认是**懒创建**：来一个任务建一个，直到达到 `corePoolSize`。`prestartCoreThread()` / `prestartAllCoreThreads()` 可预先拉起，适合启动期就要稳定承载的场景。

### 6. keepAliveTime 对核心线程生效吗？

默认不生效。只有超过核心数的那部分线程才会在空闲超时后被回收。需要核心线程也回收时调用 `allowCoreThreadTimeOut(true)`。

## 九、选择建议与最佳实践

### 队列选型

- 生产默认有界 `ArrayBlockingQueue`，容量按“可接受的最大排队延迟 × 吞吐”反推；
- 短任务、低延迟、允许扩线程：考虑 `SynchronousQueue`；
- 需要优先级且能接受无界风险：才考虑 `PriorityBlockingQueue`。

### 拒绝策略

- 不能丢任务（订单、支付）：`CallerRunsPolicy` 或自定义“持久化 + 重试”；
- 可丢采样/日志：`DiscardPolicy`；
- 只关心最新值（行情）：`DiscardOldestPolicy`；
- 默认 `AbortPolicy` 务必被捕获并降级，别让异常穿透到调用方。

### 落地清单

1. 禁止直接用 `Executors` 无界工厂，显式构造 `ThreadPoolExecutor`；
2. 线程必须命名（`ThreadFactory`），保留排查线索；
3. 队列有界、拒绝可观测，把背压交给监控而非内存；
4. 任务内统一 `try-catch` 并上报，异常不靠 `Future` 隐式兜底；
5. 线程数从 `CPU 核心数 + 1` / `CPU 核心数 × 2` 起步，压测调优；
6. 监控 `activeCount`、`queue.size`、`completedTaskCount`、拒绝计数；
7. 优雅关闭：`@PreDestroy` 调 `shutdown()` 并 `awaitTermination`；
8. 不同业务用不同池隔离，避免一个慢任务拖垮全局。

## 总结

ThreadPoolExecutor 的本质是一条决策链：**核心线程先接、接不下就排队、队满才扩容、再满就拒绝**。理解这条顺序，才不会把 `maximumPoolSize` 误当成并发上限，也不会被无界队列悄悄堆爆内存。

工程上最稳的组合是：有界 `ArrayBlockingQueue` + 命名 `ThreadFactory` + 可观测拒绝策略 + 显式线程数估算与监控。把背压和异常都暴露在明处，线程池才是稳定并发的基石，而不是隐患源头。
