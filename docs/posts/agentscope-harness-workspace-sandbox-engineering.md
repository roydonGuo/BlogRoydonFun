---
title: AgentScope Harness v1 详解：把 OpenClaw 的持续进化装进企业级安全边界
date: 2026-08-27
category: AI
cover: /images/posts/agentscope-harness-workspace-sandbox-engineering-knowledge-map.webp
tags:
  - AgentScope
  - Agent
  - Java
  - Harness
  - OpenClaw
  - Sandbox
excerpt: 过去一年 OpenClaw、Hermes、Claude Code 把 Harness Engineering 带到台前，但把这套思路搬进企业级智能体开发时，问题才刚开始。AgentScope Java 1.1 给出 Harness Framework：在 ReActAgent 关键时机插入 Hook，把工作区、文件系统、记忆、子 Agent 和沙箱的工程答案打包进框架。
---

# AgentScope Harness v1 详解：把 OpenClaw 的持续进化装进企业级安全边界

<img src="/images/posts/agentscope-harness-workspace-sandbox-engineering-knowledge-map.webp" alt="AgentScope Harness v1 知识串联图" style="border-radius: 10px;" />

过去一年，OpenClaw、Hermes、Claude Code 等产品把 **Harness Engineering**（工作区驱动的智能体工程）带到了台前。结构化工作区、上下文管理和工具约定，正在替代"每次对话各自为战"的原始用法。

但把这套思路搬进企业级智能体开发时，问题才刚刚开始：多租户怎么隔离、命令执行怎么安全、多副本状态怎么同步、长对话上下文怎么不爆、子任务怎么编排。

AgentScope Java 1.1 给出的答案是 **Harness Framework**。它不替换 `ReActAgent` 的推理循环，而是在循环关键时机插入 Hook，补齐工作区、文件系统、记忆、子 Agent 和沙箱的一组约定，让同一套 Agent 逻辑既能跑在本机当个人助手，也能直接切到分布式、多租户、隔离执行的企业场景。

> **一句话结论**：Harness 是把"下一轮怎么办、下一天怎么办、上下文爆了怎么办、状态丢了怎么办"的工程答案打包进框架，而不是让每个项目自己从零发明一遍。

## 一、OpenClaw/Hermes 很好，但在企业级场景用不起来？

### 1、个人助手和企业级 Agent 是两种工程形态

个人助手单用户、单进程，状态可以全部放在本机；企业级 Agent 要水平扩容、多租户、服务不中断，状态必须能分布式存储和恢复。

从几个维度看，两者的要求完全不同：

| 维度 | 个人助手 | 企业级 Agent |
| --- | --- | --- |
| 部署形态 | 单用户单进程 | 水平扩容、多副本 |
| 安全边界 | 本机执行无风险 | 任意 Shell 执行都是攻击面 |
| 可观测性 | 自己看日志 | 记忆落盘、会话可审计、状态变更可追踪 |
| Token 经济 | 对延迟和费用不敏感 | 每次无效上下文重推都是成本 |

**关键判断**：用同一套假设去应对两种场景必然碰壁。

### 2、企业落地最常见的五个障碍

来自一线开发者的反馈，大致可以收敛成五个问题：

1. **多用户、多副本，工作区怎么办？** 本地目录假设在分布式场景下直接崩掉。
2. **Tool 和 Skill Script 不能在宿主机上跑，怎么隔离执行？** 沙箱不是可选项，是上线前提。
3. **"workspace + 文件系统"怎么搬到分布式环境？** OSS、KV、对象存储接口各异，重写一遍等于把 Agent 逻辑和基础设施耦合死。
4. **Multi-Agent 怎么做才对？** 子任务分发、上下文隔离、异步执行、结果回收、超时取消要拼成可管理的编排层。
5. **上下文压缩和分层记忆有没有开箱即用的实现？** 多数框架只给抽象接口，具体实现还是要自己写。

AgentScope Harness 就是围绕这五个问题设计的。它用 **Workspace + AbstractFilesystem + Hook 管线**，把工程答案打包成可配置项。

## 二、Harness 设计理念：两个核心支柱

### 1、Workspace 作为唯一事实来源

Harness 为每个 Agent 引入 **workspace（工作区）** —— 一个结构化目录，承载 Agent 运行所需的一切持久化内容：人格定义（`AGENTS.md`）、长期记忆（`MEMORY.md`）、领域知识（`knowledge/`）、可复用技能（`skills/`）、子 Agent 规格（`subagents/`）以及会话历史（`agents/<agentId>/`）。

