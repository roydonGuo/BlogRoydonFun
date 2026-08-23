---
title: 主流 AI Agent 架构全景：ReAct、Plan-and-Execute、Reflection、Deep Research、HITL 与 Multi-Agent
date: 2026-08-23
category: AI
cover: /images/posts/mainstream-ai-agent-architectures-knowledge-map.webp
tags: [ai, agent, react, planning, reflection, deep-research, hitl, multi-agent]
excerpt: Agent 架构的本质是如何组织状态、决策、工具、反馈与停止条件。本文横向拆解六类主流架构解决的问题、运行机制、场景和取舍，并给出带数据结构、接口和异常分支的 Java 示例。
---

# 主流 AI Agent 架构全景：ReAct、Plan-and-Execute、Reflection、Deep Research、HITL 与 Multi-Agent

<img src="/images/posts/mainstream-ai-agent-architectures-knowledge-map.webp" alt="主流 AI Agent 架构全景：ReAct、Plan-and-Execute、Reflection、Deep Research、HITL 与 Multi-Agent知识串联图" style="border-radius: 10px;" />

Agent 架构的本质是如何组织状态、决策、工具、反馈与停止条件。本文横向拆解六类主流架构解决的问题、运行机制、场景和取舍，并给出带数据结构、接口和异常分支的 Java 示例。

## 先说结论：不要按流行度选架构，要按不确定性选

没有一种 Agent 架构能同时把灵活性、正确率、延迟、成本和可控性做到最好。选择时先看任务的主要不确定性在哪里：

| 主要问题 | 优先架构 | 核心代价 |
|---|---|---|
| 下一步要根据工具结果动态决定 | ReAct | 调用轮次多，容易循环 |
| 任务长、依赖多、需要全局进度 | Plan-and-Execute | 初始计划可能过早固化 |
| 第一次结果常有缺陷，但有明确反馈 | Reflection | 多一次或多次评审成本 |
| 需要多跳检索、证据与引用 | Deep Research | 高延迟、高 Token 和检索成本 |
| 存在不可逆、高风险或合规动作 | HITL | 等待人工导致吞吐下降 |
| 子任务能按角色、权限或上下文隔离 | Multi-Agent | 协调、冲突和级联错误增加 |

这六类不是互斥框架，而是可组合的控制结构。常见生产组合是：Planner 拆任务，ReAct Worker 执行，Reflection 验收，HITL 审批高风险工具，Multi-Agent 并行分工；Deep Research 则是把规划、检索、证据核验和写作组合成专用长任务。

本文的“主流架构”严格指来源条目列出的六类。它们是工程模式，不是一个官方封闭分类。文中机制以 ReAct、Plan-and-Solve、Reflexion、STORM、AutoGen、MetaGPT 等原始论文和 LangGraph HITL 官方文档为事实线索，核对日期为 2026-08-23。

## 判断一个系统是否真的算 Agent

普通工作流由代码预先决定每一步；Agent 至少把一部分“下一步做什么”的选择交给模型，同时由运行时守住边界：

基本执行链是：输入 → 读取状态 → 模型决策 → 校验动作 → 执行工具 → 写入观察 → 判断停止。下面先用 Java 定义这条链路中反复出现的公共对象。

无论使用哪种架构，生产实现都不能缺少公共运行状态。这里的 `state` 不是框架魔法，也不是模型里的隐藏变量，而是我们自己定义并持久化的 Java 对象：

```java
public enum RunStatus {
    RUNNING, WAITING, SUCCEEDED, FAILED, CANCELLED
}

// 限制 Agent 最多消耗多少资源；每执行一步都要扣减。
public record Budget(
        int remainingSteps,
        int remainingToolCalls,
        long deadlineEpochMillis) {

    public boolean available() {
        return remainingSteps > 0
                && remainingToolCalls >= 0
                && System.currentTimeMillis() < deadlineEpochMillis;
    }

    public Budget consumeStep(int toolCalls) {
        return new Budget(
                remainingSteps - 1,
                remainingToolCalls - toolCalls,
                deadlineEpochMillis);
    }
}

// state 就是 AgentState 的实例：保存目标、进度、工具观察和恢复信息。
public final class AgentState {
    private final String runId;
    private final String traceId;
    private final String goal;
    private RunStatus status = RunStatus.RUNNING;
    private Budget budget;
    private final List<String> messages = new ArrayList<>();
    private final List<String> observations = new ArrayList<>();
    private final List<ArtifactRef> artifacts = new ArrayList<>();
    private final Set<String> allowedTools;
    private final String idempotencyKey;
    private long checkpointVersion;

    public AgentState(String goal, Budget budget, Set<String> allowedTools) {
        this.runId = UUID.randomUUID().toString();
        this.traceId = UUID.randomUUID().toString();
        this.goal = goal;
        this.budget = budget;
        this.allowedTools = Set.copyOf(allowedTools);
        this.idempotencyKey = UUID.randomUUID().toString();
    }

    public void addObservation(String observation) {
        observations.add(observation);
    }

    public void consumeBudget(int toolCalls) {
        budget = budget.consumeStep(toolCalls);
    }

    public String getRunId() { return runId; }
    public String getGoal() { return goal; }
    public RunStatus getStatus() { return status; }
    public void setStatus(RunStatus status) { this.status = status; }
    public Budget getBudget() { return budget; }
    public List<String> getObservations() { return observations; }
    public Set<String> getAllowedTools() { return allowedTools; }
    public String getIdempotencyKey() { return idempotencyKey; }
}

public record ArtifactRef(String id, String sha256, String mediaType) {}
```

