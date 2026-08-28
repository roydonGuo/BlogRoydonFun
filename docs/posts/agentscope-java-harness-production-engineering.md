---
title: 深入理解 AgentScope 2.0 的 Harness：把"能跑的 Agent"变成"能上生产的 Agent"
date: 2026-08-27
category: AI
cover: /images/posts/agentscope-java-harness-production-engineering-knowledge-map.webp
tags:
  - AgentScope
  - Java
  - Harness
  - Agent
  - 多租户
  - 分布式
excerpt: AgentScope Java 2.0 的核心变化是把整套 Harness（工程化套件）内置进了框架。它站在 ReActAgent（推理内核）之上，把企业级分布式智能体必备的能力——上下文管理、持久记忆、Session、Sandbox、Skill、Subagent——统一封装成一套"开关式"能力，开发者可以按需启用。
top: true
---

# 深入理解 AgentScope 2.0 的 Harness：把“能跑的 Agent"变成“能上生产的 Agent”

<img src="/images/posts/agentscope-java-harness-production-engineering-knowledge-map.webp" alt="AgentScope 2.0 Harness 知识串联图：调用身份 / 运行状态 / 同一会话 / 沙箱隔离 / 跨机恢复" style="border-radius: 10px;" />

AgentScope Java 2.0 的核心变化，是把整套 **Harness**（工程化套件）内置进了框架。它站在 **ReActAgent**（推理内核）之上，把企业级分布式智能体必备的能力——上下文管理、持久记忆、Session、Sandbox、Skill、Subagent——统一封装成一套"开关式"能力。开发者可以继续用轻量的 ReAct 循环，也可以按需启用 Harness，把同一套 Agent 逻辑落地到生产环境。

经过 5 个 RC 版本迭代，2.0 GA 已正式发布：

- 文档：https://java.agentscope.io
- GitHub：https://github.com/agentscope-ai/agentscope-java
- Release Notes：https://github.com/agentscope-ai/agentscope-java/releases/tag/v2.0.0

> 本文根据刘军 2026-07 关于 AgentScope 2.0 的公开技术分享整理，并按笔记风格重写，原文图片引用全部保留。

下面先看 2.0 的整体定位，再逐层拆解 Harness 的核心设计与实战形态。

## 一、背景：2.0 生态全景、内核与迁移要点

### 1、AgentScope 生态全景

AgentScope 是一个框架（图中蓝色部分），已有 Python、Java、TypeScript 三语言实现，Go 实现在开发中。框架层定义 Agent 怎么开发、怎么定义——Agent Loop 循环、Reasoning、Tool Call、Model、Event/Message 传递都内置。

<img src="/images/posts/agentscope-java-harness-production-engineering/ecosystem-overview.webp" alt="AgentScope 2.0 生态全景：Python/Java/TypeScript 三语言实现 + 模型适配 + 观测 + Higress/Nacos 生态" style="border-radius: 10px;" />

向外延展的生态适配包括：模型侧支持 DeepSeek、OpenAI 兼容、Qwen；观测侧默认 **OpenTelemetry** 埋点，可上报 LangFuse / ARMS 等平台；Higress 做模型与 MCP 代理、Nacos 管理 Skill / MCP 市场；再往上是 QwenPaw、AgentTeams 等衍生产品。

### 2、ReActAgent 内核与核心组件

2.0 的底层推理循环不变，仍是 **ReAct Agent**（Reasoning + Acting）。核心能力稳定：Model、Tool 定义、Middleware（取代 1.0 的 Hook）、Permission（工具权限管控，1.0 没有）、以及上下文管理。

<img src="/images/posts/agentscope-java-harness-production-engineering/react-agent-core.webp" alt="ReActAgent 内核与核心组件：Reasoning、Tool Call、Middleware、Permission、Memory 与上下文管理" style="border-radius: 10px;" />

### 3、1.0 → 2.0 迁移要点

底层逻辑不变，但有三层迁移关注点：

- **兼容层（绿色）**：绝大多数能力保持兼容，废弃的 Hook 仍保留，可平滑升级。
- **必须改（中间）**：引入 **Agent State** 管理运行态（与 1.0 的 Session 数据格式有差异）；call / stream 入口新增 **Runtime Context**（须传 User、Session 等隔离信息）。
- **可逐步迁移（废弃内容）**：标记废弃的部分预计 2.1 移除，先迁到 2.0 再逐步清理。

