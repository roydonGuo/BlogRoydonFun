---
title: Pi Agent 框架详细解读：最小内核、Agent Loop 与扩展体系
date: 2026-08-24
category: AI
cover: /images/posts/pi-agent-harness-engineering-knowledge-map.webp
tags: [ai, agent, pi, coding-agent, agent-loop, llm]
excerpt: Pi 不是功能缩水的 Claude Code，而是一套模型中立、最小化且可编程的 Agent Harness。本文拆解它的五层包结构、工具循环、会话树、扩展机制与安全边界，并与 Claude Code、Codex 做工程选型比较。
---

# Pi Agent 框架详细解读：最小内核、Agent Loop 与扩展体系

<img src="/images/posts/pi-agent-harness-engineering-knowledge-map.webp" alt="Pi Agent 框架详细解读：最小内核、Agent Loop 与扩展体系知识串联图" style="border-radius: 10px;" />

Pi 不是功能缩水的 Claude Code，而是一套模型中立、最小化且可编程的 Agent Harness。本文拆解它的五层包结构、工具循环、会话树、扩展机制与安全边界，并与 Claude Code、Codex 做工程选型比较。

## 先说结论：Pi 更像 Agent 底盘，不是全家桶产品

Pi 提供一个能直接工作的终端编码 Agent，同时把核心能力拆成可独立复用的包。它负责模型接入、消息循环、工具执行、会话持久化和终端交互，但刻意不把 MCP、子代理、计划模式、待办列表和权限弹窗固化进内核。这些能力由扩展、技能、包或外部沙箱补充。

因此，评价 Pi 不能只数默认功能。它真正的价值是三个边界足够清楚：

- 模型层统一不同供应商的流式响应、工具调用和推理参数；
- Agent Loop 只管理状态、消息、工具结果和停止条件；
- 产品工作流通过 TypeScript 扩展组装，不必修改核心源码。

这带来高度可塑性，也把更多工程责任交给使用者。需要开箱即用的权限治理、多代理协作和完整产品界面时，Claude Code 或 Codex 通常更省事；需要自建 Agent Harness、接入多模型或试验新工作流时，Pi 更直接。