后文中的 `state`、`plan`、`ledger`、`board` 都遵循同一原则：它们是业务代码定义的数据对象，不是 LLM 自动提供的能力。

## 一、ReAct：用观察结果决定下一步

ReAct 将 Reasoning 与 Acting 交错执行：模型先根据当前状态选择一个动作，运行时执行工具，再把 Observation 放回上下文。它解决的是“任务路径无法提前写死”，例如排障、查库存、调用多个 API 或逐步修改代码。

<img src="/images/posts/mainstream-ai-agent-architectures/01-react-loop.webp" alt="ReAct Agent 思考行动观察循环原理图" style="border-radius: 10px;" />

### 运行机制

先把模型可能返回的两种动作定义清楚。`ToolCall` 不是一段任意文本，而是经过 JSON 反序列化后得到的 Java 对象：

```java
public record ToolCall(String toolName, Map<String, Object> arguments) {}

public sealed interface AgentDecision {
    // 模型认为已经可以回答用户。
    record FinalAnswer(String content) implements AgentDecision {}

    // 模型需要先调用工具，再根据工具结果继续决定。
    record CallTool(ToolCall call) implements AgentDecision {}
}

public record ToolResult(
        boolean success,
        String summary,
        ArtifactRef fullResultRef,
        String errorCode) {}

public interface LanguageModel {
    AgentDecision decide(String goal, List<String> observations);
}

public interface ToolExecutor {
    ToolResult execute(ToolCall call, String idempotencyKey, Duration timeout);
}

public final class ReActAgent {
    private final LanguageModel model;
    private final ToolExecutor toolExecutor;
    private final CheckpointStore checkpoints;

    public ReActAgent(
            LanguageModel model,
            ToolExecutor toolExecutor,
            CheckpointStore checkpoints) {
        this.model = model;
        this.toolExecutor = toolExecutor;
        this.checkpoints = checkpoints;
    }

    public String run(String goal) {
        // state 是普通 Java 对象，保存这一轮任务的全部可恢复状态。
        AgentState state = new AgentState(
                goal,
                new Budget(10, 6, System.currentTimeMillis() + 60_000),
                Set.of("searchOrder", "queryInventory"));

        while (state.getBudget().available()) {
            // 只把目标和已压缩的工具观察交给模型，不传数据库连接等内部对象。
            AgentDecision decision = model.decide(
                    state.getGoal(),
                    List.copyOf(state.getObservations()));

            if (decision instanceof AgentDecision.FinalAnswer answer) {
                if (!answer.content().isBlank()) {
                    state.setStatus(RunStatus.SUCCEEDED);
                    checkpoints.save(state);
                    return answer.content();
                }
                // 空答案不结束，让模型在下一轮看到明确错误。
                state.addObservation("ERROR: FINAL_ANSWER_IS_BLANK");
                state.consumeBudget(0);
                continue;
            }

            AgentDecision.CallTool action = (AgentDecision.CallTool) decision;
            ToolCall call = action.call();

            // 权限检查由 Java 运行时完成，不能让模型自行判断是否有权调用。
            if (!state.getAllowedTools().contains(call.toolName())) {
                state.addObservation("ERROR: TOOL_DENIED: " + call.toolName());
                state.consumeBudget(0);
                checkpoints.save(state);
                continue;
            }

            validateArguments(call); // 按该工具的 JSON Schema 校验必填项和类型。

            ToolResult result = toolExecutor.execute(
                    call,
                    state.getIdempotencyKey() + ":" + state.getBudget().remainingSteps(),
                    Duration.ofSeconds(10));

            // 完整结果放对象存储；这里只把短摘要交回模型，避免撑爆上下文。
            String observation = result.success()
                    ? "TOOL_OK: " + result.summary()
                    : "TOOL_ERROR[" + result.errorCode() + "]: " + result.summary();
            state.addObservation(observation);
            state.consumeBudget(1);
            checkpoints.save(state); // 每次工具调用后持久化，进程重启也能恢复。
        }

        state.setStatus(RunStatus.FAILED);
        checkpoints.save(state);
        throw new AgentRunException("BUDGET_EXHAUSTED");
    }

    private void validateArguments(ToolCall call) {
        // 示例：真实项目应由每个 ToolDefinition 持有并执行自己的参数 Schema。
        if (call.arguments() == null) {
            throw new IllegalArgumentException("工具参数不能为空");
        }
    }
}
```

以“查询订单是否可以退款”为例，`state.observations` 的变化是：空列表 → `searchOrder` 返回订单状态 → `queryRefundRule` 返回退款规则 → 模型生成最终答复。模型每次只选择下一步，Java 循环负责权限、执行、记账和停止。

### 适用场景

- 下一步依赖刚获得的外部数据；
- 工具数量有限，单次动作可以快速验证；
- 路径较短，但分支较多；
- 需要在失败后换参数、换工具或回退。

### 优点

- 观察驱动，能适应环境变化；
- 每一步都有工具结果，轨迹容易解释和调试；
- 不需要先生成完整计划，启动快。

### 缺点

- 局部决策容易缺少全局方向；
- 可能重复搜索、重复调用或卡在同一错误；
- 轮次越多，上下文、延迟和成本越高；
- 若把内部推理全文持久化，会带来隐私与兼容性问题，工程上应记录决策摘要、动作和观察。

## 二、Plan-and-Execute：先拆依赖，再逐步执行与重规划

