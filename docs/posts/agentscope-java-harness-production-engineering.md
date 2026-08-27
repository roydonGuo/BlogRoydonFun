---
title: AgentScope Java 2.0 Harness：状态、工作区与生产隔离
date: 2026-08-27
category: AI
cover: /images/posts/agentscope-java-harness-production-engineering-knowledge-map.webp
tags:
  - AgentScope
  - Java
  - AI Agent
  - Harness
  - 分布式系统
excerpt: AgentScope Java 2.0 Harness 的关键不是再包一层 Agent，而是把调用身份、运行状态和持久工作区拆成独立边界，再为沙箱、子 Agent、记忆与多副本恢复提供统一装配方式。
---

# AgentScope Java 2.0 Harness：状态、工作区与生产隔离

<img src="/images/posts/agentscope-java-harness-production-engineering-knowledge-map.webp" alt="AgentScope Java 2.0 Harness：状态、工作区与生产隔离知识串联图" style="border-radius: 10px;" />

AgentScope Java 2.0 Harness 的关键不是再包一层 Agent，而是把调用身份、运行状态和持久工作区拆成独立边界，再为沙箱、子 Agent、记忆与多副本恢复提供统一装配方式。

## 一、先记住三个结论

1. **Harness（工程运行层）**不替换 `ReActAgent` 的推理循环，只负责装配工作区、状态持久化、上下文压缩、记忆、沙箱、Skill 和子 Agent 等能力。
2. `RuntimeContext`、`AgentStateStore`、Workspace 不是同一个东西。前者描述“本次是谁在调用”，中间保存“下次从哪里继续”，后者承载“长期文件资产”。
3. 多副本部署不能只共享 Workspace。运行状态、文件系统或沙箱快照、并发隔离必须同时具备跨节点能力。

:::mermaid
flowchart TB
    A[业务请求] --> B[RuntimeContext<br/>本次调用身份]
    B --> C[HarnessAgent<br/>工程能力编排]
    C --> D[ReActAgent<br/>推理与工具循环]
    C <--> E[AgentStateStore<br/>运行状态恢复]
    C <--> F[Workspace<br/>文件与长期记忆]
    C --> G[Sandbox / Subagent<br/>隔离执行]
:::

截至 2026-08-27，AgentScope Java 2.0 官方文档要求 JDK 17 及以上。以下边界和 API 均按当日官方 v2 文档核对。

## 二、Harness 解决什么问题

裸 `ReActAgent` 已经能够完成模型推理、工具调用和循环终止，但“能完成一次任务”不等于“能长期运行”。生产系统还要回答这些问题：

- 同一用户的下一次请求如何恢复上下文？
- 不同用户、不同会话如何隔离？
- 超长工具结果如何避免挤爆模型上下文？
- Agent 产生的文件、记忆和计划保存在哪里？
- 危险命令如何与宿主机隔离？
- 多副本接力时，状态和沙箱如何一起恢复？

`HarnessAgent` 是围绕 `ReActAgent` 的薄封装。它保留核心推理算法，通过固定顺序的中间件和统一 Builder 接入工程能力。

| 能力 | 解决的问题 | 典型入口 |
| --- | --- | --- |
| Workspace | 人格、知识、文件产物和长期记忆 | `.workspace(...)` |
| 状态持久化 | 跨调用恢复运行上下文 | `.stateStore(...)` |
| 上下文压缩 | 控制消息与工具结果占用 | `.compaction(...)` |
| Sandbox | 隔离文件与命令执行 | `.filesystem(...)` |
| Skill | 按需加载可复用流程 | `.skillRepository(...)` |
| Subagent | 拆分角色与后台任务 | `workspace/subagents/` 等 |
| Plan Mode | 先只读规划，再经确认执行 | `.enablePlanMode()` |
| Channel | 会话并发、路由与事件流 | `.channel(...)` |

这些能力并非彼此嵌套的大模块。它们主要通过调用上下文、状态存储和工作区协作，因此先分清三者比记住所有 Builder 方法更重要。

## 三、三类数据边界

<img src="/images/posts/AgentScope Java 2.0 Harness：状态、工作区与生产隔离/agentstate-runtimecontext-migration.webp" alt="AgentScope 2.0 AgentState 与 RuntimeContext 迁移边界图" style="border-radius: 10px;" />

### 1、RuntimeContext：只描述本次调用

