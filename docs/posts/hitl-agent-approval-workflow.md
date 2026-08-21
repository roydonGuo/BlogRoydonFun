---
title: AI Agent 人机协同审批：HITL 状态机与高风险工具治理
date: 2026-08-07
category: AI
cover: /images/posts/hitl-agent-approval-workflow-knowledge-map.webp
tags: [agent, hitl, spring-ai, tool-calling, security]
excerpt: 从“模型建议、应用决策、人工授权、系统执行”的职责分离出发，用 Spring AI 用户控制工具调用、持久化审批状态机与幂等执行器，构建可暂停、可恢复、可审计的高风险 Agent 工作流。
---

# AI Agent 人机协同审批：HITL 状态机与高风险工具治理

<img src="/images/posts/hitl-agent-approval-workflow-knowledge-map.webp" alt="AI Agent 人机协同审批：HITL 状态机与高风险工具治理知识串联图" style="border-radius: 10px;" />

从“模型建议、应用决策、人工授权、系统执行”的职责分离出发，用 Spring AI 用户控制工具调用、持久化审批状态机与幂等执行器，构建可暂停、可恢复、可审计的高风险 Agent 工作流。

让大模型生成一段退款说明，和允许大模型直接调用“退款 5000 元”接口，是两种完全不同的风险等级。前者输出错误时通常还能修改，后者一旦执行就可能产生资金、库存、权限或合规影响。

HITL（Human In The Loop，人类参与闭环）的核心结论是：**模型只能提出动作，应用必须判断风险，高风险动作必须在冻结参数后等待人工授权，真正的副作用由受控执行器完成。** 审批不是聊天窗口里的一句“确认”，而是一套可持久化、可超时、可恢复、可幂等、可审计的业务状态机。

> 本文以 **Spring AI 2.0.0** 的 Tool Calling 契约、OWASP `LLM06:2025 Excessive Agency`、NIST AI RMF Core 与 MCP 2025-11-25 Elicitation 规范为事实依据，核对时间为 **2026-08-07**。Spring AI 2.0.0 已提供用户控制的工具执行方式，适合在执行前插入外部审批；不同模型供应商只负责产生工具调用请求，不能替代应用侧授权。

## 一、HITL 解决的不是“模型不够聪明”，而是授权边界

工具调用通常包含六个角色：

1. 用户提出目标，例如“把重复支付的订单退掉”；
2. 模型根据工具定义，生成工具名与参数；
3. Agent 编排器解析工具请求并维护会话；
4. 策略引擎判断调用者、工具、参数和环境风险；
5. 审批人决定批准、拒绝或要求修改；
6. 执行器携带最小权限访问真实业务系统。

这里最容易犯的错误，是把“模型选择了工具”误解为“模型获得了执行授权”。Spring AI 官方文档明确区分了两件事：模型返回工具调用请求，而应用负责找到并执行工具。OWASP 对 Excessive Agency 的建议也包括最小权限、限制工具能力，以及在高影响动作执行前要求用户批准。

因此，HITL 至少要守住三条边界：

- **模型不是授权主体**：模型给出的工具名、金额、收款方和理由都属于不可信输入；
- **审批不是身份认证**：点击“批准”的人还必须经过登录、权限和数据范围校验；
- **批准不等于执行成功**：下游超时、重复投递和进程重启仍需由业务幂等与重试机制处理。

## 二、哪些操作需要人工介入

不是每个工具都弹审批框。审批过多会让人形成“无脑点同意”的疲劳，审批过少又会把风险交给模型。工程上应先给工具建立风险目录，再结合本次参数动态升级。

| 风险等级 | 典型工具 | 默认策略 | 关键控制 |
|---|---|---|---|
| 只读低风险 | 查询公开文档、读取本人订单摘要 | 可自动执行 | 数据范围、脱敏、频率限制 |
| 可逆写操作 | 创建草稿、添加标签、暂停非核心任务 | 条件自动或单人审批 | 撤销能力、变更差异、幂等键 |
| 高影响写操作 | 退款、发货、批量改价、删除资源、生产变更 | 强制审批 | 冻结参数、权限复核、过期时间 |
| 不可逆或敏感操作 | 转账、密钥轮换、批量删除、越权数据导出 | 双人审批或禁止 Agent 执行 | 职责分离、最小权限、外部复核 |

风险不能只挂在工具名上。例如 `refundOrder` 退款 10 元和 10 万元、退到原支付渠道和改退到新账户，风险显然不同。策略引擎至少应检查：

- 工具的静态风险等级；
- 金额、数量、资源范围等参数阈值；
- 当前用户是否拥有目标资源；
- 生产或测试环境；
- 是否涉及个人信息、凭证和跨租户数据；
- 是否命中短时间重复操作、异常时段或批量模式。

最终策略可以是 `AUTO_EXECUTE`、`REQUIRE_APPROVAL`、`REQUIRE_DUAL_APPROVAL` 或 `DENY`。`DENY` 很重要：HITL 不是所有危险能力的通行证，某些操作根本不应该暴露给 Agent。

## 三、审批必须是一套持久化状态机

