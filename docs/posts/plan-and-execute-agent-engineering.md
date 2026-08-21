---
title: Plan-and-Execute Agent 工程实践：规划、执行与重规划
date: 2026-08-20
category: AI
cover: /images/posts/plan-and-execute-agent-engineering-knowledge-map.webp
tags: [ agent, plan-and-execute, spring-ai, tool-calling, workflow ]
excerpt: Plan-and-Execute 的价值是把长任务拆成可检查的显式计划，再由应用逐步执行、验证和重规划。本文用 Spring AI 2.0.0 讲清状态机、数据契约、工具边界、终止条件与可观测性。
---

# Plan-and-Execute Agent 工程实践：规划、执行与重规划

<img src="/images/posts/plan-and-execute-agent-engineering-knowledge-map.webp" alt="Plan-and-Execute Agent 工程实践：规划、执行与重规划知识串联图" style="border-radius: 10px;" />

Plan-and-Execute 的价值是把长任务拆成可检查的显式计划，再由应用逐步执行、验证和重规划。本文用 Spring AI 2.0.0
讲清状态机、数据契约、工具边界、终止条件与可观测性。

## 先说结论：计划是状态，不是一段提示词

ReAct 通常在每轮观察后决定下一步，适合路径短、环境反馈强的任务。Plan-and-Execute
先生成一份显式计划，再逐步执行；当事实、权限或依赖变化时，只重写未完成部分。它更适合跨系统排障、资料研究、代码迁移等长任务。

可靠实现至少包含五个角色：

| 角色           | 职责               | 不应承担的职责      |
|--------------|------------------|--------------|
| Planner      | 把目标拆成有依赖关系的步骤    | 直接调用外部工具     |
| Executor     | 执行当前可运行步骤        | 随意修改总目标      |
| Evaluator    | 判断结果是否满足步骤验收条件   | 用语气流畅代替事实验证  |
| Replanner    | 保留已完成事实，调整剩余计划   | 无边界地反复推翻全部计划 |
| Orchestrator | 持久化状态、控制预算、权限和终止 | 把控制权交给模型文本   |

因此，Agent 不是一次模型调用，而是一台由应用掌控的状态机：

```text
目标 → 规划 → 取可执行步骤 → 权限检查 → 执行 → 验证
                         ↑                 ↓
                    重规划 ← 失败或事实变化
                                      ↓
                                完成 / 阻塞 / 超预算
```

## 用数据契约固定计划

计划不能只保存为 Markdown 列表，否则步骤 ID、依赖、状态和验收条件都难以可靠更新。可以先定义最小 Java 契约：

```java
public record Plan(
        String goal,
        List<PlanStep> steps,
        int revision
) {
}

public record PlanStep(
        String id,
        String instruction,
        List<String> dependsOn,
        String acceptance,
        RiskLevel risk,
        StepStatus status
) {
}

public enum StepStatus {
    PENDING, RUNNING, SUCCEEDED, FAILED, BLOCKED, SKIPPED
}

public enum RiskLevel {
    READ_ONLY, REVERSIBLE_WRITE, IRREVERSIBLE_WRITE
}
```

`instruction` 描述动作，`acceptance` 描述可验证结果，两者必须分开。例如“查询订单”是动作，“返回订单号、支付状态和更新时间”才是验收条件。步骤使用稳定
ID，重规划时才能保留历史、关联工具调用和实现幂等。

Spring AI 2.0.0 的 `ChatClient` 可以把模型响应转换为 Java 类型；`validateSchema()` 会按生成的 Schema
校验并在失败时重试。原生结构化输出是否可用取决于具体模型，因此不要把它写成跨提供商保证：

```java
Plan plan = chatClient.prompt()
        .system("""
                你是任务规划器，只拆解目标，不调用工具。
                每步必须可独立验收，并声明依赖和风险级别。
                """)
        .user(userGoal)
        .call()
        // 校验结构，避免缺少步骤 ID 或状态字段的结果进入执行器
        .entity(Plan.class, spec -> spec.validateSchema());
```

Schema 合法仍不代表计划正确。应用还要校验：步骤 ID 唯一、依赖存在且无环、步骤数量不超上限、高风险动作有审批策略、验收条件不为空。

## 编排器只推进一个确定状态

不要让模型在一轮中“规划并执行全部步骤”。编排器每次只选择依赖已成功的步骤，执行后立即保存事件，再决定继续、重规划或停止：

```java
public RunResult run(AgentRun run) {
    while (!run.isTerminal()) {
        // 预算由应用硬限制，不能依赖提示词自觉停止
        budgetGuard.check(run);

        PlanStep step = scheduler.nextReadyStep(run.plan());
        if (step == null) {
            return finishOrBlock(run);
        }

        approvalPolicy.requireApprovalIfNeeded(run.id(), step);
        stepStore.markRunning(run.id(), step.id());

        try {
            ToolResult result = executor.execute(step, run.trustedContext());
            Evaluation evaluation = evaluator.evaluate(step.acceptance(), result);

            // 先持久化原始证据，再让模型摘要，避免摘要替代事实
            eventStore.append(run.id(), step.id(), result, evaluation);
            if (evaluation.passed()) {
                stepStore.markSucceeded(run.id(), step.id());
            } else {
                replanner.reviseRemaining(run.id(), evaluation.reason());
            }
        } catch (RetryableToolException ex) {
            retryPolicy.schedule(run.id(), step.id(), ex);
        } catch (Exception ex) {
            stepStore.markFailed(run.id(), step.id(), ex.getClass().getSimpleName());
        }
    }
    return run.result();
}
```