Plan-and-Execute 把“制定全局步骤”和“完成当前步骤”分开。它解决 ReAct 容易边走边忘目标的问题，适合迁移系统、生成多文件项目、长链路数据处理等有明显阶段和依赖的任务。

<img src="/images/posts/mainstream-ai-agent-architectures/02-plan-execute.webp" alt="Plan-and-Execute Agent 规划执行重规划原理图" style="border-radius: 10px;" />

### 运行机制

计划不是字符串列表，而是一组带依赖和验收条件的 `PlanStep`。只有依赖全部完成的步骤才能进入执行队列：

```java
public enum StepStatus { PENDING, RUNNING, DONE, FAILED }

public final class PlanStep {
    private final String id;
    private final String instruction;
    private final Set<String> dependencyIds;
    private final String acceptanceRule;
    private StepStatus status = StepStatus.PENDING;
    private List<ArtifactRef> outputs = new ArrayList<>();
    private String failureReason;

    public boolean isReady(Map<String, PlanStep> allSteps) {
        return status == StepStatus.PENDING
                && dependencyIds.stream()
                        .map(allSteps::get)
                        .allMatch(step -> step.status == StepStatus.DONE);
    }
}

public record StepResult(List<ArtifactRef> outputs, String summary) {}
public record Verdict(boolean passed, boolean needReplan, String reason) {}

public interface Planner {
    List<PlanStep> create(String goal);
    List<PlanStep> revise(String goal, List<PlanStep> oldPlan, String newFact);
}

public interface StepExecutor {
    StepResult execute(PlanStep step, List<ArtifactRef> dependencyOutputs);
}

public interface StepVerifier {
    Verdict verify(PlanStep step, StepResult result);
}

public final class PlanAndExecuteAgent {
    private final Planner planner;
    private final StepExecutor executor;
    private final StepVerifier verifier;
    private final CheckpointStore checkpoints;

    public List<ArtifactRef> run(String goal) {
        Map<String, PlanStep> plan = indexById(planner.create(goal));
        validateAcyclic(plan); // 检查 ID 唯一、依赖存在，并拒绝环形依赖。

        Budget budget = new Budget(20, 20, System.currentTimeMillis() + 300_000);
        checkpoints.savePlan(goal, plan, budget); // 执行前先存档，支持断点恢复。

        while (!allDone(plan) && budget.available()) {
            Optional<PlanStep> next = plan.values().stream()
                    .filter(step -> step.isReady(plan))
                    .findFirst();

            if (next.isEmpty()) {
                // 仍有未完成步骤却找不到 ready step，说明计划已阻塞。
                throw new AgentRunException("PLAN_BLOCKED: " + findBlockers(plan));
            }

            PlanStep step = next.get();
            step.setStatus(StepStatus.RUNNING);
            checkpoints.savePlan(goal, plan, budget);

            List<ArtifactRef> inputs = step.getDependencyIds().stream()
                    .map(plan::get)
                    .flatMap(dependency -> dependency.getOutputs().stream())
                    .toList();

            try {
                StepResult result = executor.execute(step, inputs);
                Verdict verdict = verifier.verify(step, result);

                if (verdict.passed()) {
                    step.setOutputs(result.outputs());
                    step.setStatus(StepStatus.DONE);
                } else {
                    step.setFailureReason(verdict.reason());
                    step.setStatus(StepStatus.FAILED);
                }

                if (verdict.needReplan()) {
                    // 已完成步骤和产物不可丢；只允许 Planner 改写未完成部分。
                    List<PlanStep> revised = planner.revise(goal, List.copyOf(plan.values()), verdict.reason());
                    plan = mergeKeepingCompletedSteps(plan, revised);
                    validateAcyclic(plan);
                }
            } catch (RuntimeException executionError) {
                step.setStatus(StepStatus.FAILED);
                step.setFailureReason(executionError.getMessage());
                // 失败也必须保存，否则恢复后会误以为步骤从未执行。
            }

            budget = budget.consumeStep(1);
            checkpoints.savePlan(goal, plan, budget);
        }

        if (!allDone(plan)) {
            throw new AgentRunException("BUDGET_EXHAUSTED");
        }

        List<ArtifactRef> outputs = collectFinalOutputs(plan);
        verifyWholeGoal(goal, outputs); // 单步都成功，不代表全局目标一定成功。
        return outputs;
    }
}
```

### 适用场景

- 任务超过单个上下文窗口或需要断点续跑；
- 子任务之间存在顺序、依赖和明确产物；
- 需要给用户展示进度、剩余工作和阻塞项；
- Planner 与 Executor 需要使用不同权限或模型能力。

### 优点

- 全局目标、依赖和进度可见；
- 单步上下文更小，便于隔离失败和恢复；
- 可以并行运行无依赖步骤；
- 适合加入重规划、人工修改计划和阶段验收。

### 缺点

- 信息不足时，初始计划可能只是“看起来完整”；
- Planner 与 Executor 之间容易发生契约漂移；
- 计划维护本身增加模型调用和状态复杂度；
- 粒度过粗无法验证，粒度过细则协调成本过高。

## 三、Reflection：把失败压成下一轮可用的经验

Reflection 在一次执行后增加评审与反思，将失败原因和改进策略写入短期经验，再开始下一次尝试。Reflexion 论文的关键不是训练模型权重，而是把语言反馈写入 episodic memory，影响后续决策。