<img src="/images/posts/agentscope-java-harness-production-engineering/migration-notes.webp" alt="1.0 → 2.0 迁移要点：兼容层 / 必须改 / 可逐步迁移 三色分层" style="border-radius: 10px;" />

## 二、Harness 是什么：在 ReAct 内核上的一层工程化封装

### 1、从 ReActAgent 内核说起

ReAct Agent 负责"怎么思考、怎么调工具"，但不负责"长期运行一个 Agent 要怎么管状态、管记忆、管多租户"。

### 2、Harness 层的定位：把生产必备能力内置

Harness 是构建在 AgentScope 底层推理执行组件之上的一层。可以理解为：在以前 1.0 的 ReAct Agent 之外，又包了一层"生产外壳"。

<img src="/images/posts/agentscope-java-harness-production-engineering/harness-layer-positioning.webp" alt="Harness 层定位：在 ReActAgent 之上包一层生产外壳" style="border-radius: 10px;" />

这层之上，把一个 Agent 长期运行必备的能力——上下文管理、上下文压缩、Agent 编排、Skill 运行、沙箱隔离执行、推理规划与任务状态跟踪、IM 消息系统对接、工具权限管控——统一作为一个 Harness 套件，在框架底层内置支持。开发者用开关或遵循 Harness 开发模式即可启用。

**重点在于**：Harness 不改变推理内核，只是把"工程化落地"这件事从业务代码里抽出来，变成框架能力。

## 三、快速上手：从 ReActAgent 到 HarnessAgent

### 1、加一层依赖

用 Harness 要先引入这一层的依赖。因为 Harness 是在内核之上新增的封装，单独的模块需要单独引入。

```xml
<dependency>
    <groupId>io.agentscope</groupId>
    <artifactId>agentscope-harness</artifactId>
    <version>${agentscope.version}</version>
</dependency>
```

### 2、入口切换：HarnessAgent

`ReActAgent` 的 API 入口仍然保留，但多了一个新入口叫 **HarnessAgent**。它底层还是用 ReAct Agent，但在 API 感知上可以直接以 Harness 模式构建 Agent。

<img src="/images/posts/agentscope-java-harness-production-engineering/harness-agent-entry.webp" alt="HarnessAgent 入口：在 ReActAgent 基础上多了 Workspace、压缩策略、Sandbox 隔离配置" style="border-radius: 10px;" />

对比两者的差异：前面部分一致——Name、System、Model；往下 `HarnessAgent` 多了 **Workspace** 的概念，可以指定 Workspace、压缩策略，以及 Sandbox 隔离配置等，都能在这一层直接用 API 配置。

<img src="/images/posts/agentscope-java-harness-production-engineering/react-vs-harness.webp" alt="ReActAgent 与 HarnessAgent API 对比：上层相同，下层 HarnessAgent 多出 Workspace / 压缩 / 沙箱" style="border-radius: 10px;" />

调用的区别在上下文：需要传入前面提到的 **Runtime Context**（运行时上下文），主要携带当前 User、Session 等多租户隔离信息。

```java
// HarnessAgent 构建与调用（API 形态以官方文档为准）
HarnessAgent agent = HarnessAgent.builder()
    .name("order-agent")
    .system("你是一个处理商城订单的助手")
    .model(chatModel)
    .workspace(workspace)          // Workspace：智能体的事实真相源
    .compressionPolicy(policy)     // 上下文压缩策略
    .sandboxConfig(sandboxConfig)  // 沙箱隔离配置
    .build();

RuntimeContext ctx = RuntimeContext.builder()
    .user("u_1001")                // 多租户隔离：User 维度
    .session("s_77")
    .build();

agent.call("帮我查一下昨天下的订单", ctx);
```

注意：上面 `RuntimeContext` 是 2.0 新增的必传概念，承载 User / Session 等隔离信息，也是多租户能力的基础。

## 四、Workspace：智能体进化的 Source of Truth

### 1、Workspace 里有什么

**Workspace**（工作空间）是现在主流 Agent 产品与框架的核心抽象，可以理解为一个逻辑概念。它沉淀的资产分两类：

- **静态资产**：Agent 定义相关，比如 `AGENTS.md`、Skills、Sub-Agent。这些是随镜像打包走的、业务侧定义好的内容。
- **运行时数据**：Agent 运行过程中自己产生的——实时 Session 状态、Task 任务状态、沉淀下来的 `MEMORY.md` 记忆等。

