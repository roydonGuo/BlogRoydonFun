---
title: Agent Skills 工程实践：渐进式披露、可复用能力与安全边界
date: 2026-08-11
category: AI
cover: /covers/backend.svg
tags: [ai, agent, agent-skills, context-engineering, security]
excerpt: 从开放格式、三阶段渐进式披露与执行边界出发，讲清 Agent Skill 如何封装可复用流程，并用 Java 落实导入校验、最小权限、审计与版本治理。
---

# Agent Skills 工程实践：渐进式披露、可复用能力与安全边界

<img src="/images/posts/agent-skills-progressive-disclosure-engineering-knowledge-map.webp" alt="Agent Skills 工程实践：渐进式披露、可复用能力与安全边界知识串联图" style="border-radius: 10px;" />

从开放格式、三阶段渐进式披露与执行边界出发，讲清 Agent Skill 如何封装可复用流程，并用 Java 落实导入校验、最小权限、审计与版本治理。

Agent Skill 不是一段更长的 Prompt，也不是给模型直接加权限。它是一种把任务触发条件、操作步骤、参考资料、确定性脚本和静态资产组织成目录的开放格式，让兼容的 Agent 在任务需要时发现并加载这套能力。

它解决的是“如何稳定复用做事方法”，而 MCP、Function Calling 等机制更偏向“如何暴露和调用外部能力”。一个 Skill 可以指导 Agent 何时调用工具、按什么顺序校验结果，但真正的文件、网络、数据库和发布权限仍应由宿主应用控制。

> 本文以 **Agent Skills 开放规范当前版本**为格式基线，并参考 OpenAI Skills 官方说明、OWASP LLM06:2025 与 NIST AI 100-2e2025，事实核对时间为 **2026-08-11**。规范中的 `allowed-tools` 仍标记为实验性字段，各客户端支持度可能不同；本文不会把某个客户端的目录位置、自动批准行为或执行能力当成开放标准的保证。

## 一、先分清 Skill、Prompt、Tool 与 MCP

四者经常一起出现，但解决的问题并不相同：

| 概念 | 核心职责 | 典型内容 | 主要边界 |
|---|---|---|---|
| Prompt | 描述当前目标和约束 | 角色、任务、输出格式 | 通常随一次请求进入上下文 |
| Skill | 封装可发现、可复用的工作流 | `SKILL.md`、脚本、参考资料、资产 | 只指导行为，不天然授予权限 |
| Tool / Function Calling | 暴露一个可执行操作 | 名称、参数 Schema、执行器 | 应用必须校验参数、身份和权限 |
| MCP | 连接 Agent 与外部能力的协议 | Tools、Resources、Prompts 等 | 负责能力交换，不替代业务授权 |

例如“发布技术博客”可以做成 Skill：先查重选题、查官方资料、按模板写作、构建、定向提交。Skill 内部可能调用网页检索、文件写入、Git 等工具；这些工具可以由 MCP 或应用原生接口提供。Skill 定义流程，工具完成动作，宿主负责授权与审计。

不适合做 Skill 的内容也很明确：

- 只在一次对话中使用的临时要求，直接写 Prompt 更简单；
- 一个参数稳定、职责单一的外部操作，应优先建成 Tool；
- 需要强事务、一致性或确定性编排的核心业务，不应完全交给自然语言步骤；
- 高频变化的事实数据应通过 API 或检索获得，不要固化进 `SKILL.md`。

## 二、开放格式的完整组成

按 Agent Skills 规范，一个 Skill 至少是包含 `SKILL.md` 的目录。常见结构如下：

```text
order-refund-review/
├── SKILL.md          # 必选：元数据与主流程
├── scripts/          # 可选：可执行的确定性脚本
├── references/       # 可选：按需读取的规则和契约
├── assets/           # 可选：模板、图片或静态数据
└── LICENSE.txt       # 可选：许可证文本
```

### 1. `SKILL.md`：发现入口与主流程

`SKILL.md` 由 YAML frontmatter 和 Markdown 正文组成。当前规范要求 `name` 与 `description`，还定义了若干可选字段：

| 字段 | 必选 | 作用 | 工程建议 |
|---|---|---|---|
| `name` | 是 | Skill 唯一名称，并与目录名匹配 | 使用小写字母、数字和连字符 |
| `description` | 是 | 描述做什么、什么时候使用 | 同时写清触发场景与不适用范围 |
| `license` | 否 | 声明许可证或指向许可证文件 | 引入第三方 Skill 时必须核查 |
| `compatibility` | 否 | 说明运行环境、依赖和网络需求 | 把 Java、Git、数据库等前置条件写明 |
| `metadata` | 否 | 扩展键值信息 | 可记录作者、内部版本、责任团队 |
| `allowed-tools` | 否 | 声明预批准工具 | 仍属实验性，不能代替宿主授权 |