工作区不是临时存储，而是 Agent 的"大脑外化"：所有状态的读写都围绕工作区展开，而不是散落在代码、数据库和内存里。

运行流程大致如下：

- 每次推理开始前，`WorkspaceContextHook` 把 `AGENTS.md`、`MEMORY.md`、`knowledge/` 等关键文件注入 system prompt。
- 推理结束后，`MemoryFlushHook` 从当次对话中提炼新事实写入记忆流水账。
- 后台 `MemoryConsolidator` 周期性合并、去重、精炼，输出到 `MEMORY.md`。

<img src="/images/posts/agentscope-harness-workspace-sandbox-engineering/workspace-as-source-of-truth.webp" alt="Workspace 作为 Source of Truth，左右两侧分别是持续演化机制和运行时上下文层" style="border-radius: 10px;" />

**上图要点**：工作区是 Source of Truth；左侧负责"持续演化"（记忆提取、会话压缩、技能沉淀），右侧负责"运行时上下文注入"（会话上下文、记忆召回、上下文控制）。

**为什么这比把 prompt 写死在代码里更好**：人格、知识、技能、子 Agent 规格都在文件里，调整行为只需改文件，不需要重新编译部署。

### 2、AbstractFilesystem 让工作区可以运行在任何环境

工作区很美，但现实约束是：本地磁盘在分布式场景下行不通。多个 Pod 各有一块本地磁盘，`MEMORY.md` 写到哪里？哪个副本的版本才是"真"的？

AgentScope Harness 用 **AbstractFilesystem（抽象文件系统）** 解决这个问题。对上层 Agent 来说，只有统一的 `read/write/ls/grep` 等接口；对下层来说，可以适配本地磁盘、远端对象存储（OSS）、KV 数据库（Redis）、沙箱文件系统等任意介质，还能通过 `CompositeFilesystem` 把不同路径路由到不同后端。

<img src="/images/posts/agentscope-harness-workspace-sandbox-engineering/abstract-filesystem-inheritance.webp" alt="AbstractFilesystem 继承图：四种实现 LocalFilesystemWithShell、CompositeFilesystem、LocalFilesystem、RemoteFilesystem、SandboxFilesystem" style="border-radius: 10px;" />

**上图要点**：三种拓展实现对应三种使用模式：

- **LocalFilesystemWithShell**：本机目录 + Shell 执行，适合个人开发/本地应用。
- **CompositeFilesystem**：把不同路径映射到不同后端（例如本地放代码，远端放记忆），灵活度最高。
- **SandboxFilesystem**：文件读写和命令执行都在隔离沙箱内完成。

<img src="/images/posts/agentscope-harness-workspace-sandbox-engineering/workspace-based-on-abstract-filesystem.webp" alt="FilesystemTool、ShellExecuteTool、Memory 三大模块统一以 Workspace Based on AbstractFilesystem 为入口" style="border-radius: 10px;" />

**上图要点**：文件系统之上，`FilesystemTool`、`ShellExecuteTool`、`Memory` 三大模块统一以 Workspace 为入口，Agent 不直接触碰物理存储。

基于这一层抽象，Harness 给企业级智能体开发带来三大能力：

- **安全与隔离**：Shell/Code/Skill 通过沙箱后端隔离；`execute` 工具只在本机或沙箱模式下暴露。
- **分布式部署**：关键文件路由到远端共享存储，多副本读到同一份状态。
- **Subagent 与异步任务**：子 Agent 的工作区、文件系统、会话状态可继承或独立配置，异步任务状态机开箱即用。

## 三、三种典型使用场景

Harness 不是"非此即彼"的选型，而是从简单到复杂的三条路径。

### 1、个人代理 Agent —— 典型如 OpenClaw 类应用

特点：单用户、本机运行、操作本地文件或脚本。

Harness 在这里的价值是"让 Agent 真正了解我、记住我"：

- **持续记忆**：对话结束后自动提炼事实写入工作区，下次启动无需重新告知背景。
- **本地 Shell 执行**：在可信本机环境下直接运行脚本、操作文件。
- **工作区即配置**：改 `AGENTS.md` 调人格，在 `skills/` 里加技能，不需要重新编译部署。
- **会话跨进程恢复**：只要 `sessionId` 不变，关闭再打开状态全部还原。