<img src="/images/posts/mainstream-ai-agent-architectures/03-reflection.webp" alt="Reflection Agent 执行评审反思重试原理图" style="border-radius: 10px;" />

### 运行机制

```java
public record Candidate(String content, List<String> actions, ArtifactRef artifact) {}

public record Evaluation(
        boolean passed,
        String failedRule,
        String rootCause,
        String actionableFix,
        List<String> evidence) {}

// ReflectionMemory 是下一次尝试会读取的结构化经验，不是完整思维过程。
public record ReflectionMemory(
        String failedRule,
        String rootCause,
        String nextChange,
        Set<String> forbiddenActions) {}

public interface Actor {
    Candidate generate(String task, int attempt, List<ReflectionMemory> memories);
}

public interface Evaluator {
    Evaluation evaluate(String task, Candidate candidate);
}

public interface Critic {
    ReflectionMemory reflect(Candidate candidate, Evaluation evaluation);
}

public final class ReflectionAgent {
    private static final int MAX_MEMORIES = 5;
    private final Actor actor;
    private final Evaluator evaluator;
    private final Critic critic;

    public Candidate run(String task, int maxAttempts) {
        List<ReflectionMemory> memories = new ArrayList<>();

        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            // 第一次 memories 为空；后续尝试会携带前几轮的失败经验。
            Candidate candidate = actor.generate(task, attempt, List.copyOf(memories));
            Evaluation evaluation = evaluator.evaluate(task, candidate);

            if (evaluation.passed()) {
                if (evaluation.evidence().isEmpty()) {
                    throw new AgentRunException("EVALUATION_WITHOUT_EVIDENCE");
                }
                return candidate;
            }

            ReflectionMemory reflection = critic.reflect(candidate, evaluation);
            validateReflection(reflection); // 必须包含失败规则、根因和下一步改动。

            boolean duplicate = memories.stream().anyMatch(old ->
                    old.failedRule().equals(reflection.failedRule())
                            && old.nextChange().equals(reflection.nextChange()));

            if (!duplicate) {
                memories.add(reflection);
            }

            // 只保留最近且不重复的经验，防止上下文无限增长。
            if (memories.size() > MAX_MEMORIES) {
                memories.remove(0);
            }

            // 连续两轮命中同一失败规则，说明“反思”没有改变行为，应提前停止。
            if (sameFailureRepeated(memories, 2)) {
                throw new AgentRunException("REFLECTION_NOT_IMPROVING");
            }
        }

        throw new AgentRunException("ATTEMPTS_EXHAUSTED");
    }

    private void validateReflection(ReflectionMemory memory) {
        if (memory.failedRule().isBlank()
                || memory.rootCause().isBlank()
                || memory.nextChange().isBlank()) {
            throw new IllegalArgumentException("反思结果缺少可执行信息");
        }
    }
}
```

例如生成 SQL 时，`Evaluator` 可以真实执行 `EXPLAIN` 和只读测试查询；失败经验应写成“缺少租户条件，下一轮必须给所有表别名增加 `tenant_id = ?`”，而不是空泛的“需要更加谨慎”。

### 适用场景

- 有编译、单测、Schema、评分器或人工反馈；
- 代码生成、文案修订、查询构造等允许多次尝试；
- 一次失败能转化为下一次明确约束。

### 优点

- 不微调模型也能利用试错反馈；
- 将“失败了”转成结构化改进动作；
- 可与 ReAct、Planner 或代码执行器组合。

### 缺点

- 自评模型可能和生成模型共享盲点；
- 没有可靠 evaluator 时，反思可能自信地强化错误；
- 每次尝试都增加调用成本；
- 经验记忆若不去重、过期和隔离，会逐渐污染后续任务。

## 四、Deep Research：围绕证据缺口迭代检索

Deep Research 不是“搜索一次再写长文”，而是持续维护研究问题、证据账本和未解决缺口。它解决开放问题中检索不完整、来源冲突、引用错位和长上下文失控。

<img src="/images/posts/mainstream-ai-agent-architectures/04-deep-research.webp" alt="Deep Research Agent 规划检索证据核验写作原理图" style="border-radius: 10px;" />

### 运行机制