**运行时上下文（Runtime Context）**携带 `userId`、`sessionId` 和业务扩展字段。它由应用在每次请求时创建，不作为长期状态自动保存。

```java
RuntimeContext context = RuntimeContext.builder()
        // 租户或最终用户标识，用于数据隔离
        .userId(userId)
        // 会话标识，决定本次加载哪一份 AgentState
        .sessionId(sessionId)
        .put("traceId", traceId)
        .build();

Msg result = agent.call(new UserMessage(userInput), context).block();
```

<img src="/images/posts/AgentScope Java 2.0 Harness：状态、工作区与生产隔离/harness-runtime-context.webp" alt="HarnessAgent 通过 RuntimeContext 接收用户与会话身份的原理图" style="border-radius: 10px;" />

工程上应由认证后的服务端身份生成 `userId`，不能直接相信客户端随意传入的值。否则攻击者可能通过伪造标识读取其他会话。

### 2、AgentStateStore：保存可恢复运行状态

**Agent 状态（AgentState）**包含对话缓冲、压缩摘要、权限、工具、任务和 Plan Mode 等运行期子状态。每次 `call()` 结束后，框架将它写入 `AgentStateStore`；相同 `(userId, sessionId)` 的下一次调用再自动加载。

默认实现是本地 `JsonFileAgentStateStore`，路径位于：

```text
~/.agentscope/state/<agentId>/
```

这条路径在 Workspace 之外。默认实现适合单机开发，不适合多副本共享。生产环境通常切换为 Redis 或 MySQL 等分布式实现。

### 3、Workspace：保存持久文件资产

**工作区（Workspace）**是 Agent 人格、知识、Skill、子 Agent 定义和运行产物的文件树。它保存的是可部署、可查询或可累积的文件，不是 `AgentState` 的存放目录。

```text
workspace/
├── AGENTS.md                    # 人格与工程约束
├── MEMORY.md                    # 汇总后的长期记忆
├── memory/
│   └── YYYY-MM-DD.md            # 按日追加的记忆
├── knowledge/                   # 领域知识
├── skills/                      # Skill 定义
├── subagents/                   # 子 Agent 定义
├── tools.json                   # MCP 工具白名单等配置
├── plans/                       # 计划文件
└── agents/<agentId>/
    ├── sessions/                # 完整会话日志
    └── tasks/                   # 子任务记录
```

完整会话日志不会因上下文压缩而消失。压缩影响模型当前携带的上下文，Workspace 中的追加日志仍可用于审计和检索。

## 四、一次调用的数据流

相同 `(userId, sessionId)` 是状态寻址的核心。一次调用可以简化为：

:::mermaid
sequenceDiagram
    participant App as Java 服务
    participant H as HarnessAgent
    participant S as AgentStateStore
    participant W as Workspace
    participant R as ReActAgent

    App->>H: message + RuntimeContext
    H->>S: 按 userId/sessionId 加载 AgentState
    H->>W: 加载人格、记忆与必要文件
    H->>R: 组装提示词并执行推理循环
    R-->>H: 回复、工具结果与状态变化
    H->>W: 追加日志、任务和记忆产物
    H->>S: 保存最新 AgentState
    H-->>App: 返回结果或流式事件
:::

这里有三个容易忽略的不变量：

- `AGENTS.md` 或 `MEMORY.md` 修改后，系统提示词会在后续推理步骤重新构建，无需重启 Agent。
- 压缩、记忆提炼和后台维护带有节流机制，并非每一轮都执行。
- 同一 `(userId, sessionId)` 的调用会串行化，不同会话可以并行。

## 五、最小 Java 装配

Maven 只引入 Harness 时，可使用以下依赖。`${agentscope.version}` 应锁定为项目验证过的具体版本，不要在生产构建中使用动态版本。

```xml
<dependency>
    <groupId>io.agentscope</groupId>
    <artifactId>agentscope-harness</artifactId>
    <version>${agentscope.version}</version>
</dependency>
```

模型提供商位于独立扩展模块中，应按实际厂商增加依赖。下面只展示 Harness 的状态边界，不绑定具体模型名称：

