---
title: Java 装饰器模式工程实践：组合增强、顺序语义与 Spring 边界
date: 2026-08-26
category: 后端开发
cover: /images/posts/java-decorator-pattern-engineering-knowledge-map.webp
tags: [java, design-pattern, spring]
excerpt: 装饰器模式的关键不是“多包一层”，而是在保持同一接口的前提下，用对象组合按需叠加职责。本文通过 Java 报价服务说明结构、装配顺序、异常边界、Spring 配置及其与代理、适配器的区别。
---

# Java 装饰器模式工程实践：组合增强、顺序语义与 Spring 边界

<img src="/images/posts/java-decorator-pattern-engineering-knowledge-map.webp" alt="Java 装饰器模式工程实践：组合增强、顺序语义与 Spring 边界知识串联图" style="border-radius: 10px;" />

装饰器模式的关键不是“多包一层”，而是在保持同一接口的前提下，用对象组合按需叠加职责。本文通过 Java 报价服务说明结构、装配顺序、异常边界、Spring 配置及其与代理、适配器的区别。

## 先说结论：装饰器解决的是可组合增强

当一个核心对象需要缓存、指标、校验、审计等可选能力时，继承很快会形成组合爆炸：`CachedQuoteService`、`MeteredQuoteService`、`CachedMeteredQuoteService`……装饰器把每项职责拆成一个实现相同接口的包装对象，运行时像套娃一样组合：

```text
调用方 → 指标装饰器 → 缓存装饰器 → 远程报价服务
                         ↓ 命中时直接返回
```

一个合格的装饰器通常满足四点：

1. 装饰器与被装饰对象实现同一业务接口；
2. 装饰器内部持有该接口，而不是绑定某个具体实现；
3. 默认把调用委托给内部对象，只在调用前后增加单一职责；
4. 替换成装饰后的对象，调用方不需要改变协议。

如果新对象改变的是接口，它更像适配器；如果主要目标是控制访问、远程调用或延迟创建，它更像代理。模式名称取决于设计意图，不取决于代码里是否出现了 `delegate` 字段。

## 最小结构：先定义数据，再定义委托链

下面用商品报价服务说明。先把接口契约和失败类型定义清楚，避免装饰器各自猜测什么错误能重试、什么结果能缓存。

```java
import java.math.BigDecimal;
import java.time.Duration;

public record QuoteRequest(
        long productId,
        long customerId,
        int quantity
) {
    public QuoteRequest {
        if (productId <= 0 || customerId <= 0) {
            throw new IllegalArgumentException("商品和客户 ID 必须为正数");
        }
        if (quantity <= 0 || quantity > 1_000) {
            throw new IllegalArgumentException("数量必须在 1..1000 之间");
        }
    }
}

public record QuoteResult(
        BigDecimal totalPrice,
        String currency,
        Duration validFor
) {}

public interface QuoteService {
    QuoteResult quote(QuoteRequest request);
}

public final class QuoteUnavailableException extends RuntimeException {
    public QuoteUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

抽象基类不是模式的必要条件，但能集中保存委托对象，并阻止 `null` 在链路深处才暴露：

```java
import java.util.Objects;

public abstract class QuoteServiceDecorator implements QuoteService {
    protected final QuoteService delegate;

    protected QuoteServiceDecorator(QuoteService delegate) {
        this.delegate = Objects.requireNonNull(delegate, "delegate");
    }
}
```

核心实现只负责访问上游，不关心缓存和指标：

```java
public final class RemoteQuoteService implements QuoteService {
    private final PricingClient client;

    public RemoteQuoteService(PricingClient client) {
        this.client = client;
    }

    @Override
    public QuoteResult quote(QuoteRequest request) {
        try {
            return client.fetch(request);
        } catch (PricingTimeoutException e) {
            // 在系统边界把底层异常翻译成稳定的领域异常
            throw new QuoteUnavailableException("报价服务暂时不可用", e);
        }
    }
}

public interface PricingClient {
    QuoteResult fetch(QuoteRequest request);
}

public final class PricingTimeoutException extends RuntimeException {
    public PricingTimeoutException(String message) {
        super(message);
    }
}
```

## 两个装饰器：缓存与指标各管一件事

缓存装饰器只缓存成功结果。上游异常、空值或已过期数据都不应伪装成有效报价：

```java
import java.util.Optional;

