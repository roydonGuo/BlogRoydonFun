---
title: Java 适配器模式工程实践：类适配、对象适配与兼容边界
date: 2026-08-24
category: 后端开发
cover: /images/posts/java-adapter-pattern-engineering-knowledge-map.webp
tags: [java, design-patterns, adapter, integration, spring]
excerpt: 适配器模式不改变旧组件的核心能力，而是在边界处转换接口、数据与失败语义。本文完整比较类适配器与对象适配器，并用 Java 第三方物流接入讲清兼容层的工程边界。
---

# Java 适配器模式工程实践：类适配、对象适配与兼容边界

<img src="/images/posts/java-adapter-pattern-engineering-knowledge-map.webp" alt="Java 适配器模式工程实践：类适配、对象适配与兼容边界知识串联图" style="border-radius: 10px;" />

适配器模式不改变旧组件的核心能力，而是在边界处转换接口、数据与失败语义。本文完整比较类适配器与对象适配器，并用 Java 第三方物流接入讲清兼容层的工程边界。

## 先说结论：适配的是契约，不只是方法名

当业务已经依赖稳定接口，而旧系统、第三方 SDK 或不同协议提供了不兼容能力时，可在两者之间增加适配器。一个完整适配器至少要处理四类差异：

1. 方法形状：名称、参数、返回值和同步异步模型；
2. 数据语义：字段、单位、时区、枚举和空值；
3. 失败语义：错误码、异常、超时、重试和部分成功；
4. 生命周期：连接、线程、鉴权凭证和资源关闭。

只把 `createOrder` 改名为 `send`，却原样泄漏供应商 DTO 与错误码，不算建立了稳定兼容边界。

GoF 适配器有两种基本实现：

| 形态 | 复用方式 | 优点 | 主要限制 |
|---|---|---|---|
| 类适配器 | 继承被适配类，同时实现目标接口 | 代码短，可直接使用受保护成员 | 占用类继承位，耦合具体实现，不能继承 `final` 类 |
| 对象适配器 | 持有被适配对象并委托调用 | 可替换、组合、包装多个实现，生命周期更清楚 | 多一层委托，需要显式决定暴露哪些能力 |

Java 工程通常优先对象适配器。类适配器只适合被适配类稳定、确实需要继承能力且不会妨碍其他继承关系的局部场景。

## 四个角色先对齐

以物流下单为例：

- `ShipmentGateway` 是业务需要的目标接口（Target）；
- `LegacyCarrierClient` 是已有但接口不兼容的组件（Adaptee）；
- `LegacyCarrierAdapter` 负责转换（Adapter）；
- 订单服务只依赖 `ShipmentGateway`（Client）。

```java
public interface ShipmentGateway {

    ShipmentResult create(ShipmentCommand command);
}

public record ShipmentCommand(
        String requestId,
        String recipientName,
        String mobile,
        long weightGram) {
}

public record ShipmentResult(String trackingNo, ShipmentStatus status) {
}

public enum ShipmentStatus {
    ACCEPTED, REJECTED
}
```

目标接口使用业务语言，不应出现供应商的 `vendorCode`、签名串或原始响应对象。这样更换 SDK 时，订单服务无需跟着修改。

## 类适配器：通过继承完成转换

假设旧客户端是可继承类：

```java
public class LegacyCarrierClient {

    protected LegacyResponse submit(String receiver, String phone, int weightKg) {
        // 示例省略真实 HTTP 调用
        throw new UnsupportedOperationException("仅展示旧客户端契约");
    }
}

public final class ClassCarrierAdapter
        extends LegacyCarrierClient
        implements ShipmentGateway {

    @Override
    public ShipmentResult create(ShipmentCommand command) {
        // 旧接口只接受整千克，必须明确进位规则，不能直接截断
        int weightKg = Math.toIntExact((command.weightGram() + 999L) / 1000L);
        LegacyResponse response = submit(
                command.recipientName(),
                command.mobile(),
                weightKg);
        return mapResponse(response);
    }

    private ShipmentResult mapResponse(LegacyResponse response) {
        ShipmentStatus status = response.success()
                ? ShipmentStatus.ACCEPTED
                : ShipmentStatus.REJECTED;
        return new ShipmentResult(response.waybillNo(), status);
    }
}
```

类适配器紧凑，但继承同时带来约束。Java 类声明只有一个直接父类；若适配器还要继承框架基类，就无法继续继承旧客户端。旧类变成 `final`、修改受保护方法或把内部状态暴露给子类，也会直接影响适配器。

更重要的是，“能继承”不等于“是同一种对象”。适配器通常只是在使用旧客户端，而不是旧客户端的一种业务子类型。关系表达不自然时，应改用组合。

## 对象适配器：通过组合隔离变化

对象适配器持有目标对象，工程上更常用：

