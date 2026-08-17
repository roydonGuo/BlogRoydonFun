---
title: AI Agent 的 SubAgent 工程实践：任务委派、上下文隔离与结果回收
date: 2026-08-17
category: 后端开发
cover: /images/posts/agent-subagent-delegation-engineering-knowledge-map.png
tags: [agent, subagent, multi-agent, orchestration, java]
excerpt: 从“主 Agent 保留控制权、SubAgent 只完成有边界的子任务”出发，讲清拆分条件、委派契约、上下文与权限隔离、并行调度、结果回收、冲突处理、取消传播和 Java 编排实现。
---

# AI Agent 的 SubAgent 工程实践：任务委派、上下文隔离与结果回收

<img src="/images/posts/agent-subagent-delegation-engineering-knowledge-map.png" alt="AI Agent 的 SubAgent 工程实践：任务委派、上下文隔离与结果回收知识串联图" style="border-radius: 10px;" />

从“主 Agent 保留控制权、SubAgent 只完成有边界的子任务”出发，讲清拆分条件、委派契约、上下文与权限隔离、并行调度、结果回收、冲突处理、取消传播和 Java 编排实现。

## 先说结论：SubAgent 不是多开几个模型请求

SubAgent 是由主 Agent 或确定性编排器创建的受限执行单元。它围绕一个明确子目标独立运行，拥有单独的指令、上下文、工具、预算和生命周期，最终把结构化结果交回上级，而不是直接共享主 Agent 的全部对话和权限。

一套可上线的 SubAgent 机制至少要守住六条边界：

1. **只有可独立验收的任务才拆分**，不能为了“显得智能”强行多 Agent；
2. **主 Agent 保留最终回答与副作用决策权**，SubAgent 默认只提供证据或候选方案；
3. **委派使用结构化任务契约**，不把一句模糊自然语言当作完整需求；
4. **上下文、工具和权限按任务最小化**，不复制主 Agent 的全部能力；
5. **每个子任务都有预算、超时、取消和停止条件**，禁止无限递归委派；
6. **结果必须可追溯、可合并、可拒绝**，主 Agent不能把多份输出简单拼接。