<img src="/images/posts/agentscope-java-harness-production-engineering/workspace-source-of-truth.webp" alt="Workspace 里有什么：左侧静态资产（AGENTS.md / Skills / Sub-Agent），右侧运行时数据（Session / Task / MEMORY.md）" style="border-radius: 10px;" />

所有静态或运行时的资产都沉淀在 Workspace 里，它是智能体"进化"的事实真相源（Source of Truth）。

### 2、抽象文件系统：Workspace 的物理载体

一个 Agent 有一个 Workspace，但会被很多用户使用。AgentScope 在同一个 Workspace 内做了逻辑上的多租户隔离——用户维度、Session 维度或 Agent 维度。

Workspace 是逻辑概念，物理存储呢？最直观是磁盘，但磁盘意味着绑定本机（On-premise 限制）。

为了解决这个问题——尤其面向企业级分布式场景——AgentScope 把 Workspace 上层逻辑往底层物理实现走时，抽象出一个接口，叫 **Abstract File System**（抽象文件系统）。Agent 操作 Workspace 时，物理层用的就是这个接口。

<img src="/images/posts/agentscope-java-harness-production-engineering/abstract-filesystem.webp" alt="Abstract File System：本地 On-premise / 树形文件系统 / 共享存储 / Sandbox 四种实现" style="border-radius: 10px;" />

框架为它提供三种默认实现，也可任意扩展：

- **本地 On-premise**：装在本机，直接操作磁盘。
- **树形文件系统**：用于用户隔离，树状结构。
- **共享存储**：生产环境多实例部署时，把抽象文件系统接到 MySQL、Redis 或阿里云 OSS，实现同一 Workspace 被不同 Agent 实例共享。
- **Sandbox**：对隔离要求更高时，一个 Workspace 映射一个 Sandbox，配合生命周期管理实现多租户隔离。

**重点在于**：抽象文件系统让 Workspace 脱离"单机磁盘"的限制，从而支撑分布式场景。

## 五、上下文压缩：四道防线守住窗口

Session 运行时，模型有上下文窗口限制。怎么保证上下文不超限？框架内置了几套压缩策略（图中只展示一部分，实际配置更多）：

- 工具执行结果超过阈值后，截取并落盘，只给文件引用路径。
- 工具入参过大时，做字数截断。
- 对过往消息压缩，保留最近几条。

<img src="/images/posts/agentscope-java-harness-production-engineering/context-compaction.webp" alt="上下文压缩三道防线：结果落盘、入参截断、历史压缩" style="border-radius: 10px;" />

压缩时**尽量不能丢信息**。哪些信息不能丢？

- 复杂任务的**规划**（可能在消息前几条），粗暴压缩会丢。
- 基于规划拉起的**子 Agent 异步任务状态**，任务可能还没返回，要持续追踪。

所以这类需要在全局更新的状态——规划详情、子 Agent 异步状态、清单、工具权限授权记录——都要保证不被压缩，做区别处理。

## 六、双层长期记忆：事实自动沉淀

压缩管的是瞬时状态，必然丢信息。这些信息可以沉淀为长期记忆。框架的策略是：在会话压缩前做一次 Flush 分拣。

- **第一层（每日流水账）**：记到每天专属文件里，结构和 QwenPaw 类似。
- **第二层（全局 MEMORY.md）**：后台任务定期扫描当天记忆，蒸馏为全局 `MEMORY.md`。它在每次请求进来时全局加载到 System Prompt，因此大小和数据的质量非常关键。

<img src="/images/posts/agentscope-java-harness-production-engineering/layered-memory.webp" alt="双层长期记忆：每日流水账 → 蒸馏为全局 MEMORY.md，每轮注入 System Prompt" style="border-radius: 10px;" />

配套的记忆管理工具：`Memory Search`、`Memory Get`、`Session Search`。模型根据 `MEMORY.md` 引导，在适当时候查流水账。上述所有环节（每日提取、定时蒸馏、压缩）的 Prompt 都可定制。

## 七、子智能体编排：主 Agent 拉起并管理子 Agent

Harness 里非常重要的一环是智能体编排。主 Agent 直接指导所有子 Agent：任务进来后，内置 `Agent Fork`、`Agent Spawn` 工具，主 Agent 按需拉起子 Agent。

<img src="/images/posts/agentscope-java-harness-production-engineering/subagent-orchestration.webp" alt="子智能体编排：主 Agent 通过 Agent Fork / Agent Spawn 拉起同步、异步、远程三类子 Agent" style="border-radius: 10px;" />

