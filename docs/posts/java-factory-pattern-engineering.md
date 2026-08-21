---
title: Java 工厂模式工程实践：简单工厂、工厂方法与抽象工厂
date: 2026-08-20
category: 后端开发
cover: /images/posts/java-factory-pattern-engineering-knowledge-map.webp
tags: [java, design-patterns, factory-method, abstract-factory, spring]
excerpt: 工厂模式的价值不是隐藏 new，而是把对象创建规则从业务流程中剥离。本文用支付渠道示例讲清简单工厂、工厂方法、抽象工厂的边界，并说明在 Spring 中如何用类型安全注册表替代不断增长的分支。
---

# Java 工厂模式工程实践：简单工厂、工厂方法与抽象工厂

<img src="/images/posts/java-factory-pattern-engineering-knowledge-map.webp" alt="Java 工厂模式工程实践：简单工厂、工厂方法与抽象工厂知识串联图" style="border-radius: 10px;" />

工厂模式的价值不是隐藏 new，而是把对象创建规则从业务流程中剥离。本文用支付渠道示例讲清简单工厂、工厂方法、抽象工厂的边界，并说明在 Spring 中如何用类型安全注册表替代不断增长的分支。

## 先说结论：变化点决定工厂形态

工厂适合处理“调用方只依赖抽象，但实例的选择、装配或生命周期会变化”的场景。创建逻辑只有一行且稳定时，直接构造通常更清楚；把每个对象都包装成工厂，只会增加跳转层级。

常见工厂形态可以完整分为三类：

| 形态 | 创建决定放在哪里 | 适用变化 | 主要代价 |
|---|---|---|---|
| 简单工厂 | 一个集中方法 | 产品种类少，选择规则稳定 | 新产品通常要修改分支；它不是 GoF 23 种模式之一 |
| 工厂方法 | 每个具体工厂实现一个创建方法 | 单个产品的创建步骤需要扩展 | 类数量增加 |
| 抽象工厂 | 一个工厂创建一族相关产品 | 整套实现必须配套切换 | 增加新的产品维度会修改全部工厂 |

三者不是逐级升级关系。简单工厂足够时不必套工厂方法；只创建一种产品时，也不应为了“高级”使用抽象工厂。

## 简单工厂：集中选择，不集中业务

假设支付服务需要根据渠道创建客户端。最直接的简单工厂如下：

```java
public enum PayChannel {
    WECHAT, ALIPAY
}

public interface PayClient {
    PayResult pay(PayCommand command);
}

public final class PayClientFactory {

    private PayClientFactory() {
    }

    public static PayClient create(PayChannel channel, PayProperties properties) {
        // 工厂只负责选择和装配，不在这里执行扣款、重试或记账
        return switch (channel) {
            case WECHAT -> new WechatPayClient(properties.wechat());
            case ALIPAY -> new AlipayPayClient(properties.alipay());
        };
    }
}
```

调用方不再知道构造参数，但工厂仍知道全部具体产品。它适合命令行工具、SDK 适配层或产品类型很少的模块。若每增加渠道都要修改巨大 `switch`，并且不同渠道还有独立依赖，集中工厂已经成为扩展瓶颈。

不要用字符串默默回退到默认实现。未知渠道应明确失败，否则配置错误可能把真实交易送到错误通道。

## 工厂方法：把创建步骤交给扩展者

工厂方法把“创建哪个产品”延迟给子类或实现类。抽象流程负责稳定步骤，具体工厂只负责创建对象：

```java
public abstract class PaymentExecutor {

    public final PayResult execute(PayCommand command) {
        validate(command);
        PayClient client = createClient();
        return client.pay(command);
    }

    protected abstract PayClient createClient();

    private void validate(PayCommand command) {
        // 统一校验放在稳定流程中，避免每个渠道重复实现
        if (command.amount().signum() <= 0) {
            throw new IllegalArgumentException("支付金额必须大于零");
        }
    }
}

public final class WechatPaymentExecutor extends PaymentExecutor {
    private final WechatProperties properties;

    public WechatPaymentExecutor(WechatProperties properties) {
        this.properties = properties;
    }

    @Override
    protected PayClient createClient() {
        // 微信渠道独立控制 SDK 初始化与依赖装配
        return new WechatPayClient(properties);
    }
}
```

它的重点是多态扩展，不是把静态 `create` 改成实例方法。若子类除了返回不同对象没有任何差异，Spring 依赖注入或构造器传入 `PayClient` 往往更简单。

## 抽象工厂：保证一族对象来自同一套实现

跨境支付可能需要成套切换支付客户端、退款客户端和签名器。它们必须属于同一供应商或同一环境，此时应创建“产品族”：

```java
public interface PaymentSuiteFactory {
    PayClient payClient();
    RefundClient refundClient();
    SignatureVerifier signatureVerifier();
}

public final class WechatSuiteFactory implements PaymentSuiteFactory {
    private final WechatProperties properties;

    public WechatSuiteFactory(WechatProperties properties) {
        this.properties = properties;
    }

    @Override
    public PayClient payClient() {
        return new WechatPayClient(properties);
    }

    @Override
    public RefundClient refundClient() {
        return new WechatRefundClient(properties);
    }

    @Override
    public SignatureVerifier signatureVerifier() {
        return new WechatSignatureVerifier(properties.platformCertificate());
    }
}
```