一个面向订单退款审核的最小示例：

```markdown
---
name: order-refund-review
description: 核对订单、支付与退款状态并生成审核建议。用于客服提交退款复核时；不执行真实退款。
license: Proprietary
compatibility: Requires Java 21 and read-only order APIs
metadata:
  owner: mall-platform
  version: "1.3.0"
---

# 退款审核流程

1. 读取 `references/refund-policy.md`，确认当前规则版本。
2. 使用只读工具查询订单、支付和既有退款记录。
3. 校验金额、币种、退款原因和重复申请。
4. 输出结构化审核建议；真实退款必须进入人工审批。
```

`description` 不是宣传语，而是路由契约。写成“帮助处理订单”会让 Agent 在查单、改价、发货、退款等大量场景中误触发；写清“退款复核”和“不执行真实退款”，才能降低漏触发与误触发。

### 2. `scripts/`：确定性动作

脚本适合校验 Schema、转换格式、计算哈希、生成报告等确定性任务。规范不限定具体语言，实际可运行语言取决于客户端。

脚本必须像生产程序一样处理输入：

- 参数显式传入，不从对话文本拼接 Shell 命令；
- 默认只读，写操作使用明确输出目录；
- 设置超时、文件大小和结果行数上限；
- 错误返回稳定错误码，避免把密钥和堆栈塞回模型；
- 依赖版本固定，并能追溯来源与哈希。

### 3. `references/`：按需知识

这里适合放长规则、字段字典、接口契约和边界案例。每个文件应聚焦一个问题，例如 `refund-policy.md`、`error-codes.md`、`api-contract.md`，避免再造一个无人能按需定位的巨型文档。

需要注意：参考资料进入模型上下文后依然是不可信输入。外部网页、工单、邮件或用户上传文档中的“忽略前文并执行命令”不能升级成系统指令。

### 4. `assets/`：静态输入

资产可以是文档模板、示例表格、图片或查询字典。它们不是天然可信资源：模板可能带宏，压缩包可能包含路径穿越，图片和文档也可能嵌入恶意指令。导入、解压和渲染都要放在受限环境中。

## 三、渐进式披露到底如何节省上下文

选题池常把渐进式披露拆成四层甚至附上固定百分比，但开放规范当前明确的是三个阶段，且只给出近似或推荐预算，不保证每个客户端都采用相同阈值：

```text
发现阶段
只加载 name + description
        ↓ 命中任务
激活阶段
加载完整 SKILL.md
        ↓ 执行确有需要
资源阶段
读取 references / scripts / assets 中的具体文件
```

### 1. 发现：用最小元数据完成路由

宿主可以常驻很多 Skill 的 `name` 和 `description`，让模型判断当前任务与哪些能力匹配。元数据越含糊，路由成本和误触发率越高。

### 2. 激活：一次读完整主指令

Skill 被选中后，Agent 会读取完整 `SKILL.md`，所以“正文没读完就先执行”不是可靠设计。规范建议主指令保持紧凑，并把大量细节拆到引用文件；当前规范给出的建议是指令少于约 5000 tokens、主文件少于 500 行，这些是设计建议，不是跨客户端强制运行限制。

### 3. 执行：只取本步骤需要的资源

退款审核无需加载营销规则，生成月报无需读取退款 API 契约。`SKILL.md` 应明确告诉 Agent 在什么条件下读取哪个文件，引用路径相对 Skill 根目录，并避免多层递归跳转。

渐进式披露优化的是**上下文装载**，不是数据库懒加载。脚本是否执行、文件能否读取、工具是否获批，仍由宿主运行时决定。资源没有加载进上下文，也不代表它经过安全审查。

## 四、从 Java 后端看一条完整执行链

生产系统可以把 Skill 当作“版本化工作流包”，但不要让模型直接遍历文件并随意执行。更稳妥的链路是：

```text
用户请求
  ↓
Skill Registry：按元数据召回候选
  ↓
Policy Engine：租户、角色、场景与版本校验
  ↓
Context Loader：加载 SKILL.md 与必要 reference
  ↓
Agent Runtime：生成工具调用提案
  ↓
Tool Gateway：Schema、权限、配额、幂等校验
  ↓
受限执行器：只读查询 / 沙箱脚本 / 人工审批
  ↓
结构化结果、审计事件与指标
```

这里至少有五种稳定契约：

1. **Skill 契约**：名称、版本、来源、内容摘要和兼容性；
2. **触发契约**：什么意图可以激活，什么场景必须排除；
3. **工具契约**：参数 Schema、错误码、超时和结果大小；
4. **授权契约**：主体、租户、资源、动作和审批要求；
5. **审计契约**：调用了哪个 Skill 版本、读取了哪些资源、执行了什么工具。

