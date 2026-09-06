---
title: Tomcat 并发容量工程实践：maxThreads、maxConnections、acceptCount 与过载保护
date: 2026-09-06
category: 后端开发
cover: /images/posts/tomcat-concurrency-capacity-engineering-knowledge-map.webp
tags: [tomcat, spring-boot, concurrency, capacity-planning, observability]
excerpt: Tomcat 能承载多少请求没有单一答案：maxThreads 限制同步请求的并行执行，maxConnections 限制已接纳连接，acceptCount 只影响连接上限后的操作系统等待队列；容量必须由下游预算、延迟目标和压测结果共同确定，并用超时、限流与可观测性阻止排队失控。
---

# Tomcat 并发容量工程实践：maxThreads、maxConnections、acceptCount 与过载保护

<img src="/images/posts/tomcat-concurrency-capacity-engineering-knowledge-map.webp" alt="Tomcat 并发容量工程实践：maxThreads、maxConnections、acceptCount 与过载保护知识串联图" style="border-radius: 10px;" />

Tomcat 能承载多少请求没有单一答案：maxThreads 限制同步请求的并行执行，maxConnections 限制已接纳连接，acceptCount 只影响连接上限后的操作系统等待队列；容量必须由下游预算、延迟目标和压测结果共同确定，并用超时、限流与可观测性阻止排队失控。

## 先说结论：连接数、并发请求数和吞吐量不是一回事

回答“一个 Tomcat 最多能同时处理多少个 HTTP 请求”前，先拆开三个量：

1. **连接数**：客户端与 Connector 保持的 TCP 连接，包括正在处理、Keep-Alive 空闲和等待可用工作线程的连接；
2. **并行执行数**：同一时刻真正进入 Servlet 业务代码的同步请求，通常受工作线程数约束；
3. **吞吐量**：单位时间完成的请求数，还取决于单请求耗时、CPU、数据库、缓存和外部服务。

经典平台线程模式下，`maxThreads=200` 不等于“最多 200 个连接”，更不等于“固定 200 QPS”。若平均请求耗时是 100 ms，200 个工作线程的理论上界约为 2000 QPS；若请求因数据库等待拉长到 2 秒，上界就只剩约 100 QPS。实际值还要扣除调度、网络、GC、锁竞争和长尾延迟。

本文以 **Apache Tomcat 11.0.25** 与 **Spring Boot 4.1.1** 官方文档为事实基线，核对日期为 **2026-09-06**。不同 Tomcat、Spring Boot 版本和 Connector 实现的默认值可能变化，升级后应重新核对配置元数据，不能复制旧文章的参数表。

## 一、一次同步请求会经过三层容量边界

Tomcat 11 的 NIO Connector 默认是非阻塞连接管理，但普通、非异步 Servlet 请求在执行期间仍需要一个工作线程。请求高峰可以简化为：

```text
新连接
  ↓
操作系统连接等待队列（acceptCount）
  ↓
Tomcat 已接纳连接（maxConnections）
  ↓
工作线程执行同步请求（maxThreads）
  ↓
Controller → Service → 数据库 / 缓存 / 外部 API
```

这三层不是可以相加的“总容量”。它们限制的是不同阶段：

| 参数 | 限制对象 | 达到上限后的典型行为 | 常见误区 |
| --- | --- | --- | --- |
| `maxThreads` | 请求处理线程 | 连接可继续存在，请求等待可用线程 | 当成最大连接数或 QPS |
| `maxConnections` | Tomcat 接纳并处理的连接 | 后续连接主要在操作系统队列等待 | 越大越能提高吞吐 |
| `acceptCount` | 操作系统提供的连接等待队列 | 队列满后连接可能被拒绝或超时 | 当成 Tomcat 内部请求队列 |

Tomcat 官方还明确提醒：操作系统可能忽略 `acceptCount` 并采用不同的实际队列长度。因此，它只能表达期望上限，不能替代操作系统观测和压测。

## 二、`maxThreads` 决定同步业务代码的并行度

Tomcat 11.0.25 的内部工作线程默认上限是 200。Spring Boot 4.1.1 对应配置为：

```yaml
server:
  tomcat:
    threads:
      max: 200
      min-spare: 20
```

`min-spare` 是保持运行的最少线程，不是保留给高优先级请求的配额。流量上升时，Tomcat 按需创建工作线程，直到 `max`。

工作线程不能只按 CPU 核数设置。CPU 密集型请求需要较低并行度避免上下文切换；大量等待数据库或远程接口的阻塞型请求可以容纳更多线程，但上限必须服从更稀缺的下游资源：

```text
安全工作线程上限 <= min(
  数据库可用连接预算 / 单请求平均占用连接数,
  下游允许并发数,
  JVM 线程与栈内存预算,
  达到目标 P99 时压测得到的并发数
)
```

例如应用允许业务使用 80 个数据库连接，而一个请求在主要阶段通常占用 1 个连接，把 `maxThreads` 从 200 提到 800 不会让数据库变快。高峰时只会让更多线程等待连接池，堆积更多请求对象，并扩大超时后的重试风暴。

