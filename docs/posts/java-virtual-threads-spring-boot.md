---
title: Java 21 虚拟线程在 Spring Boot 中的工程化实践
date: 2026-08-04
category: 后端开发
cover: /images/posts/java-virtual-threads-spring-boot-knowledge-map.webp
tags: [java, jvm, spring-boot, concurrency, performance]
excerpt: 从调度原理、版本差异到 Spring Boot 聚合接口实战，讲清虚拟线程的适用边界、下游限流、上下文传播与排障方法。
---

# Java 21 虚拟线程在 Spring Boot 中的工程化实践
<img src="/images/posts/java-virtual-threads-spring-boot-knowledge-map.webp" alt="Java 21 虚拟线程在 Spring Boot 中的工程化实践知识串联图" style="border-radius: 10px;" />

在传统 Spring MVC 应用中，一个请求通常占用一个平台线程。线程执行 JDBC、HTTP 或 Redis 调用时，大部分时间其实在等待 I/O，但底层操作系统线程仍被占用。为了避免线程数量失控，我们习惯用固定线程池限制并发；代价则是请求会在线程池队列中继续等待。

Java 21 正式交付的虚拟线程（Virtual Thread）提供了另一种选择：继续使用直观的同步阻塞代码，同时让 JVM 以更低的成本承载大量并发任务。它尤其适合“请求很多、I/O 等待多、单次计算少”的服务，但并不是打开一个配置就能无条件提升性能。

> 本文以 **JDK 21、Spring Boot 3.2+、Spring MVC** 为主要适用范围。JDK 19、20 中虚拟线程仍是预览特性；JDK 24 又改变了 `synchronized` 场景下的固定（pinning）行为，文末会单独说明。

## 一、先理解三种线程角色

虚拟线程没有取代平台线程，而是在 JVM 中增加了一层调度。

| 角色 | 由谁调度 | 与操作系统线程的关系 | 典型用途 |
|---|---|---|---|
| 平台线程（Platform Thread） | 操作系统 | 通常与一个 OS 线程一一绑定 | CPU 密集任务、传统线程池 |
| 虚拟线程（Virtual Thread） | JVM | 生命周期内可先后运行在不同平台线程上 | 大量短生命周期、阻塞式 I/O 任务 |
| 载体线程（Carrier Thread） | JVM 与操作系统共同参与 | 承载虚拟线程实际执行的工作线程 | JVM 内部实现细节，不应作为业务资源池使用 |

虚拟线程执行 Java 代码时，会被 JVM **挂载**到某个载体线程。遇到 JDK 能识别的阻塞 I/O 后，虚拟线程可以卸载，保存执行状态并让出载体线程；I/O 就绪后，再由调度器将它挂载到可用载体线程继续运行。

因此，虚拟线程的核心收益不是“单个任务跑得更快”，而是减少 I/O 等待期间对 OS 线程的占用，从而提高系统可承载的并发任务数。

```text
请求 A ──计算──等待数据库…………继续执行──结束
              ↓ 卸载             ↑ 重新挂载
载体线程 ──请求 A──请求 B──请求 C──请求 A──
```

这套模型有三个直接结论：

1. 虚拟线程适合 JDBC、阻塞式 HTTP 客户端、文件 I/O 等等待时间占比较高的任务。
2. CPU 密集任务仍受 CPU 核数限制，创建更多虚拟线程不会增加算力。
3. 虚拟线程很轻量，但数据库连接、文件描述符、下游接口容量并没有随之变多。

## 二、Spring Boot 3.2+ 如何启用虚拟线程

Spring Boot 3.2 开始提供正式支持。应用运行在 Java 21+ 时，可以通过配置启用：

```yaml
spring:
  threads:
    virtual:
      enabled: true # 让受 Spring Boot 管理的执行器优先使用虚拟线程
  main:
    keep-alive: true # 仅剩守护线程时仍保持 JVM 存活，纯调度/消息应用尤其需要关注
```

在 Spring Boot 3.2 中，开启后会影响这些常见入口：

- Tomcat、Jetty 的 Servlet 请求处理线程；
- 自动配置的 `applicationTaskExecutor`，包括常见的 `@Async` 任务；
- 自动配置的任务调度器；
- 部分消息与数据组件的自动配置执行器。

线程池专属的 `spring.task.execution.pool.*` 配置不会继续控制虚拟线程执行器。原因很简单：虚拟线程采用“一个任务一个线程”的模型，不需要维护一组可复用的虚拟工作线程。

可以临时增加一个诊断接口，确认控制器是否运行在虚拟线程中：

```java
@RestController
@RequestMapping("/diagnostics")
public class ThreadDiagnosticsController {

    @GetMapping("/thread")
    public Map<String, Object> currentThread() {
        Thread thread = Thread.currentThread();
        return Map.of(
                "name", thread.getName(),
                "virtual", thread.isVirtual() // Java 21 提供的虚拟线程判断方法
        );
    }
}
```