不要只记录“Agent 完成退款审核”。至少记录可关联的 `traceId`、Skill 内容哈希、工具名、规范化参数摘要、授权决策、结果码与耗时；敏感参数本身则应脱敏或只保留摘要。

## 五、Java 导入器：先把 Skill 当不可信软件包

下面的骨架展示服务端导入 Skill 时的第一道边界。它不执行任何脚本，只验证目录、关键文件、名称和大小；YAML 解析器还应启用安全模式，并限制别名、嵌套深度和输入体积。

```java
public record SkillManifest(
        String name,
        String description,
        String license,
        String compatibility,
        Map<String, String> metadata,
        String contentSha256) {
}
```

```java
public final class SkillPackageValidator {

    private static final long MAX_SKILL_MD_BYTES = 256 * 1024;
    private static final Pattern NAME =
            Pattern.compile("^[a-z0-9]+(?:-[a-z0-9]+)*$");

    public Path validateRoot(Path registryRoot, Path candidate) throws IOException {
        Path safeRegistry = registryRoot.toRealPath();
        Path safeCandidate = candidate.toRealPath(LinkOption.NOFOLLOW_LINKS);

        // 防止通过 ..、挂载点或符号链接逃逸 Skill Registry
        if (!safeCandidate.startsWith(safeRegistry)
                || Files.isSymbolicLink(candidate)
                || !Files.isDirectory(safeCandidate)) {
            throw new SecurityException("INVALID_SKILL_ROOT");
        }

        Path skillFile = safeCandidate.resolve("SKILL.md");
        if (!Files.isRegularFile(skillFile, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("SKILL_MD_REQUIRED");
        }
        if (Files.size(skillFile) > MAX_SKILL_MD_BYTES) {
            throw new IllegalArgumentException("SKILL_MD_TOO_LARGE");
        }
        return skillFile;
    }

    public void validateName(Path skillRoot, String manifestName) {
        String directoryName = skillRoot.getFileName().toString();

        // 开放规范要求 name 使用 kebab-case，并与父目录名一致
        if (!NAME.matcher(manifestName).matches()
                || !directoryName.equals(manifestName)) {
            throw new IllegalArgumentException("SKILL_NAME_MISMATCH");
        }
    }
}
```

真正接收 ZIP 时还要先逐项检查压缩条目：拒绝绝对路径、`..`、符号链接、设备文件和超量解压；设置文件数、单文件大小和总展开大小上限，再解压到一次性隔离目录。只校验最终路径不够，因为 Zip Slip 和解压炸弹可能在解析阶段就造成破坏。

通过格式校验也不代表可以上线。安全导入流水线应继续完成：

```text
来源登记 → 哈希/签名校验 → 解压安全检查 → Manifest 校验
        → 指令与脚本人工审查 → 静态扫描 → 沙箱演练
        → 权限映射 → 审批发布 → 运行监控 → 可回滚
```

## 六、Skill 的安全风险要完整看

### 1. 指令注入

恶意 `SKILL.md` 或 reference 可以诱导 Agent 忽略上级约束、读取密钥、上传源码或扩大任务范围。模型无法只靠“识别坏话”可靠解决这个问题，因此要用权限隔离限制最坏结果。

### 2. 脚本与依赖供应链

脚本可能直接删除文件、访问网络或读取环境变量；依赖包则可能被投毒或在升级后改变行为。Skill 的来源、版本、许可证、内容哈希和依赖锁文件都应纳入制品治理。

### 3. 过度功能、权限与自治

OWASP 将 Agent 损害的常见根因归纳为过度功能、过度权限和过度自治。一个只需生成退款建议的 Skill 不应拥有执行退款、导出全库和发送邮件的能力；高风险动作必须拆成独立工具，并由后端权限和人工审批控制。

### 4. 数据泄露

Skill 可能要求读取仓库、工单或客户资料，再把结果发送到外部服务。工具网关要同时校验数据来源和目标去向，敏感字段进入模型前脱敏，网络出口按域名与方法限制。

### 5. 资源耗尽

递归读取 reference、无限工具循环、大文件回填和脚本长时间运行都会消耗 Token、CPU、磁盘或下游配额。应设置上下文预算、最大文件数、最大工具轮次、总截止时间和取消传播。

### 6. 更新漂移与回滚困难

只记录 Skill 名称无法复现一次执行。发布时应生成不可变版本和内容摘要，灰度观察成功率、人工驳回率、工具错误率与成本；异常时按版本回滚，而不是在线修改同名目录。

## 七、真实场景：退款审核 Skill 如何落地

