---
title: 深入理解 AgentScope Java 2.0 Harness：从“能跑”到“生产可用”
date: 2026-08-27
category: AI
cover: /images/posts/agentscope-java-harness-production-engineering-knowledge-map.webp
tags:
  - AgentScope
  - Java
  - AI Agent
  - Harness
  - 分布式系统
excerpt: AgentScope Java 2.0 Harness 在 ReAct 推理内核之上统一状态恢复、Workspace、上下文压缩、双层记忆、Sandbox、Skill、子 Agent、Plan Mode 与 Channel，解决多租户、长会话和多副本部署问题。
---

# 深入理解 AgentScope Java 2.0 Harness：从“能跑”到“生产可用”

<img src="/images/posts/agentscope-java-harness-production-engineering-knowledge-map.webp" alt="深入理解 AgentScope Java 2.0 Harness 知识串联图" style="border-radius: 10px;" />

`ReActAgent` 已经可以完成推理、调用工具并返回结果，但企业真正上线一个 Agent 时，难点往往不在“这一轮能不能回答”，而在“下一轮、下一天、下一台机器还能不能正确继续”。AgentScope Java 2.0 将这部分工程能力收拢进 Harness：在不替换 ReAct 推理循环的前提下，统一装配状态恢复、Workspace、上下文压缩、长期记忆、Sandbox、Skill、子 Agent、Plan Mode 与 Channel。

本文基于 AgentScope Java 2.0 官方文档与官方 Harness 技术解析整理。重点不是罗列 Builder 方法，而是解释每种状态放在哪里、能力之间怎样协作，以及单机示例迁移到多租户、多副本生产环境时还缺哪些边界。