子 Agent 的类型：

- **同步子 Agent**：等结果返回再继续。
- **异步子 Agent**：适合耗时长的任务，完成后主动把结果通知回主 Agent。
- **远程子 Agent**：拉起远端子 Agent。

主 Agent 配套一个 **Task List** Toolkit，覆盖所有管理工具，可主动查看有哪些子 Agent、各自处于什么状态。

一个企业常见诉求：用户想直接切到某个子 Agent 和它对话（类似 Claude Code 的体验）。AgentScope 支持把子 Agent 暴露出来，让使用者直接对话。

细节上还处理了：主/子 Agent 上下文是否共享、子 Agent 事件如何透传并标记归属、子 Agent 权限是否继承主 Agent——这些框架里都有机制。

## 八、沙箱管理：隔离、恢复与分布式

沙箱主要解决 Agent **工具执行的安全问题**。框架提供一套沙箱生命周期管理系统，把工具执行放进沙箱里隔离运行，支持隔离、恢复与分布式场景。具体机制可查阅官方文档。

<img src="/images/posts/agentscope-java-harness-production-engineering/sandbox-management.webp" alt="沙箱管理：隔离执行 + 快照恢复 + 分布式生命周期" style="border-radius: 10px;" />

## 九、Skills：四层注册中心与沙箱内执行

Skill 分两部分：

- **管理**：对接类似 **Nacos** 的中心化 Skill 管理系统，自动把中心化管理的 Skill 加载到本地识别使用。同时基于 Workspace 的细粒度隔离，可实现不同用户间 Skill 隔离——各自拥有各自的 Skill，互不可见。
- **执行**：Skill 有时带脚本和资源文件，受安全管控。框架支持把整个 Skill 投影到 Sandbox，让所有脚本在 Sandbox 内闭环执行。

<img src="/images/posts/agentscope-java-harness-production-engineering/skills-registry.webp" alt="Skills：Nacos 中心化注册 + Workspace 用户级隔离 + 投影进 Sandbox 闭环执行" style="border-radius: 10px;" />

## 十、计划模式：想清楚 → 写下来 → 再动手

Harness 支持**计划模式**（Plan Mode）。1.0 的 Plan 偏向内部管理状态机；2.0 内置了一整套 Plan 工具，如 `PlanEnter`、`PlanExit`。

<img src="/images/posts/agentscope-java-harness-production-engineering/plan-mode.webp" alt="计划模式：进入只读规划 → 写 Plan 文件 → 确认后切回执行模式" style="border-radius: 10px;" />

请求进来可直接开启 Plan；熟悉 Coding Agent 的话，可理解为和 Codex / Claude Code 的 Plan 模式一致——开启后回答问题会先生成 Plan，再切回 Agent 模式基于 Plan 执行。也可让它自主识别进入 Plan。因每个工具都有 Permission，切 Plan 时可能先询问；执行完切回 Agent 模式时也会弹出确认。整条流程可在前端 UI 串起来。

## 十一、Channel：消息平台 → Gateway → Agent

企业业务里常需把后台任务和企业内即时通讯系统对接。框架原生支持 Channel 对接：消息平台经 Gateway 路由到 Agent。

<img src="/images/posts/agentscope-java-harness-production-engineering/channel-gateway.webp" alt="Channel：消息平台经 Gateway 路由到 HarnessAgent，流式事件或后台结果回传" style="border-radius: 10px;" />

## 十二、企业级实战示例

官方仓库给出多个示例，全部基于 Harness 构建。

### 1、个人助手：直连本机 FS 与 Shell

一个类 QwenPaw 的简化产品，验证"如何用 AgentScope 开发个人助手"。Workspace 模式完全绑定本地磁盘，**不支持分布式部署**。

<img src="/images/posts/agentscope-java-harness-production-engineering/example-personal-assistant.webp" alt="个人助手示例：Workspace 直连本机文件系统 + Shell，单机运行" style="border-radius: 10px;" />

### 2、多租户 Managed Agent 平台

一个零代码开发的 Agent 平台（Agent Builder）：公司内集中部署，每人可创建 Agent，管理员可建共享 Agent 给全员用。底层靠 Workspace 与物理 File System 分组实现多租户隔离，每人数据隔离。这是 Claude Managed Agents、Langchain Managed Agents、Qoder Cloud Agents 的原型，用 2.0 可快速搭出。