### 异步 Servlet 会改变线程占用，不会消灭容量边界

Servlet 异步处理可以在等待期间释放容器工作线程，适合长轮询或由异步客户端驱动的 I/O。但后续回调、业务执行和响应写回仍消耗 CPU、内存与下游并发。异步只改变“等待时是否长期占住平台线程”，不是无限并发开关。

### 虚拟线程也不能替下游扩容

Tomcat 11 支持内部执行器使用虚拟线程；Spring Boot 4.1.1 可通过 `spring.threads.virtual.enabled=true` 启用虚拟线程支持。官方属性表同时说明，启用虚拟线程后 `server.tomcat.threads.max` 和 `min-spare` 不再生效。

```yaml
spring:
  threads:
    virtual:
      enabled: true
```

虚拟线程降低“一个阻塞请求对应一个昂贵平台线程”的成本，但数据库连接、第三方限额、CPU、内存和 Socket 仍是有限资源。迁移后必须补上独立的并发门控，不能依赖原来的 `maxThreads` 充当总闸门：

```java
import java.util.concurrent.Semaphore;

public final class PaymentConcurrencyGuard {
    private final Semaphore permits = new Semaphore(64);

    public <T> T execute(CheckedSupplier<T> action) throws Exception {
        // 不无限等待：容量耗尽时尽快失败，让上游执行退避策略。
        if (!permits.tryAcquire()) {
            throw new ServiceBusyException("支付通道繁忙，请稍后重试");
        }
        try {
            return action.get();
        } finally {
            permits.release();
        }
    }

    @FunctionalInterface
    public interface CheckedSupplier<T> {
        T get() throws Exception;
    }
}
```

真实项目应按依赖分别限并发，例如数据库、支付和大模型接口各有独立预算，不能用一个全局信号量掩盖瓶颈位置。

## 三、`maxConnections` 管连接，不直接管业务执行

Tomcat 11.0.25 NIO/NIO2 Connector 的 `maxConnections` 默认值是 8192。Spring Boot 4.1.1 对应配置为：

```yaml
server:
  tomcat:
    max-connections: 4096
    keep-alive-timeout: 20s
    max-keep-alive-requests: 100
```

连接数可以显著高于工作线程数，因为 NIO Poller 能管理大量未在业务代码中执行的连接。一个 Keep-Alive 连接可能暂时空闲，也可能连续承载多个请求；HTTP/2 更允许一条连接上存在多个并发流。因此，连接数不能直接换算成并发请求数。

`maxConnections` 过低会让健康流量过早在内核队列等待；过高则会增加 Socket、缓冲区、TLS 状态和请求解析相关内存，并让慢客户端占据容量。需要同时治理：

- `connection-timeout`：接纳连接后等待请求行的时间；
- `keep-alive-timeout`：等待同一连接下一个请求的时间；
- `max-keep-alive-requests`：一条连接最多承载的 Keep-Alive 请求数；
- 代理层的空闲超时：应与应用侧策略协调，避免代理和 Tomcat 对连接寿命判断相反。

超时不是越短越安全。上传、移动网络和跨地域请求需要合理余量；应基于正常流量分布设定，并对慢请求、慢上传和异常断连分别观测。

## 四、`acceptCount` 是缓冲垫，不是扩容按钮

Spring Boot 4.1.1 的 `server.tomcat.accept-count` 默认值为 100：

```yaml
server:
  tomcat:
    accept-count: 200
```

当 `maxConnections` 已到上限，操作系统仍可能把后续连接放入等待队列；队列满后，新连接可能直接被拒绝，也可能等待到客户端超时。

把 `acceptCount` 调得很大只会延迟失败。若应用稳定吞吐是每秒 500 个请求，额外排队 5000 个请求意味着排队本身就可能增加约 10 秒延迟；客户端若在 2 秒时重试，同一个业务请求还会制造更多连接。最终表现是 P99 先恶化，随后内存、线程和下游一起被拖垮。

更可靠的策略是让等待队列保持有界，并在进入 Tomcat 前后尽早拒绝：

1. 网关按租户、接口和调用方限流，返回明确的 `429` 与退避建议；
2. 应用按稀缺下游资源做舱壁隔离，避免一个慢接口耗尽全部容量；
3. 客户端只对幂等操作重试，采用指数退避、抖动和次数上限；
4. 超过服务时间预算时尽快取消下游调用，不继续消耗无效资源。

## 五、一份可落地的 Spring Boot 配置起点

下面不是通用最优值，而是一份必须经压测校准的起点：

```yaml
server:
  tomcat:
    threads:
      max: 160
      min-spare: 20
    max-connections: 4096
    accept-count: 200
    connection-timeout: 10s
    keep-alive-timeout: 20s
    max-keep-alive-requests: 100
    # Spring Boot 只有启用 MBean Registry 后才自动绑定 Tomcat 指标。
    mbeanregistry:
      enabled: true

management:
  endpoints:
    web:
      exposure:
        include: health,metrics,prometheus
```

