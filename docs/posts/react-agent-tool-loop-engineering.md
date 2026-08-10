---
title: ReAct Agent 工程实践：推理、工具调用与停止条件
date: 2026-08-10
category: 后端开发
cover: /covers/backend.svg
tags: [ai, agent, react, spring-ai, tool-calling]
excerpt: 从 ReAct 的推理—行动—观察循环出发，用 Spring AI 构建可控工具调用链，并把预算、状态、失败处理、安全与可观测性落到工程边界。
---

# ReAct Agent 工程实践：推理、工具调用与停止条件

<img src="/images/posts/react-agent-tool-loop-engineering-knowledge-map.png" alt="ReAct Agent 工程实践：推理、工具调用与停止条件知识串联图" style="border-radius: 10px;" />

从 ReAct 的推理—行动—观察循环出发，用 Spring AI 构建可控工具调用链，并把预算、状态、失败处理、安全与可观测性落到工程边界。

ReAct 不是“让模型多想几步”的提示词技巧，而是一种把模型决策与外部行动交替组织起来的 Agent 运行范式：模型根据目标和当前状态决定下一步动作，应用执行工具，把结果作为观察反馈给模型，循环直到得到最终答案或触发停止条件。

生产系统真正困难的部分也不在循环本身，而在循环外壳：谁能调用什么工具、参数是否可信、同一个动作能否重放、失败后是否继续、循环何时强制终止，以及怎样在不记录模型私密推理文本的前提下完成审计。

> 本文以 **ReAct 原始论文（ICLR 2023）**与 **Spring AI 2.0.0** 官方文档为事实基线，核对时间为 **2026-08-10**。Spring AI 2.0.0 推荐由 `ChatClient` 的 `ToolCallingAdvisor` 管理工具循环；需要逐步进度、条件分支或自定义观测时，可以关闭自动注册并使用 `ToolCallingManager` 手动驱动。框架接口会演进，升级时应重新核对官方文档。

## 一、先抓住 ReAct 的最小闭环

ReAct 原始论文把 reasoning trace 与 task-specific action 交错生成。工程实现不必把模型的内部推理原文展示或持久化，可以把闭环抽象为四类可验证状态：

```text
用户目标
   ↓
模型决策：最终回答，或请求调用某个工具
   ↓
应用校验：工具白名单、参数、权限、预算、幂等键
   ↓
工具执行：返回结构化结果或结构化错误
   ↓
观察回填：把必要结果加入下一轮上下文
   └──────────────────────────────→ 再次决策
```

这里有三个关键边界：

1. **模型只提出动作，不直接获得系统权限。** 工具定义是可调用能力目录，真正执行仍由应用负责；
2. **观察是事实输入，不是成功保证。** 超时、无权限、参数错误和下游拒绝都应成为下一轮可识别的结果；
3. **最终答案只是一个终态。** 超预算、等待人工确认、不可重试失败和客户端取消也必须能够结束循环。

传统的一次模型调用只能“输入 → 输出”。ReAct 则把外部环境纳入反馈回路，适合信息需要逐步补齐、动作之间存在依赖、执行结果会改变后续计划的任务。例如售后 Agent 先查订单，再按订单状态查询物流，最后才能判断是解释进度、创建工单还是请求人工介入。

## 二、一个完整循环由哪些部分组成

一个可上线的 ReAct 运行时至少包含以下八部分，缺少任何一项都容易把演示代码变成事故入口。

| 组成 | 职责 | 工程约束 |
|---|---|---|
| 目标与上下文 | 描述用户要解决的问题 | 区分可信系统指令与不可信用户/外部内容 |
| 工具目录 | 暴露名称、说明和参数 Schema | 默认拒绝，按用户、租户和场景动态裁剪 |
| 决策模型 | 选择最终回答或工具调用 | 不把自然语言当已授权命令 |
| 参数校验器 | 校验类型、范围和业务规则 | Schema 校验后仍要做服务端权限校验 |
| 工具执行器 | 调用数据库、HTTP 或内部服务 | 超时、限流、熔断、幂等与隔离 |
| 观察适配器 | 把结果转换为模型可消费的结构 | 截断大结果，过滤密钥与个人信息 |
| 循环控制器 | 管理轮次、预算、取消和终态 | 任何循环都必须有硬上限 |
| 轨迹与指标 | 记录可审计事件 | 记录决策摘要与动作，不依赖私密思维链 |

工具回包应优先使用稳定的结构化契约，而不是把异常堆栈直接扔回模型：