一个可用的审批流程不应依赖某个 HTTP 请求一直保持连接。用户可能几小时后才审批，服务也可能在等待期间发布或重启，所以状态必须落库。

完整状态可以设计为：

| 状态 | 含义 | 允许的下一步 |
|---|---|---|
| `PROPOSED` | 模型提出工具调用，尚未完成策略判断 | `PENDING_APPROVAL`、`APPROVED`、`DENIED` |
| `PENDING_APPROVAL` | 参数已冻结，等待人工决定 | `APPROVED`、`REJECTED`、`EXPIRED` |
| `APPROVED` | 审批完成，尚未产生副作用 | `EXECUTING`、`EXPIRED` |
| `EXECUTING` | 执行器已领取任务 | `SUCCEEDED`、`FAILED` |
| `SUCCEEDED` | 下游明确成功并记录结果 | 终态 |
| `REJECTED` | 审批人拒绝 | 终态 |
| `DENIED` | 策略直接禁止 | 终态 |
| `EXPIRED` | 超过审批或执行有效期 | 终态 |
| `FAILED` | 执行失败，等待受控重试或人工处理 | `EXECUTING` 或终止 |

状态迁移必须使用条件更新，防止审批、取消和执行并发发生：

```sql
UPDATE agent_action
SET status = 'APPROVED',
    approved_by = :operatorId,
    approved_at = CURRENT_TIMESTAMP,
    version = version + 1
WHERE id = :actionId
  AND status = 'PENDING_APPROVAL'
  AND expires_at > CURRENT_TIMESTAMP
  AND version = :expectedVersion;
```

受影响行数为 0 时，说明动作已被其他人处理、已经过期或版本不一致，不能继续执行。批准后应通过 Outbox 或可靠任务表唤醒执行器，而不是在审批 HTTP 请求中直接调用支付、数据库或运维接口。

## 四、冻结“批准的内容”，防止审批后偷换参数

审批页必须展示真正要执行的业务事实，而不是模型生成的一段自然语言摘要。至少展示：

- 工具名称与风险等级；
- 目标资源、租户和环境；
- 金额、数量、收件人等关键参数；
- 变更前后差异与预计影响；
- 请求人、审批人、创建时间和过期时间；
- 不能回滚的后果与可用补偿方案。

创建审批单时，把规范化后的参数序列化并计算摘要：

```java
public record FrozenAction(
        String actionId,
        String toolName,
        String canonicalArguments,
        String argumentsSha256,
        String tenantId,
        String requestedBy,
        Instant expiresAt) {
}
```

审批页读取冻结快照，执行器再次计算 `argumentsSha256` 并比较。任何参数变化都必须作废旧审批，重新进入 `PENDING_APPROVAL`。不能允许模型在批准之后“补充一个字段”，也不能让审批人直接修改 JSON 后沿用旧签名。

敏感信息不要塞进提示词、审批备注和通用日志。密钥、Token、完整银行卡号等应由执行器根据受控引用在运行时获取；模型和审批页面只看到脱敏值或资源标识。

## 五、用 Spring AI 接管工具调用循环

Spring AI 2.0.0 的 `ChatClient` 默认通过 `ToolCallingAdvisor` 自动完成模型调用、工具执行和结果回传。如果需要在工具执行前暂停并等待审批，可以关闭本次请求的自动工具循环，改用用户控制的执行方式。

下面的骨架只展示关键职责，不把真实支付凭证或审批状态保存在内存中：

```java
@Service
public class AgentActionService {

    private final ChatModel chatModel;
    private final RiskPolicy riskPolicy;
    private final AgentActionRepository actionRepository;

    public AgentReply handle(String userId, String tenantId, String question) {
        ToolCallback[] tools = ToolCallbacks.from(new OrderQueryTools(), new RefundProposalTools());
        ChatOptions options = ToolCallingChatOptions.builder()
                .toolCallbacks(tools)
                .build();

        // 这里只让模型提出工具调用，不自动产生真实业务副作用。
        ChatResponse response = chatModel.call(new Prompt(question, options));
        if (!response.hasToolCalls()) {
            return AgentReply.text(response.getResult().getOutput().getText());
        }

        // 每一个模型参数都按外部输入处理，先校验、规范化，再进入策略判断。
        ToolCallRequest request = ToolCallRequest.from(response);
        ValidatedAction action = validateAndCanonicalize(request, userId, tenantId);
        RiskDecision decision = riskPolicy.evaluate(action);

        if (decision == RiskDecision.DENY) {
            return AgentReply.denied("该操作不允许由 Agent 发起");
        }
        if (decision.requiresApproval()) {
            // 持久化冻结快照、摘要、调用者、租户、过期时间和会话恢复点。
            String actionId = actionRepository.createPending(action, decision);
            return AgentReply.pendingApproval(actionId);
        }

        // 低风险工具也必须经过受控执行器，不能反射调用任意 Bean。
        return executeLowRiskAction(action);
    }
}
```

高风险工具最好拆成“提案工具”和“执行命令”两层。模型可以调用 `proposeRefund` 生成候选动作，但真正的 `executeRefund` 不注册给模型，只允许后台执行器在审批完成后调用。这样即使提示词注入诱导模型反复请求退款，也无法绕过审批仓库和策略引擎。