### 2、企业级数据服务 —— 典型如 DataAgent

特点：服务多用户、执行 SQL/Python/Shell、任务耗时较长、输入不可信。

这类场景最大的风险是执行安全：

- **隔离沙箱执行**：命令在隔离环境内运行，宿主服务进程不受影响。
- **多轮沙箱状态恢复**：每轮结束后保存沙箱状态，下轮或重启后原位恢复。
- **分布式记忆共享**：长期记忆放在共享存储，多节点读到同一份"对用户的了解"。
- **子 Agent 并行编排**：长任务拆给多个子 Agent 并发执行，主 Agent 只协调和汇总。
- **多租户隔离**：按会话或用户维度隔离工作区与执行环境。

### 3、企业在线服务 —— 典型如交易/客服 Agent

特点：主要调用业务 API，不执行 Shell，但需要多实例运行、会话状态可持久、跨用户知识共享。

这类场景核心是稳定与安全：

- **默认安全边界**：不配置沙箱时，框架不暴露 Shell 工具，Agent 只能通过业务工具交互。
- **多实例共享记忆**：用户记忆落到远端存储，任意实例读到同一份上下文。
- **会话跨请求连续**：每次请求带相同用户标识，Agent 自动恢复上次对话状态。
- **并行子任务支持**：同时查库存、计算优惠、生成摘要等子任务可委派给子 Agent 并行执行。

## 四、Harness 详解：从快速开始到底层机制

### 1、Quick Start：三步上手

**第一步：引入依赖**

```xml
<dependency>
    <groupId>io.agentscope</groupId>
    <artifactId>agentscope-harness</artifactId>
    <version>${agentscope.version}</version>
</dependency>
```

**第二步：准备工作区**

在磁盘上选一个目录作为 `workspace`，并在其中创建 `AGENTS.md`。这是 Harness 的核心入口：人格、记忆、技能、子 Agent 规格全部围绕这个目录展开。

**第三步：构建 HarnessAgent 并调用**

```java
HarnessAgent agent = HarnessAgent.builder()
    .name("my-agent")
    .model(model)
    .workspace(Paths.get(".agentscope/workspace"))
    .compaction(CompactionConfig.builder()
        .triggerMessages(50)
        .keepMessages(20)
        .build())
    .build();

RuntimeContext ctx = RuntimeContext.builder()
    .sessionId("user-session-001")
    .userId("alice")
    .build();

Msg reply = agent.call(userMessage, ctx).block();
```

**关键配置点**：

- `sessionId` 相同则自动续接上下文；
- 多用户场景必须传 `userId`，用于命名空间隔离；
- `CompactionConfig` 建议一开始就配，避免线上 context overflow。

运行后检查工作区：如果 `AGENTS.md`、`memory/`、`agents/<agentId>/` 都存在，说明 Agent 已经在正常写入记忆和持久化会话状态。

### 2、核心概念总览

掌握下面六个概念，就基本掌握了 Harness 的运行逻辑。

| 概念 | 定义 | 解决的问题 |
| --- | --- | --- |
| **HarnessAgent（Harness 智能体入口）** | 基于 `ReActAgent` 的工程化封装入口，构建时自动装配 Hook、内置工具、技能与会话持久化 | 不想从零拼装压缩、记忆、会话、子任务、文件系统 |
| **workspace（工作区）** | Agent 的工作目录，承载 `AGENTS.md`、`MEMORY.md`、`skills/`、`subagents/`、会话历史等全部持久化内容 | 人格、知识、记忆、状态放哪、如何持续演化 |
| **filesystem（文件系统抽象）** | 文件读写的统一接口，是工具层与物理存储之间的抽象层 | 同一套逻辑如何在本地、共享存储、沙箱间切换 |
| **RuntimeContext（运行时上下文）** | 单次 `call()` 的身份上下文，含 `sessionId`、`userId` | 这一轮是谁、状态读写到哪、多租户如何隔离 |
| **sandbox（沙箱）** | 隔离执行环境，命令在沙箱侧运行，每轮结束后持久化状态 | 不可信输入下如何安全执行并保持多轮状态连续 |
| **memory（记忆）** | 双层记忆系统：自动提炼新事实 + 周期性合并成可注入的长期记忆 | 长对话不丢事实、上下文不爆、历史可检索 |