```json
{
  "status": "RETRYABLE_ERROR",
  "code": "LOGISTICS_TIMEOUT",
  "message": "物流服务暂时不可用",
  "retryAfterMs": 500,
  "data": null
}
```

`status` 告诉循环控制器能否继续，`code` 供程序分支和指标聚合，`message` 只提供模型做用户解释所需的信息。内部地址、访问令牌、SQL、堆栈和供应商原始报文不应进入模型上下文。

## 三、停止条件必须由应用掌握

只要求模型“完成后停止”不构成控制。模型可能重复查询同一订单、在两个工具之间来回切换，或因错误观察不断重试。应用至少应实现以下完整终态：

| 终态 | 触发条件 | 返回策略 |
|---|---|---|
| `COMPLETED` | 模型给出无需工具的最终回答 | 返回答案与引用的业务事实 |
| `MAX_STEPS` | 达到最大工具轮次 | 返回已完成步骤并建议人工继续 |
| `TIME_BUDGET_EXCEEDED` | 超过总耗时或请求截止时间 | 取消下游调用，避免后台继续消耗 |
| `COST_BUDGET_EXCEEDED` | 达到模型或工具预算 | 保存可恢复状态，不再发起新动作 |
| `REPEATED_ACTION` | 相同工具与规范化参数重复出现 | 阻断循环并记录诊断事件 |
| `WAITING_APPROVAL` | 动作需要人工授权 | 冻结参数摘要，等待审批后恢复 |
| `NON_RETRYABLE_ERROR` | 权限、业务规则或数据契约拒绝 | 停止自动执行，给出可理解原因 |
| `CANCELLED` | 客户端断开或用户撤销 | 传播取消信号并释放资源 |

最大轮次只是最后一道保险。更有效的是识别“无进展”：将工具名和规范化参数计算摘要，如果连续出现相同摘要，且观察没有新增信息，就应提前结束。对于可重试错误，还要设置**单工具重试次数**和**全局重试预算**，否则三个工具各自重试三次，整体调用数会快速膨胀。

推荐把预算显式放进运行状态：

```java
public record AgentBudget(
        int maxToolRounds,
        int maxSameAction,
        long deadlineEpochMillis) {

    public void check(int currentRound, int sameActionCount) {
        // 三类硬限制均由应用判断，不能交给模型自行遵守
        if (currentRound >= maxToolRounds) {
            throw new AgentStoppedException("MAX_STEPS");
        }
        if (sameActionCount >= maxSameAction) {
            throw new AgentStoppedException("REPEATED_ACTION");
        }
        if (System.currentTimeMillis() >= deadlineEpochMillis) {
            throw new AgentStoppedException("TIME_BUDGET_EXCEEDED");
        }
    }
}
```

## 四、用 Spring AI 手动接管工具循环

对于普通问答，Spring AI 2.0.0 的 `ToolCallingAdvisor` 可以自动处理工具调用。若要把每一步进度推送给前端、执行审批、检测重复动作或按业务错误码分支，则更适合关闭单次请求的自动工具 Advisor，由应用驱动循环。

下面的骨架沿用官方的 `ToolCallingManager` 路径，并把生产控制点放在每轮工具执行之前：

```java
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.api.AdvisorParams;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.prompt.ChatOptions;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.model.tool.ToolCallingManager;
import org.springframework.ai.model.tool.ToolExecutionResult;

public final class ControlledAgentRunner {

    private final ChatClient chatClient;
    private final ToolCallingManager toolCallingManager;
    private final AgentGuard agentGuard;

    public ControlledAgentRunner(ChatClient chatClient,
                                 ToolCallingManager toolCallingManager,
                                 AgentGuard agentGuard) {
        this.chatClient = chatClient;
        this.toolCallingManager = toolCallingManager;
        this.agentGuard = agentGuard;
    }

    public String run(Prompt initialPrompt, ChatOptions options) {
        Prompt prompt = initialPrompt;
        int round = 0;

        ChatResponse response = callWithoutAutomaticLoop(prompt, options);
        while (response != null && response.hasToolCalls()) {
            round++;

            // 执行前统一检查轮次、截止时间、重复动作、权限和审批要求
            agentGuard.beforeToolExecution(round, response);

            ToolExecutionResult execution =
                    toolCallingManager.executeToolCalls(prompt, response);

            // 工具结果和历史由框架转换；应用仍应在工具内部完成脱敏与结果限长
            prompt = new Prompt(execution.conversationHistory(), options);
            response = callWithoutAutomaticLoop(prompt, options);
        }

        if (response == null || response.getResult() == null) {
            throw new AgentStoppedException("EMPTY_MODEL_RESPONSE");
        }
        return response.getResult().getOutput().getText();
    }

    private ChatResponse callWithoutAutomaticLoop(Prompt prompt,
                                                  ChatOptions options) {
        return chatClient.prompt(prompt)
                .options(options)
                // 关闭本次请求自动注册的工具循环，避免与手动循环重复执行
                .advisors(AdvisorParams.toolCallingAdvisorAutoRegister(false))
                .call()
                .chatResponse();
    }
}
```

