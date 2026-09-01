---
title: Java Builder 模式工程实践：分步构造、不变量与演进边界
date: 2026-09-01
category: 后端开发
cover: /images/posts/java-builder-pattern-engineering-knowledge-map.webp
tags: [java, design-pattern, builder, immutable-object, lombok]
excerpt: Builder 的价值不是把构造器改成链式调用，而是把复杂对象的收集、默认值、校验和最终冻结集中到一个构建边界；用得好能稳定演进对象契约，用错则会制造半成品、复用污染和隐蔽的空值。
---

# Java Builder 模式工程实践：分步构造、不变量与演进边界

<img src="/images/posts/java-builder-pattern-engineering-knowledge-map.webp" alt="Java Builder 模式工程实践：分步构造、不变量与演进边界知识串联图" style="border-radius: 10px;" />

Builder 的价值不是把构造器改成链式调用，而是把复杂对象的收集、默认值、校验和最终冻结集中到一个构建边界；用得好能稳定演进对象契约，用错则会制造半成品、复用污染和隐蔽的空值。

## 先说结论：Builder 是对象构建边界

当对象同时具有多个可选参数、跨字段约束、集合防御性复制或演进中的兼容要求时，Builder 很合适。它把创建过程拆成两种状态：

- `Builder` 是短生命周期、可变、允许尚未填完的施工区；
- 构建出的业务对象是完整、可验证、尽量不可变的成品。

如果类只有两三个含义清楚的字段，没有默认值和组合约束，构造器、静态工厂或 `record` 往往更直接。Builder 不是所有 DTO 的默认仪式，也不能替代领域校验。

本文以 Java SE 25 和 Lombok 当前官方文档为事实基线，核对日期为 **2026-09-01**。Builder 是设计模式，不依赖特定 JDK；文中的 `record`、`List.copyOf` 和现代语法需要按项目实际 Java 基线调整。

## 一、先认识四个角色

以创建支付请求为例，先定义结构，再看控制流：

```java
import java.time.Instant;
import java.util.List;
import java.util.Objects;

public final class PaymentRequest {
    private final String requestId;
    private final long merchantId;
    private final long amountCent;
    private final String currency;
    private final String description;
    private final List<String> tags;
    private final Instant expireAt;

    private PaymentRequest(Builder builder) {
        this.requestId = builder.requestId;
        this.merchantId = builder.merchantId;
        this.amountCent = builder.amountCent;
        this.currency = builder.currency;
        this.description = builder.description;
        this.tags = List.copyOf(builder.tags);
        this.expireAt = builder.expireAt;
    }

    public String currency() {
        return currency;
    }

    public List<String> tags() {
        return tags;
    }

    public static Builder builder(String requestId, long merchantId, long amountCent) {
        return new Builder(requestId, merchantId, amountCent);
    }

    public static final class Builder {
        private final String requestId;
        private final long merchantId;
        private final long amountCent;
        private String currency = "CNY";
        private String description = "";
        private List<String> tags = List.of();
        private Instant expireAt;

        private Builder(String requestId, long merchantId, long amountCent) {
            this.requestId = requestId;
            this.merchantId = merchantId;
            this.amountCent = amountCent;
        }

        public Builder currency(String currency) {
            this.currency = currency;
            return this;
        }

        public Builder description(String description) {
            this.description = description;
            return this;
        }

        public Builder tags(List<String> tags) {
            this.tags = List.copyOf(tags);
            return this;
        }

        public Builder expireAt(Instant expireAt) {
            this.expireAt = expireAt;
            return this;
        }

        public PaymentRequest build() {
            validate();
            return new PaymentRequest(this);
        }

        private void validate() {
            if (requestId == null || requestId.isBlank()) {
                throw new IllegalArgumentException("requestId 不能为空");
            }
            if (merchantId <= 0) {
                throw new IllegalArgumentException("merchantId 必须为正数");
            }
            if (amountCent <= 0) {
                throw new IllegalArgumentException("amountCent 必须为正数");
            }
            Objects.requireNonNull(currency, "currency 不能为空");
            if (expireAt != null && !expireAt.isAfter(Instant.now())) {
                throw new IllegalArgumentException("expireAt 必须晚于当前时间");
            }
        }
    }
}
```