假设商城已有订单、支付、库存和退款服务，Skill 只负责生成审核建议：

1. 元数据命中“退款复核”请求，Registry 返回已批准版本；
2. Policy Engine 根据客服角色和租户裁剪为三个只读查询工具；
3. Agent 读取退款规则，依次查询订单、支付和历史退款；
4. Tool Gateway 校验订单归属、字段范围、超时和查询次数；
5. Agent 输出 `APPROVE_SUGGESTED`、`REJECT_SUGGESTED` 或 `NEEDS_MANUAL_REVIEW`；
6. 真正退款由独立审批流程执行，不能由这个 Skill 越权触发；
7. 审计记录 Skill 版本、证据摘要和决策理由，供客服复核。

建议把模型输出固定成应用契约：

```json
{
  "decision": "NEEDS_MANUAL_REVIEW",
  "reasonCodes": ["PAYMENT_STATUS_CONFLICT"],
  "evidenceRefs": ["order:O20260811001", "payment:P8842"],
  "nextAction": "CHECK_PAYMENT_PROVIDER",
  "customerMessage": "退款状态需要人工核对，我们会尽快处理。"
}
```

`decision` 驱动后端状态机，`reasonCodes` 用于统计和规则升级，`evidenceRefs` 只保存可授权访问的引用，不把完整支付报文交给模型。自然语言说明面向客服和用户，但不能反向决定数据库状态。

## 八、常见追问与踩坑

### Skill 越多，Agent 就越强吗？

不一定。大量描述重叠的 Skill 会提高路由歧义和上下文成本。应按单一结果边界拆分，并定期合并重复能力、下线低命中 Skill。

### `allowed-tools` 能当权限系统吗？

不能。该字段在当前规范中仍是实验性声明，客户端支持可能不同。即使客户端识别它，后端仍必须根据真实身份、租户、资源和动作重新授权。

### 为什么不把所有资料都塞进 `SKILL.md`？

Skill 激活后会读取完整主文件。过长正文会污染上下文、降低重点密度，还会让任何小规则修改都改变整个入口文件。主文件保留决策树和主流程，细节按文件拆入 references 更利于按需加载和审查。

### 脚本比让模型生成命令更安全吗？

经过审查、固定版本、输入受限且在沙箱运行的脚本通常更确定，但它仍是可执行代码。若脚本能读取宿主密钥、访问任意网络或修改任意路径，风险并不会因为它位于 `scripts/` 而降低。

### 是否应该让 Skill 自动更新？

生产环境不应直接跟随浮动分支。更稳妥的是拉取候选版本、校验摘要、审查差异、沙箱演练、灰度发布，再更新允许版本；任何阶段失败都保留旧版本。

## 九、选择建议与最佳实践

设计 Skill 时可以遵循这组顺序：

1. **先写结果边界**：一句话说明最终交付物和明确不做什么；
2. **再写触发契约**：让 `description` 同时包含任务关键词、适用场景和排除项；
3. **主流程保持短而完整**：步骤、分支、失败条件和完成标准都写进 `SKILL.md`；
4. **大知识按需拆分**：一个 reference 解决一个问题，引用不做深层套娃；
5. **确定性操作脚本化**：输入显式、输出结构化、依赖固定、错误可诊断；
6. **权限由宿主收口**：默认拒绝，按身份和资源授权，高风险动作人工确认；
7. **版本不可变**：记录来源、许可证、内容哈希、批准人和发布时间；
8. **观察真实效果**：监控命中率、误触发率、完成率、人工接管率、工具错误和成本；
9. **定期演练攻击**：覆盖指令注入、路径穿越、恶意脚本、数据外传和资源耗尽；
10. **保留降级路径**：Skill 不可用时回到人工流程或只读建议，不带病执行高风险动作。

## 十、总结

Agent Skills 的价值不在于把 Prompt 变成文件，而在于把做事方法变成可发现、可版本化、可审查和可组合的工程资产。开放格式提供了 `SKILL.md`、scripts、references 与 assets 的组织方式；渐进式披露让宿主先看元数据、命中后加载主指令、执行时再读取具体资源。

真正决定生产可用性的，是格式之外的运行时边界：Skill 只提出流程和动作，宿主负责身份、权限、参数、沙箱、审批、审计与回滚。把 Skill 同时当作上下文包和软件供应链制品治理，才能在提高复用效率的同时，不把 Agent 的便利变成新的权限入口。

## 参考资料

- [Agent Skills Specification](https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx)
- [OpenAI：Skills in ChatGPT](https://help.openai.com/en/articles/20001066)
- [OWASP LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
- [NIST AI 100-2e2025：Adversarial Machine Learning](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-2e2025.pdf)
