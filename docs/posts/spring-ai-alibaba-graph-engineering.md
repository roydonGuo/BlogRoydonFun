---
title: Spring AI Alibaba Graph 工程实践：状态、节点、边与持久化
date: 2026-08-31
category: 后端开发
cover: /images/posts/spring-ai-alibaba-graph-engineering-knowledge-map.webp
tags: [ai, agent, spring-ai-alibaba, graph, workflow]
excerpt: Spring AI Alibaba Graph 把复杂 AI 流程拆成共享状态、可测试节点和显式路由；真正决定系统能否稳定恢复的，是状态归并规则、条件边、检查点与副作用边界。
---

# Spring AI Alibaba Graph 工程实践：状态、节点、边与持久化

<img src="/images/posts/spring-ai-alibaba-graph-engineering-knowledge-map.webp" alt="Spring AI Alibaba Graph 工程实践：状态、节点、边与持久化知识串联图" style="border-radius: 10px;" />

Spring AI Alibaba Graph 把复杂 AI 流程拆成共享状态、可测试节点和显式路由；真正决定系统能否稳定恢复的，是状态归并规则、条件边、检查点与副作用边界。

## 先说结论：Graph 是状态机，不是模型调用链

一次问答只需要“输入提示词，得到文本”；生产级 Agent 还要处理分类、并行检索、人工审批、重试、暂停与恢复。把这些步骤继续塞进一个 Service 方法，分支会越来越隐蔽，失败后也不知道该从哪里继续。

**Spring AI Alibaba Graph** 是底层工作流运行时：`StateGraph` 描述结构，`Node` 执行一个步骤，`Edge` 决定下一步，`OverAllState` 在步骤之间传递数据，编译后由 `CompiledGraph` 执行。它适合需要精确控制的长流程；只需常见 ReAct、顺序、并行或路由 Agent 时，优先使用上层 Agent Framework，减少直接维护图结构的成本。

以下内容以 Spring AI Alibaba **1.1.2.0**、Spring AI 1.1.2、Spring Boot 3.5.x 为基线，事实与 API 核对日期为 **2026-08-31**。具体小版本仍应由官方 BOM 和 Release Notes 锁定，不能混用旧版文档中的 `checkpointSaver`、`edgeasync` 等 API 写法。

## 一、五个核心对象各管一件事

| 对象 | 职责 | 不应承担的职责 |
| --- | --- | --- |
| `StateGraph` | 注册节点、普通边、条件边和子图 | 执行业务副作用 |
| `OverAllState` | 保存一次运行的共享数据 | 充当无限增长的日志仓库 |
| `NodeAction` | 读取状态，返回本节点的增量更新 | 私自决定任意下一节点 |
| `Edge` | 固定或按状态选择后继节点 | 修改数据库或调用外部接口 |
| `CompiledGraph` | 执行、流式输出、中断与检查点 | 替代业务幂等和事务 |

可以把一次运行理解成反复执行三步：读取当前状态，运行当前节点，把节点返回值按策略归并回状态，再通过边选择后继节点。**节点返回的是状态增量，不应原地修改共享 Map。**

## 二、状态策略决定数据是否正确

Graph 的状态不是普通 `Map.put`。每个 key 都要明确更新策略：

- `ReplaceStrategy`：新值覆盖旧值，适合分类结果、下一动作、错误码；
- `AppendStrategy`：把新元素追加到已有集合，适合消息、证据和审计事件；
- 自定义策略：适合去重合并、取最大版本或按稳定 ID 聚合。

错误策略会造成隐蔽故障。例如把 `route` 配成追加，条件边拿到的可能是历史路由列表；把 `evidence` 配成替换，并行检索结果就会互相覆盖。调用 `updateState` 时也仍按对应策略归并，并不等于无条件覆盖。

```java
import com.alibaba.cloud.ai.graph.KeyStrategy;
import com.alibaba.cloud.ai.graph.KeyStrategyFactory;
import com.alibaba.cloud.ai.graph.state.strategy.AppendStrategy;
import com.alibaba.cloud.ai.graph.state.strategy.ReplaceStrategy;

import java.util.HashMap;
import java.util.Map;

KeyStrategyFactory stateFactory = () -> {
    Map<String, KeyStrategy> strategies = new HashMap<>();
    // 单值状态只保留节点最新判断。
    strategies.put("route", new ReplaceStrategy());
    strategies.put("answer", new ReplaceStrategy());
    strategies.put("errorCode", new ReplaceStrategy());
    // 列表状态保留多个节点产生的增量结果。
    strategies.put("evidence", new AppendStrategy());
    strategies.put("events", new AppendStrategy());
    return strategies;
};
```