配置顺序应从业务预算出发：

1. 先确定数据库、缓存和外部服务能接受的并发；
2. 再用压测找出满足目标 P95/P99 的工作线程或虚拟线程并发门限；
3. 根据 Keep-Alive 比例、客户端数量和内存预算设置连接上限；
4. 最后为短突发保留有限连接等待空间，并验证满载时的拒绝行为。

不要在线上只改一个参数后观察平均 QPS。每组配置至少记录吞吐、P50/P95/P99、错误率、活跃线程、连接数、数据库池等待、CPU、堆内存和 GC 暂停。

## 六、监控要能区分“线程满”“连接满”和“下游慢”

Spring Boot Actuator 在 `server.tomcat.mbeanregistry.enabled=true` 时自动绑定 Tomcat 指标，指标名前缀为 `tomcat.`。具体 meter 名称应从当前应用的 `/actuator/metrics` 枚举，不要把监控面板绑定到未经验证的历史名称。

生产告警至少覆盖：

| 信号 | 组合判断 | 可能问题 |
| --- | --- | --- |
| 忙线程 / 最大线程持续接近 1 | HTTP P99 同时上升 | 工作线程饱和或业务阻塞 |
| 当前连接持续逼近上限 | 忙线程不一定满 | Keep-Alive 过长、慢客户端或连接洪峰 |
| 数据库活跃连接接近上限 | Tomcat 忙线程增长 | 下游数据库成为瓶颈 |
| 错误率和超时增长 | CPU 仍不高 | 排队、锁等待或外部依赖变慢 |
| CPU 饱和且吞吐不再增长 | 增线程后 P99 更差 | CPU 密集或上下文切换过多 |

压测应包含两类故障注入：把数据库响应延迟提高，验证线程与连接是否被逐步耗尽；把客户端 Keep-Alive 空闲时间拉长，验证连接上限和超时策略。只有正常流量压测，无法证明过载时系统会稳定退化。

## 七、容量估算用 Little's Law，最终答案用压测

稳定系统可用 Little's Law 做第一轮估算：

```text
系统内平均并发数 L = 吞吐量 λ × 平均停留时间 W
```

目标 1000 QPS、平均响应 120 ms 时，平均并发约为 120。但平均值看不到长尾：如果 1% 请求耗时 3 秒，这些慢请求会长期占用工作线程和下游连接。因此配置要以目标分位延迟、突发系数和故障场景校准，并保留安全余量。

一次可靠的压测流程是：

1. 固定请求模型、数据规模、Keep-Alive、HTTP 版本和上下游容量；
2. 阶梯增加到达率，而不是一开始就打满；
3. 找到吞吐停止增长、P99 急升或错误率越线的拐点；
4. 只调整一个容量参数，复测并记录瓶颈是否转移；
5. 在依赖变慢、实例摘除和重试开启时复测过载保护；
6. 把安全工作点设在拐点之前，而不是把实验极限当生产容量。

## 八、常见误区

### 误区 1：`maxThreads + acceptCount` 就是最大请求数

两者不在同一层：前者是请求执行线程，后者是连接上限后的操作系统等待队列。中间还有 `maxConnections`，并且 HTTP Keep-Alive、异步请求和 HTTP/2 都会破坏简单加法。

### 误区 2：线程越多，吞吐越高

只有业务主要在等待、且下游仍有余量时，增加线程才可能提高吞吐。数据库连接、CPU 或外部服务已满时，更多线程只增加争用和排队。

### 误区 3：虚拟线程等于无限并发

虚拟线程降低线程成本，不增加数据库连接、CPU 和第三方配额。启用后更需要显式的下游并发门控。

### 误区 4：队列越大，越不容易报错

大队列把快速失败改成慢超时，并可能触发上游重试。可靠系统要让容量有界、拒绝可观测、调用方能退避。

## 总结

Tomcat 的并发容量不是一个参数能回答的问题。经典同步请求的并行执行主要受 `maxThreads` 约束，已接纳连接受 `maxConnections` 约束，连接上限后的等待空间由 `acceptCount` 与操作系统共同决定。真正可用的生产容量还受数据库、外部服务、CPU、内存、请求耗时和重试策略限制。

正确顺序是：先给下游资源定预算，再用工作线程或独立门控限制并行度，根据连接行为配置 `maxConnections` 与 Keep-Alive 超时，用有限 `acceptCount` 吸收短突发，最后通过指标、阶梯压测和故障注入确认安全工作点。

## 参考资料

- [Apache Tomcat 11.0.25：HTTP Connector 配置](https://tomcat.apache.org/tomcat-11.0-doc/config/http.html)
- [Spring Boot 4.1.1：Common Application Properties](https://docs.spring.io/spring-boot/appendix/application-properties/index.html)
- [Spring Boot 4.1.1：Actuator Metrics 与 Tomcat 指标](https://docs.spring.io/spring-boot/reference/actuator/metrics.html)