**总纲**：`HarnessAgent` 负责编排，`workspace` 负责沉淀，`filesystem` 负责落点，`RuntimeContext` 负责身份，`sandbox` 负责边界，`memory` 负责长期演化。

### 3、Workspace 目录结构

一个标准工作区长这样：

```
workspace/
├── AGENTS.md              ← Agent 人格与行为约定
├── MEMORY.md              ← 精炼的长期记忆
├── knowledge/             ← 领域知识
├── skills/                ← 可复用技能
├── subagents/             ← 子 Agent 规格声明
└── agents/<agentId>/
    ├── context/           ← 会话状态快照（进程重启后恢复）
    ├── sessions/          ← 对话 JSONL 与压缩上下文
    └── memory/            ← 每日记忆流水账
```

**工作区在每次推理中如何工作**：

- 推理前：把 `AGENTS.md`、`MEMORY.md`、`knowledge/` 拼入 system prompt。
- 推理后：把新事实追加到当日记忆流水账。
- 工作区随每次对话持续演化，Agent 随时间变得"更了解"业务和用户。

### 4、会话持久化：跨请求、跨进程的状态连续

Harness 把会话落盘分成两条并行路径：

- **状态快照（`context/`）**：每次 `call()` 结束后，Agent 运行状态序列化为 JSON 文件。下次用相同 `sessionId` 调用时，框架自动加载快照，恢复到上次结束位置。
- **对话日志（`sessions/`）**：完整对话历史以 JSONL 追加写入，供审计和 `session_search` 使用；另有一份压缩后的 JSONL 是模型实际"看到"的上下文。

**开发者唯一要做的事**：每次调用时稳定传入相同的 `sessionId`。

### 5、记忆管理：从对话到长期知识的自动沉淀

很多 Agent 框架的"记忆"只是把历史消息堆进上下文，迟早撑爆。Harness 的做法是 **双层分离**：

**第一层——每日流水账**：每次对话结束后，框架用 LLM 提炼"新增事实"，追加到 `memory/YYYY-MM-DD.md`。这一层只追加、不修改，保证新事实不丢失。

**第二层——长期记忆**：后台调度器周期性读取近期流水账，与 `MEMORY.md` 合并、去重、精炼，输出 Token 预算内的"可注入版"。

两层关系：第一层保证 **不丢**，第二层保证 **可用**。

**对话压缩**是另一面：当消息数或 Token 数超过阈值，Harness 用 LLM 把之前的对话压缩成摘要，保留最近若干条，其余卸载到 JSONL。如果模型返回 context overflow，框架会捕获异常、强制压缩、自动重试，整个过程对调用方透明。

```java
.compaction(CompactionConfig.builder()
    .triggerMessages(50)    // 消息数超过 50 触发压缩
    .keepMessages(20)       // 保留最近 20 条
    .flushBeforeCompact(true)
    .build())
```

### 6、子 Agent 编排：复杂任务的分解与委派

当主 Agent 遇到耗时长、上下文重或可并行的子任务时，可以委派给子 Agent。

**子 Agent 声明方式**（灵活度由低到高）：

1. **内置 `general-purpose` Agent**：镜像主 Agent 配置，适合临时委派。
2. **工作区文件驱动**：在 `subagents/` 下放置 Markdown 文件（YAML front matter 定义名称、描述、工具；body 是 system prompt），框架自动发现加载。
3. **代码声明**：用 `builder.subagent(spec)` 编程式指定。
4. **自定义工厂**：完全控制子 Agent 构建逻辑。

**调用方式**：

- **同步调用**：主 Agent 阻塞等待，适合必须拿到结果才能下一步的场景。
- **异步调用**：提交任务后立即拿到任务 ID，可用 `task_output` 轮询结果。耗时任务强烈建议异步。

**防无限递归**：子 Agent 默认是叶子形态，框架也有最大深度兜底。

### 7、内置工具：一套覆盖闭环的工具集

`HarnessAgent` 构建时会自动注册以下工具：

| 工具类别 | 工具列表 |
| --- | --- |
| 文件操作 | `read_file`、`write_file`、`edit_file`、`grep_files`、`glob_files`、`list_files` |
| 记忆检索 | `memory_search`、`memory_get` |
| 会话查询 | `session_search`、`session_list`、`session_history` |
| 子任务管理 | `agent_spawn`、`agent_send`、`agent_list`、`task_output`、`task_list`、`task_cancel` |
| Shell 执行 | `execute`（仅在本机或沙箱模式下注册） |