状态还要满足三个工程约束：只保存恢复所需的最小数据；敏感字段先脱敏或引用外部受控存储；所有需要持久化的值必须能稳定序列化。模型完整上下文、超大工具结果和二进制文件不应直接塞进检查点。

## 三、节点要小、幂等、可观测

下面用“问题分类 → 检索或直接回答”说明最小结构。节点只返回增量，条件边只负责路由：

```java
import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.action.NodeAction;
import com.alibaba.cloud.ai.graph.exception.GraphStateException;

import java.util.Map;

import static com.alibaba.cloud.ai.graph.StateGraph.END;
import static com.alibaba.cloud.ai.graph.StateGraph.START;
import static com.alibaba.cloud.ai.graph.action.AsyncEdgeAction.edge_async;
import static com.alibaba.cloud.ai.graph.action.AsyncNodeAction.node_async;

NodeAction classify = state -> {
    String question = state.value("question")
            .map(String.class::cast)
            .orElse("");
    // 示例只展示节点契约；生产环境应由受控分类器或 ChatClient 生成结果。
    String route = question.contains("订单") ? "retrieve" : "direct";
    return Map.of("route", route);
};

NodeAction retrieve = state -> Map.of(
        "evidence", java.util.List.of("kb:order-status"));

NodeAction answer = state -> Map.of(
        "answer", "根据当前证据生成受约束回答");

StateGraph workflow = new StateGraph(stateFactory)
        .addNode("classify", node_async(classify))
        .addNode("retrieve", node_async(retrieve))
        .addNode("answer", node_async(answer))
        .addEdge(START, "classify")
        .addConditionalEdges(
                "classify",
                edge_async(state -> (String) state.value("route").orElse("direct")),
                Map.of("retrieve", "retrieve", "direct", "answer"))
        .addEdge("retrieve", "answer")
        .addEdge("answer", END);

CompiledGraph graph = workflow.compile();
```

实际节点至少记录 `threadId`、节点名、尝试次数、耗时、输入输出大小、模型 token 用量、路由结果和错误类型。正文、提示词、证据与用户输入可能包含隐私，默认只记录哈希、长度和受控采样。

## 四、边分三类，循环必须有上限

### 1、普通边

普通边表达确定顺序，例如 `retrieve → answer`。它最容易审计，也最适合固定业务流程。

### 2、条件边

条件边读取状态并返回一个有限路由 key，再由映射表决定目标节点。路由函数应保持纯净：不调用模型、不写数据库、不抛出未经分类的业务异常。未知 key 必须落到明确的失败节点或安全终止，不能静默走默认成功路径。

### 3、并行边

同一节点连接多个后继节点时可形成并行分支。并行并不自动保证结果正确：多个分支写同一 key 时，归并策略必须满足结合性，最好还满足交换性；否则线程调度顺序会改变最终状态。

反思、重试和工具循环需要条件边回到前序节点，同时保存 `iteration`、deadline 与停止原因。**任何环都必须同时受最大轮数、全链路时间、模型预算和外部调用次数限制。**

## 五、检查点让流程可恢复，但不会自动幂等

使用 `SaverConfig` 编译图后，Graph 会在超级步骤保存状态快照。`RunnableConfig.threadId` 标识一条独立运行历史；`StateSnapshot` 记录当时的状态、节点、后继节点和检查点配置。

```java
import com.alibaba.cloud.ai.graph.CompileConfig;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.checkpoint.config.SaverConfig;
import com.alibaba.cloud.ai.graph.checkpoint.savers.MemorySaver;

SaverConfig saverConfig = SaverConfig.builder()
        // MemorySaver 只适合本地开发与演示，进程退出后状态会丢失。
        .register(new MemorySaver())
        .build();

CompiledGraph persistentGraph = workflow.compile(
        CompileConfig.builder().saverConfig(saverConfig).build());

RunnableConfig config = RunnableConfig.builder()
        // 生产环境应使用不可猜测且绑定租户的运行 ID。
        .threadId("tenant-42:request-9f2c")
        .build();

persistentGraph.invoke(Map.of("question", "订单为何一直处理中"), config);
var latest = persistentGraph.getState(config);
```