示例突出的是控制点，不是可直接复制的完整应用。具体 `ChatOptions` 需要携带允许暴露的 `ToolCallback`；工具集合应在请求到来时按租户、角色和会话状态计算，不能把全部后台能力永久注册给模型。

另外，Spring AI 官方说明 `ToolCallingAdvisor` 默认在工具迭代中维护完整会话历史。手动控制时同样要警惕观察结果越积越大：列表查询只回传必要字段和有限条目，大对象落到受控存储后传引用，过旧观察压缩为事实摘要，并保留原始事件 ID 供审计回查。

## 五、真实场景：售后 Agent 查询订单进度

假设用户问：“我的订单怎么还没到，能帮我处理吗？”系统可以提供三个只读或受控工具：

- `query_order`：按当前登录用户和订单号查订单；
- `query_logistics`：仅允许查询已归属当前用户的运单；
- `create_service_ticket`：创建售后工单，需要明确原因和幂等键。

一次合理轨迹可能是：

```text
第 1 轮：query_order(orderNo)
观察：已发货，carrierCode 与 trackingNo 可用

第 2 轮：query_logistics(trackingNo)
观察：运输中，最近 48 小时无新轨迹

第 3 轮：create_service_ticket(orderNo, reason, idempotencyKey)
观察：工单已创建，ticketNo = S20260810001

终态：向用户解释物流状态并返回工单号
```

这个流程中，订单归属校验必须由 `query_order` 或工具网关根据认证主体完成，不能相信模型传入的 `userId`。创建工单要使用服务端生成或校验的幂等键，避免模型重试产生多张工单。若创建工单属于需要用户确认的动作，应先返回 `WAITING_APPROVAL`，而不是让一句含糊的“帮我处理”自动扩大为不可逆操作。

观察也应区分“没有数据”和“查询失败”。物流轨迹为空可能表示刚发货；超时表示暂时无法判断；无权限则必须终止。把三者都映射成空字符串，会诱导模型编造解释。

## 六、失败处理：哪些错误可以回到循环

工具失败可分为四类：

1. **参数错误**：字段缺失、格式错误或枚举非法。返回可修正的字段级错误，允许模型最多修正一次；
2. **瞬时错误**：超时、限流和临时不可用。由执行器按退避策略做有限重试，模型不应无限重复同一调用；
3. **业务拒绝**：订单不归属当前用户、状态不允许退款。不可重试，直接进入受控终态；
4. **未知错误**：契约外异常或解析失败。隐藏内部细节，生成关联 ID，停止或转人工。

不要把所有异常转换成“工具调用失败，请重试”。模型看到的观察越模糊，越容易用同样参数再次调用。也不要让模型决定 HTTP 连接重试：网络层重试应在工具执行器内完成，并受统一预算约束；只有工具返回了新的业务信息，才值得进入下一轮模型决策。

当部分动作已成功时，要把补偿边界说清楚。查询类动作无需补偿；创建工单等幂等写操作可以安全重放并返回原结果；支付、删除、发送通知等动作则需要审批、幂等、状态机或人工处置，不能依赖模型“反向调用”来模拟事务回滚。

## 七、安全边界：提示词不能代替授权

ReAct 会把外部观察再次送回模型，因此网页、文档、邮件和工具回包都是潜在的不可信输入。工程上应坚持：

- 系统指令、用户输入、工具描述和工具结果分层组装，不把外部文本拼进高优先级指令；
- 工具按最小权限注册，读写分离，高风险动作使用审批或二次确认；
- 参数 Schema 只解决结构问题，资源归属、额度和业务状态仍由服务端校验；
- 工具运行在隔离身份下，不透传模型供应商令牌或用户原始凭证；
- 对观察结果做长度限制、内容类型检查、脱敏和引用来源标记；
- 输出到 HTML、SQL、Shell 或消息系统前继续使用目标上下文的转义与安全 API。