> 项目原仓库 `badlogic/pi-mono` 现已迁移到 [`earendil-works/pi`](https://github.com/earendil-works/pi)，npm 包名也使用 `@earendil-works/*`。本文基于 [Pi 官方文档](https://pi.dev/docs)及仓库 README 核对，核对日期为 2026-08-24；旧文章中的 `@mariozechner/*` 示例不应直接照搬。

## 一、Pi 的五层结构

Pi monorepo 不是一个大而全的 CLI，而是五个职责递进的包：

| 包 | 负责什么 | 不负责什么 |
|---|---|---|
| `pi-ai` | 模型、供应商、流式输出、工具调用和推理能力的统一接口 | 不决定任务如何循环 |
| `pi-agent-core` | Agent 状态、消息管线、工具执行、事件和转向队列 | 不提供文件编辑产品界面 |
| `pi-tui` | 终端组件与增量渲染 | 不理解模型和工具语义 |
| `pi-coding-agent` | CLI、内置编码工具、会话、压缩、资源加载与扩展宿主 | 不强制一种开发流程 |
| `pi-telemetry` | 记录 Agent 运行中的遥测事件 | 不替代业务审计与权限控制 |

调用关系可以简化为：

```text
用户 / SDK / RPC
       ↓
pi-coding-agent：会话、工具、扩展、CLI
       ├── pi-tui：终端交互
       └── pi-agent-core：状态与 Agent Loop
                    ↓
                 pi-ai：统一模型接口
                    ↓
       OpenAI / Anthropic / Google / 本地或自定义供应商
```

这种拆分允许三种使用方式：直接运行 `pi`；通过 SDK 嵌入现有应用；只取 `pi-ai` 或 `pi-agent-core`，构建自己的 Agent 产品。

## 二、`pi-ai`：先抹平模型差异

一个可移植 Agent 不能把业务循环绑定到某家模型的响应格式。不同供应商在流式事件、工具调用、推理开关、结束原因、认证方式上都有差异。`pi-ai` 将这些差异收敛成统一的模型与消息接口，再把标准事件交给上层。

Pi 当前内置多种供应商适配，也允许注册自定义供应商和模型。这里的“模型中立”不表示所有模型能力完全相同，而是让 Agent Loop 不必为每个供应商重写一遍。切换模型时仍要核对三个问题：

1. 模型是否稳定支持工具调用；
2. 上下文、推理与多模态能力是否满足任务；
3. 认证、限流和数据边界是否符合部署要求。

Pi 还支持在不同供应商之间交接会话。真正困难的不是把消息数组传过去，而是处理供应商专属的推理内容、工具调用标识和能力差异；这些适配正是模型抽象层应该承担的工作。

## 三、`pi-agent-core`：Agent Loop 如何转起来

Pi 的核心循环可以概括为“模型提出动作，运行时执行并回填观察，直到模型结束或运行时中止”。官方实现暴露了消息转换、工具钩子、事件流、取消、转向消息和后续消息等控制点。

```text
AgentMessage[]
   ↓ transformContext：裁剪、补充或重排上下文
   ↓ convertToLlm：转换为模型能够接收的消息
模型流式响应
   ├── 普通文本 → 继续输出
   └── 工具调用 → Schema 校验
                       ↓
                 beforeToolCall
                       ↓
             并行或顺序执行工具
                       ↓
                  afterToolCall
                       ↓
              工具结果写回消息历史
                       └── 再进入下一轮模型调用
```

### 工具不是函数列表，而是受控执行契约

一个工具至少包含名称、描述、参数 Schema 和执行函数。参数 Schema 约束模型能提出什么请求，执行函数决定真实副作用，流式更新则把长任务进度反馈给界面。

Pi 默认可用的编码工具包括 `read`、`bash`、`edit`、`write`、`grep`、`find` 和 `ls`。CLI 可以限制暴露给模型的工具，但这只是能力收窄，不等于操作系统级沙箱：扩展代码和已允许的 shell 命令仍可能访问进程权限范围内的资源。

工具循环需要重点处理四类结果：

- 成功：将短而明确的观察写回上下文；
- 可恢复失败：返回结构化错误，让模型调整参数或换工具；
- 不可恢复失败：中止当前运行，保留会话和诊断信息；
- 取消：通过 `AbortSignal` 终止模型流和长时间工具调用。

默认情况下，Pi 可以并行执行同一轮的多个工具调用，也允许配置为顺序执行或按工具指定策略。只有相互独立的读取适合并行；写文件、执行迁移、修改 Git 状态等有顺序依赖的动作应串行化。

### 转向消息与后续消息

用户在 Agent 工作时补充一句话，有两种不同语义：

- steering：尽快改变当前方向，在工具执行后注入下一轮；
- follow-up：不打断当前目标，等本轮完成后再处理。

把两者分开很重要。如果所有新消息都立即插入，Agent 容易在工具结果尚未归档时改变目标；如果全部排到最后，用户又无法及时阻止错误方向。

## 四、`pi-coding-agent`：把核心变成可用产品

`pi-coding-agent` 在底层循环上增加了编码场景必需的外壳：项目上下文、文件与 shell 工具、会话、自动压缩、终端 UI、扩展加载和多种运行模式。

当前 CLI 安装方式为：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
```

除了交互模式，Pi 还提供打印模式、JSON 事件流和 RPC 模式。RPC 通过标准输入输出交换逐行 JSON，适合 Java、Go 或其他语言把 Pi 当作子进程驱动；SDK 则适合 Node.js/TypeScript 应用直接嵌入。

下面是官方 SDK 入口的最小化用法。示例只创建内存会话，不包含生产环境的权限、持久化和超时治理：

```ts
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

// 加载当前环境中已经配置的模型与认证信息。
const modelRuntime = await ModelRuntime.create();

// 内存会话适合一次性任务；服务端应用应换成可持久化的会话管理器。
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
});

