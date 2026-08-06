---
title: Spring AI 结构化输出：从 JSON Schema 到校验重试
date: 2026-08-06
category: 后端开发
cover: /covers/backend.svg
tags: [spring-ai, llm, structured-output, json-schema, java]
excerpt: 从 Java DTO 契约出发，拆解提示式与模型原生结构化输出，并建立解析、Schema 校验、业务校验、有限重试和降级的完整链路。
---

# Spring AI 结构化输出：从 JSON Schema 到校验重试

<img src="/images/posts/spring-ai-structured-output-contract-knowledge-map.png" alt="Spring AI 结构化输出：从 JSON Schema 到校验重试知识串联图" style="border-radius: 10px;" />

在工单分类、订单意图提取、合同字段抽取等场景中，下游需要的不是一段“看起来像 JSON”的文本，而是一份可以被 Java 程序稳定消费的契约。只在 Prompt 里写“请返回 JSON”，模型仍可能输出 Markdown 代码块、遗漏字段、生成额外属性，甚至给出结构正确但业务上不可执行的值。

结构化输出的工程目标也不只是“反序列化成功”。完整链路至少要回答五个问题：谁定义字段契约，模型是否真的受 Schema 约束，返回值经过哪些校验，失败能否安全重试，以及连续失败时系统如何降级。

> 本文以 **Spring AI 2.0.0** 的 `ChatClient` 与 Structured Output API 为例，Schema 语义参考 **JSON Schema Draft 2020-12**，业务校验示例采用 **Jakarta Bean Validation 3.0**。不同模型供应商只支持 JSON Schema 的不同子集，接入前必须以对应 Provider 的官方能力表为准；核对时间为 **2026-08-06**。

## 一、先区分“合法 JSON”与“可靠业务对象”

下面三种结果都可能出现在同一个模型调用中：

```json
{"intent":"CREATE_ORDER","quantity":2}
```

```json
{"intent":"CREATE_ORDER","quantity":"两件"}
```

```json
{"intent":"CREATE_ORDER","quantity":-3}
```

第一份可能可用；第二份是合法 JSON，却不符合字段类型；第三份既符合 `integer` 类型，也可能违反“购买数量必须大于零”的业务规则。因此需要把输出正确性拆成四层：

| 层次 | 解决的问题 | 典型手段 |
|---|---|---|
| 语法层 | 是否为可解析 JSON | JSON Parser |
| 结构层 | 字段、类型、枚举、必填项是否正确 | JSON Schema |
| 映射层 | 能否转成目标 Java 类型 | Jackson / `BeanOutputConverter` |
| 业务层 | 数值、权限、状态流转是否可接受 | Bean Validation + 领域规则 |

Schema 能限制输出形状，却不能代替库存检查、用户权限、订单状态和数据库唯一约束。模型返回 DTO 后仍应走普通业务服务的校验流程，不能直接写库或调用高风险工具。

## 二、三类结构化输出方式及其边界

### 1. 提示式结构化输出

应用把格式说明或 JSON Schema 作为文本拼进 Prompt，模型仍通过普通文本补全返回结果。Spring AI 的 `BeanOutputConverter` 会根据 Java 类型生成 Draft 2020-12 Schema，把格式要求提供给模型，再将文本转换成 Java 对象。

优点是模型无关、兼容面广；缺点是它本质上属于“尽力而为”。Spring AI 官方明确提示：模型不保证遵守格式，因此必须准备解析失败和校验失败路径。

### 2. Provider 原生结构化输出

若模型与 Provider API 支持原生 Structured Output，Schema 会通过请求参数传给 Provider，而不是只作为提示文本。Spring AI 2.0.0 可通过 `useProviderStructuredOutput()` 或 `AdvisorParams.ENABLE_NATIVE_STRUCTURED_OUTPUT` 启用。

原生约束通常比提示式更稳定，但不能把它理解成跨供应商统一承诺。不同 Provider 对顶层数组、组合关键字、格式关键字和额外属性的支持可能不同；Spring AI 也不会默认全局启用，因为底层模型支持度并不一致。

### 3. Tool Calling 参数

工具调用同样携带结构化参数，但语义不同：结构化输出是在生成“业务结果”，Tool Calling 是模型提出“调用哪个工具以及传什么参数”。Spring AI 的 Structured Output Converter 不用于 Tool Calling。即使工具参数通过 Schema 校验，执行前仍要做鉴权、幂等、额度和人工审批判断。

## 三、从 Java DTO 生成一份可维护契约

以客服文本提取订单操作意图为例，先定义稳定的传输对象，而不是直接让模型生成数据库实体：

```java
import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

@JsonPropertyOrder({"intent", "productCode", "quantity", "reason"})
public record OrderIntent(
        @NotNull IntentType intent,
        @NotBlank String productCode,
        @Positive Integer quantity,
        String reason) {

    public enum IntentType {
        CREATE_ORDER,
        CHANGE_QUANTITY,
        CANCEL_ORDER,
        NEEDS_CLARIFICATION
    }
}
```