AgentScope Java 2.0 GA 在 5 个 RC 版本后发布，版本说明见 [v2.0.0 Release Notes](https://github.com/agentscope-ai/agentscope-java/releases/tag/v2.0.0)。本文核对日期为 2026-08-27，后续小版本若调整默认阈值或 Builder API，应以[官方文档](https://java.agentscope.io)为准。

## 一、先看 2.0 的定位与迁移重点

### 1、AgentScope 生态里 Harness 在哪一层

AgentScope 的底层仍然是 Agent 框架：模型、消息与事件、工具调用、Middleware、Permission 和 ReAct 循环都属于核心层。模型提供商、MCP、可观测平台、Skill 仓库和业务应用位于外部扩展层。Harness 夹在二者之间，把长时间运行 Agent 所需的通用工程能力组合起来。

从官方生态全景看，AgentScope 已形成 Python、Java、TypeScript 多语言实现，Go 实现仍在推进；模型侧可以接入 OpenAI 兼容协议、DeepSeek、Qwen 等提供商；观测侧使用 OpenTelemetry，可对接 LangFuse、ARMS 等平台；Higress 可承接模型与 MCP 代理，Nacos 等后端可以作为 Skill 或 MCP 的集中管理入口。Harness 的价值正是把这些外部能力约束到统一的运行上下文和工程边界中。

```text
业务入口 / IM / Issue / PR / API
                ↓
Channel 与应用路由层
                ↓
Harness：Workspace、Memory、Compaction、Sandbox、Skill、Subagent、Plan
                ↓
ReActAgent：Reasoning、Tool Call、Middleware、Permission
                ↓
Model / MCP / 业务工具 / 可观测基础设施
```

因此，Harness 不是新的推理范式，也不是另一个 Agent Loop。它更像生产运行层：将原本散落在业务代码中的会话恢复、文件路由、压缩、隔离和编排变成框架能力。

### 2、从 1.x 迁移到 2.0 要关注什么

迁移时可以按四类变化处理：

- **核心概念变化**：运行状态统一进入 `AgentState`，状态的保存和恢复由 `AgentStateStore` 负责；
- **调用入口变化**：`call()` 或流式调用需要携带 `RuntimeContext`，由其中的 `userId`、`sessionId` 建立多租户与会话边界；
- **扩展点变化**：新的扩展逻辑优先使用 Middleware 与 Permission；旧 Hook 即使存在兼容期，也不应继续作为新代码的设计基础。
- **事件流变化**：新代码应使用返回 `Flux<AgentEvent>` 的 `streamEvents()`；旧的粗粒度 `stream()` 已进入废弃迁移路径。

升级不必一次打开全部 Harness 能力。更稳妥的顺序是先迁移调用上下文与状态，再接 Workspace 和会话日志，之后根据风险逐步开启压缩、记忆、Sandbox、Skill 和子 Agent。

### 3、先记住三个结论

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

### 4、AbstractFilesystem：把逻辑工作区与物理存储解耦

Workspace 是逻辑目录，`AbstractFilesystem` 才决定文件最终落在哪里。Harness 通过统一文件系统抽象，让上层的 `read_file`、`write_file`、Skill 和记忆逻辑不必感知本机磁盘、共享存储还是沙箱容器。

| 文件系统模式 | 适用场景 | 需要注意的边界 |
| --- | --- | --- |
| 本地文件系统 | 开发机、单用户个人助手 | 绑定单机，Shell 直接接触宿主环境 |
| 共享或远端文件系统 | 多副本在线业务 Agent | 需要稳定命名空间、分布式状态存储和并发协调 |
| Sandbox 文件系统 | Coding Agent、高风险工具执行 | 需要容器生命周期、快照恢复、网络和凭据控制 |
| Composite 文件系统 | 平台型产品、混合存储 | 不同目录可路由到不同后端，必须统一处理用户隔离 |

同一个 Agent 被多个用户调用时，`userId` 不只是状态查询条件，也会参与 Workspace、Skill 和沙箱的逻辑命名空间。比如 `workspace/alice/skills/` 表示 Alice 的用户级 Skill，但在远端存储中它可能映射成 KV 前缀，在沙箱模式下则投影成容器里的 `/workspace/skills/`。

这也是为什么自定义中间件不能绕开 `WorkspaceManager` 直接调用 `java.nio.file.Files`：前者会遵循当前文件系统的隔离与路由，后者只会落到运行 Harness 的 JVM 宿主磁盘。

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
- 单个 Agent 或 Gateway 内，同一 `(userId, sessionId)` 的调用会串行化，不同会话可以并行；多副本仍要配置跨节点协调。

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

## 六、上下文压缩：四道防线守住窗口

长会话不能只依赖模型越来越大的上下文窗口。Harness 的压缩栈包含四种相互独立但可以组合的策略：

| 防线 | 触发时机 | 处理方式 |
| --- | --- | --- |
| 对话摘要压缩 | 消息数量或 Token 接近阈值 | 摘要旧前缀，只保留最近若干条消息 |
| 大工具结果卸载 | 单条工具结果超过阈值 | 全文写入 Workspace，上下文只保留首尾与文件路径 |
| 上下文溢出兜底 | 模型返回上下文超限错误 | 强制极限压缩，并自动重试一次 |
| 预压缩参数截断 | 摘要前发现超长工具参数 | 不调用模型，先截断低价值的大字符串参数 |

对话摘要和工具结果卸载不是一回事。前者压缩整个历史前缀，后者只处理异常大的单次工具输出。例如 Shell 打印数万行日志时，应先把原始结果卸载到文件，再让 Agent 通过 `read_file` 按需查看，而不是让一条工具消息占满窗口。

```java
HarnessAgent agent = HarnessAgent.builder()
        .name("engineering-assistant")
        .model(model)
        .workspace(Paths.get(".agentscope/workspace"))
        .compaction(CompactionConfig.builder()
                // 超过阈值后摘要旧消息
                .triggerMessages(80)
                // 保留最近对话，避免摘要后失去当前任务细节
                .keepMessages(20)
                // 摘要前先截断体积很大的工具参数
                .truncateArgs(CompactionConfig.TruncateArgsConfig.builder()
                        .maxArgLength(2_000)
                        .truncationText("... [truncated] ...")
                        .build())
                .build())
        .toolResultEviction(ToolResultEvictionConfig.defaults())
        .build();
```

压缩只处理 `AgentState.contextMutable()` 中的对话消息，不会粗暴删除所有运行状态：

- Plan Mode 状态保存在独立的 `planModeContext`，计划文件位于 `plans/`；
- 后台子 Agent 的 `taskId`、状态和结果由 `TaskRepository` 单独维护；
- `todo_write` 清单和 Permission 规则位于各自的 `AgentState` 字段；
- 原始消息可以在摘要前写入永不压缩的 `*.log.jsonl`，供 `session_search` 检索。

生产环境还要给“写入 Workspace 的大结果”设置生命周期。否则模型上下文虽然变小，磁盘或对象存储会不断增长，只是把内存问题转移成了存储问题。

## 七、双层长期记忆：从会话事实到 MEMORY.md

压缩解决“当前窗口放不下”，长期记忆解决“跨会话还要记住”。Harness 将两者设计为独立能力，不能把摘要消息直接当作长期记忆。

长期记忆有两层：

```text
对话消息
   │ Flush：抽取值得长期保留的事实
   ▼
memory/YYYY-MM-DD.md        每日追加，原始、允许重复
   │ Consolidation：后台合并、去重、蒸馏
   ▼
MEMORY.md                   全局长期记忆，每轮推理注入 System Prompt
```

这条管线实际包含三类不同的模型调用：

1. **Flush**：从即将被压缩或已累积的对话中抽取事实，追加到每日记忆；
2. **Consolidation**：定期整理每日流水账，重写高质量的 `MEMORY.md`；
3. **Compaction summary**：压缩当前对话前缀，只影响本次会话上下文。

三者默认可以共享主 Agent 的模型，但触发策略、Prompt 和写入目标不同。生产系统可以给 Flush 与 Consolidation 配置成本更低的模型，同时严格控制 `MEMORY.md` 的大小、敏感字段和冲突事实。

配套查询也分两类：`memory_search`、`memory_get` 查询长期记忆；`session_list`、`session_history`、`session_search` 查询未被压缩的完整会话日志。正确的使用方式是让 `MEMORY.md` 保存稳定事实和检索线索，需要细节时再查询每日记忆或历史会话，而不是把所有聊天原文永久塞回 System Prompt。

## 八、从单机迁移到多副本

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

## 九、Sandbox 的边界不只是“能执行命令”

Sandbox 需要同时隔离文件、进程和恢复元数据。风险主要来自四个方向：

- **宿主机越界**：Agent 不应通过普通文件 API 绕过 Workspace 路由写宿主机。
- **租户串线**：隔离粒度与 `userId`、`sessionId` 的生成规则不一致。
- **快照回滚**：旧副本在锁外写回过期快照，覆盖新状态。
- **工具越权**：命令进入了沙箱，但网络、凭据和 MCP 工具仍无最小权限限制。

自定义中间件若要读写工作区，应通过 `HarnessAgent#getWorkspaceManager()`。直接使用 `java.nio.file.Files` 只会写当前 JVM 所在磁盘，在远端文件系统或沙箱模式下很可能落错位置。

## 十、子 Agent 编排：委派、后台执行与结果回传

子 Agent 解决的是“由谁做”，不是简单地把一段 Prompt 再调用一次。主 Agent 可以把研究、编码、审查等任务交给拥有独立角色、工具与上下文的临时实例，并通过任务记录持续跟踪。

| 执行形态 | 主 Agent 是否等待 | 适用任务 | 结果如何返回 |
| --- | --- | --- | --- |
| 同步委派 | 等待 | 快速检索、短分析、单步校验 | 子 Agent 返回后继续当前推理 |
| 后台任务 | 不等待 | 长时间构建、研究、批量处理 | 完成后以系统提醒回注主 Agent |
| 远程子 Agent | 取决于协议 | 独立服务、跨团队能力 | 由远程调用协议返回事件和结果 |

Workspace 可以在 `subagents/<id>.md` 中声明子 Agent，也可以通过 Builder 代码配置。框架还要处理四类容易被业务代码忽略的问题：

- **上下文边界**：子 Agent 默认不应依赖父 Agent 的全部隐式对话，任务输入要显式携带目标、材料、约束和输出契约；
- **事件归属**：流式输出要携带来源标识，前端才能区分主 Agent 与多级子 Agent；
- **权限继承**：子 Agent 获得的工具权限不应超过任务所需范围，父 Agent 有权限不代表子 Agent 必须继承；
- **恢复能力**：后台任务状态保存在独立任务记录中，重启或多副本接力后仍需按 `taskId` 查询。

异步结果不放进普通历史消息，而是由任务仓库保存，并在主 Agent 下一轮推理前通过 system reminder 注入。这样既不会被上下文摘要误删，也不要求主 Agent 为等待长任务一直占用请求线程。

## 十一、Skill、Plan Mode 与 Channel

这三项能力分别回答“怎么复用”“什么时候执行”和“从哪里接入”。它们与子 Agent、Sandbox 组合后，才形成完整的生产工作流。

### 1、Skill：四层组合与沙箱内执行

Skill 是包含 `SKILL.md`、参考资料、脚本和样例的能力包。Harness 当前支持四层来源：

| 层级 | 来源 | 典型用途 |
| --- | --- | --- |
| Layer 1 | 项目全局注册 | 应用代码内置的基础能力 |
| Layer 2 | Git、Nacos、MySQL、Classpath 等 Skill 仓库 | 团队统一分发、在线更新 |
| Layer 3 | `workspace/skills/` | 当前 Agent 或项目共享能力 |
| Layer 4 | `<userId>/skills/` | 用户私有能力，可覆盖同名共享版本 |

这些来源可以同时启用，而不是四选一。Skill 元数据预载后，Agent 只在需要时读取完整说明和资源，从而减少 System Prompt 常驻内容。带脚本的市场 Skill 会先物化到 `.skills-cache`，再投影进 Sandbox，最终在容器内执行；工作区 Skill 则直接随 Workspace 投影。

这套机制解决了分发和文件可见性，但不等于业务授权。即使某个 Skill 声明了数据库或发布工具，服务端仍要根据租户、环境与操作类型执行 Permission 校验。

### 2、Plan Mode：想清楚、写下来、确认后再执行

Plan Mode 将高风险任务分成只读规划和可写执行两个阶段。进入规划后，Agent 可以调查、拆分步骤并把计划写入 `plans/`；退出规划时通过 Permission 或人工确认切回执行模式。

计划文件、Plan Mode 状态和待办清单都有独立的持久化位置，因此对话压缩不会把它们一起摘要掉。但 Plan Mode 只控制执行时机，不能替代 Sandbox、租户鉴权或工具白名单。

### 3、Channel：消息平台到 Agent 的稳定入口

Channel 把不同传输协议统一成 Agent 可处理的消息与事件流：

```text
CLI / Web / DingTalk / Feishu / GitHub Webhook
                      ↓
              Gateway / Channel Adapter
                      ↓
       路由、鉴权、去重、Thread/Session 映射
                      ↓
                  HarnessAgent
                      ↓
          流式事件或后台任务结果回传
```

Channel 的重点不是“接一个聊天窗口”，而是稳定地把外部线程映射为 `(userId, sessionId)`，同时处理签名校验、重复投递、忙会话排队、流式事件和后台结果回推。例如 Issue 与 PR Review 应映射到不同线程，避免两个任务共享错误的上下文。

## 十二、企业级实战形态

官方技术解析给出了四类典型 Harness 应用，它们的差异主要体现在文件系统、隔离粒度和入口方式：

1. **个人助手**：Workspace 直连本机文件系统和 Shell，部署简单、可以持续积累记忆，但天然绑定单机，不适合作为多租户服务；
2. **Managed Agent 平台**：集中部署 Agent Builder，让用户创建私有或共享 Agent，通过 Composite Filesystem、`userId` 命名空间和控制面实现数据隔离；
3. **数据 Agent 平台**：每个用户拥有隔离的数据空间与私有 Skill，沉淀出的能力经过审核后才能升级为组织共享 Skill；
4. **自主编码机器人**：通过 GitHub/GitLab Webhook 接收 Issue 或 Review，请求按 Thread 路由，每个任务进入独立 Docker Sandbox，长任务结果再通过原 Channel 回传。

这四类示例不是四套互不相关的框架，而是同一组 Harness 组件的不同组合：个人助手偏本地 Workspace；平台产品强调多租户文件路由和状态存储；数据 Agent 额外增加 Skill 生命周期；Coding Agent 则把 Channel、后台子 Agent、Sandbox 和线程恢复组合在一起。

## 十三、生产落地检查表

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

## 十四、常见误区

| 误区 | 正确认知 |
| --- | --- |
| AgentState 存在 Workspace 中 | AgentState 默认在独立 `AgentStateStore`，Workspace 只保存文件资产与日志 |
| 共享 Workspace 就能多副本恢复 | 还需要分布式 AgentState、沙箱快照和跨节点协调 |
| 上下文压缩会删除历史记录 | 压缩模型上下文，完整会话日志仍可在 Workspace 追加保存 |
| Compaction 等于长期记忆 | Compaction 生成当前会话摘要；Flush 与 Consolidation 才负责沉淀长期事实 |
| Sandbox 已经解决所有安全问题 | 仍需凭据、网络、MCP、租户和人工确认边界 |
| Subagent 会自动继承父任务信息 | 应显式传递目标、材料、工具范围和输出契约 |
| Skill 仓库等于权限中心 | Skill 负责能力发现和加载，业务授权仍由 Permission 与服务端鉴权控制 |
| Channel 只负责收发消息 | 还要承担签名、去重、线程映射、排队和结果回推 |
| 直接用 `Files` 写入工作区更简单 | 非本地模式可能写错位置，应走 WorkspaceManager |

## 十五、总结

AgentScope Java 2.0 Harness 的工程价值可以压缩成一句话：它不改变 Agent 如何推理，而是把一个 Agent 长期运行所需的状态、记忆、隔离、编排、权限和接入能力，从业务代码中抽出来变成可组合的框架设施。

**要点回顾**：`RuntimeContext` 只描述本次调用身份；`AgentStateStore` 保存可恢复的运行状态；Workspace 承载会话日志、长期记忆和文件产物；四道压缩防线控制当前上下文，双层 Memory 沉淀跨会话事实；Subagent、Skill、Plan Mode 分别处理任务委派、能力复用与执行时机；Channel 负责把外部线程稳定映射到会话；多副本恢复必须同时共享状态、文件与沙箱快照。

**关联知识点**：ReAct 推理与工具循环决定 Agent 如何行动；AgentState 与事件溯源决定任务如何恢复；上下文压缩与检索增强决定信息怎样在有限窗口内保真；多租户隔离保证状态、文件、Skill 和工具授权使用同一身份；分布式锁与幂等避免同一会话并发覆盖或重复副作用；MCP 与 Channel 治理负责外部能力和外部入口的最小权限与审计。

**面试常问**：`RuntimeContext`、`AgentState` 和 Workspace 的生命周期分别是什么？→ `RuntimeContext` 仅在单次调用中传递身份，`AgentState` 跨调用保存运行快照，Workspace 长期保存可审计文件；四道上下文防线是什么？→ 对话摘要、大结果卸载、溢出强制压缩重试、预压缩参数截断；为什么共享 Workspace 不能独立完成多副本恢复？→ 运行状态仍位于独立 `AgentStateStore`，沙箱还需要远端快照和跨节点协调；Compaction 与 Memory 有什么区别？→ 前者控制当前上下文，后者通过每日记忆与 `MEMORY.md` 保存跨会话事实；为什么不能直接用 `java.nio.file.Files` 写 Workspace？→ 远端或沙箱模式下会绕过 `WorkspaceManager` 路由并写错物理位置。

**参考资料**：[AgentScope 2.0 Harness 官方技术解析](https://java.agentscope.io/v2/zh/blogs/agentscope-v2-explained.html)；[AgentScope Java 2.0 快速开始](https://java.agentscope.io/v2/zh/docs/quickstart.html)；[V1 迁移指南](https://java.agentscope.io/v2/zh/docs/change-log.html)；[Harness Architecture](https://java.agentscope.io/v2/en/docs/harness/architecture.html)；[上下文压缩](https://java.agentscope.io/v2/zh/docs/harness/compaction.html)；[记忆（Memory）](https://java.agentscope.io/v2/zh/docs/harness/memory.html)；[工作区（Workspace）](https://java.agentscope.io/v2/zh/docs/harness/workspace.html)；[文件系统（Filesystem）](https://java.agentscope.io/v2/zh/docs/harness/filesystem.html)；[沙箱（Sandbox）](https://java.agentscope.io/v2/zh/docs/harness/sandbox.html)；[子 Agent](https://java.agentscope.io/v2/zh/docs/harness/subagent.html)；[技能（Skill）](https://java.agentscope.io/v2/zh/docs/harness/skill.html)；[计划模式](https://java.agentscope.io/v2/zh/docs/harness/plan-mode.html)；[Channel](https://java.agentscope.io/v2/zh/docs/harness/channel.html)。

