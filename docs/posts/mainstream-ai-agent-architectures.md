---
title: 主流 AI Agent 架构全景：ReAct、Plan-and-Execute、Reflection、Deep Research、HITL 与 Multi-Agent
date: 2026-08-23
category: AI
cover: /images/posts/mainstream-ai-agent-architectures-knowledge-map.webp
tags: [ai, agent, react, planning, reflection, deep-research, hitl, multi-agent]
excerpt: Agent 架构的本质是如何组织状态、决策、工具、反馈与停止条件。本文横向拆解六类主流架构解决的问题、运行机制、场景和取舍，并给出逐步完整但足够精简的伪代码。
---

# 主流 AI Agent 架构全景：ReAct、Plan-and-Execute、Reflection、Deep Research、HITL 与 Multi-Agent

<img src="/images/posts/mainstream-ai-agent-architectures-knowledge-map.webp" alt="主流 AI Agent 架构全景：ReAct、Plan-and-Execute、Reflection、Deep Research、HITL 与 Multi-Agent知识串联图" style="border-radius: 10px;" />

Agent 架构的本质是如何组织状态、决策、工具、反馈与停止条件。本文横向拆解六类主流架构解决的问题、运行机制、场景和取舍，并给出逐步完整但足够精简的伪代码。

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

```text
输入 → 读取状态 → 模型决策 → 校验动作 → 执行工具 → 写入观察 → 判断停止
```

无论使用哪种架构，生产实现都不能缺少以下公共状态：

```text
RunState {
  goal                 # 用户目标与验收条件
  status               # RUNNING / WAITING / SUCCEEDED / FAILED / CANCELLED
  messages             # 必要对话，不等于无限历史
  artifacts            # 文件、证据、计划、工具结果的引用
  budget               # 最大轮次、Token、费用、时间和工具次数
  permissions          # 本次运行允许的工具与数据范围
  idempotencyKey       # 防止重试造成重复副作用
  checkpointVersion    # 恢复时检测并发覆盖
  traceId              # 串联模型、工具、人工审批与子 Agent
}
```

## 一、ReAct：用观察结果决定下一步

ReAct 将 Reasoning 与 Acting 交错执行：模型先根据当前状态选择一个动作，运行时执行工具，再把 Observation 放回上下文。它解决的是“任务路径无法提前写死”，例如排障、查库存、调用多个 API 或逐步修改代码。

<img src="/images/posts/mainstream-ai-agent-architectures/01-react-loop.webp" alt="ReAct Agent 思考行动观察循环原理图" style="border-radius: 10px;" />

### 运行机制

```text
function runReAct(goal, tools, budget):
  state = newState(goal, budget)                 # 初始化目标、权限、预算与轨迹

  while state.budget.hasTimeAndSteps():
    decision = model.decide(state.visibleView()) # 只提供完成当前决策所需上下文

    if decision.type == "FINAL":
      return verifyAndFinish(decision.answer)    # 最终答案仍要过格式和业务校验

    if decision.type != "TOOL_CALL":
      state.observe(error("INVALID_DECISION"))  # 非法结构作为观察反馈，不直接执行
      continue

    call = validateSchema(decision.call, tools)  # 校验工具名、参数 Schema 与权限
    if call.denied:
      state.observe(error("TOOL_DENIED"))       # 把边界反馈给模型，禁止绕过运行时
      continue

    result = executeWithTimeout(call)            # 工具层负责超时、幂等、审计和脱敏
    state.observe(compact(result))               # 大结果存外部，只注入摘要与引用
    state.budget.consume(decision, result)        # 每轮扣减 Token、时间与工具次数

  return fail("BUDGET_EXHAUSTED", state.trace)  # 必须有确定停止条件，防止无限循环
```

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

```text
function runPlanExecute(goal, budget):
  plan = planner.create(goal, constraints, doneCriteria) # 生成带 ID、依赖和验收条件的步骤
  plan = validateDag(plan)                               # 拒绝循环依赖、空步骤和越权动作
  state = checkpoint(goal, plan, budget)                 # 先持久化，支持长任务恢复

  while not plan.allDone() and budget.available():
    step = plan.nextReadyStep()                          # 只取依赖已完成的最小可执行步骤
    if step == NONE:
      return fail("PLAN_BLOCKED", plan.blockers())      # 没有可运行步骤时明确失败

    result = executor.run(step, state.relevantContext()) # Worker 可用 ReAct，但受步骤预算限制
    verdict = verify(result, step.acceptance)            # 用确定规则或独立评审检查产物

    if verdict.pass:
      plan.markDone(step.id, result.artifactRefs)         # 保存引用，不把大产物全塞入上下文
    else:
      plan.markFailed(step.id, verdict.reason)

    if environmentChanged() or verdict.needReplan:
      plan = planner.revise(plan, state.facts())          # 保留已完成步骤，只修改未完成部分
      plan = validateDag(plan)

    state = checkpoint(goal, plan, budget.consume(result))# 每步后保存版本与预算

  return plan.allDone() ? assemble(plan)                  # 汇总前再次执行全局验收
                        : fail("BUDGET_EXHAUSTED", plan)
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

```text
function runWithReflection(task, evaluator, maxAttempts):
  memory = []                                       # 只保存可复用经验，不保存冗长自言自语

  for attempt in 1..maxAttempts:
    candidate = actor.run(task, memory, attempt)    # 执行器读取历史反思后重新尝试
    feedback = evaluator.check(candidate, criteria) # 优先使用测试、规则或外部反馈

    if feedback.pass:
      return success(candidate, feedback.evidence)  # 成功必须带可验证证据

    reflection = critic.summarize({
      "failedRule": feedback.failedRule,           # 具体违反哪条验收规则
      "rootCause": feedback.rootCause,             # 为什么失败，不只复述现象
      "nextChange": feedback.actionableFix,        # 下一轮必须改变什么
      "doNotRepeat": candidate.badActions          # 明确禁止重复的路径
    })

    memory = keepTopNonDuplicate(memory + reflection)# 去重并限制长度，避免错误经验污染

  return fail("ATTEMPTS_EXHAUSTED", memory)         # 超限后交给人或降级，不无限自省