这里有几个重要设计选择：

- 使用枚举封闭动作集合，避免下游依赖自由文本分支；
- 字段名表达业务语义，不使用 `data1`、`type` 这类模糊名称；
- DTO 与持久化实体隔离，防止模型控制价格、用户 ID、支付状态等敏感字段；
- 用 `@JsonPropertyOrder` 固定生成 Schema 的属性顺序，减少契约 Diff 噪声；
- Bean Validation 注解负责 Java 对象的业务前置校验，不假设所有注解都会被每个 Provider 的 Schema 方言完整理解。

JSON Schema 中，`properties` 只声明字段并不等于必填，必填字段必须进入 `required`。默认还允许未声明属性；需要封闭对象时应使用 `additionalProperties: false`。但它与 `allOf` 组合时存在作用域陷阱，复杂组合可评估 Draft 2019-09 之后的 `unevaluatedProperties`，同时先确认 Provider 是否支持该关键字。

## 四、Spring AI 2.0.0 的最短可用链路

`ChatClient.entity()` 可以把返回内容直接映射为 Java 类型：

```java
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

@Service
public class OrderIntentExtractor {

    private final ChatClient chatClient;

    public OrderIntentExtractor(ChatClient.Builder builder) {
        this.chatClient = builder
                .defaultSystem("""
                        你负责提取订单操作意图。
                        只根据用户原文抽取，不补造商品编码和数量；
                        信息不足时返回 NEEDS_CLARIFICATION。
                        """)
                .build();
    }

    public OrderIntent extract(String userText) {
        return this.chatClient.prompt()
                .user(userText)
                .call()
                .entity(OrderIntent.class, spec -> spec
                        // Provider 支持时，把 Schema 作为原生输出约束传入模型
                        .useProviderStructuredOutput()
                        // 按实体 Schema 校验；失败时由框架携带错误信息有限重试
                        .validateSchema());
    }
}
```

在 Spring AI 2.0.0 中，`validateSchema()` 默认最多重复尝试 3 次；失败信息会追加给模型用于修正。它不能与流式输出同时使用，因为验证必须拿到完整 JSON 后才能进行。若业务必须流式展示，可以把“自然语言过程”和“最终结构化结果”拆成两个调用，或先聚合完整文本再转换，但不要把尚未闭合的 JSON 片段直接交给业务层。

如果 Provider 不支持原生结构化输出，去掉 `useProviderStructuredOutput()`，`entity()` 仍可走提示式 Schema 与转换流程。建议在启动检查或灰度探测中验证目标模型能力，而不是运行时静默切换后还宣称具备同等可靠性。

## 五、Schema 通过后还要做业务校验

模型输出被映射为 `OrderIntent` 后，继续使用标准校验器和领域规则：

```java
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.util.Set;

public class OrderIntentService {

    private final OrderIntentExtractor extractor;
    private final Validator validator;

    public OrderIntentService(OrderIntentExtractor extractor, Validator validator) {
        this.extractor = extractor;
        this.validator = validator;
    }

    public OrderIntent analyze(String userText) {
        OrderIntent result = extractor.extract(userText);
        Set<ConstraintViolation<OrderIntent>> violations = validator.validate(result);

        if (!violations.isEmpty()) {
            // 不把带隐私的原文或完整模型响应直接写入日志
            throw new IllegalArgumentException("结构化结果未通过业务字段校验");
        }

        if (result.intent() == OrderIntent.IntentType.CANCEL_ORDER
                && (result.reason() == null || result.reason().isBlank())) {
            // 跨字段规则由领域代码表达，避免把全部规则塞进 Prompt
            throw new IllegalArgumentException("取消订单必须说明原因");
        }

        return result;
    }
}
```

真正执行订单操作时，还应重新从可信数据源读取商品、订单和当前用户信息。模型只负责“提出结构化意图”，业务服务才拥有“批准并执行动作”的权限。

## 六、重试要修复错误，不能放大故障

结构化输出失败可以重试，但需要区分错误类型：

| 错误类型 | 是否适合重试 | 处理建议 |
|---|---|---|
| JSON 截断、字段类型错误 | 通常适合 | 携带精简校验错误重试 |
| 必填信息在原文中缺失 | 不适合盲重试 | 返回 `NEEDS_CLARIFICATION` |
| Provider 限流、超时 | 有条件 | 指数退避、抖动、熔断 |
| Schema 与模型不兼容 | 不适合 | 阻断发布或切换已验证配置 |
| 业务规则不通过 | 视情况 | 向用户补问，不让模型编造 |

每次修复重试都会增加延迟与 Token 成本。必须设置总尝试次数、单次超时和整条请求截止时间，并保证重试不会触发外部副作用。结构化抽取和真正的下单、退款、发信应是两个阶段；只有抽取结果通过所有校验后，才允许进入幂等的执行接口。