```java
public record ResearchQuestion(String id, String text, int priority) {}
public record SearchHit(URI url, String title, Instant publishedAt) {}

// 每条证据必须能从“结论”追溯到“网页中的具体位置”。
public record Evidence(
        String questionId,
        String claim,
        URI sourceUrl,
        String locator,
        Instant publishedAt,
        Instant accessedAt,
        boolean supportsClaim) {}

public final class EvidenceLedger {
    private final List<Evidence> entries = new ArrayList<>();

    public void add(Evidence evidence) {
        entries.add(evidence);
    }

    public List<Evidence> forQuestion(String questionId) {
        return entries.stream()
                .filter(item -> item.questionId().equals(questionId))
                .toList();
    }

    public boolean hasConflict(String questionId) {
        List<Evidence> items = forQuestion(questionId);
        return items.stream().anyMatch(Evidence::supportsClaim)
                && items.stream().anyMatch(item -> !item.supportsClaim());
    }

    public List<Evidence> all() {
        return List.copyOf(entries);
    }
}

public interface SearchService {
    List<SearchHit> search(List<String> queries, Set<String> allowedDomains);
    String fetch(SearchHit hit, Duration timeout);
}

public interface ResearchModel {
    List<ResearchQuestion> split(String question);
    List<String> buildQueries(ResearchQuestion gap);
    List<Evidence> extract(String page, SearchHit source, ResearchQuestion gap);
    List<ResearchQuestion> deriveFollowUps(ResearchQuestion gap, List<Evidence> evidence);
    String write(String question, List<Evidence> evidence);
}

public final class DeepResearchAgent {
    private final SearchService searchService;
    private final ResearchModel model;
    private final CitationAuditor citationAuditor;

    public String run(String question) {
        PriorityQueue<ResearchQuestion> queue = new PriorityQueue<>(
                Comparator.comparingInt(ResearchQuestion::priority).reversed());
        queue.addAll(model.split(question));

        EvidenceLedger ledger = new EvidenceLedger();
        Set<URI> visited = new HashSet<>();
        Budget budget = new Budget(12, 30, System.currentTimeMillis() + 600_000);
        Set<String> allowedDomains = Set.of("docs.oracle.com", "spring.io", "arxiv.org");

        while (!queue.isEmpty() && budget.available()) {
            ResearchQuestion gap = queue.remove();
            List<String> queries = model.buildQueries(gap);
            List<SearchHit> hits = searchService.search(queries, allowedDomains).stream()
                    .filter(hit -> visited.add(hit.url())) // URL 去重，避免重复抓取。
                    .limit(Math.min(5, budget.remainingToolCalls()))
                    .toList();

            for (SearchHit hit : hits) {
                try {
                    String page = searchService.fetch(hit, Duration.ofSeconds(15));
                    List<Evidence> extracted = model.extract(page, hit, gap);

                    for (Evidence evidence : extracted) {
                        validateProvenance(evidence); // URL、定位、访问时间缺一不可。
                        ledger.add(evidence);
                    }
                } catch (RuntimeException fetchError) {
                    // 单个来源失败不终止研究，但要留下可观测记录。
                    recordFetchFailure(hit.url(), fetchError.getMessage());
                }
                budget = budget.consumeStep(1);
            }

            List<Evidence> currentEvidence = ledger.forQuestion(gap.id());
            if (currentEvidence.isEmpty() || ledger.hasConflict(gap.id())) {
                // 缺证据或证据冲突时继续拆出更具体的问题。
                queue.addAll(model.deriveFollowUps(gap, currentEvidence));
            }
        }

        List<Evidence> allEvidence = ledger.all();
        String draft = model.write(question, allEvidence);
        CitationAudit audit = citationAuditor.verify(draft, allEvidence);

        if (!audit.passed()) {
            // 引用不支持结论时删除对应结论；绝不能让模型补造一个 URL。
            draft = removeUnsupportedClaims(draft, audit.unsupportedClaimIds());
            CitationAudit secondAudit = citationAuditor.verify(draft, allEvidence);
            if (!secondAudit.passed()) {
                throw new AgentRunException("CITATION_AUDIT_FAILED");
            }
        }
        return draft;
    }
}
```

### 适用场景

- 技术调研、竞品分析、尽职调查和有引用要求的报告；
- 问题需要多跳检索或不同来源交叉验证；
- 结论可能随时间变化，必须记录核对日期。

### 优点

- 研究过程围绕证据而不是模型记忆；
- 可以显式处理信息缺口、冲突和时效性；
- 证据账本让引用审计和局部重跑成为可能。

### 缺点

- 搜索、抓取、重排和综合带来高延迟与高成本；
- 垃圾来源会污染后续推理；
- 长报告容易出现引用与结论错位；
- 开放问题没有天然终点，必须用覆盖率和预算共同停止。

## 五、HITL：在副作用前暂停，而不是事后通知

Human-in-the-Loop 把人工决定建模为可持久化的中断状态。它解决的是模型不应独自承担的授权、合规和高风险决策，而不是简单地在页面末尾放一个“确认”按钮。

<img src="/images/posts/mainstream-ai-agent-architectures/05-hitl.webp" alt="HITL Agent 暂停审批恢复执行原理图" style="border-radius: 10px;" />

### 运行机制