执行器需要再次校验，而不是相信审批阶段的结论：

```java
@Transactional
public void executeApprovedAction(String actionId) {
    AgentAction action = actionRepository.lockById(actionId);

    // 重新核验状态、有效期、参数摘要和审批权限，防止过期或篡改后执行。
    action.assertExecutable(clock.instant());
    action.verifyFrozenArguments();

    // 使用 actionId 作为业务幂等键；重试不能生成第二笔退款。
    actionRepository.markExecuting(actionId, action.getVersion());
    RefundResult result = refundGateway.refund(
            action.toRefundCommand(),
            "agent-action:" + actionId);

    actionRepository.markSucceeded(actionId, result.providerRequestId());
}
```

示例中的本地事务无法包住远程退款。生产实现应依赖下游幂等键、明确的结果查询接口和可恢复任务，而不是通过无限重试猜测结果。

## 六、审批以后如何恢复 Agent 对话

长时间等待审批时，不应保持模型流式连接，也不应把整个上下文原样塞进数据库。可以持久化一个恢复快照：

```text
conversationId
actionId
modelMessageId / toolCallId
toolName
frozenArgumentsHash
promptVersion
toolContractVersion
status
```

审批成功并执行完成后，把结构化工具结果作为一条新的工具消息回填，再让模型生成面向用户的最终解释。审批拒绝、过期或执行失败时，也要回填明确的机器可读结果，例如：

```json
{
  "actionId": "act_20260807_001",
  "status": "REJECTED",
  "errorCode": "APPROVER_REJECTED",
  "message": "审批人拒绝退款请求，未产生资金变更"
}
```

不要把数据库异常堆栈、内部接口地址或敏感凭证直接返回给模型。模型需要的是稳定错误码、可公开说明和允许的下一步，例如“修改参数后重新申请”，而不是基础设施细节。

## 七、常见追问与踩坑

### 1. 用户在聊天中回复“确认”够不够

不够。至少要把确认绑定到具体 `actionId`、冻结参数摘要、当前登录身份和未过期状态。若同时存在两个待审批动作，一句“确认”没有明确对象，极易误操作。

### 2. 审批人和请求人可以是同一个人吗

取决于风险策略。个人草稿或低金额操作可以是同一人确认；生产变更、大额资金、权限提升通常需要职责分离，甚至双人审批。规则应由业务与合规共同配置，不能由模型临时决定。

### 3. 模型置信度高时能否跳过审批

不能把模型自报置信度当作授权证据。是否审批应由工具风险、参数、用户权限、环境和组织策略决定。置信度最多作为升级人工复核的附加信号。

### 4. 只记录 Prompt 和模型回答是否算审计

不算。审计日志至少还要记录工具契约版本、规范化参数摘要、策略版本、状态迁移、审批身份、执行幂等键、下游请求标识和最终结果。审计日志应防篡改并设置访问控制，避免它反过来成为敏感数据泄漏源。

### 5. MCP Elicitation 是否等同于业务审批

不等同。MCP 2025-11-25 的 Elicitation 能让 Server 通过 Client 请求用户补充信息或进行带外交互，并要求客户端提供用户批准控制；但业务系统仍需自己完成身份、权限、冻结参数、审批状态和幂等执行。协议交互能力不能替代领域授权。

## 八、上线前的最佳实践清单

1. 默认只暴露只读和提案型工具，高风险执行器不注册给模型；
2. 为每个工具定义所有者、风险等级、参数阈值、数据范围和禁用开关；
3. 模型参数经过 JSON Schema、Bean Validation 与业务规则三层校验；
4. 审批单冻结规范化参数，显示真实影响，任何修改都重新审批；
5. 状态迁移使用版本号或条件更新，审批任务设置明确过期时间；
6. 审批身份、业务权限和租户范围在批准与执行阶段都重新校验；
7. 执行器使用最小权限凭证、幂等键、结果查询和有界重试；
8. 记录策略版本、工具版本、参数摘要、审批链和下游结果，敏感字段脱敏；
9. 提供拒绝、撤销、超时、补偿和人工接管路径；
10. 用故障演练验证重复消息、服务重启、审批并发、下游超时和结果未知场景。

## 九、总结

HITL 不是在 Agent 界面上加一个确认按钮，而是把高风险工具调用改造成一条受治理的业务流水线：模型提出动作，应用校验并评估风险，审批人针对冻结参数授权，执行器以最小权限和幂等语义产生副作用，最后把结构化结果恢复到 Agent 对话。

真正可靠的边界是：**模型可以建议，但不能授权；人类可以批准，但不能绕过系统校验；系统可以执行，但必须可追踪、可恢复、可限制。** 当这三层职责清楚之后，Agent 才能从演示中的“自动调用工具”，走向生产环境中的“受控完成任务”。

## 参考资料

- [Spring AI 2.0.0：Tool Calling](https://docs.spring.io/spring-ai/reference/api/tools.html)
- [OWASP LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
- [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)
- [MCP 2025-11-25：Elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
