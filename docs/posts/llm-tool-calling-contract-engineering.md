---
title: LLM 工具调用工程实践：Schema 契约、执行边界与失败恢复
date: 2026-08-13
category: 后端开发
cover: /covers/backend.svg
tags: [llm, tool-calling, spring-ai, json-schema, agent]
excerpt: 从模型只负责提出调用请求这一边界出发，讲清工具定义、JSON Schema、应用侧执行、权限与幂等、结果回传、失败恢复和可观测性，并给出 Spring AI 2.0.0 的订单售后示例。
---

# LLM 工具调用工程实践：Schema 契约、执行边界与失败恢复

<img src="/images/posts/llm-tool-calling-contract-engineering-knowledge-map.png" alt="LLM 工具调用工程实践：Schema 契约、执行边界与失败恢复知识串联图" style="border-radius: 10px;" />

从模型只负责提出调用请求这一边界出发，讲清工具定义、JSON Schema、应用侧执行、权限与幂等、结果回传、失败恢复和可观测性，并给出 Spring AI 2.0.0 的订单售后示例。

## 先说结论：模型选择工具，应用掌握执行权

工具调用也常被称为 Function Calling。它不是把数据库、支付接口或文件系统交给模型，而是让模型生成一份“想调用哪个工具、参数是什么”的结构化请求，再由应用完成解析、校验、授权、执行和结果回传。

一条可靠链路必须坚持六个边界：

1. **工具定义是面向模型的接口契约**，名称、描述和输入 Schema 都会影响选择准确率；
2. **模型输出始终是不可信输入**，通过 Schema 不等于通过业务校验；
3. **身份、租户、权限和幂等键来自可信运行时**，不能让模型自行填写；
4. **查询工具与变更工具分级治理**，高风险动作需要确认、限权和审计；
5. **工具结果应机器可判定**，区分业务拒绝、可重试故障和未知失败；
6. **循环必须有预算和停止条件**，否则错误重试会放大成本与副作用。