```java
public enum RiskDecision { AUTO_EXECUTE, REQUIRE_APPROVAL, DENY }
public enum ApprovalType { APPROVE, REJECT, EDIT }

public record ApprovalRequest(
        String requestId,
        String checkpointId,
        long checkpointVersion,
        String redactedAction,
        String estimatedImpact,
        Instant expiresAt) {}

public record ApprovalDecision(
        ApprovalType type,
        String approverId,
        ToolCall editedCall,
        String reason,
        String oneTimeToken) {}

public interface RiskPolicy {
    RiskDecision evaluate(String operatorId, ToolCall call);
}

public interface ApprovalGateway {
    void submit(ApprovalRequest request);
    ApprovalDecision waitForDecision(String requestId, Instant deadline);
}

public final class HumanInTheLoopExecutor {
    private final RiskPolicy policy;
    private final ApprovalGateway approvalGateway;
    private final ToolExecutor toolExecutor;
    private final CheckpointStore checkpoints;
    private final AuditLog auditLog;

    public ToolResult execute(
            AgentState state,
            String operatorId,
            ToolCall proposedCall) {

        ToolCall call = validateAndNormalize(proposedCall);
        RiskDecision risk = policy.evaluate(operatorId, call);

        if (risk == RiskDecision.DENY) {
            auditLog.append(state.getRunId(), "POLICY_DENIED", call.toolName());
            return new ToolResult(false, "策略禁止该操作", null, "POLICY_DENIED");
        }

        if (risk == RiskDecision.AUTO_EXECUTE) {
            // 自动操作仍使用幂等键，网络重试不会重复扣款或重复发信。
            return toolExecutor.execute(call, state.getIdempotencyKey(), Duration.ofSeconds(10));
        }

        // 关键顺序：先保存状态，再通知审批人，此时尚未执行工具。
        Checkpoint checkpoint = checkpoints.save(state);
        state.setStatus(RunStatus.WAITING);

        ApprovalRequest request = new ApprovalRequest(
                UUID.randomUUID().toString(),
                checkpoint.id(),
                checkpoint.version(),
                redactSecrets(call),
                estimateImpact(call),
                Instant.now().plus(Duration.ofHours(2)));
        approvalGateway.submit(request);

        ApprovalDecision decision = approvalGateway.waitForDecision(
                request.requestId(), request.expiresAt());

        if (decision == null || Instant.now().isAfter(request.expiresAt())) {
            state.setStatus(RunStatus.CANCELLED);
            return new ToolResult(false, "审批超时，默认拒绝", null, "APPROVAL_TIMEOUT");
        }

        verifySignatureAndConsumeToken(decision); // 令牌只能使用一次，且绑定审批人。

        if (decision.type() == ApprovalType.REJECT) {
            state.setStatus(RunStatus.CANCELLED);
            auditLog.append(state.getRunId(), "REJECTED", decision.reason());
            return new ToolResult(false, decision.reason(), null, "HUMAN_REJECTED");
        }

        if (decision.type() == ApprovalType.EDIT) {
            call = validateAndNormalize(decision.editedCall());
            // 人修改参数后必须重新过策略，防止把低风险动作改成高风险动作。
            if (policy.evaluate(operatorId, call) == RiskDecision.DENY) {
                throw new AgentRunException("EDITED_CALL_DENIED");
            }
        }

        checkpoints.assertVersion(
                request.checkpointId(), request.checkpointVersion());
        state.setStatus(RunStatus.RUNNING);
        auditLog.append(state.getRunId(), "APPROVED_BY", decision.approverId());

        // 审批通过后才发生副作用；checkpointId 参与幂等键，恢复也只执行一次。
        return toolExecutor.execute(
                call,
                state.getIdempotencyKey() + ":" + request.checkpointId(),
                Duration.ofSeconds(10));
    }
}
```

### 适用场景

- 删除、写库、部署、转账、发信和外部发布；
- 金融、安全、法务或企业 IT 的审计要求；
- 信息不足、影响范围大或无法自动回滚的动作。

### 优点

- 把授权责任交给明确的人；
- 暂停、恢复和审计轨迹可持久化；
- 人可以批准、拒绝或修改模型提议。

### 缺点

- 等待时间不可控，会降低自动化吞吐；
- 审批信息不足会造成“盲点确认”；
- 状态恢复、超时、重复审批和版本冲突实现复杂；
- 若先执行再审批，HITL 就失去风险控制意义。

## 六、Multi-Agent：用角色与边界换取并行和专门化

Multi-Agent 把一个任务交给多个拥有不同角色、上下文、工具或权限的 Agent。它真正解决的是隔离与协作，不是“多调用几次模型”。常见拓扑包括 Supervisor-Worker、Agent Handoff、共享黑板和受控群聊；生产系统通常优先选择有中心协调者的 Supervisor-Worker。

<img src="/images/posts/mainstream-ai-agent-architectures/06-multi-agent.webp" alt="Multi-Agent 监督者分工并行验收原理图" style="border-radius: 10px;" />

### 运行机制