// prompt 会驱动模型、工具和后续轮次，直到本次 Agent 运行结束。
await session.prompt("分析当前项目的依赖方向，并给出最小重构建议");
```

Java 后端接入时，更稳妥的边界通常是 RPC 子进程：Java 服务负责租户、鉴权、任务状态、超时和审计；Pi 进程负责模型循环与项目工具。不要让 Web 请求线程无限等待 Agent，可将一次运行建模为异步任务，并持久化 `runId`、会话路径、进程状态和最终产物。

## 五、会话不是平铺聊天记录，而是一棵树

Pi 会话使用 JSONL 保存，每条记录带有 `id` 与 `parentId`，因此同一个文件可以表达分支历史。用户可以在终端中回到较早节点继续，也可以 fork 或 clone 会话。

这比“复制整段聊天再重来”更适合编码任务：

- 可以从错误决策前分叉，保留原路径用于复盘；
- 不必破坏已经完成的工具轨迹；
- 外部系统可以按父子关系重建任意分支；
- Git 分支与会话分支可以分别管理，避免把两者混为一谈。

当上下文接近模型限制时，Pi 会自动压缩较早内容。压缩摘要是有损的，但完整历史仍保留在会话文件中。工程上不能把摘要当作事实数据库：关键约束应写进项目说明、技能或结构化状态，重要产物应落盘，恢复任务时再从原始记录核验。

## 六、扩展体系：Pi 为什么可以保持最小

TypeScript 扩展可以订阅生命周期事件、注册工具和命令、调整上下文、替换 UI 组件、接入供应商，甚至实现自定义压缩和权限门禁。Skills 提供按需加载的操作说明，prompt templates 保存可复用提示词，themes 管理终端外观，Pi packages 则把这些资源一起分发。

官方示例已经展示了子代理、计划模式、权限门禁、沙箱、MCP、Git checkpoint 等能力，但要注意：示例存在不代表默认内核内置。Pi 的设计选择是让团队决定这些机制的具体语义，而不是替所有项目预设答案。

这种自由度也带来供应链风险。扩展和 Pi package 是在本机进程中执行的代码，可能读取文件、环境变量和凭据。引入第三方包前至少应：

1. 查看源码、维护者和发布记录；
2. 固定版本并审查升级差异；
3. 在隔离环境中验证工具和网络行为；
4. 不向 Agent 进程注入无关生产凭据。

## 七、Pi 的安全边界：默认信任当前进程

Pi 官方明确说明：它没有内置权限系统，默认拥有启动用户和进程拥有的权限。项目配置的信任提示主要防止自动加载陌生仓库中的配置与扩展，不能替代对 shell、文件系统和网络的完整隔离。

因此，生产或处理不可信仓库时，应把安全边界放到进程外：

```text
宿主服务：身份、审批、配额、审计
        ↓
隔离运行环境：容器 / VM / 专用沙箱
        ├── 只挂载任务工作区
        ├── 默认阻断非必要网络
        ├── 注入短期、最小权限凭据
        └── 限制 CPU、内存、进程数和执行时间
                    ↓
                  Pi Agent