启用成功只代表请求处理线程发生了变化，并不代表吞吐量一定提升。是否有效还取决于数据库连接池、下游限流、锁竞争和 CPU 使用率。

## 三、真实场景：并行聚合多个下游接口

假设商品详情接口需要同时查询库存、价格和会员权益。只把请求线程改成虚拟线程，并不会自动把三个串行调用变成并行调用；要缩短聚合耗时，仍需显式并发。

### 1. 注册任务级虚拟线程执行器

```java
@Configuration
public class VirtualThreadConfiguration {

    @Bean(destroyMethod = "close")
    public ExecutorService virtualThreadExecutor() {
        // 每个提交的任务创建一个虚拟线程，不复用虚拟线程池
        return Executors.newVirtualThreadPerTaskExecutor();
    }
}
```

将执行器做成单例 Bean，是为了统一管理生命周期和调用入口，而不是复用虚拟线程本身。不要在每个请求中反复创建、关闭执行器。

### 2. 并行执行三个阻塞调用

```java
@Service
public class ProductDetailService {

    private final ExecutorService virtualThreadExecutor;
    private final InventoryClient inventoryClient;
    private final PriceClient priceClient;
    private final MemberBenefitClient benefitClient;

    public ProductDetailService(
            ExecutorService virtualThreadExecutor,
            InventoryClient inventoryClient,
            PriceClient priceClient,
            MemberBenefitClient benefitClient) {
        this.virtualThreadExecutor = virtualThreadExecutor;
        this.inventoryClient = inventoryClient;
        this.priceClient = priceClient;
        this.benefitClient = benefitClient;
    }

    public ProductDetail query(long userId, long productId) {
        CompletableFuture<Stock> stockFuture = CompletableFuture.supplyAsync(
                () -> inventoryClient.query(productId), virtualThreadExecutor);
        CompletableFuture<Price> priceFuture = CompletableFuture.supplyAsync(
                () -> priceClient.query(productId), virtualThreadExecutor);
        CompletableFuture<MemberBenefit> benefitFuture = CompletableFuture.supplyAsync(
                () -> benefitClient.query(userId, productId), virtualThreadExecutor);

        // join 会在任一子任务失败时抛出 CompletionException，统一异常处理应保留原始 cause
        CompletableFuture.allOf(stockFuture, priceFuture, benefitFuture).join();

        return new ProductDetail(
                productId,
                stockFuture.join(),
                priceFuture.join(),
                benefitFuture.join()
        );
    }
}
```

如果三个下游耗时分别为 80 ms、120 ms、60 ms，串行调用的理论等待时间约为 260 ms，并行后接近最慢调用的 120 ms。但这属于**业务并行化**带来的延迟收益；虚拟线程的价值是以较低线程成本支撑大量这样的阻塞式聚合请求。

生产代码还应在 HTTP 客户端层配置连接超时、读取超时和连接池等待超时。仅使用 `CompletableFuture.orTimeout`，并不保证底层阻塞 I/O 会立即被取消。

## 四、不要用线程池充当下游限流器

平台线程昂贵，固定线程池过去同时承担了“复用线程”和“限制并发”两个职责。虚拟线程不需要复用，但下游系统仍然需要保护，此时应把限流职责显式交给 `Semaphore`、连接池或专用限流组件。

```java
@Component
public class InventoryClient {

    private final RestClient restClient;
    private final Semaphore permits = new Semaphore(50, true);

    public InventoryClient(RestClient.Builder builder) {
        this.restClient = builder.baseUrl("http://inventory-service").build();
    }

    public Stock query(long productId) {
        boolean acquired = false;
        try {
            // 最多允许 50 个库存请求同时进入下游，等待过久则快速失败
            acquired = permits.tryAcquire(200, TimeUnit.MILLISECONDS);
            if (!acquired) {
                throw new IllegalStateException("库存服务当前繁忙");
            }

            return restClient.get()
                    .uri("/api/stocks/{productId}", productId)
                    .retrieve()
                    .body(Stock.class);
        } catch (InterruptedException ex) {
            // 恢复中断标记，交由上层决定取消或降级策略
            Thread.currentThread().interrupt();
            throw new IllegalStateException("库存查询被中断", ex);
        } finally {
            if (acquired) {
                permits.release();
            }
        }
    }
}
```

许可数应根据下游 SLA、连接池大小和压测结果确定，而不是照搬示例中的 50。对于 JDBC，数据库连接池本身已经具备并发闸门作用，通常不需要再叠加一个相同粒度的信号量，否则可能形成两层排队并增加超时判断难度。

## 五、版本差异：`synchronized` 固定问题不能一概而论

虚拟线程发生阻塞时，如果无法从载体线程卸载，就称为固定（pinning）。固定时间长、发生频繁时，会重新占满有限的载体线程，削弱虚拟线程的扩展性。

不同 JDK 版本的行为需要明确区分：