这段代码包含四个角色：

| 角色 | 在示例中的位置 | 责任 |
| --- | --- | --- |
| 产品 | `PaymentRequest` | 保存最终状态，对外提供稳定业务语义 |
| 构建器 | `PaymentRequest.Builder` | 临时收集参数，提供命名清楚的设置方法 |
| 构建动作 | `build()` | 执行最终校验并创建成品 |
| 调用方 | 业务服务 | 决定本次要提供哪些可选信息 |

经典 Builder 还可能有 Director 负责固定装配步骤，但业务系统通常不需要为了“角色齐全”强行增加一个类。只有多处都要复用同一构建流程时，才把流程抽成命名明确的工厂或装配器。

## 二、必填参数应尽早暴露

最松散的 Builder 允许所有字段从默认零值开始，直到 `build()` 才发现漏填：

```java
PaymentRequest.builder()
        .description("订单支付")
        .build(); // requestId、merchantId、amountCent 到此才报错
```

这会把本可由方法签名表达的约束变成运行时错误。示例把三个稳定必填项放进 `builder(...)`：

```java
PaymentRequest request = PaymentRequest
        .builder("pay-20260901-001", 10001L, 29900L)
        .description("年度订阅")
        .expireAt(Instant.now().plusSeconds(900))
        .build();
```

选择规则很简单：

1. 长期稳定且每次都必填的字段，放入 Builder 工厂或构造器；
2. 有合理默认值或确实可缺省的字段，保留链式方法；
3. 只有特定业务分支才必填的字段，在 `build()` 做跨字段校验；
4. 如果必填步骤有严格顺序，可用 staged builder，但要接受接口数量和泛型复杂度。

不要用十几个阶段接口只换取“编译期不能漏填”。当对象频繁演进时，阶段接口会放大修改面。多数后端领域对象采用“少量必填构造参数 + 构建时完整校验”更平衡。

## 三、不变量必须在成品诞生前成立

字段级非空只是最低门槛，真正重要的是跨字段业务约束。例如退款请求可能要求：部分退款必须给出金额，全额退款则禁止重复传金额。

```java
public enum RefundMode {
    FULL,
    PARTIAL
}

public record RefundRequest(
        String paymentId,
        RefundMode mode,
        Long amountCent,
        String reason
) {
    public RefundRequest {
        if (paymentId == null || paymentId.isBlank()) {
            throw new IllegalArgumentException("paymentId 不能为空");
        }
        if (mode == null) {
            throw new IllegalArgumentException("mode 不能为空");
        }
        if (mode == RefundMode.PARTIAL && (amountCent == null || amountCent <= 0)) {
            throw new IllegalArgumentException("部分退款必须提供正数金额");
        }
        if (mode == RefundMode.FULL && amountCent != null) {
            throw new IllegalArgumentException("全额退款不能重复指定金额");
        }
    }
}
```

Builder 最终应调用这个受约束的构造入口，而不是绕开它。校验可以分层：

- 链式方法做局部、无上下文的快速拒绝，例如拒绝负数；
- `build()` 或产品构造器做跨字段不变量；
- 应用服务做需要查数据库或远端系统的业务判断。

不要在 Builder 中查询库存、账户余额或权限服务。构建对象应保持确定、快速、无外部副作用，否则一个普通 `build()` 会变成隐藏的网络事务，既难测试也难重试。

## 四、不可变成品需要防御性复制

把字段声明为 `final` 不等于对象不可变。如果 Builder 把可变集合引用直接交给成品，调用方仍能从外部修改它：