本文以 Spring AI 2.0.0 当前 API 为 Java 示例基线，事实核对时间为 2026-08-13。Spring AI 官方明确说明：模型只能请求工具并给出参数，真正执行工具的是客户端应用；2.0.0 起推荐由 `ChatClient` 的 `ToolCallingAdvisor` 管理执行生命周期，旧的模型内部执行方式已弃用。具体以 [Spring AI Tool Calling](https://docs.spring.io/spring-ai/reference/api/tools.html)、[Recursive Advisors](https://docs.spring.io/spring-ai/reference/api/advisors-recursive.html) 和 [Observability](https://docs.spring.io/spring-ai/reference/observability/) 为准。

## 一、完整链路由哪些部分组成

### 1. 工具注册

应用把本次请求允许使用的工具定义交给模型。定义通常包含：

- 唯一且稳定的工具名；
- 清楚说明“何时使用、何时不要使用”的描述；
- 描述参数类型、必填项、枚举和约束的 JSON Schema；
- 应用侧的真实执行函数；
- 结果序列化、异常处理和是否直接返回等元数据。

不要把整个后台 Service 暴露成工具集。工具越多、能力越宽，模型选择越困难，攻击面也越大。应按当前用户、页面、业务阶段和权限动态提供最小集合。

### 2. 模型提出调用请求

模型根据用户问题和工具定义，返回工具名、调用 ID 与参数。这个响应只是候选执行计划，不是授权结果。即使供应商宣称支持严格 Schema，应用仍要重新反序列化、校验字段，并执行自己的业务规则。

### 3. 应用解析与执行

应用完成以下工作：

```text
识别工具名 → 校验参数 → 注入可信上下文 → 鉴权 → 风险审批
        → 幂等检查 → 超时与隔离 → 执行业务 → 记录审计
```

工具名必须通过注册表解析，不能反射调用任意类名或方法名；参数只能进入预先绑定的 DTO，不能拼接 SQL、Shell 或 URL。

### 4. 结果回传与最终回答

工具执行结果通常作为一条专用工具消息回传给模型，并通过调用 ID 与原请求关联。模型可以据此生成最终自然语言回答，也可以继续请求另一个工具。应用应限制最大迭代次数、总工具次数、累计耗时和 Token 预算。

## 二、工具有两类，但风险至少分四级

Spring AI 官方按目的把工具分为两大类：

- **信息检索工具**：查询数据库、内部 API、文件或搜索服务，只把外部事实带回上下文；
- **动作执行工具**：创建记录、发送消息、修改订单或触发流程，会改变外部状态。

生产治理还应进一步按副作用分级：

| 等级 | 典型操作 | 默认策略 |
|---|---|---|
| 只读 | 查询订单、读取库存 | 最小字段返回、租户校验、超时控制 |
| 可逆写 | 修改草稿、添加标签 | 幂等、版本号、操作日志、提供撤销 |
| 高影响写 | 退款、发货、发送通知 | 人工确认、金额或范围上限、二次鉴权 |
| 不可逆或特权 | 删除数据、执行运维命令 | 默认不开放；确有需要时使用独立审批通道 |

OWASP 将过多功能、过大权限和过度自主归为 Excessive Agency 的主要根因。降低风险的重点不是让 Prompt 写得更严厉，而是让应用根本不提供无关工具，并在执行点独立验证高影响动作。参见 [OWASP LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)。

## 三、怎样设计可调用的 Schema 契约

### 1. 名称描述“业务动作”，不要描述底层实现

`query_order_refund_eligibility` 比 `call_service_2` 更容易被正确选择。描述要同时写清前置条件和禁止场景，例如：

```text
查询当前登录用户某个订单是否满足退款申请条件；
仅用于查询，不创建退款单，不改变订单状态。
```

这比“查询退款信息”更能区分查询与执行。

### 2. 参数尽量扁平、闭合、无歧义

优先使用明确字段和枚举，避免让模型生成任意 Map。JSON Schema 中 `properties` 只声明属性，并不会自动使属性必填；必须使用 `required`。不希望接收额外字段时，应使用 `additionalProperties: false`。这些语义可在 [JSON Schema 对象参考](https://json-schema.org/understanding-json-schema/reference/object) 中核对。

```json
{
  "type": "object",
  "properties": {
    "orderNo": {
      "type": "string",
      "description": "用户可见的订单编号"
    },
    "reasonCode": {
      "type": "string",
      "enum": ["NOT_RECEIVED", "DAMAGED", "OTHER"]
    }
  },
  "required": ["orderNo", "reasonCode"],
  "additionalProperties": false
}
```

枚举只是语法白名单，不能代替业务状态判断。模型传入 `DAMAGED`，应用仍要确认订单属于当前用户、商品已签收、时间窗口有效并允许该售后类型。

### 3. 不要让模型提供可信上下文

以下字段不应出现在模型可见 Schema 中：

- `userId`、`tenantId`、角色和数据权限；
- 支付账户、内部审批人和系统密钥；
- 幂等键、Trace ID、请求来源和风控结论；
- 服务端计算的金额上限、折扣和订单归属。

Spring AI 的 `ToolContext` 可把这些运行时数据传给工具，而且上下文数据不会发送给模型。它适合承载经过认证网关确认的身份与请求元数据。

### 4. 版本演进优先新增工具，不静默改语义

工具名、必填参数、枚举和值域都属于协议。删除字段、改变金额单位或把查询改为写操作都是破坏性变化。可采用 `request_refund_v2` 或内部版本注册表灰度新契约，保留旧版本观测窗口后再下线。

## 四、Spring AI 2.0.0 订单售后示例

下面不是测试用例，而是可由对话入口直接调用的工具实现。示例把模型参数与可信上下文分开，并让写操作复用业务层既有的权限、状态机和幂等约束。

```java
public record RefundEligibility(
        String orderNo,
        boolean eligible,
        String reason,
        BigDecimal refundableAmount) {
}

public record RefundReceipt(
        String refundNo,
        String status,
        String message) {
}

@Component
public class OrderAfterSalesTools {

    private final OrderQueryService orderQueryService;
    private final RefundApplicationService refundApplicationService;

    public OrderAfterSalesTools(OrderQueryService orderQueryService,
                                RefundApplicationService refundApplicationService) {
        this.orderQueryService = orderQueryService;
        this.refundApplicationService = refundApplicationService;
    }

    @Tool(description = "查询当前登录用户的订单是否可申请退款；只读，不创建退款单")
    public RefundEligibility queryRefundEligibility(
            @ToolParam(description = "用户提供的订单编号") String orderNo,
            ToolContext toolContext) {

        // 用户身份来自认证后的运行时上下文，不能信任模型生成的 userId
        Long userId = (Long) toolContext.getContext().get("userId");
        return orderQueryService.queryRefundEligibility(userId, orderNo);
    }

    @Tool(description = "为当前登录用户创建退款申请；调用前必须已获得用户明确确认")
    public RefundReceipt requestRefund(
            @ToolParam(description = "用户提供的订单编号") String orderNo,
            @ToolParam(description = "退款金额，单位为元，必须大于零") BigDecimal amount,
            @ToolParam(description = "退款原因，使用用户已经确认的原意") String reason,
            ToolContext toolContext) {

        Long userId = (Long) toolContext.getContext().get("userId");
        String idempotencyKey = (String) toolContext.getContext().get("idempotencyKey");
        Boolean approved = (Boolean) toolContext.getContext().get("refundApproved");

        // Prompt 中说“已确认”不能代替服务端审批状态
        if (!Boolean.TRUE.equals(approved)) {
            return new RefundReceipt(null, "CONFIRMATION_REQUIRED", "请先确认退款金额和原因");
        }

        // 业务服务必须再次校验归属、状态、可退金额，并使用幂等键防止重复退款
        return refundApplicationService.apply(userId, orderNo, amount, reason, idempotencyKey);
    }
}
```

对话入口只为本次请求注入必要工具：

```java
@Service
public class AfterSalesAssistant {

    private final ChatClient chatClient;
    private final OrderAfterSalesTools tools;

    public AfterSalesAssistant(ChatModel chatModel, OrderAfterSalesTools tools) {
        this.chatClient = ChatClient.builder(chatModel).build();
        this.tools = tools;
    }

    public String reply(String userMessage,
                        Long userId,
                        String idempotencyKey,
                        boolean refundApproved) {

        return chatClient.prompt()
                .system("你是订单售后助手。退款前必须复述金额与原因并获得明确确认。")
                .user(userMessage)
                // 只把售后工具加入当前请求，避免其他场景意外获得写能力
                .tools(tools)
                // 可信上下文不会进入模型可见的工具参数 Schema
                .toolContext(Map.of(
                        "userId", userId,
                        "idempotencyKey", idempotencyKey,
                        "refundApproved", refundApproved))
                .call()
                .content();
    }
}
```

这段示例仍需要外围接口先完成登录认证、确认态持久化和幂等键生成。不能因为 `refundApproved=true` 存在，就省略退款服务内部的订单归属、金额上限和状态机校验。

## 五、自动执行、受控循环与直接返回怎么选

Spring AI 2.0.0 当前提供三种工具执行生命周期：

| 模式 | 谁驱动循环 | 适用场景 |
|---|---|---|
| 框架控制 | `ChatClient` 自动注册的 `ToolCallingAdvisor` | 常规问答与简单工具链，优先使用 |
| Advisor 控制 | 自定义 `ToolCallingAdvisor` 与管理器 | 需要在循环内插入审计、策略或记忆控制 |
| 用户控制 | 应用检查 `hasToolCalls()` 并手动执行 | 需要向 UI 流式展示步骤、逐次审批或自定义停止条件 |

不要把“自动执行”理解为无限自治。无论使用哪种模式，应用都应设置：

- 单轮最大迭代次数；
- 单工具与整轮超时；
- 并行调用数量；
- 相同工具和参数的重复调用限制；
- 总 Token、外部 API 成本和写操作数量；
- 用户取消、审批拒绝和熔断后的停止路径。

`returnDirect=true` 可以让工具结果不再回传模型，而是直接返回调用方。它适合下载链接、结构化查询结果或确定性业务回执，但会绕过模型的最终解释。并行请求多个工具时，Spring AI 要求所有调用都设置直接返回，才会整体直接返回，因此不应把它当作随意的性能开关。

## 六、工具结果要让模型知道下一步是什么

只返回“失败”会迫使模型猜测。推荐统一结果信封：

```json
{
  "status": "REJECTED",
  "code": "ORDER_NOT_REFUNDABLE",
  "message": "订单已超过退款申请时间",
  "retryable": false,
  "data": null
}
```

结果状态至少应覆盖：

| 状态 | 含义 | 模型下一步 |
|---|---|---|
| `SUCCESS` | 执行完成 | 基于结果回答，不重复调用 |
| `CONFIRMATION_REQUIRED` | 缺少用户确认 | 展示影响并请求确认 |
| `REJECTED` | 业务规则拒绝 | 解释原因或提供允许的替代路径 |
| `RETRYABLE_ERROR` | 短暂超时、限流或依赖故障 | 在预算内退避重试，或稍后再试 |
| `FAILED` | 未知或不可恢复错误 | 停止自动调用，记录事件并转人工 |

工具结果应最小化，只返回完成任务所需字段。不要把数据库实体、堆栈、内部 URL、访问令牌或无关个人信息交给模型。大结果应分页、摘要或保存到受控对象存储，再返回短期引用。

## 七、失败恢复：重试不能重复制造副作用

### 1. 参数错误

缺少必填字段、格式错误或枚举不合法时，不执行工具。返回具体但不泄露内部实现的错误，让模型向用户补充信息。不要自动把未知值替换成看似合理的默认值。

### 2. 业务拒绝

订单不属于当前用户、状态不允许退款或金额超限都属于确定性拒绝，不应重试。返回稳定错误码，模型只负责解释和引导。

### 3. 短暂系统故障

超时、限流和临时不可用可以重试，但要满足三个条件：工具被标记为可重试、调用仍在总预算内、写操作携带相同幂等键。退避次数与时间由应用控制，不能交给模型自由决定。

### 4. 未知异常

序列化错误、权限组件异常或数据库状态不明时，应默认停止写操作。特别是请求超时不等于下游没有成功，重试前必须先按幂等键查询执行结果。

Spring AI 会把工具异常包装为 `ToolExecutionException`，并可通过 `ToolExecutionExceptionProcessor` 选择把错误转成模型可读消息，或继续抛给调用方。高风险写操作更适合抛出并进入应用补偿流程，避免模型在信息不足时自行改参数重试。

## 八、安全边界：Schema 之外还要做什么

1. **最小工具集**：每个请求只注册当前场景需要的工具；
2. **服务端鉴权**：工具内部基于真实用户与租户重新校验资源归属；
3. **参数化访问**：数据库、Shell、HTTP 目标都使用白名单与参数化 API；
4. **高风险确认**：确认内容包含动作、对象、金额或范围，并设置短有效期；
5. **幂等与并发控制**：写工具使用业务唯一键、版本号或状态机；
6. **输出隔离**：把工具返回值视为外部数据，不允许其中的指令覆盖系统策略；
7. **秘密不入模型**：密钥只在执行端使用，日志和工具结果中都不回传；
8. **网络边界**：限制可访问域名、IP、端口与重定向，防止 SSRF；
9. **审计可追溯**：记录请求人、工具版本、审批、参数摘要、结果码和副作用 ID；
10. **人工兜底**：权限冲突、金额异常、重复执行状态不明时停止自动化。

## 九、可观测性：既要能定位，又不能泄密

至少记录以下维度：

- 会话与调用 ID、工具名、工具版本；
- 选择工具前的模型调用耗时；
- 参数校验、鉴权、审批和幂等命中结果；
- 工具执行耗时、结果码、重试次数和下游 Trace ID；
- 工具循环次数、停止原因、Token 与成本；
- 写操作生成的订单号、退款号等可审计业务 ID。

Spring AI 使用 `spring.ai.tool` observation 记录工具执行，并提供工具名、调用 ID、参数 Schema 等属性。工具参数和结果默认不导出，因为它们可能包含敏感数据；`spring.ai.tools.observations.include-content` 默认也是 `false`。生产环境应保持默认关闭，确需排障时使用字段级脱敏和短期采样，而不是整段打开。

告警不要只看异常率，还应覆盖：同一参数重复调用、单轮工具数激增、审批拒绝后继续调用、写操作超时后重复提交、未知工具名、Schema 校验失败率和敏感字段命中。

## 十、常见追问与踩坑

### 工具调用等于结构化输出吗

不等于。结构化输出通常约束模型的最终回答格式；工具调用约束的是中间执行请求，应用还要真正执行工具并把结果送回模型。两者都可能使用 JSON Schema，但生命周期和风险不同。

### 工具调用等于 MCP 吗

不等于。工具调用描述模型与应用之间的调用模式；MCP 进一步标准化 Host、Client、Server 之间的能力发现、调用与传输。同一个 `ToolCallback` 可以来自本地方法，也可以适配 MCP Server。

### Schema 校验通过就能执行吗

不能。Schema 只验证结构和值域，不知道订单归属、实时库存、账户余额、审批状态和并发版本。业务校验、授权与风控必须在执行端完成。

### 是否应该把所有工具设为默认工具

不应该。Spring AI 官方也提醒默认工具会被同一 Builder 构建的客户端共享，若使用不慎，可能让工具出现在不该出现的请求中。优先按请求传入工具，高频只读工具才考虑默认注册。

### 模型没有调用正确工具怎么办

先检查工具名、描述、参数是否重叠，再减少候选工具、补充正反使用条件和真实回归样本。不要一开始就无限增加 Prompt。工具很多时再考虑动态检索，但检索本身也要评估漏召回与越权暴露。

## 十一、选择建议与最佳实践

1. 从一个只读、结果可验证的工具开始，再逐步开放写能力；
2. 工具粒度围绕单一业务意图，不暴露通用 SQL、HTTP 或脚本执行器；
3. 名称和描述同时写清用途、前置条件与禁止动作；
4. 参数使用稳定 DTO、枚举、必填约束和关闭额外字段；
5. 身份、权限、幂等键和审批结论全部通过可信上下文注入；
6. 工具内部复用已有领域服务，不绕过事务、状态机和风控；
7. 统一结果码与 `retryable` 语义，禁止模型根据自然语言猜重试；
8. 查询和写入分别设置超时、重试、并发和熔断策略；
9. 为循环设置次数、耗时、成本和副作用预算；
10. 版本化工具 Schema，并用真实对话回放验证选择、参数和停止条件；
11. 默认不采集完整参数与结果，日志只保留必要的脱敏摘要；
12. 把权限绕过、重复写入、结果注入和下游超时纳入故障演练。

## 十二、总结

LLM 工具调用的核心不是“让模型调用 Java 方法”，而是建立一条受控执行协议：应用提供最小工具定义，模型提出结构化请求，应用进行解析、校验、鉴权、审批和幂等执行，再把机器可判定的结果回传模型。

真正可靠的实现要把模型当作规划者而不是权限主体。Schema 提升参数确定性，却不能替代业务规则；自动循环提高效率，却不能取消预算和停止条件；错误回传帮助模型恢复，却不能让写操作盲目重试。把契约、可信上下文、副作用治理、失败分类和可观测性同时做好，工具调用才能从演示能力变成可上线的工程组件。

## 参考资料

- [Spring AI 2.0.0：Tool Calling](https://docs.spring.io/spring-ai/reference/api/tools.html)
- [Spring AI：Recursive Advisors](https://docs.spring.io/spring-ai/reference/api/advisors-recursive.html)
- [Spring AI：Observability](https://docs.spring.io/spring-ai/reference/observability/)
- [Spring AI 2.0.0 API：ToolCallback](https://docs.spring.io/spring-ai/docs/current/api/org/springframework/ai/tool/ToolCallback.html)
- [JSON Schema：Object](https://json-schema.org/understanding-json-schema/reference/object)
- [OWASP LLM06:2025：Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