本文以通用 Java 编排器为主，不绑定模型供应商的私有字段。事实核对时间为 2026-08-17。OpenAI Agents SDK 官方将多 Agent 编排区分为“Manager 调用 Agents as tools”和“Handoffs”；Anthropic 公开的研究系统则采用 Orchestrator-Worker，让主 Agent 把相互独立的研究方向并行交给 SubAgent。具体以 [OpenAI Agent orchestration](https://openai.github.io/openai-agents-python/multi_agent/)、[Handoffs](https://openai.github.io/openai-agents-python/handoffs/) 和 [Anthropic multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) 为准。

## 一、先区分四个容易混淆的概念

### 1. 普通工具调用

工具是确定性能力，例如查询数据库、读取文件或调用订单接口。模型给出参数，应用执行函数。工具本身通常没有独立的推理循环、任务记忆和动态规划。

### 2. SubAgent

SubAgent 通常拥有自己的指令、模型调用循环和工具集合，可以在边界内完成多步任务。例如“检查支付模块的并发风险并返回证据”，它可能需要搜索代码、追踪调用、阅读配置和整理发现。

### 3. Handoff

Handoff 是控制权转移：分诊 Agent 选择退款专家后，专家成为当前对话的活跃 Agent。OpenAI Agents SDK 官方文档说明，Handoff 默认会把对话历史交给接收方，也支持通过输入过滤器改变转交内容。

### 4. Workflow 节点

Workflow 节点由代码或图编排器决定执行顺序，输入输出相对固定。节点内部可以调用模型，但“下一步是谁”通常不由模型自由决定，因此比开放式 Agent 更可预测。

如果主 Agent 仍拥有用户会话并把专家当作一个有界工具调用，这是典型 SubAgent/Manager 模式；如果专家接管后续对话，则更接近 Handoff。

## 二、什么时候值得使用 SubAgent

### 适合拆分的任务

- 有两个以上**相互独立**的探索方向，可以并行完成；
- 不同子任务需要明显不同的工具、知识或指令；
- 单个任务上下文过大，拆分后能隔离噪声；
- 每个子任务都有明确输入、输出和验收标准；
- 需要多份独立判断来发现遗漏或交叉验证；
- 主任务需要先收集证据，再统一综合和决策。

例如分析一个线上故障，可以拆为日志时间线、数据库状态、近期发布差异三个只读 SubAgent。它们互不修改状态，结果可以用同一事故 ID 汇总。

### 不适合拆分的任务

- 一次模型调用就能稳定完成的简单问答；
- 子步骤强依赖前一步结果，几乎无法并行；
- 多个执行者必须高频修改同一份共享状态；
- 需求仍然模糊，连验收标准都未确定；
- 涉及付款、删除、发布等高风险副作用，却没有集中审批点；
- 调用成本、延迟或限流比任务收益更重要。

多 Agent 会增加调度、上下文复制、冲突合并和评测成本。Anthropic 也把其多 Agent 研究架构定位在适合广度优先、可探索多个独立方向的查询，而不是所有任务的默认方案。

## 三、两种主流协作模式怎么选

| 模式 | 控制权 | SubAgent 输入 | 最终回答者 | 适用场景 |
|---|---|---|---|---|
| Manager / Agent as Tool | 主 Agent 始终持有 | 主 Agent 生成的有界任务包 | 主 Agent | 并行研究、代码审查、证据收集、方案比较 |
| Handoff | 转移给专家 Agent | 过滤后的会话与转交参数 | 接管的专家 | 客服分诊、领域路由、专家直接服务用户 |

工程上不要把两者混成一个隐式流程。必须明确：谁拥有用户会话、谁能继续调用工具、谁负责最终答案、发生失败后回到哪里。

本文后续采用 Manager 模式，因为它更适合 Java 后端统一控制权限、预算、副作用和结果合并。

## 四、完整 SubAgent 系统由哪些部分组成

### 1. 任务分解器

把主目标拆为若干子目标，并判断依赖关系。任务分解既可以由模型提议，也可以由代码按业务类型生成；最终都要经过应用校验，限制任务数量、深度和允许的类型。

### 2. 能力注册表

描述可用 SubAgent 的职责、输入 Schema、输出 Schema、工具白名单、默认预算和禁止动作。不要让模型通过任意名称实例化未知 Agent。

### 3. 调度器

处理依赖、并行度、优先级、超时、重试、取消和背压。并行不等于一次性启动所有任务；需要同时受模型限流、下游连接池和业务预算约束。

### 4. 隔离运行时

为每个 SubAgent 准备独立上下文、工具凭证、工作目录或沙箱、Trace 和临时状态。默认禁止读取兄弟 SubAgent 的中间思考或未授权文件。

### 5. 结果信封

统一返回状态、结论、证据、置信说明、未解决问题、消耗和错误，而不是只返回一段自然语言。

### 6. 汇总器

检查结果完整性、证据来源和相互冲突，再决定补派任务、请求用户信息或生成最终答案。汇总器不能用“多数表决”替代事实核验。

### 7. 审批与审计

高风险工具在主 Agent 层集中审批；记录任务树、父子关系、授权范围、状态迁移、工具调用、预算和最终采用了哪些证据。

## 五、委派契约必须比 Prompt 更严格

一个可执行的任务包至少包含：

```json
{
  "taskId": "payment-log-timeline",
  "parentTaskId": "incident-20260817",
  "role": "日志分析员",
  "objective": "还原支付回调重复发生的时间线",
  "acceptanceCriteria": [
    "列出首次和重复回调时间",
    "每个结论附日志引用",
    "区分事实与推断"
  ],
  "contextRefs": ["log-query:pay-callback:masked"],
  "allowedTools": ["search_logs", "read_trace"],
  "forbiddenActions": ["write_database", "send_message"],
  "outputSchema": "SubAgentResultV1",
  "deadline": "由服务端运行时注入",
  "maxDelegationDepth": 0
}
```

其中身份、租户、权限、截止时间和预算必须由可信运行时注入，不能让模型自行填写。`maxDelegationDepth=0` 表示该 SubAgent 不得继续创建下级 Agent，是安全的默认值。

任务描述要回答五个问题：做什么、不做什么、能看什么、能调用什么、怎样算完成。如果输入仍需 SubAgent 自己猜测，后续合并几乎一定会出现范围漂移。

## 六、上下文隔离：不要复制主 Agent 的全部历史

主 Agent 的会话可能包含用户隐私、无关文件、其他租户信息和高权限工具。SubAgent 只应获得完成子任务所需的最小上下文：

```text
角色与任务边界
    + 当前子目标与验收标准
    + 必要事实和可回取引用
    + 允许的工具 Schema
    + 输出契约与预算
```

不要默认传递：完整聊天历史、其他 SubAgent 输出、主 Agent 的全部工具、密钥、隐藏审批状态和无关长期记忆。

如果确实需要 Handoff，应使用输入过滤明确裁掉无关历史。官方 OpenAI Agents SDK 的 Handoff 支持 `input_filter`，正是为了控制接收方看到的历史与当前条目。不同框架 API 会变化，但“转交前过滤”是稳定的安全原则。

## 七、Java 示例：受控并行执行多个只读 SubAgent

先定义稳定的任务和结果协议：

```java
public enum SubAgentStatus {
    CREATED,
    RUNNING,
    SUCCEEDED,
    FAILED,
    TIMED_OUT,
    CANCELLED
}

public record SubAgentTask(
        String taskId,
        String role,
        String objective,
        List<String> acceptanceCriteria,
        List<String> contextRefs,
        Set<String> allowedTools,
        int maxDelegationDepth) {
}

public record Evidence(
        String sourceId,
        String excerpt,
        String version) {
}

public record SubAgentResult(
        String taskId,
        SubAgentStatus status,
        String conclusion,
        List<Evidence> evidence,
        List<String> unresolvedQuestions,
        String errorCode) {
}
```

`SubAgentRunner` 负责把任务包转换为模型请求并执行工具循环。编排器不关心模型私有参数，只依赖统一接口：

```java
public interface SubAgentRunner {

    SubAgentResult run(SubAgentTask task, RuntimeContext context);
}

public record RuntimeContext(
        String tenantId,
        String traceId,
        Instant deadline,
        Map<String, Object> trustedAttributes) {
}
```

下面使用 Java 21 虚拟线程并行执行独立只读任务。虚拟线程降低阻塞式编排的线程成本，但不会自动解决模型限流、数据库连接池或外部 API 容量，仍需要单独的并发门控。

```java
public final class SubAgentOrchestrator implements AutoCloseable {

    private final SubAgentRunner runner;
    private final ExecutorService executor;
    private final Semaphore concurrencyGate;

    public SubAgentOrchestrator(SubAgentRunner runner, int maxConcurrency) {
        this.runner = runner;
        this.executor = Executors.newVirtualThreadPerTaskExecutor();
        // 虚拟线程可以很多，但真正进入模型和下游的任务必须受容量限制
        this.concurrencyGate = new Semaphore(maxConcurrency);
    }

    public List<SubAgentResult> execute(
            List<SubAgentTask> tasks,
            RuntimeContext context) {

        validateTaskGraph(tasks);

        Map<String, Future<SubAgentResult>> futures = new LinkedHashMap<>();
        for (SubAgentTask task : tasks) {
            Future<SubAgentResult> future = executor.submit(() -> {
                boolean acquired = false;
                try {
                    Duration wait = Duration.between(Instant.now(), context.deadline());
                    if (wait.isNegative() || wait.isZero()) {
                        return timeout(task.taskId());
                    }

                    acquired = concurrencyGate.tryAcquire(
                            wait.toMillis(),
                            TimeUnit.MILLISECONDS);
                    if (!acquired) {
                        return timeout(task.taskId());
                    }

                    // Runner 内部还要校验工具白名单与租户上下文
                    return runner.run(task, context);
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                    return cancelled(task.taskId());
                } finally {
                    if (acquired) {
                        concurrencyGate.release();
                    }
                }
            });
            futures.put(task.taskId(), future);
        }

        List<SubAgentResult> results = new ArrayList<>();
        for (Map.Entry<String, Future<SubAgentResult>> entry : futures.entrySet()) {
            String taskId = entry.getKey();
            Future<SubAgentResult> future = entry.getValue();
            try {
                Duration remaining = Duration.between(
                        Instant.now(),
                        context.deadline());
                if (remaining.isNegative() || remaining.isZero()) {
                    future.cancel(true);
                    results.add(timeout(taskId));
                    continue;
                }

                results.add(future.get(
                        remaining.toMillis(),
                        TimeUnit.MILLISECONDS));
            } catch (TimeoutException ex) {
                // cancel(true) 只是发出中断请求，Runner 与工具也必须协作响应取消
                future.cancel(true);
                results.add(timeout(taskId));
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                cancelAll(futures.values());
                results.add(cancelled(taskId));
                break;
            } catch (ExecutionException ex) {
                results.add(failed(taskId, "SUBAGENT_EXECUTION_FAILED"));
            }
        }

        return List.copyOf(results);
    }

    private void validateTaskGraph(List<SubAgentTask> tasks) {
        Set<String> ids = new HashSet<>();
        for (SubAgentTask task : tasks) {
            if (!ids.add(task.taskId())) {
                throw new IllegalArgumentException("重复子任务 ID: " + task.taskId());
            }
            // 默认禁止 SubAgent 继续递归委派，避免任务树失控
            if (task.maxDelegationDepth() != 0) {
                throw new IllegalArgumentException("当前编排器不允许递归委派");
            }
        }
    }

    private void cancelAll(Collection<Future<SubAgentResult>> futures) {
        futures.forEach(future -> future.cancel(true));
    }

    private SubAgentResult timeout(String taskId) {
        return new SubAgentResult(taskId, SubAgentStatus.TIMED_OUT,
                null, List.of(), List.of(), "SUBAGENT_TIMEOUT");
    }

    private SubAgentResult cancelled(String taskId) {
        return new SubAgentResult(taskId, SubAgentStatus.CANCELLED,
                null, List.of(), List.of(), "SUBAGENT_CANCELLED");
    }

    private SubAgentResult failed(String taskId, String code) {
        return new SubAgentResult(taskId, SubAgentStatus.FAILED,
                null, List.of(), List.of(), code);
    }

    @Override
    public void close() {
        executor.close();
    }
}
```

这段代码刻意没有自动重试。SubAgent 超时后，底层模型请求可能已经成功，写工具甚至可能已经产生副作用；只有只读且明确可重试的任务才能自动重派。高风险操作应留在主 Agent 的集中审批和幂等执行层。

## 八、结果回收：主 Agent 应该拿到什么

SubAgent 的返回值不应是“我分析完了，问题可能在数据库”。至少要包含：

- 明确状态：成功、失败、超时或取消；
- 一句话结论；
- 支撑结论的证据与来源版本；
- 事实、推断和建议的区分；
- 未解决问题与缺失输入；
- 是否建议继续派生任务；
- Token、耗时、工具次数等消耗摘要。

主 Agent 合并时按以下顺序处理：先验证协议完整性，再校验证据权限与新鲜度，然后处理冲突，最后才生成用户可见答案。

如果两个 SubAgent 结论冲突，不要让第三个模型直接“投票”。应比较来源权威性、时间、查询范围和版本；仍无法判断时，创建一个只负责验证冲突点的新任务，或者向用户说明不确定性。

## 九、失败、重试和取消传播

### 任务拒绝

SubAgent 发现目标超出职责、上下文不足或需要禁止工具时，应返回稳定错误码，不要自行扩大权限。

### 超时

主 Agent 到达截止时间后停止等待，并向仍在运行的子任务传播取消。Java `Future.cancel(true)` 只发送中断，HTTP 客户端、模型 SDK 和工具实现也必须支持超时或取消，否则后台工作仍会继续消耗资源。

### 部分成功

三个子任务中两个成功，不一定意味着整个任务失败。汇总器根据验收标准判断：缺失结果是否关键、能否降级回答、是否值得补派。

### 重试

只对短暂网络错误、限流和明确幂等的只读任务进行有界重试。参数错误、权限拒绝、任务范围不清和确定性业务拒绝都不应重试。

### 主任务取消

用户取消、审批拒绝或上游请求断开后，应取消整棵任务树、停止创建新任务、撤销临时凭证并清理工作区。取消事件也要进入审计日志。

## 十、安全边界：多 Agent 会放大权限错误

1. **最小工具集**：每个角色只注册完成子任务需要的工具；
2. **默认只读**：研究和分析型 SubAgent 不提供写工具；
3. **可信上下文注入**：租户、身份、审批和预算由运行时提供；
4. **禁止通用执行器**：不要给 SubAgent 任意 SQL、Shell、HTTP 或文件系统权限；
5. **隔离临时空间**：不同任务使用独立目录、凭证和网络策略；
6. **结果视为不可信输入**：兄弟 Agent 的输出不能覆盖系统规则；
7. **限制递归深度**：默认不允许 SubAgent 再创建 SubAgent；
8. **集中副作用**：退款、发布、删除和通知由主 Agent 统一确认与执行；
9. **秘密不跨边界**：只传短期引用，不把密钥放进任务 Prompt；
10. **全链路审计**：记录父子任务、授权工具、证据和最终采用结果。

## 十一、可观测性：要看到一棵任务树

每次运行至少关联以下标识：`traceId`、`rootTaskId`、`parentTaskId`、`taskId`、`agentRole` 和 `attempt`。任务树上的每个节点应记录：

- 排队、启动、结束时间与最终状态；
- 输入上下文类别和脱敏摘要；
- 模型、工具调用、Token、延迟和成本；
- 并发门控等待时间与限流次数；
- 取消来源、超时层级和重试原因；
- 返回证据、冲突数和最终是否被主 Agent 采用。

关键指标不只是平均耗时，还包括任务拆分数、最大深度、成功率、部分成功率、无效委派率、重复任务率、结果采用率、冲突率和单位成功任务成本。

追踪内容默认不记录完整 Prompt、工具参数和结果，因为其中可能包含敏感数据。保留哈希、引用 ID、Schema 版本和必要的脱敏字段即可。

## 十二、常见追问与踩坑

### SubAgent 越多，质量越好吗

不是。更多 Agent 会增加重复探索、上下文复制、限流、合并冲突和成本。数量应由独立子问题的数量决定，并通过真实任务评测，而不是写死固定值。

### 主 Agent 可以把完整对话直接发给 SubAgent 吗

不建议。Manager 模式只应传结构化子任务和必要证据。完整历史会引入隐私、噪声和指令冲突；Handoff 也应在转交前过滤。

### SubAgent 能直接操作数据库吗

查询型 Agent 可以通过受限、参数化、租户隔离的只读工具访问必要数据；不要提供通用 SQL。写操作默认回到主 Agent，经过审批、幂等和业务状态校验。

### 并行执行一定更快吗

不一定。模型限流、共享连接池、串行依赖和结果合并都可能抵消并行收益。只有真正独立且耗时占比高的任务才适合并行。

### 是否需要不同模型承担不同角色

不一定。角色差异首先来自任务、工具、上下文和输出契约。选择不同模型属于成本与能力优化，应基于评测结果，不要把“角色名”直接映射为未经验证的模型组合。

### SubAgent 的思考过程要全部返回吗

不需要。主 Agent需要可验证的结论、证据、限制和未解决问题，而不是冗长内部推理。返回结构化工作产物也能减少上下文污染和敏感信息暴露。

## 十三、选择建议与最佳实践

1. 先用单 Agent 和确定性工具完成基线，再证明 SubAgent 能提高质量或降低耗时；
2. 只拆分可独立验收、依赖关系清楚的子目标；
3. 明确采用 Manager 还是 Handoff，不能让控制权隐式漂移；
4. 用版本化任务 Schema 代替自由文本委派；
5. 主 Agent只传最小上下文，SubAgent 默认只读且禁止递归委派；
6. 任务数量、并发、深度、Token、工具次数和总耗时都设硬上限；
7. 独立任务才并行，有依赖的任务使用显式 DAG；
8. 结果必须附证据、状态和未解决问题，禁止只返回自然语言结论；
9. 冲突通过证据核验解决，不用简单投票；
10. 取消要从根任务传播到模型请求、工具和临时资源；
11. 高风险副作用集中在主 Agent 审批、鉴权和幂等执行；
12. 用任务树追踪并评测任务成功、结果采用、延迟、成本与安全事件。

## 总结

SubAgent 的价值不在于“同时运行更多模型”，而在于把复杂任务拆成多个上下文干净、能力受限、结果可验收的工作单元。主 Agent负责目标、分解、授权和最终判断；SubAgent负责在明确边界内探索并返回证据；应用负责调度、隔离、预算、取消和审计。

当任务不能被清楚描述、上下文无法安全切分、结果无法独立验收时，就不应该创建 SubAgent。真正可靠的多 Agent 系统，首先是一套可治理的分布式任务系统，其次才是多次模型调用。