```java
List<String> tags = new ArrayList<>();
tags.add("vip");

PaymentRequest request = PaymentRequest
        .builder("pay-1", 10001L, 29900L)
        .tags(tags)
        .build();

tags.add("tampered"); // 若未复制，成品可能被悄悄改变
```

因此要在输入和冻结边界上明确复制。`List.copyOf` 会创建不可修改快照，并拒绝 `null` 元素；如果业务允许 `null`，应先定义清楚语义，而不是换回可变集合掩盖问题。

同样要注意：集合不可修改只代表容器结构被冻结，元素对象仍可能可变。领域对象若要真正不可变，元素也应采用不可变值对象，或在边界上逐项复制。

## 五、Builder 可以复用，但通常不该复用

Builder 本身是可变对象，默认不应跨线程共享，也不应作为 Spring 单例字段：

```java
// 错误：多个请求会竞争并串用上一次留下的字段。
@Service
public class PaymentAssembler {
    private final PaymentRequest.Builder shared =
            PaymentRequest.builder("placeholder", 1L, 1L);
}
```

每次构建都创建新 Builder，成本通常可以忽略。即便实现允许同一个 Builder 连续 `build()`，后一次也会继承前一次状态，尤其容易污染集合、默认值和可选字段。

需要从已有对象派生新对象时，应显式提供复制入口：

```java
public Builder toBuilder() {
    return new Builder(requestId, merchantId, amountCent)
            .currency(currency)
            .description(description)
            .tags(tags)
            .expireAt(expireAt);
}
```

调用方随后只修改差异：

```java
PaymentRequest renewed = original.toBuilder()
        .expireAt(Instant.now().plusSeconds(1800))
        .build();
```

这里仍是浅复制语义；字段中若包含可变对象，需要明确复制深度。

## 六、不要让 Builder 吞掉对象演进问题

Builder 能让新增可选字段对调用方更友好，但不能保证所有演进都兼容：

| 变化 | 常见影响 | 更稳妥的处理 |
| --- | --- | --- |
| 新增可选字段 | 旧调用方仍可构建 | 提供明确默认值并补兼容测试 |
| 新增必填字段 | 旧调用方可能运行时失败 | 修改必填工厂签名，或引入新的构建入口 |
| 字段改名 | 链式 API 破坏 | 保留旧方法并标记弃用，内部转发到新字段 |
| 字段语义变化 | 编译可能通过但业务错误 | 新建类型或新 Builder，避免复用旧名字 |
| 删除默认值 | 老代码行为改变 | 版本化契约并迁移调用方 |

尤其不要把“没调用 setter”与“显式设置为 `null`”混为一谈。两者语义不同时，需要额外的 `boolean xxxSet`、专门的值类型，或干脆拆成不同命令对象。

## 七、Lombok 减少样板，不负责设计契约

Lombok `@Builder` 可以生成内部 Builder、链式方法和 `build()`。但官方文档明确：未设置的字段默认得到 `0`、`null` 或 `false`；类级 `@Builder` 的构造器生成还会与显式构造器、`@Value` 等注解交互。

```java
import lombok.Builder;
import lombok.Singular;
import lombok.Value;

import java.time.Instant;
import java.util.List;

@Value
@Builder(toBuilder = true)
public class ExportTask {
    String taskId;
    String format;

    @Builder.Default
    int maxRows = 10_000;

    @Singular("recipient")
    List<String> recipients;

    Instant expireAt;
}
```

这段代码解决了样板量，但仍要回答：`taskId` 是否必填、`format` 支持哪些值、`maxRows` 的范围是什么、空收件人是否允许、过期时间如何校验。更稳妥的做法是把 `@Builder` 放在受约束的构造器或静态工厂上，让生成的 `build()` 最终经过该入口。

使用 Lombok 时重点检查：