```java
public record AgentTask(
        String id,
        String instruction,
        String requiredSkill,
        Set<String> requiredPermissions,
        Set<String> dependencyIds,
        Set<String> readableBoardKeys,
        Set<String> writableBoardKeys,
        String acceptanceRule) {}

public record WorkerResult(
        String taskId,
        Map<String, Object> boardWrites,
        List<ArtifactRef> artifacts,
        String summary,
        long basedOnBoardVersion) {}

public interface WorkerAgent {
    WorkerResult execute(AgentTask task, Map<String, Object> context, CancellationToken token);
}

public interface AgentRegistry {
    WorkerAgent select(String skill, Set<String> permissions);
}

// SharedBoard 是线程安全的共享事实表；通过版本号阻止两个 Agent 静默覆盖彼此。
public final class SharedBoard {
    private final Map<String, Object> values = new HashMap<>();
    private long version = 1;

    public synchronized Map<String, Object> read(Set<String> allowedKeys) {
        return values.entrySet().stream()
                .filter(entry -> allowedKeys.contains(entry.getKey()))
                .collect(Collectors.toUnmodifiableMap(Map.Entry::getKey, Map.Entry::getValue));
    }

    public synchronized void commit(WorkerResult result, Set<String> writableKeys) {
        if (result.basedOnBoardVersion() != version) {
            throw new ConcurrentModificationException("共享状态版本已变化");
        }
        if (!writableKeys.containsAll(result.boardWrites().keySet())) {
            throw new SecurityException("Worker 写入了未授权字段");
        }
        values.putAll(result.boardWrites());
        version++;
    }
}

public final class MultiAgentSupervisor {
    private final AgentRegistry registry;
    private final ResultVerifier verifier;
    private final ExecutorService pool;

    public String run(String goal) {
        Map<String, AgentTask> tasks = decompose(goal); // Supervisor 生成带依赖的任务 DAG。
        validateTaskGraph(tasks);

        SharedBoard board = new SharedBoard();
        Set<String> completed = new HashSet<>();
        Map<String, Integer> failures = new HashMap<>();
        Map<String, CancellationToken> tokens = new ConcurrentHashMap<>();
        Budget budget = new Budget(15, 30, System.currentTimeMillis() + 300_000);

        try {
            while (completed.size() < tasks.size() && budget.available()) {
                List<AgentTask> readyTasks = tasks.values().stream()
                        .filter(task -> !completed.contains(task.id()))
                        .filter(task -> task.dependencyIds().stream().allMatch(completed::contains))
                        .filter(task -> failures.getOrDefault(task.id(), 0) < 3)
                        .toList();

                if (readyTasks.isEmpty()) {
                    throw new AgentRunException("NO_READY_TASK");
                }

                List<CompletableFuture<WorkerResult>> jobs = new ArrayList<>();
                for (AgentTask task : readyTasks) {
                    WorkerAgent worker = registry.select(
                            task.requiredSkill(), task.requiredPermissions());
                    Map<String, Object> context = board.read(task.readableBoardKeys());
                    CancellationToken token = new CancellationToken();
                    tokens.put(task.id(), token);

                    jobs.add(CompletableFuture.supplyAsync(
                            () -> worker.execute(task, context, token), pool));
                }

                for (int i = 0; i < jobs.size(); i++) {
                    AgentTask task = readyTasks.get(i);
                    try {
                        WorkerResult result = jobs.get(i).orTimeout(30, TimeUnit.SECONDS).join();
                        validateResultSchema(result, task);
                        Verdict verdict = verifier.verify(task.acceptanceRule(), result);

                        if (verdict.passed()) {
                            board.commit(result, task.writableBoardKeys());
                            completed.add(task.id());
                        } else {
                            failures.merge(task.id(), 1, Integer::sum);
                        }
                    } catch (CompletionException | ConcurrentModificationException error) {
                        // 超时、Worker 异常或版本冲突都回到 Supervisor，由它重试或重新分工。
                        failures.merge(task.id(), 1, Integer::sum);
                    } finally {
                        tokens.remove(task.id());
                    }
                }

                escalateTasksFailedThreeTimes(tasks, failures, board);
                budget = budget.consumeStep(readyTasks.size());
                saveTeamCheckpoint(tasks, completed, failures, board, budget);
            }
        } finally {
            // 父任务退出时通知全部子 Agent 停止，避免后台继续消耗资源或写数据。
            tokens.values().forEach(CancellationToken::cancel);
        }

        if (completed.size() != tasks.size()) {
            throw new AgentRunException("TEAM_INCOMPLETE");
        }
        return synthesizeFinalAnswer(goal, board);
    }
}
```

### 适用场景

- 子任务可并行，且需要不同工具、权限或专业上下文；
- 单个 Agent 的上下文会被大仓库、多文档或多角色职责撑爆；
- 需要独立执行者与验证者，降低同一模型自证偏差；
- 任务天然存在研究、编码、测试、审计等分工。

### 优点

- 通过隔离上下文提高单个角色的信号密度；
- 无依赖任务可以并行；
- 工具和数据权限可以按角色最小化；
- Worker 可独立替换、扩缩容和评测。

### 缺点

- 沟通会消耗额外 Token，错误也会沿交接链放大；
- 多 Agent 不会自动产生多样性，同模型同提示可能共享盲点；
- 共享状态、并发写入、取消传播和责任归属更复杂；
- 子任务不独立时，拆分反而比单 Agent 更慢。

## 六类架构如何组合

不要把组合写成“Agent 套 Agent”的无限递归。先指定一个主控制结构，再按风险增加辅助环：

| 任务 | 推荐组合 | 为什么 |
|---|---|---|
| 在线客服查单 | ReAct + HITL | 动态查工具；退款等动作进入审批 |
| 代码迁移 | Plan-and-Execute + ReAct Worker + Reflection | 全局分步；单步动态执行；编译测试反馈修订 |
| 技术调研报告 | Deep Research + Reflection | 证据驱动检索；引用审计失败后局部修订 |
| 大仓库功能开发 | Supervisor Multi-Agent + Plan-and-Execute | 按模块分工；统一计划、写入范围和验收 |
| 自动化运维 | ReAct + Policy + HITL | 诊断可自动；高风险变更必须审批并可恢复 |

组合后的统一主循环仍然是一个 Java 状态机。区别只是 `nextNode` 可能指向 Planner、ReAct Worker、Critic 或 Approval：