<img src="/images/posts/agentscope-java-harness-production-engineering/example-managed-agent-platform.webp" alt="多租户 Managed Agent 平台：用户分组 + Workspace 隔离 + 共享 Agent" style="border-radius: 10px;" />

### 3、数据 Agent 平台：per-用户进化 + 审批式能力市场

多租户场景。每个用户有隔离的数据空间，可拥有自己的 Skill；不同用户沉淀的 Skill 走审批机制——申请共享、审批通过后全员可用。

<img src="/images/posts/agentscope-java-harness-production-engineering/example-data-agent-platform.webp" alt="数据 Agent 平台：per-用户数据空间 + 私有 Skill + 审批式共享" style="border-radius: 10px;" />

### 4、自主编码机器人：Thread 路由 + 一次性 Docker 容器

企业级共享 Coding Agent，对接 GitLab：处理 Issue / PR Review 的请求都被该服务接收。每个用户的运行环境隔离——自动拉起 Sandbox 专门服务，Issue 与 PR 状态连续且互不干扰。也可作为 CI/CD 平台，用 AI 驱动研发协作。

<img src="/images/posts/agentscope-java-harness-production-engineering/example-autonomous-coding-bot.webp" alt="自主编码机器人：Webhook → Thread 路由 → 一次性 Docker Sandbox → 结果回传" style="border-radius: 10px;" />

## 总结

### 要点回顾

- **Harness 是 ReAct 内核之上的工程化层**：内置上下文管理、压缩、编排、Skill、Sandbox、记忆、Channel、权限等生产能力。
- **Workspace 是事实真相源**：静态资产 + 运行时数据，靠抽象文件系统对接磁盘 / 共享存储 / Sandbox，支撑分布式。
- **上下文压缩有四道防线**：结果落盘、入参截断、历史压缩，且全局状态（规划 / 异步子 Agent 状态 / 授权记录）不压缩。
- **双层记忆**：每日流水账 → 蒸馏为全局 MEMORY.md，配套 Search 工具。
- **子 Agent 编排**：同步 / 异步 / 远程三类，Task List 跟踪，可暴露给使用者直接对话。
- **多租户靠 RuntimeContext + Workspace 隔离**：User / Session 维度隔离，是 1.0→2.0 的核心破坏性变更之一。

### 一句话结论

**AgentScope 2.0 的 Harness，把"长期运行一个生产级 Agent"所需的状态、记忆、隔离、编排、权限等脏活，从业务代码里抽出来变成了框架开关。**

### 关联知识点

- **ReAct Agent**：Harness 之下的推理内核，理解它才能看清 Harness 在哪个层次加东西。
- **Agent State / Runtime Context**：2.0 引入的状态管理与多租户上下文，是迁移时要改的重点。
- **MCP / Nacos**：Skill 与 MCP 市场的中心化注册，是 Harness 生态对接的一环。
- **OpenTelemetry**：框架默认埋点，观测数据可上报 LangFuse / ARMS 等平台。
- **QwenPaw / AgentTeams**：基于 AgentScope 框架衍生的具体产品，可对照理解 Workspace 与记忆设计。

### 面试常问

- **问：AgentScope 2.0 相比 1.0 最大的破坏性变更是什么？** 引入 Agent State 与 RuntimeContext，call / stream 入口须传运行时上下文；Hook 被 Middleware 替代（废弃但保留）。
- **问：Workspace 怎么支撑分布式？** 通过 Abstract File System 抽象，把物理存储接到 MySQL / Redis / OSS 等共享存储，多实例看到同一 Workspace。
- **问：上下文压缩为什么不能丢规划？** 复杂任务规划常在消息前几条，粗暴压缩会丢失；规划、异步子 Agent 状态、授权记录等全局状态需区别保护。
- **问：子 Agent 有哪几种类型？** 同步、异步（完成主动通知主 Agent）、远程三种。

### 参考资料

- [AgentScope 2.0 技术分享原文](https://java.agentscope.io/v2/zh/blogs/agentscope-v2-explained.html)
- [AgentScope Java 官方文档](https://java.agentscope.io)
- [GitHub 仓库](https://github.com/agentscope-ai/agentscope-java)
- [Release Notes v2.0.0](https://github.com/agentscope-ai/agentscope-java/releases/tag/v2.0.0)

> 图片均引用自原文，原图托管于 `workbuddy-space-static.codebuddy.work`，已按需求转存至本地 `docs/public/images/posts/agentscope-java-harness-production-engineering/` 目录，避免部署环境外链失效。