连续失败时可以降级为人工确认表单，保留用户原文并让用户补齐字段；不要用宽松 `Map<String, Object>` 吞掉异常，也不要删除必填约束后继续自动执行。

## 七、契约演进与兼容性

结构化 DTO 一旦被工作流、缓存或消息消费者使用，就已经成为版本化接口。新增可选字段通常比删除字段、改名或收紧枚举安全；新增必填字段会让旧响应和回放数据立即失效。

推荐采用以下治理方式：

1. 为 Prompt、Schema 和 DTO 记录同一个 `contractVersion`；
2. 将生成后的 Schema 作为可审查产物，在发布时比较变化；
3. 新旧版本并行灰度，分别统计结构校验和业务校验成功率；
4. 缓存键包含模型配置与契约版本，避免旧 JSON 映射到新 DTO；
5. 消息事件使用显式版本和兼容消费者，不直接复用在线模型响应。

若字段只供内部推理使用，不要加入输出契约。Schema 越大，模型越难稳定满足，传输和验证成本也越高。保持“小而封闭”的结果对象通常比设计一个包罗万象的 AI 通用响应更可靠。

## 八、可观测性要覆盖整条失败链

至少记录以下低基数字段和指标：

- `provider`、受控的模型配置标识、`contractVersion`；
- 原生约束或提示式约束模式；
- 首次成功率、最终成功率、校验失败类型和重试次数；
- 模型调用耗时、结构转换耗时、业务校验耗时；
- 输入与输出 Token、超时、限流和降级次数；
- 进入人工确认与拒绝自动执行的比例。

日志默认不保存完整 Prompt、用户原文和模型响应。需要排障样本时，应先做权限控制、字段脱敏、采样与保留期限设置，并用请求 ID 串联模型调用、校验和最终业务动作。

## 九、常见误区

### 误区 1：能反序列化就说明结果正确

Jackson 成功只证明 JSON 可以映射到 Java 类型，不能证明商品存在、数量合理或当前用户有操作权限。

### 误区 2：原生 Structured Output 可以替代校验

它主要强化结构契约。业务规则、供应商限制、拒答、截断和服务异常仍需要应用处理。

### 误区 3：所有 JSON Schema 关键字都能跨模型使用

Provider 往往只实现规范子集。复杂组合、格式校验和顶层结构必须以目标 Provider 文档与实际探测为准。

### 误区 4：失败就无限重试

缺失信息不会因重复调用自动出现；无限重试只会放大成本、延迟和限流。无法修复的错误应转为补问、降级或人工确认。

### 误区 5：让模型直接生成数据库实体

实体通常包含主键、租户、价格、状态和审计字段。模型输出应进入最小化命令 DTO，再由可信业务代码补全并校验敏感字段。

## 十、最佳实践清单

- 用专用 DTO 定义最小输出契约，枚举封闭动作集合；
- 区分提示式、Provider 原生结构化输出与 Tool Calling；
- 同时执行 JSON 解析、Schema、Java 映射和业务规则校验；
- Provider 支持时启用原生约束，不支持时明确记录降级模式；
- 重试只修复可修复错误，并设置次数、超时和总截止时间；
- 抽取与副作用执行分离，执行接口继续鉴权、幂等和审计；
- 为 Prompt、Schema、DTO 和缓存建立统一契约版本；
- 观测首次成功率、修复成功率、Token 成本和人工降级率；
- 不记录未经脱敏的完整输入输出，不把校验错误暴露给终端用户；
- 升级模型或 Spring AI 版本时，使用固定样本集重新验证契约。

## 十一、总结

LLM 结构化输出不是一句“返回 JSON”，而是一条从 Java DTO、JSON Schema、模型约束到解析与业务校验的契约链。提示式输出提供广泛兼容，Provider 原生输出强化结构可靠性，`validateSchema()` 能对可修复错误进行有限重试，但最终业务正确性仍属于应用代码。

最稳妥的落地方式是让模型只产生最小化、可验证的意图对象，把鉴权、幂等、状态检查和副作用留在普通业务服务中。这样即使模型输出失败或供应商能力变化，系统也能明确拒绝、补问或降级，而不是把“不确定文本”直接变成生产动作。

## 参考资料

- [Spring AI 2.0.0：Structured Output Converter](https://docs.spring.io/spring-ai/reference/api/structured-output-converter.html)
- [Spring AI 2.0.0：ChatClient Entity 与 Schema Validation](https://docs.spring.io/spring-ai/reference/api/chatclient.html#_returning_an_entity)
- [Spring AI 2.0.0：StructuredOutputConverter API](https://docs.spring.io/spring-ai/docs/current/api/org/springframework/ai/converter/StructuredOutputConverter.html)
- [JSON Schema：Object、required 与 additionalProperties](https://json-schema.org/understanding-json-schema/reference/object)
- [JSON Schema Draft 2020-12 Specification](https://json-schema.org/draft/2020-12)
- [Jakarta Bean Validation 3.0 Specification](https://jakarta.ee/specifications/bean-validation/3.0/)