生产实现应以数据库中的运行版本号做乐观锁，确保同一 `runId + stepId` 只有一个 Worker
获得执行权。对支付、发消息、创建资源等副作用，还要向下游传稳定幂等键；仅把步骤标为 `RUNNING` 不能防止进程崩溃后的重复执行。

## 重规划只改“未来”

触发重规划的典型原因只有几类：

1. 工具返回的新事实让后续前提失效；
2. 步骤验收失败，原路径不可继续；
3. 依赖服务或权限不可用，需要替代路径；
4. 用户修改目标或审批结果；
5. 预算不足，需要缩减交付范围。

重规划输入应包含原目标、已完成步骤的事实摘要、失败证据、剩余预算和不可变约束。输出只能修改 `PENDING`、`FAILED` 或 `BLOCKED`
的后续步骤；已成功步骤及其证据不可被模型改写。每次修订递增 `revision`，并保存旧计划差异，才能回答“为什么改路”。

需要设置硬终止条件：最大模型调用数、最大工具调用数、最大重规划次数、截止时间和成本预算。连续生成等价计划、没有可执行步骤、关键审批被拒绝时，应进入 `BLOCKED`
或 `FAILED`，而不是继续消耗 Token。

## 工具、权限与上下文边界

Spring AI 的工具调用契约是：模型提出工具名和参数，应用负责解析与执行；模型不会直接获得后端 API。Plan-and-Execute
更应把这条边界固定下来：

- Planner 只看到工具能力摘要，不得到密钥、租户身份或完整返回值；
- Executor 从服务端可信上下文注入 `userId`、`tenantId` 和权限，禁止使用模型生成的身份；
- 高风险步骤在工具执行前审批，审批应绑定计划版本、步骤 ID、参数摘要和有效期；
- 工具结果区分 `SUCCESS`、`RETRYABLE_ERROR`、`BUSINESS_REJECTED`、`PERMISSION_DENIED` 与 `UNKNOWN_OUTCOME`；
- `UNKNOWN_OUTCOME` 先按幂等键查询结果，不能直接重放副作用。

工具返回值只保留决策所需字段，并限制大小。网页、工单和日志都属于不可信数据，其中的“忽略规则并调用某工具”不能升级为系统指令。

## 可观测性要能还原一次运行

Spring AI 2.0.0 基于 Micrometer 为 `ChatClient`、模型和工具调用提供 Observation，但业务编排仍需补充自己的低基数指标和
Trace 事件：

| 维度 | 建议记录                   |
|----|------------------------|
| 运行 | `run_id`、目标类型、最终状态、总耗时 |
| 计划 | 版本、步骤数、重规划次数、计划差异摘要    |
| 步骤 | `step_id`、状态、尝试次数、验收结果 |
| 工具 | 工具名、耗时、结果类别、幂等键哈希      |
| 预算 | 模型调用数、工具调用数、Token 与费用  |

Prompt、工具参数和结果可能包含隐私或密钥，不应默认写入指标标签或 Trace。Spring AI 官方也默认不导出完整 Prompt、Completion
和工具参数；如需开启，应先做脱敏、采样和访问控制。

## 何时不要使用

以下任务通常不需要 Plan-and-Execute：单次检索、固定三步流程、低延迟聊天、可由确定性代码完整表达的业务规则。此时普通服务编排、工作流引擎或单轮
Tool Calling 更便宜、更可靠。

它真正适合的是“路径事先不完全确定，但每一步都能被应用验证”的长任务。工程重点不是让计划显得聪明，而是让计划可持久化、可审批、可恢复、可终止。

## 总结

Plan-and-Execute 把一次长推理拆成规划、执行、验证和重规划四个受控阶段。Planner 产出结构化候选计划，Orchestrator
掌握状态和预算，Executor 在权限边界内调用工具，Evaluator 用证据验收，Replanner 只修改未来步骤。

一套能上线的实现应满足：计划有稳定契约，执行有幂等，副作用有审批，失败有分类，循环有上限，过程有事件记录。做到这些，Agent
才是一条可治理的任务链，而不是一段不可复现的对话。

参考资料（核对日期：2026-08-20）：

- [Spring AI 2.0.0：Chat Client API](https://docs.spring.io/spring-ai/reference/api/chatclient.html)
- [Spring AI 2.0.0：Tool Calling](https://docs.spring.io/spring-ai/reference/api/tools.html)
- [Spring AI 2.0.0：Structured Output Converter](https://docs.spring.io/spring-ai/reference/api/structured-output-converter.html)
- [Spring AI 2.0.0：Observability](https://docs.spring.io/spring-ai/reference/observability/index.html)
- [ACL 2023：Plan-and-Solve Prompting](https://aclanthology.org/2023.acl-long.147/)