- **JDK 21**：虚拟线程在 `synchronized` 块或方法内执行阻塞操作，以及执行部分 native/外部函数调用时，可能固定载体线程。
- **JDK 24+**：JEP 491 改进了 JVM 监视器实现，虚拟线程在 `synchronized` 中阻塞时通常可以卸载；不应再机械地把所有 `synchronized` 改成 `ReentrantLock`。
- **仍需关注的情况**：native 调用回调 Java 后再阻塞、类加载与类初始化等少数场景仍可能固定。

JDK 21 排查固定问题时，可以使用：

```bash
# 仅适用于仍支持该诊断参数的版本；JDK 24 中设置它已不再生效
java -Djdk.tracePinnedThreads=full -jar app.jar
```

更通用的生产排查方式是使用 JDK Flight Recorder（JFR）观察虚拟线程事件，并结合阻塞时长和发生频率判断是否真的影响吞吐。短暂、偶发的固定通常不值得为了“零事件”进行高风险重构。

## 六、常见误区与踩坑

### 1. 把虚拟线程当成性能加速器

虚拟线程提升的是 I/O 密集系统的并发承载能力，不会让 SQL、远程接口或 CPU 计算本身更快。低并发系统开启后几乎没有变化也很正常。

### 2. 无限制放大下游压力

过去请求会卡在线程池队列中；改用虚拟线程后，大量任务可能更快地抵达数据库和下游服务。若连接池、接口配额与超时策略没有同步设计，瓶颈只会向后移动，甚至触发雪崩。

### 3. 继续池化虚拟线程

虚拟线程应按任务创建并在任务结束后销毁。使用固定虚拟线程池既没有必要，也会重新引入排队和容量配置问题。需要限制某段操作时，使用信号量或资源池表达真实约束。

### 4. 忽略事务和上下文边界

虚拟线程支持 `ThreadLocal`，所以 Spring MVC 在同一请求线程中的事务、SecurityContext 和日志上下文仍可正常工作。但提交到另一个虚拟线程的子任务已经切换线程：

- 父线程上的 `@Transactional` 事务不会自动传播到子任务；
- MDC、租户信息等普通 `ThreadLocal` 数据不会天然复制；
- 多个子任务也不应并发共享同一个 JDBC `Connection` 或可变实体。

需要跨任务传播时，应使用 Spring 的 `TaskDecorator`、可观测性组件提供的上下文传播机制，或显式传递只读参数。不要依赖“碰巧继承”的线程本地状态。

### 5. 在 ThreadLocal 中缓存重对象

为每个请求保存 traceId、用户 ID 这类小型上下文通常没有问题；但如果在 `ThreadLocal` 中缓存大缓冲区、解析器等昂贵对象，数十万虚拟线程会制造显著内存压力。此类对象应改为有界对象池、安全单例或按需创建。

### 6. 忽略守护线程生命周期

虚拟线程始终是守护线程。如果非 Web 应用只剩虚拟线程，JVM 可能提前退出。Spring Boot 提供的 `spring.main.keep-alive=true` 可以维持应用生命周期，消息消费和定时任务服务应重点检查。

## 七、落地时的最佳实践

1. **先识别负载类型**：只有阻塞式 I/O 占比较高，虚拟线程才通常有明显收益。
2. **先建立基线再切换**：记录吞吐量、P95/P99 延迟、CPU、堆内存、数据库连接池等待和下游错误率。
3. **保持任务短小且有边界**：为每次 HTTP、SQL 和锁等待设置明确超时，正确响应线程中断。
4. **按真实资源限流**：数据库看连接池，下游接口看配额与 SLA，不再用平台线程数量间接限流。
5. **审计跨线程上下文**：重点检查事务、MDC、鉴权、租户和链路追踪信息。
6. **按运行版本排查固定**：JDK 21 与 JDK 24+ 的监视器行为不同，优化建议不能混用。
7. **逐接口灰度与压测**：优先选择 I/O 占比高、依赖关系清晰的接口，观察瓶颈是否转移到连接池或下游服务。

## 八、总结

虚拟线程让 Java 服务重新获得“一个任务一个线程”的简单编程模型，又避免为大量 I/O 等待长期占用 OS 线程。对 Spring MVC、JDBC 和阻塞式 HTTP 客户端为主的项目，它能用较小的改造成本提高并发承载能力。

真正决定上线效果的并不是 `spring.threads.virtual.enabled=true` 这一行配置，而是完整的工程约束：识别 I/O 型负载、显式限制稀缺资源、设置超时、处理跨线程上下文，并根据实际 JDK 版本进行观测和排障。虚拟线程降低了线程成本，但没有消除系统容量边界。

## 参考资料

- [JEP 444：Virtual Threads（JDK 21 正式特性）](https://openjdk.org/jeps/444)
- [Oracle Java 21 虚拟线程指南](https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html)
- [Spring Boot 3.2 Release Notes：Virtual Threads](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.2-Release-Notes#support-for-virtual-threads)
- [JEP 491：Synchronize Virtual Threads without Pinning（JDK 24）](https://openjdk.org/jeps/491)