```java
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.UserMessage;
import io.agentscope.core.model.Model;
import io.agentscope.harness.agent.HarnessAgent;
import io.agentscope.harness.agent.memory.compaction.CompactionConfig;

import java.nio.file.Paths;

public final class AgentService {

    private final HarnessAgent agent;

    public AgentService(Model model) {
        this.agent = HarnessAgent.builder()
                .name("engineering-assistant")
                .sysPrompt("你是一个谨慎的 Java 工程助手。")
                // 实际项目传入官方支持的模型实例或已注册模型标识
                .model(model)
                // 工作区保存人格、知识、日志和长期记忆
                .workspace(Paths.get(".agentscope/workspace"))
                .compaction(CompactionConfig.builder()
                        // 达到阈值后压缩旧消息，保留最近消息
                        .triggerMessages(30)
                        .keepMessages(10)
                        .build())
                .build();
    }

    public Msg chat(String userId, String sessionId, String input) {
        RuntimeContext context = RuntimeContext.builder()
                // 标识必须来自可信的认证上下文
                .userId(userId)
                .sessionId(sessionId)
                .build();

        return agent.call(new UserMessage(input), context).block();
    }
}
```

示例接收官方 Model 接口，实际项目可传入对应厂商扩展构造的模型实例。这样能避免用未经核实的提供商名称、模型编号或认证字段污染核心示例。

## 六、从单机迁移到多副本

只把 Workspace 挂到共享盘仍然不够。多副本中的任意节点要接住同一会话，至少要同时处理以下三层：

| 层次 | 单机开发 | 多副本生产 |
| --- | --- | --- |
| AgentState | 本地 JSON 文件 | Redis、MySQL 等分布式状态存储 |
| Workspace | 本地目录 | 远端文件系统、共享存储或可恢复沙箱 |
| 执行环境 | 本机进程 | 带远端快照的 Sandbox |
| 并发控制 | 进程内串行 | 跨节点锁或分布式协调 |

官方文档给出的分布式沙箱条件包括：

1. 分布式 `AgentStateStore`，让任何副本都能读取运行状态；
2. 非空远端快照，使沙箱文件能够跨副本恢复；
3. 合适的 `IsolationScope`，决定按用户还是会话隔离；
4. 创建、恢复和销毁沙箱时的并发保护，避免双重初始化或覆盖快照。

使用 `SandboxFilesystemSpec` 或 `RemoteFilesystemSpec` 却仍保留本地状态存储时，当前 Harness 会在构建阶段拒绝部分不一致配置。这个限制很有价值：文件跨节点而运行状态留在单机，会形成看似可恢复、实际断片的会话。

<img src="/images/posts/AgentScope Java 2.0 Harness：状态、工作区与生产隔离/sandbox-distributed-recovery.webp" alt="AgentScope 沙箱隔离、恢复与分布式部署原理图" style="border-radius: 10px;" />

## 七、Sandbox 的边界不只是“能执行命令”

Sandbox 需要同时隔离文件、进程和恢复元数据。风险主要来自四个方向：

- **宿主机越界**：Agent 不应通过普通文件 API 绕过 Workspace 路由写宿主机。
- **租户串线**：隔离粒度与 `userId`、`sessionId` 的生成规则不一致。
- **快照回滚**：旧副本在锁外写回过期快照，覆盖新状态。
- **工具越权**：命令进入了沙箱，但网络、凭据和 MCP 工具仍无最小权限限制。

自定义中间件若要读写工作区，应通过 `HarnessAgent#getWorkspaceManager()`。直接使用 `java.nio.file.Files` 只会写当前 JVM 所在磁盘，在远端文件系统或沙箱模式下很可能落错位置。

## 八、Skill、Subagent 与 Plan Mode 如何协作

这些能力应围绕职责边界组合，而不是全部默认开启。

### 1、Skill：复用“怎么做”

Skill 适合封装按需加载的流程、约束和脚本。它减少系统提示词常驻内容，但不能代替服务端鉴权。Skill 中声明可用工具，不代表调用者自动获得业务权限。

### 2、Subagent：隔离“由谁做”

子 Agent 适合把研究、实现或审查交给独立角色。Workspace 可在 `subagents/<id>.md` 中声明角色，也可通过内置通用子 Agent或代码配置声明。每次子 Agent 执行是临时实例，并拥有自己的会话。

子 Agent 的输入应包含明确目标、输入材料、允许使用的工具和期望输出；不要依赖父 Agent 的隐式上下文。

### 3、Plan Mode：控制“什么时候做”

Plan Mode 适合高风险任务的先读后写流程。规划阶段应限制为只读能力，退出规划后再经过人工确认进入执行阶段。它降低误操作概率，但不能代替 Sandbox 和工具权限。

## 九、生产落地检查表

### 1、身份与隔离