生产环境需要选用外部持久化 Saver，并定义 TTL、租户隔离、加密、容量与清理策略。相同 `threadId` 只能串行推进，避免两个请求同时从同一旧检查点分叉写回。

更重要的是，恢复会重新执行检查点之后的节点。发送消息、扣费、建单等外部副作用必须使用业务幂等键、Outbox 或状态机保护。检查点只记住“运行到哪里”，无法让第三方系统自动撤销或去重。

## 六、失败处理按节点边界收口

| 失败类型 | 推荐处理 | 禁止做法 |
| --- | --- | --- |
| 模型超时 | 节点级短超时、有限重试、降级路由 | 无限回到同一模型节点 |
| 结构化输出非法 | Schema 校验后有限修复 | 把原始文本强转为业务对象 |
| 工具结果未知 | 查询幂等键或状态接口 | 直接重放有副作用调用 |
| 状态反序列化失败 | 停止恢复并告警，执行版本迁移 | 丢弃字段后继续成功路径 |
| 路由 key 未知 | 进入显式失败节点 | 默认跳到 `END` 当作成功 |
| Saver 不可用 | 按业务风险拒绝启动或降级无恢复模式 | 声称已经持久化 |

图定义与状态 Schema 都要版本化。部署新版本时，旧检查点可能引用已删除节点或旧字段；恢复入口应校验 `graphVersion`，通过迁移器转换，无法迁移就转人工处理。

## 七、什么时候用 Graph

适合直接使用 Graph 的场景：

- 流程包含明确分支、并行、循环、中断或跨请求恢复；
- 每个步骤都需要独立观测、重试和审计；
- 模型判断与确定性业务规则必须混合编排；
- 需要把 Agent 作为子图嵌入受控业务流程。

不适合的场景：单次聊天、固定两三步同步调用、普通 Spring 事务流程，或团队尚未建立状态版本、幂等和可观测规范。Graph 能把控制流显式化，但也引入状态 Schema、图版本和恢复语义的维护成本。

## 八、上线检查清单

1. 每个状态 key 是否定义了明确类型、归并策略、大小上限和敏感级别；
2. 节点是否只返回增量，外部副作用是否有业务幂等键；
3. 条件边是否覆盖未知路由，所有循环是否有轮数、时间和成本上限；
4. 并行分支写同一 key 时，归并结果是否与执行顺序无关；
5. `threadId` 是否绑定租户且不可猜测，同一运行是否串行推进；
6. Saver 是否支持重启恢复、TTL、加密、容量监控和灾备；
7. 图结构与状态是否携带版本，旧检查点是否有迁移或人工兜底；
8. 节点耗时、token、路由、重试、检查点和停止原因是否可关联查询；
9. 依赖是否由官方 BOM 锁定，并在升级前核对当前文档与 Release Notes。

## 九、总结

Spring AI Alibaba Graph 的核心不是把模型调用画成图，而是把状态变化、控制流和恢复点变成可审计契约。

**要点回顾**：`StateGraph` 定义结构；节点返回状态增量；边只负责路由；Replace、Append 与自定义策略决定归并语义；检查点提供恢复基础，但外部副作用仍需幂等；循环、并行与旧状态迁移必须显式治理。

**关联知识点**：Spring AI `ChatClient` 负责模型调用抽象；结构化输出负责节点结果校验；HITL 依赖中断与检查点；Outbox 负责跨系统副作用可靠投递；OpenTelemetry 可串联图运行、节点与模型调用。

**面试常问**：Graph 与普通 Chain 的差别？→ Graph 有共享状态、条件路由、循环、中断和持久化恢复；检查点能否保证接口不重复调用？→ 不能，仍需业务幂等；并行节点为何需要 Reducer？→ 多分支写同一状态时必须定义稳定归并语义。

**参考资料**：[Spring AI Alibaba 版本说明](https://java2ai.com/docs/versions/)；[Graph Core 官方 README](https://github.com/alibaba/spring-ai-alibaba/tree/main/spring-ai-alibaba-graph-core)；[Graph Core 持久化](https://java2ai.com/docs/frameworks/graph-core/core/persistence/)；[官方 Graph 快速示例](https://github.com/alibaba/spring-ai-alibaba/blob/main/examples/documentation/src/main/java/com/alibaba/cloud/ai/examples/documentation/graph/QuickStartExample.java)。