工具说明也属于安全契约。名称应表达单一能力，描述要写清前置条件与副作用。不要提供 `execute_any_sql`、`call_any_url` 这类无限能力工具；与其要求模型“谨慎使用”，不如把能力拆成受限查询、固定域名请求和经过状态机保护的业务命令。

## 八、可观测性：记录轨迹，不记录秘密

建议为每次 Agent 运行生成 `runId`，每轮生成 `stepId`，并记录以下结构化事件：

```text
runId / stepId / parentStepId
模型调用耗时、结果类型、输入输出 token（供应商可提供时）
工具名、参数摘要、授权结果、幂等键摘要
工具耗时、结果状态、错误码、重试次数
累计轮次、剩余预算、最终终态
```

参数摘要应采用白名单字段或不可逆摘要，不能把身份证号、Token、完整地址和工具原始响应写入日志。对于模型推理，应记录“为什么进入某个业务分支”的可审计决策标签，例如 `LOGISTICS_STALLED`、`NEEDS_USER_CONFIRMATION`，而不是要求或保存模型的完整私密思维链。

核心指标至少包括：任务完成率、平均工具轮次、无工具直接完成比例、工具错误率、重复动作阻断数、超预算率、转人工率，以及各终态占比。只看模型请求成功率，会掩盖“HTTP 都是 200，但 Agent 一直循环”的真实故障。

## 九、常见追问

### 1. ReAct 等于 Chain of Thought 吗

不等于。Chain of Thought 关注中间推理步骤，ReAct 的核心是推理与外部行动交替，并让环境观察影响下一步。工程系统可以保留动作、观察和决策标签，而不展示模型内部推理全文。

### 2. 有 Function Calling 就自动拥有 ReAct Agent 吗

没有。Function Calling 提供模型表达工具调用的协议能力；ReAct 还需要应用维护循环、上下文、观察、预算、终态和失败策略。一次函数调用可以只是普通工作流中的单步，并不必然构成 Agent。

### 3. 自动工具循环还是手动循环

简单只读问答、工具低风险且不需要中间进度时，使用框架自动循环更省代码。涉及审批、SSE 逐步反馈、动态工具集、复杂预算、重复检测或每轮持久化恢复时，应手动接管或使用显式工作流引擎。

### 4. 温度调低能防止重复调用吗

不能作为保证。采样参数只影响生成分布，无法替代确定性的最大轮次、动作摘要去重、截止时间和幂等控制。

### 5. 工具越多，Agent 越强吗

通常不是。工具过多会增加选择歧义、上下文成本和越权面。应按当前任务检索或裁剪候选工具，并让每个工具保持高内聚、低副作用、契约清晰。

## 十、选择建议与最佳实践

如果任务步骤固定、分支有限且合规要求强，优先使用普通状态机或工作流；如果下一步必须依据开放环境反馈动态决定，才考虑 ReAct。两者也可以组合：工作流负责不可越过的阶段，ReAct 只在某个受控节点内选择查询工具或生成建议。

上线前可以按这份清单检查：

1. 每个工具都有明确输入 Schema、授权点、超时和结果上限；
2. 写工具具备幂等键，危险动作具备审批或确认；
3. 循环有轮次、时间、成本、重复动作和取消限制；
4. 错误分为可修正、可重试、业务拒绝和未知异常；
5. 外部观察按不可信输入处理，并进行脱敏与限长；
6. 运行状态可以持久化，等待审批或进程重启后不会重复副作用；
7. 轨迹日志能回答“调用了什么、依据什么事实、谁授权、结果怎样”；
8. 有确定性的降级路径：返回部分结果、转人工或切回固定工作流。

## 总结

ReAct 的价值，是让模型在行动结果的反馈下逐步调整下一步，而不是一次性猜完所有答案。它适合开放、动态、需要工具交互的任务，但不等于把系统控制权交给模型。

可靠实现应把模型限制在“提出下一步”的位置，把工具权限、参数校验、预算、幂等、停止条件、错误分类与审计牢牢放在应用侧。先用确定性的循环控制器守住边界，再让模型在边界内发挥决策能力，ReAct 才能从漂亮 Demo 变成可维护的 Java 后端能力。

## 参考资料

- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
- [Spring AI 2.0.0：Tool Calling](https://docs.spring.io/spring-ai/reference/api/tools.html)
- [Spring AI 2.0.0：ChatClient API](https://docs.spring.io/spring-ai/reference/api/chatclient.html)