```

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

```text
function deepResearch(question, sourcePolicy, budget):
  scope = clarify(question)                           # 固定范围、时间点、受众和交付格式
  plan = makeResearchQuestions(scope)                 # 拆成可检索、可判定完成的子问题
  ledger = EvidenceLedger()                           # 每条主张关联来源、摘录位置和时间
  queue = prioritize(plan.openQuestions())            # 优先高价值、高不确定性的证据缺口

  while queue.notEmpty() and budget.available():
    gap = queue.pop()
    queries = diversifyQueries(gap)                    # 同义词、反例、官方来源与时间限定
    hits = search(queries, sourcePolicy).deduplicate() # 先过滤域名、日期、重复页和低质来源

    for hit in hits.takeWithinBudget():
      page = fetchWithTimeout(hit)
      claims = extractClaims(page, gap)                # 提取主张，不把整页直接塞进报告
      ledger.add(validateProvenance(claims, hit))       # 保存 URL、定位、发布日期与访问时间

    conflicts = ledger.findConflicts(gap)              # 冲突证据必须继续核验或显式披露
    queue.add(deriveFollowUps(gap, conflicts, ledger))  # 根据新证据动态生成后续问题
    budget.consume(hits)

  draft = synthesize(scope, ledger.supportedClaims())   # 只用有证据支持的主张写作
  audit = verifyEveryCitation(draft, ledger)            # 检查引用是否真的支持相邻结论
  return audit.pass ? draft : reviseOrFail(draft, audit)# 缺证据时删结论，不允许编造引用
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

```text
function executeWithApproval(run, proposedCall, policy):
  call = validateAndNormalize(proposedCall)          # 先校验工具、参数、权限与敏感数据
  risk = policy.evaluate(call, run.identity)         # 策略引擎决定自动、审批或拒绝

  if risk == "DENY":
    return rejected("POLICY_DENIED")                # 模型无权覆盖确定性策略

  if risk == "AUTO":
    return executeIdempotently(call, run.key)        # 低风险动作仍需幂等、超时和审计

  checkpoint = persistBeforeSideEffect(run, call)    # 必须在产生副作用之前保存可恢复状态
  request = createApproval({
    "checkpoint": checkpoint.id,                    # 恢复位置
    "action": redact(call),                         # 给审批人足够信息但隐藏秘密
    "impact": estimateImpact(call),                 # 影响范围、成本与可逆性
    "expiresAt": policy.deadline                    # 审批超时后默认拒绝
  })
  decision = waitForSignedDecision(request)          # 审批结果绑定人员、版本和一次性令牌

  if decision.type == "REJECT": return cancelled(decision.reason)
  if decision.type == "EDIT":   call = revalidate(decision.editedCall)
  if decision.type != "APPROVE" and decision.type != "EDIT":
    return fail("INVALID_APPROVAL")

  ensureCheckpointUnchanged(checkpoint.version)      # 防止等待期间状态被其他流程修改
  audit(decision, call)
  return executeIdempotently(call, run.key)          # 恢复后只执行一次副作用
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

```text
function runMultiAgent(goal, registry, budget):
  contract = supervisor.decompose(goal)               # 子任务包含输入、输出、依赖和验收条件
  contract = validateDag(contract)                    # 检查循环依赖、重叠写入和缺失责任人
  board = SharedBoard(goal, version=1)                # 共享结构化事实与产物引用，不共享全部私聊

  while contract.hasOpenTasks() and budget.available():
    ready = contract.readyTasks()

    jobs = ready.map(task -> {
      agent = registry.select(task.skill, task.permission)# 按能力与最小权限选择 Worker
      context = board.view(task.requiredKeys)             # 每个 Agent 只拿完成任务所需上下文
      return launch(agent, task, context, task.budget)     # 可并行，但每个子任务有独立预算和取消令牌
    })

    results = awaitAllOrTimeout(jobs)
    for result in results:
      result = validateSchemaAndProvenance(result)         # 验证结构、来源、写入范围和版本
      if conflictsWithBoard(result):
        result = supervisor.resolve(result, board)         # 冲突由明确策略处理，不让 Agent 自由覆盖
      verdict = verifier.check(result, contract.acceptance)
      contract.update(result.taskId, verdict)
      if verdict.pass: board.commit(result, expectedVersion)# 乐观锁提交共享状态

    if contract.repeatedFailure():
      supervisor.reassignOrEscalate(contract, board)       # 换 Agent、缩小任务或交给人工
    checkpoint(contract, board, budget.consume(results))

  cancelAllChildren()                                     # 父任务结束必须传播取消
  return contract.allDone() ? supervisor.synthesize(board)
                            : fail("TEAM_INCOMPLETE", contract)
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

组合后的统一主循环可以保持简单：

```text
load checkpoint
while not terminal and budget available:
  choose next node by persisted state      # 节点可以是 Planner、Worker、Critic 或 Approval
  validate node input and permission       # 模型永远不绕过运行时策略
  execute node with timeout and idempotency
  validate output, record trace, checkpoint
finish only after acceptance criteria pass # “模型说完成”不等于任务完成
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