```

Pi README 推荐通过 Gondolin、Docker 或 OpenShell 等外部环境获得更强隔离。无论选哪种实现，都要分别控制文件系统、网络、凭据和不可逆操作；只隐藏某个工具名称并不能形成可靠安全边界。

## 八、Pi、Claude Code 与 Codex 对比

三者都能在代码库中读取文件、运行命令、修改代码并调用工具，但产品目标不同。以下比较基于 [Pi 官方文档](https://pi.dev/docs)、[Claude Code 官方文档](https://code.claude.com/docs/en/overview)和 [Codex 官方文档](https://learn.chatgpt.com/docs/codex/cli)，核对日期为 2026-08-24；模型、套餐和具体功能更新较快，选型时应再次查阅官方说明。

| 维度 | Pi Agent Harness | Claude Code | Codex |
|---|---|---|---|
| 核心定位 | 最小、模型中立、可编程的 Agent 底盘 | 围绕 Claude 的成熟编码 Agent 产品 | 围绕 OpenAI Codex 的本地、IDE、桌面与云端编码 Agent 平台 |
| 默认能力 | 基础编码工具、会话、压缩、TUI；高级工作流按需扩展 | 权限、项目记忆、Skills、Hooks、MCP、子代理等产品能力较完整 | 审批与沙箱、AGENTS.md、Skills、MCP、子代理、工作树和自动化能力较完整 |
| 模型策略 | 统一多家供应商，也支持自定义适配 | 以 Claude 模型与 Anthropic 生态为中心 | 以 OpenAI 模型与 Codex 生态为中心 |
| 扩展方式 | TypeScript 扩展、Skills、模板、主题、Pi packages | CLAUDE.md、Skills、Hooks、MCP、子代理、Plugins | AGENTS.md、Skills、Hooks、MCP、子代理、Plugins |
| MCP 与子代理 | 默认不内置，可用扩展或示例实现 | 产品内提供 | 产品内提供 |
| 会话模型 | JSONL 树，可原地分支、fork、clone，完整历史保留 | 由产品管理会话、记忆和子代理上下文 | 由产品管理任务、线程、子代理及工作树 |
| 默认安全 | 无内置权限系统，依赖当前进程权限；建议外置沙箱 | 默认只读，编辑与命令按权限规则审批，并提供 sandbox | 本地执行提供 sandbox 与 approval policy，云任务运行在隔离环境中 |
| 编程接入 | TypeScript SDK、JSON 事件流、stdin/stdout RPC | Agent SDK、CLI 与自动化集成 | SDK、非交互 CLI、App Server、GitHub Action 等 |
| 上手成本 | 直接使用不高，深度定制需要自己设计治理 | 产品工作流完整，团队规则配置成本较低 | 多种运行界面和自动化入口，需选好本地/云端边界 |
| 最适合 | 自研 Agent、模型对比、特殊工具链、研究与原型 | Claude 技术栈、成熟终端体验、企业化策略管理 | OpenAI 技术栈、多入口协作、并行任务与工程自动化 |

### 怎么选

- 选 Pi：你要控制 Agent Loop、模型路由、工具协议和交互形态，并愿意自己补齐权限、沙箱与运维。
- 选 Claude Code：你更看重成熟的终端编码体验、Claude 模型协作和完整扩展生态，希望少造运行时基础设施。
- 选 Codex：你需要本地与云端任务结合、IDE/桌面/CLI 多入口、受控自动化，或已经使用 OpenAI 的模型与开发平台。

Pi 的优势是“可改”，Claude Code 和 Codex 的优势是“已集成”。团队最容易犯的错误，是选择 Pi 后照搬全家桶预期，或选择成熟产品后又绕过其权限与会话体系重建一套控制层。

## 九、落地 Pi 前先回答六个问题

1. 模型供应商是否需要动态切换，切换时如何做能力降级？
2. 哪些工具只读，哪些工具有副作用，谁负责审批？
3. Agent 进程能访问哪些目录、网络和凭据？
4. 会话、Git 状态和业务任务状态分别由谁持久化？
5. 工具失败、进程崩溃、上下文压缩后如何恢复？
6. 如何记录模型调用、工具输入输出、代码差异和最终产物？

如果这些问题没有答案，高可扩展性只会放大不确定性。Pi 最合适的用法不是无边界地“让 Agent 自己发挥”，而是把它当成清晰、可替换的执行内核，再由外层系统补上身份、权限、审批、隔离、预算与观测。

## 参考资料

- [Pi Agent Harness 仓库](https://github.com/earendil-works/pi)
- [Pi 官方文档](https://pi.dev/docs)
- [Pi Coding Agent README](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)
- [Pi Agent Core README](https://github.com/earendil-works/pi/tree/main/packages/agent)
- [Claude Code 官方概览](https://code.claude.com/docs/en/overview)
- [Claude Code 扩展能力](https://code.claude.com/docs/en/features-overview)
- [Claude Code 安全与权限](https://code.claude.com/docs/en/security)
- [Codex CLI 官方文档](https://learn.chatgpt.com/docs/codex/cli)
- [Codex 子代理](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Codex 沙箱与审批](https://learn.chatgpt.com/docs/sandboxing)
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)