**注意**：在"远端共享存储"模式下，框架**默认不注册** `execute` 工具。这是有意设计：如果你的 Agent 不需要执行命令，用这个模式可以消除一整类执行安全风险。

### 8、文件系统三种模式：按需选型

| 模式 | 配置方式 | 适用场景 |
| --- | --- | --- |
| 本机 + Shell（默认） | `new LocalFilesystemSpec()` | 个人本机应用、开发测试 |
| 远端共享存储 | `new RemoteFilesystemSpec(store)` | 多副本在线服务、跨节点共享记忆 |
| 沙箱执行 | `sandboxSpec` | 执行不可信代码、DataAgent、Coding Agent |

三种模式的核心区别是：**谁来执行命令、数据落在哪、隔离粒度是多少**。同一套 Agent 代码，切换 `filesystem` 配置就能迁移。

### 9、沙箱：隔离执行 + 状态可恢复

沙箱模式解决的不只是"隔离执行"，更是"多轮对话中隔离环境的连续性"。

- **执行边界**：命令和文件操作发生在沙箱侧，宿主进程只协调。
- **状态可恢复**：每次 `call()` 结束，沙箱状态被持久化为快照；下次调用按 `sessionId` 或 `userId` 恢复。
- **工作区投影**：`AGENTS.md`、`skills/`、`subagents/`、`knowledge/` 等宿主内容会在每次调用开始时同步到沙箱。
- **隔离粒度**：SESSION / USER / AGENT / GLOBAL 可选，按需切分。

**关键结论**：沙箱不是"用完即毁"的一次性容器，而是能在多轮对话间保持工作现场的持久化执行环境。

## 五、总结

### 1、要点回顾

- Harness 不是新推理框架，而是在 `ReActAgent` 关键时机插入 Hook 的工程化封装。
- **Workspace** 是唯一事实来源，Agent 的人格、知识、技能、记忆、子 Agent 规格全部沉淀在结构化目录里。
- **AbstractFilesystem** 让同一套 Agent 逻辑在本机、远端共享存储、沙箱之间切换，只改配置不改代码。
- **双层记忆**（流水账 + 长期记忆）和**对话压缩**保证长对话不爆上下文、新事实不丢。
- **子 Agent 编排**支持同步/异步委派，复杂任务可拆解并行执行。
- **沙箱**提供隔离执行 + 多轮状态恢复，是企业级 Agent 上线的安全前提。

### 2、一句话结论

**AgentScope Harness v1 把 OpenClaw 式的"持续进化"体验，装进了一套可配置、可分布式、可隔离的企业级边界里。**

<img src="/images/posts/agentscope-harness-workspace-sandbox-engineering/harness-end-to-end-overview.webp" alt="Harness 端到端总览：AbstractFilesystem 继承关系 + 三大模块基于 Workspace + Agent 与 Sandbox 通过 Snapshot State 同步" style="border-radius: 10px;" />

**上图要点**：Harness 把抽象文件系统、工具与记忆接入、Agent 端工作区、沙箱端工作区和 Snapshot State 这几层串成端到端视图，是上面所有章节的一张速查地图。

### 3、关联知识点

- **ReAct Agent**：Harness 的推理基础，理解 Hook 插入时机需要先理解 ReAct 循环。
- **LLM 上下文压缩**：长对话场景的通用优化，Harness 把它做成了自动管线。
- **沙箱与容器隔离**：Kata、gVisor、Docker 等技术与 Harness 沙箱后端的结合点。
- **多租户数据隔离**：SESSION / USER / AGENT / GLOBAL 的隔离粒度设计。
- **Multi-Agent 系统**：子 Agent 委派、任务状态机、结果回收的通用模式。

### 4、参考资料

- [AgentScope Harness v1 官方原文](https://java.agentscope.io/v1/zh/blogs/agentscope-v1-harness.html)
- [AgentScope 官方文档 - Harness 概览](https://java.agentscope.io/v1/zh/blogs/agentscope-v1-harness.html#../overview.md)
- [AgentScope 官方文档 - Filesystem](https://java.agentscope.io/v1/zh/blogs/agentscope-v1-harness.html#../filesystem.md)