1. 默认值是否显式使用 `@Builder.Default`，并测试未赋值路径；
2. 集合是否用 `@Singular` 或在构造入口复制，避免暴露可变引用；
3. `toBuilder()` 是浅复制，嵌套可变对象不会自动深拷贝；
4. 反序列化框架是否真的支持生成的 Builder，不要只因代码能编译就假定能绑定；
5. 通过 `delombok` 或 IDE 展开结果，审查实际构造器、可见性和默认值。

## 八、Builder、构造器、静态工厂和 record 怎么选

| 方案 | 适合场景 | 主要边界 |
| --- | --- | --- |
| 构造器 | 字段少、顺序稳定、参数含义清楚 | 同类型参数多时易传错，演进会改签名 |
| 静态工厂 | 有明确业务意图或多种创建路径 | 参数多时仍会变长 |
| Builder | 可选字段多、存在默认值和跨字段约束 | 样板较多，错误常延迟到 `build()` |
| `record` | 固定数据载体、字段不多、强调值语义 | 只是浅不可变，参数多时调用仍不清楚 |

Java 官方把 record 定义为固定值集合的透明载体，并为组件生成私有 `final` 字段、访问器和规范构造器。record 与 Builder 不是对立关系：字段少时直接用 record；字段多时可用 Builder 收集参数，最后调用 record 的受校验规范构造器。

## 九、测试要覆盖构建契约

不要只测一条成功链。Builder 的高价值测试应覆盖：

```java
import static org.junit.jupiter.api.Assertions.*;

import java.util.ArrayList;
import java.util.List;

class PaymentRequestTest {

    @Test
    void shouldApplyStableDefaults() {
        PaymentRequest request = PaymentRequest
                .builder("pay-1", 10001L, 29900L)
                .build();

        assertEquals("CNY", request.currency());
        assertTrue(request.tags().isEmpty());
    }

    @Test
    void shouldRejectInvalidAmount() {
        assertThrows(IllegalArgumentException.class, () ->
                PaymentRequest.builder("pay-1", 10001L, 0L).build());
    }

    @Test
    void shouldFreezeInputCollection() {
        List<String> tags = new ArrayList<>(List.of("vip"));
        PaymentRequest request = PaymentRequest
                .builder("pay-1", 10001L, 29900L)
                .tags(tags)
                .build();

        tags.add("changed");
        assertEquals(List.of("vip"), request.tags());
        assertThrows(UnsupportedOperationException.class,
                () -> request.tags().add("forbidden"));
    }
}
```

还应补充所有跨字段组合、显式 `null`、Builder 二次使用、`toBuilder()` 派生和序列化边界。若 Builder 是公共库 API，再用二进制兼容检查或消费者契约测试约束演进。

## 十、上线前检查清单

- Builder 是否解决了真实复杂度，而不是给简单 DTO 增加仪式；
- 稳定必填项是否由方法签名暴露，避免全部拖到 `build()` 才报错；
- 字段级和跨字段不变量是否在成品诞生前统一校验；
- 构建过程是否无数据库、网络和消息副作用；
- 集合及嵌套可变对象是否定义了复制与冻结策略；
- Builder 是否只在单次构建中局部使用，未跨线程或跨请求共享；
- 默认值是否唯一、可测试，且能区分“未设置”和“显式空值”；
- Lombok 生成代码是否经过 `delombok` 或 IDE 展开审查；
- 新增必填字段、字段改名和语义变化是否有明确迁移方案；
- 测试是否覆盖默认值、失败组合、防御性复制和派生构建。

Builder 模式真正解决的是“复杂对象如何合法出生”。让 Builder 承担参数收集，让构造入口守住不变量，让产品对象尽量不可变，再把外部查询和副作用留在应用服务中，链式 API 才不只是好看，而是一个可验证、可演进的对象契约。

## 参考资料

- [Java SE 25 Record API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Record.html)
- [Java SE 25 与 JDK 25 规范](https://docs.oracle.com/en/java/javase/25/docs/specs/index.html)
- [Lombok @Builder 官方文档](https://projectlombok.org/features/Builder)
- [Lombok @Value 官方文档](https://projectlombok.org/features/Value)