```java
public final class AgentWorkflowEngine {
    private final NodeRegistry nodeRegistry;
    private final CheckpointStore checkpoints;
    private final PermissionChecker permissionChecker;
    private final AcceptanceVerifier acceptanceVerifier;

    public WorkflowOutput resume(String runId) {
        // 读取持久化对象；首次运行则由 start() 创建同样结构的 WorkflowState。
        WorkflowState state = checkpoints.loadWorkflow(runId);

        while (!state.isTerminal() && state.getBudget().available()) {
            String nodeId = state.getNextNodeId();
            AgentNode<Object, Object> node = nodeRegistry.get(nodeId);
            Object input = state.buildInputFor(nodeId);

            permissionChecker.check(
                    state.getIdentity(), nodeId, input, state.getPermissions());

            NodeResult<Object> result;
            try {
                result = node.execute(state.toNodeContext(), input);
            } catch (RetryableException error) {
                state.recordRetry(nodeId, error.getCode());
                state.consumeBudget(0);
                checkpoints.saveWorkflow(state);
                continue;
            }

            if (result instanceof NodeResult.Completed<Object> completed) {
                validateNodeOutput(nodeId, completed.value());
                state.addArtifacts(completed.artifacts());
                state.moveTo(selectNextNode(state, completed.value()));
            } else if (result instanceof NodeResult.Waiting<Object> waiting) {
                state.setPendingApproval(waiting.request());
                state.setStatus(RunStatus.WAITING);
            } else if (result instanceof NodeResult.Retryable<Object> retryable) {
                state.recordRetry(nodeId, retryable.code());
            } else if (result instanceof NodeResult.Failed<Object> failed) {
                state.fail(failed.code(), failed.safeMessage());
            }

            state.consumeBudget(result.toolCallCount());
            state.recordTrace(nodeId, result); // 记录动作摘要，不保存模型隐藏推理。
            checkpoints.saveWorkflow(state);  // 每个节点结束后都可恢复。

            if (state.getStatus() == RunStatus.WAITING) {
                return WorkflowOutput.waiting(state.getPendingApproval());
            }
        }

        if (!state.isTerminal()) {
            state.fail("BUDGET_EXHAUSTED", "运行预算已耗尽");
            checkpoints.saveWorkflow(state);
        }

        // 节点全部结束后还要验证业务目标，不能相信“模型说已经完成”。
        acceptanceVerifier.verify(state.getGoal(), state.getArtifacts());
        return WorkflowOutput.finished(state.getStatus(), state.getArtifacts());
    }
}
```

## Java 后端落地时先定义运行时契约

不要一开始就绑定某个 Agent 框架。先在 Java 层定义稳定的节点、状态和结果协议：

```java
public interface AgentNode<I, O> {
    NodeResult<O> execute(NodeContext context, I input);
}

public record NodeContext(
        String runId,
        String traceId,
        Budget budget,
        PermissionSet permissions,
        ArtifactStore artifacts,
        CheckpointStore checkpoints) {}

public sealed interface NodeResult<T> {
    // 节点若调用了工具，应覆盖此方法，以便统一预算记账。
    default int toolCallCount() { return 0; }

    record Completed<T>(T value, List<ArtifactRef> artifacts) implements NodeResult<T> {}
    record Waiting<T>(ApprovalRequest request) implements NodeResult<T> {}
    record Retryable<T>(String code, Duration backoff) implements NodeResult<T> {}
    record Failed<T>(String code, String safeMessage) implements NodeResult<T> {}
}
```

然后把六种架构实现为不同的调度器，而不是六套互不兼容的业务代码。模型调用、工具执行、人工审批、证据存储和子 Agent 都只是节点；状态机负责选择下一个节点，基础设施负责超时、幂等、持久化、追踪和权限。

## 所有架构都必须补齐的生产边界

### 停止条件

同时限制最大轮次、墙钟时间、Token、费用、工具次数、重试次数和子 Agent 数。停止原因必须进入最终状态，不能只返回一句“未完成”。

### 工具边界

工具参数做 Schema 校验；读写工具分权；副作用使用幂等键；命令、SQL 和外部内容按不可信输入处理；模型输出不能直接成为执行权限。

### 状态与恢复

每个有意义步骤后保存 checkpoint；大结果放对象存储，只在状态中保存摘要、哈希和引用；恢复时校验版本，避免同一运行被重复推进。

### 可观测性

至少记录 `runId`、节点、模型调用耗时、Token、工具名、结果状态、重试、审批等待时间、子任务父子关系和停止原因。不要把敏感 Prompt、完整工具结果或内部推理默认写入日志。

### 评测

离线评测看任务成功率、步骤数、工具正确率、引用准确率和副作用违规率；在线监控看成本、P95/P99 延迟、循环率、人工驳回率、恢复失败率与未知错误率。架构升级必须用同一任务集回归，不能只凭演示效果判断。

## 选型口诀

- 路径未知但任务短：ReAct；
- 任务长且有依赖：Plan-and-Execute；
- 有明确反馈、允许重做：Reflection；
- 结论必须有证据：Deep Research；
- 动作高风险或需问责：HITL；
- 子任务可隔离、可并行：Multi-Agent；
- 同时满足多项：选一个主架构，再添加必要的辅助环，不要堆满所有模式。

## 总结

ReAct 优化动态决策，Plan-and-Execute 优化长任务控制，Reflection 利用失败反馈，Deep Research 管理证据缺口，HITL 把授权交还给人，Multi-Agent 用角色和隔离换取并行与专门化。它们解决的是不同的不确定性，不能只比较“谁更智能”。

真正决定系统能否上线的，往往不是模型生成了什么，而是运行时是否守住动作校验、预算、停止条件、权限、幂等、checkpoint、审计和验收。先定义这些共同契约，再组合 Agent 架构，系统才会从 Demo 变成可恢复、可观测、可治理的工程。

## 参考资料

- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
- [Plan-and-Solve Prompting: Improving Zero-Shot Chain-of-Thought Reasoning](https://arxiv.org/abs/2305.04091)
- [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)
- [STORM: Assisting in Writing Wikipedia-like Articles From Scratch](https://arxiv.org/abs/2402.14207)
- [Deep Research Agents: A Systematic Examination and Roadmap](https://arxiv.org/abs/2506.18096)
- [LangGraph 官方文档：Human-in-the-Loop](https://docs.langchain.com/oss/python/langchain/human-in-the-loop)
- [AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation](https://arxiv.org/abs/2308.08155)
- [MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework](https://arxiv.org/abs/2308.00352)