```java
public final class ObjectCarrierAdapter implements ShipmentGateway {

    private final LegacyCarrierClient client;

    public ObjectCarrierAdapter(LegacyCarrierClient client) {
        // 依赖从外部注入，便于统一管理连接、凭证和关闭时机
        this.client = Objects.requireNonNull(client);
    }

    @Override
    public ShipmentResult create(ShipmentCommand command) {
        validate(command);
        int weightKg = Math.toIntExact((command.weightGram() + 999L) / 1000L);

        try {
            LegacyResponse response = client.submit(
                    command.recipientName(),
                    command.mobile(),
                    weightKg);
            return mapResponse(response);
        } catch (LegacyTimeoutException ex) {
            // 超时结果未知，不能误报为确定失败并直接重复下单
            throw new ShipmentResultUnknownException(command.requestId(), ex);
        } catch (LegacyRejectedException ex) {
            // 将供应商异常转换为稳定的领域错误
            throw new ShipmentRejectedException(ex.code(), ex.getMessage(), ex);
        }
    }

    private void validate(ShipmentCommand command) {
        if (command.weightGram() <= 0) {
            throw new IllegalArgumentException("包裹重量必须大于零");
        }
        if (command.requestId() == null || command.requestId().isBlank()) {
            throw new IllegalArgumentException("requestId 不能为空");
        }
    }

    private ShipmentResult mapResponse(LegacyResponse response) {
        ShipmentStatus status = response.success()
                ? ShipmentStatus.ACCEPTED
                : ShipmentStatus.REJECTED;
        return new ShipmentResult(response.waybillNo(), status);
    }
}
```

组合让同一个目标接口可以包装不同 SDK，也能在外层增加指标、限流或审计装饰。适配器只负责一个供应商到领域契约的映射；供应商选择应交给工厂或策略注册表，避免适配器内部再次堆积渠道分支。

## 兼容层真正难在语义转换

### 单位与精度

克、千克、分、元、秒和毫秒不能只靠变量名提醒。适配器应固定转换方向，显式处理舍入与溢出，并在边界处校验。金额优先使用最小货币单位或 `BigDecimal`，不要用 `double` 转换协议金额。

### 枚举与未知值

供应商增加状态的速度可能快于应用发布。对未知枚举不能静默映射成“成功”；应保留原始值并进入 `UNKNOWN`、告警或人工处理路径。只有业务明确允许时才能降级。

### 超时与幂等

远程写请求超时表示“结果未知”，不等于“对方未执行”。适配器应传递稳定幂等键，查询原请求结果后再决定是否重试。自动重试必须限制次数、退避范围和可重试错误集合。

### 异常与可观测性

领域层不应捕获几十种 SDK 异常，但适配器也不能丢掉诊断信息。建议保留供应商代码、请求 ID、耗时和重试次数；日志中脱敏手机号、地址、Token 与签名，指标标签不要放高基数字段。

## 与相近模式的边界

| 模式 | 核心目的 | 是否改变调用契约 |
|---|---|---|
| 适配器 | 让不兼容接口可以协作 | 通常改变 |
| 外观 | 给复杂子系统提供更简单入口 | 可能改变，但重点是简化 |
| 装饰器 | 在保持接口不变时叠加职责 | 通常不改变 |
| 代理 | 控制对同一能力的访问 | 通常不改变 |
| 策略 | 在同一契约下替换算法或实现 | 不改变 |

这些模式可以组合：多个供应商适配器都实现 `ShipmentGateway`，策略注册表选择其中一个，外层装饰器统一记录指标。但每一层应只有一个变化原因，否则结构会比原始分支更难理解。

## JDK 与 Spring 中的典型例子

Java SE 25 文档把 `InputStreamReader` 明确定义为字节流到字符流的桥梁：它持有 `InputStream`，按指定字符集解码并提供 `Reader` 契约。这是对象适配器的直观例子，也提醒我们编码不是方法签名问题，而是数据语义的一部分。

Spring Framework 7.0.8 的 `HandlerAdapter` 则让 `DispatcherServlet` 通过统一接口调用不同类型的处理器。适配器先用 `supports` 判断能否处理目标，再通过 `handle` 执行。它是框架扩展 SPI，并不意味着业务应用需要为普通 Controller 自行实现一个 `HandlerAdapter`。

## 落地检查清单

1. 目标接口是否使用稳定业务语言，而非复制供应商 DTO；
2. 适配器是否只处理一个外部契约，没有混入渠道选择和业务编排；
3. 单位、时区、精度、空值和未知枚举是否有明确规则；
4. 超时是否按结果未知处理，写操作是否具备幂等键；
5. 异常转换是否保留可诊断信息，同时完成敏感数据脱敏；
6. SDK 的连接、线程和凭证生命周期是否由明确所有者管理；
7. 可替换性是否确有价值；若两端接口本来就一致，不要为了模式增加空壳委托。

## 总结

适配器模式的价值是把兼容成本锁在系统边界。类适配器用继承换取简短实现，但受单继承和具体类变化约束；对象适配器用组合获得替换能力、生命周期控制和更清晰的所有权，通常更适合 Java 后端集成。

真正决定适配层质量的不是类图，而是数据与失败语义：单位怎么换、未知状态怎么处理、超时能否重试、资源由谁关闭。把这些规则写进一个窄而稳定的边界，业务核心才能不被外部协议拖着变化。

参考资料（核对日期：2026-08-24）：

- [Java SE 25：InputStreamReader](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/InputStreamReader.html)
- [Java SE 25 语言规范：8.1.4 Superclasses and Subclasses](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.1.4)
- [Spring Framework 7.0.8：HandlerAdapter](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/servlet/HandlerAdapter.html)