public final class CachedQuoteService extends QuoteServiceDecorator {
    private final QuoteCache cache;

    public CachedQuoteService(QuoteService delegate, QuoteCache cache) {
        super(delegate);
        this.cache = cache;
    }

    @Override
    public QuoteResult quote(QuoteRequest request) {
        QuoteKey key = QuoteKey.from(request);
        Optional<QuoteResult> cached = cache.get(key);
        if (cached.isPresent()) {
            return cached.get();
        }

        QuoteResult result = delegate.quote(request);
        cache.put(key, result, result.validFor());
        return result;
    }
}

public record QuoteKey(long productId, long customerId, int quantity) {
    public static QuoteKey from(QuoteRequest request) {
        return new QuoteKey(
                request.productId(), request.customerId(), request.quantity());
    }
}

public interface QuoteCache {
    Optional<QuoteResult> get(QuoteKey key);
    void put(QuoteKey key, QuoteResult result, Duration ttl);
}
```

指标装饰器使用 `finally` 保证成功和失败都记录耗时，同时保留原异常，不把可观测性故障变成业务故障：

```java
public final class MeteredQuoteService extends QuoteServiceDecorator {
    private final QuoteMetrics metrics;

    public MeteredQuoteService(QuoteService delegate, QuoteMetrics metrics) {
        super(delegate);
        this.metrics = metrics;
    }

    @Override
    public QuoteResult quote(QuoteRequest request) {
        long startedAt = System.nanoTime();
        String outcome = "success";
        try {
            return delegate.quote(request);
        } catch (RuntimeException e) {
            outcome = "failure";
            throw e;
        } finally {
            try {
                metrics.record(outcome, System.nanoTime() - startedAt);
            } catch (RuntimeException metricError) {
                // 指标是旁路能力：记录内部告警，但不能覆盖原业务结果或异常
                metrics.reportInternalFailure(metricError);
            }
        }
    }
}

public interface QuoteMetrics {
    void record(String outcome, long elapsedNanos);
    void reportInternalFailure(RuntimeException error);
}
```

这里没有把所有增强塞进一个“万能装饰器”。一个装饰器只有一个变化原因，才能独立测试、替换和排序。

## 顺序不是实现细节，而是业务语义

下面两种装配都能编译，但观测含义不同：

```java
QuoteService remote = new RemoteQuoteService(pricingClient);

// 方案 A：统计调用方看到的总延迟，缓存命中也计入请求量
QuoteService serviceA = new MeteredQuoteService(
        new CachedQuoteService(remote, quoteCache),
        quoteMetrics);

// 方案 B：只统计穿透缓存后的上游调用
QuoteService serviceB = new CachedQuoteService(
        new MeteredQuoteService(remote, quoteMetrics),
        quoteCache);