抽象工厂的核心约束是“整套兼容”：不能拿微信支付客户端配支付宝验签器。它容易增加新的产品族，例如再加一个渠道；却不容易增加新的产品维度。接口一旦新增 `billClient()`，所有具体工厂都必须补齐实现。这是它最重要的权衡。

## Spring 中更常用的是策略注册表

在 Spring 应用里，各渠道客户端通常已经由容器创建。此时再手写 `new` 工厂会绕过配置绑定、代理和生命周期管理。Spring 当前参考文档明确支持注入某一类型的全部 Bean；当目标是 `Map<String, T>` 时，键为 Bean 名称，值为对应 Bean。

为了避免把 Bean 名称当业务协议，可让实现显式声明渠道，再构建不可变注册表：

```java
public interface PayHandler {
    PayChannel channel();
    PayResult pay(PayCommand command);
}

@Component
public final class PayHandlerRegistry {
    private final Map<PayChannel, PayHandler> handlers;

    public PayHandlerRegistry(List<PayHandler> candidates) {
        EnumMap<PayChannel, PayHandler> registered = new EnumMap<>(PayChannel.class);
        for (PayHandler candidate : candidates) {
            PayHandler previous = registered.put(candidate.channel(), candidate);
            if (previous != null) {
                // 启动即失败，避免同一渠道在运行时随机命中某个实现
                throw new IllegalStateException("重复支付渠道: " + candidate.channel());
            }
        }
        this.handlers = Map.copyOf(registered);
    }

    public PayHandler required(PayChannel channel) {
        PayHandler handler = handlers.get(channel);
        if (handler == null) {
            throw new IllegalArgumentException("不支持的支付渠道: " + channel);
        }
        return handler;
    }
}
```

这仍承担简单工厂的“按类型取实现”职责，但对象创建交给 IoC 容器，注册表只负责业务键映射和完整性校验。它比注入 `ApplicationContext` 后到处 `getBean()` 更容易测试、审计和限制依赖边界。

需要区分三个相近概念：

- `@Bean` 方法是容器中的实例化入口，不等于 GoF 工厂方法模式；
- Spring `FactoryBean<T>` 是 IoC 容器的实例化扩展点，`getObject()` 返回产品，也不自动等于某种 GoF 工厂结构；
- JDK `ServiceLoader` 是服务提供者发现机制，适合插件边界。Java 21 的 `stream()` 可先检查 Provider 类型，再按需实例化，但发现、冲突处理和生命周期仍需应用定义。

## 选择工厂前先检查四个边界

### 1. 创建和使用是否真正分离

工厂返回可用对象即可，不应同时调用支付、写数据库或发送消息。否则它既是工厂又是业务服务，失败语义会变得模糊。

### 2. 产品是否需要成套一致

只选一个实现用简单工厂或注册表；创建步骤由扩展者定制用工厂方法；多个相关对象必须一起切换才用抽象工厂。

### 3. 生命周期由谁管理

SDK 客户端若维护连接池或线程，应由容器复用并在关闭时释放。每次请求都由工厂新建客户端，可能造成连接、线程和证书加载成本失控。

### 4. 失败是否尽早暴露

重复注册、缺少实现、配置不完整应在启动阶段失败。运行时选择失败要返回明确业务错误，不能静默降级到另一个支付渠道。

## 常见误区

1. **工厂里堆业务分支**：创建后又判断订单、执行优惠和重试，职责已经越界；
2. **用反射替代显式契约**：`Class.forName(type)` 看似开放，实际把类型安全、构造参数和权限检查推迟到运行时；
3. **所有对象都建工厂**：没有变化的值对象直接构造更清晰；
4. **抽象工厂只返回一个产品**：没有产品族约束时，它只是更重的普通工厂；
5. **依赖 Bean 名称作为外部协议**：重命名组件会破坏路由，业务枚举或稳定代码更合适；
6. **忽略对象销毁**：创建连接型产品时必须同时设计复用、关闭和健康检查。

## 总结

工厂模式解决的是创建变化，不是消灭 `new`。简单工厂集中少量选择；工厂方法把单个产品的创建交给扩展者；抽象工厂保证一族对象配套。进入 Spring 后，对象实例化通常应交给容器，业务侧保留一个显式、类型安全、启动时校验的注册表即可。

判断是否值得引入工厂，只需追问：变化的是产品类型、创建步骤，还是整套产品族？答案明确后，模式通常也就明确了。

参考资料（核对日期：2026-08-20）：

- [Java SE 21：ServiceLoader](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/ServiceLoader.html)
- [Spring Framework 7.0.8：Using @Autowired](https://docs.spring.io/spring-framework/reference/core/beans/annotation-config/autowired.html)
- [Spring Framework 7.0.8：Container Extension Points](https://docs.spring.io/spring-framework/reference/core/beans/factory-extension.html)
- [Spring Framework 7.0.8：Bean Overview](https://docs.spring.io/spring-framework/reference/core/beans/definition.html)