- `userId` 来自认证上下文，并带租户前缀或稳定映射；
- `sessionId` 不可被其他用户枚举或复用；
- 缺少用户身份时，明确拒绝请求或定义可审计的降级策略；
- 同一会话的并发请求经过串行化或幂等控制。

### 2、状态与恢复

- AgentState、Workspace 和沙箱快照分别设置备份与保留策略；
- 多副本使用分布式状态存储，并演练节点切换后的恢复；
- 状态结构升级前准备兼容读取或迁移方案；
- 会话日志和长期记忆设置容量、脱敏与删除策略。

### 3、工具与安全

- Shell、文件、网络和 MCP 工具均使用白名单；
- 凭据通过运行环境注入，不写入 Workspace、日志或 Skill；
- 高风险写操作启用人工确认、超时和可取消机制；
- 子 Agent 继承的工具范围不超过任务所需权限。

### 4、可观测性

至少关联以下标识：

```text
traceId -> userId -> sessionId -> agentId -> taskId -> toolCallId
```

关键指标包括首 Token 延迟、总耗时、模型与工具错误率、压缩次数、状态读写耗时、沙箱恢复耗时和单会话资源占用。日志记录参数摘要和结果状态即可，避免完整输出泄露敏感数据。

## 十、常见误区

| 误区 | 正确认知 |
| --- | --- |
| AgentState 存在 Workspace 中 | AgentState 默认在独立 `AgentStateStore`，Workspace 只保存文件资产与日志 |
| 共享 Workspace 就能多副本恢复 | 还需要分布式 AgentState、沙箱快照和跨节点协调 |
| 上下文压缩会删除历史记录 | 压缩模型上下文，完整会话日志仍可在 Workspace 追加保存 |
| Sandbox 已经解决所有安全问题 | 仍需凭据、网络、MCP、租户和人工确认边界 |
| Subagent 会自动继承父任务信息 | 应显式传递目标、材料、工具范围和输出契约 |
| 直接用 `Files` 写入工作区更简单 | 非本地模式可能写错位置，应走 WorkspaceManager |

## 十一、总结

AgentScope Java 2.0 Harness 的工程价值可以压缩成一句话：用 `RuntimeContext` 确定本次调用身份，用 `AgentStateStore` 恢复运行状态，用 Workspace 沉淀持久资产，再把 Sandbox、Skill、Subagent 和 Plan Mode 挂到这组边界上。

**要点回顾**：`RuntimeContext` 只描述本次调用身份；`AgentStateStore` 保存可恢复的运行状态；Workspace 承载会话日志、长期记忆和文件产物；多副本恢复必须同时共享状态、文件与沙箱快照；Sandbox、Plan Mode 和工具权限分别约束执行环境、执行时机与可用能力。

**关联知识点**：ReAct 推理与工具循环决定 Agent 如何行动；上下文压缩与长期记忆决定信息如何跨轮次保留；多租户隔离保证状态、文件和工具授权使用同一身份；分布式锁与幂等避免同一会话并发覆盖或重复副作用；MCP 工具治理负责外部能力的最小权限与审计。

**面试常问**：`RuntimeContext`、`AgentState` 和 Workspace 的生命周期分别是什么？→ `RuntimeContext` 仅在单次调用中传递身份，`AgentState` 跨调用保存运行快照，Workspace 长期保存可审计文件；为什么共享 Workspace 不能独立完成多副本恢复？→ 运行状态仍位于独立 `AgentStateStore`，沙箱还需要远端快照和跨节点协调；上下文压缩会删除完整历史吗？→ 不会，它只缩减当前模型上下文，完整会话日志仍追加到 Workspace；为什么不能直接用 `java.nio.file.Files` 写 Workspace？→ 远端或沙箱模式下会绕过 `WorkspaceManager` 路由并写错物理位置。

**参考资料**：[AgentScope Java 2.0 快速开始](https://java.agentscope.io/v2/zh/docs/quickstart.html)；[Harness Architecture](https://java.agentscope.io/v2/en/docs/harness/architecture.html)；[上下文与 AgentState](https://java.agentscope.io/v2/zh/docs/building-blocks/context.html)；[工作区（Workspace）](https://java.agentscope.io/v2/zh/docs/harness/workspace.html)；[沙箱（Sandbox）](https://java.agentscope.io/v2/zh/docs/harness/sandbox.html)；[子智能体（Subagent）](https://java.agentscope.io/v2/zh/docs/harness/subagent.html)。