```

装饰链从外向内进入、从内向外返回。评审时至少明确：

- 缓存命中是否应计入调用量与延迟；
- 异常在哪一层被翻译，外层能看到哪种异常；
- 重试若存在，是重试整个链，还是只重试远程调用；
- 事务、锁、限流和超时覆盖的是单次尝试还是整个操作；
- `close()`、提交、回滚等资源语义由哪一层拥有。

JDK 的 `FilterInputStream` 就是经典的同接口包装结构：它持有另一个 `InputStream`，默认转发读取、跳过、关闭等操作，子类再增加缓冲、摘要、解压等能力。连续包装流时，解密、解压、缓冲的次序同样会改变结果。本文以 Java SE 25 API 为核对基线，核对日期为 2026-08-26。

## 在 Spring 中显式装配，避免循环依赖

装饰器适合在配置层按明确顺序组装，而不是让每个实现都用同一个 `QuoteService` 类型自动注入：

```java
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class QuoteConfiguration {

    @Bean
    QuoteService quoteService(
            PricingClient pricingClient,
            QuoteCache quoteCache,
            QuoteMetrics quoteMetrics) {

        QuoteService core = new RemoteQuoteService(pricingClient);
        QuoteService cached = new CachedQuoteService(core, quoteCache);
        return new MeteredQuoteService(cached, quoteMetrics);
    }
}
```

这种装配有三个好处：链路一眼可见、顺序可审查、单元测试无需启动 Spring。若必须把各层声明成独立 Bean，应使用清晰的限定名，并为最终对外 Bean 指定 `@Primary`；不要依赖 Bean 扫描顺序推断装饰顺序。

## 装饰器、代理、适配器与 AOP 怎么选

| 方案 | 接口关系 | 核心意图 | 适合场景 | 主要风险 |
|---|---|---|---|---|
| 装饰器 | 与目标相同 | 按对象组合叠加职责 | 单个能力链、顺序需要显式表达 | 层数过多后堆栈和装配难读 |
| 代理 | 通常与目标相同 | 控制访问或代表目标 | 远程调用、延迟加载、权限门面 | 调用方误以为是本地对象 |
| 适配器 | 输入接口与输出接口不同 | 转换协议 | 对接遗留 SDK、第三方模型 | 语义转换丢失信息 |
| Spring AOP | 由代理暴露目标接口或类 | 批量织入横切关注点 | 事务、鉴权、统一观测 | 自调用绕过、切点过宽、代理类型限制 |

选择标准不是“哪个更高级”，而是增强范围：

- 只增强一个明确对象，而且顺序属于业务设计：优先显式装饰器；
- 对大量 Bean 的同类方法统一应用事务、鉴权或日志：考虑 Spring AOP；
- 需要把第三方接口翻译为领域接口：使用适配器；
- 需要隐藏远程、权限或生命周期控制：使用代理。

Spring AOP 基于运行时代理。官方文档说明它使用 JDK 动态代理或 CGLIB；目标对象内部通过 `this` 发起的自调用不会经过代理，因此相应 advice 不会执行。装饰器没有这个特定的代理绕过问题，但如果核心对象绕过注入、直接持有未装饰实现，同样会跳过装饰链。两者都要保证调用方拿到的是最终入口。

## 常见失败与治理方法

### 1. 吞掉内部异常

缓存故障是否降级取决于契约：读缓存失败可以记录后访问上游，写缓存失败通常可以返回本次成功报价；但远程报价失败不能返回 `null` 假装成功。每层应写出允许降级的异常白名单。

### 2. 装饰器修改了接口语义

若核心服务承诺“每次读取实时价格”，外层擅自缓存就违反了替换原则。应把时效性写入接口或结果，例如 `validFor`，再由缓存层执行明确策略。

### 3. 链条过长

当一次调用经过十几层包装，排错成本会超过复用收益。可把稳定且总是共同出现的步骤合并成一个领域组件，但不要把无关横切能力重新揉成万能类。日志中记录固定的 `component` 和 `outcome`，不要用高基数字段做指标标签。

### 4. 重复增强

Spring AOP 已统一记录指标时，再套一层指标装饰器会重复计数。应在架构层维护“增强职责清单”，明确每项职责由装饰器、AOP、网关还是客户端库负责。

## 测试重点：验证顺序和失败边界

装饰器测试不只断言返回值，还应验证委托次数和事件顺序：

```java
@Test
void cacheHitShouldSkipRemoteButStillRecordOuterMetric() {
    QuoteService remote = request -> {
        throw new AssertionError("缓存命中时不应访问上游");
    };
    RecordingMetrics metrics = new RecordingMetrics();
    QuoteCache cache = new InMemoryQuoteCache(preloadedQuote());

    QuoteService service = new MeteredQuoteService(
            new CachedQuoteService(remote, cache), metrics);

    QuoteResult result = service.quote(validRequest());

    assertEquals(preloadedQuote(), result);
    assertEquals(List.of("success"), metrics.outcomes());
}
```

生产前至少覆盖缓存命中、缓存未命中、上游超时、缓存读写故障、指标故障和并发击穿。若加入重试，还要验证最大尝试次数、总超时、只重试可恢复异常，以及幂等边界。

## 参考资料

- [Java SE 25：FilterInputStream](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/FilterInputStream.html)
- [Spring Framework：AOP 代理机制](https://docs.spring.io/spring-framework/reference/core/aop/proxying.html)
- [Spring Framework：AOP 概念](https://docs.spring.io/spring-framework/reference/core/aop/introduction-defn.html)
