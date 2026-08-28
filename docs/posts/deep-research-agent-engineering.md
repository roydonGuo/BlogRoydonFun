---
title: Deep Research Agent 工程实践：检索规划、证据账本与可中断执行
date: 2026-08-21
category: AI
cover: /images/posts/deep-research-agent-engineering-knowledge-map.webp
tags: [ai, agent, deep-research, spring-ai]
excerpt: Deep Research 不是让模型一次生成更长的答案，而是把澄清、检索、取证、核验和写作做成可恢复的研究任务。本文从 Java 后端视角拆解证据账本、引用校验、预算控制与长任务状态机。
---

# Deep Research Agent 工程实践：检索规划、证据账本与可中断执行

<img src="/images/posts/deep-research-agent-engineering-knowledge-map.webp" alt="Deep Research Agent 工程实践：检索规划、证据账本与可中断执行知识串联图" style="border-radius: 10px;" />

Deep Research 不是让模型一次生成更长的答案，而是把澄清、检索、取证、核验和写作做成可恢复的研究任务。本文从 Java 后端视角拆解证据账本、引用校验、预算控制与长任务状态机。

## 先说结论：研究产物必须能回到证据

普通问答追求快速给出可用回答；Deep Research 面向边界模糊、来源分散、需要交叉核验的开放问题。它至少要形成三个可审计产物：研究简报、证据账本和带引用的报告。只有最终文本，没有“哪条结论来自哪个来源、何时抓取、是否存在冲突”，就只是长回答。

它与几个相近模式的边界如下：

| 模式 | 核心目标 | 主要产物 | 不足以替代 Deep Research 的原因 |
|---|---|---|---|
| RAG | 从已建索引中召回上下文 | 文档片段 | 通常不负责开放式搜索、追问和多轮补证 |
| ReAct | 在推理与工具调用间循环 | 动作轨迹 | 轨迹不等于可复核的证据体系 |
| Plan-and-Execute | 按计划完成通用任务 | 步骤状态 | 计划本身不保证来源质量和引用覆盖 |
| Deep Research | 围绕问题持续搜集、核验并综合证据 | 证据账本与研究报告 | 成本更高，必须异步化和预算化 |

OpenAI 当前 Deep Research 指南把澄清、提示重写、搜索/文件/MCP 数据源、内联引用和后台执行列为完整链路中的关键环节。本文不绑定某个模型，把这些能力落到应用自己可控制的状态与契约上；事实核对日期为 2026-08-21。

## 先固化研究简报，再开始搜索

“调研 Java Agent 框架”仍然太宽。系统应先得到结构化简报，至少固定：问题、读者、时间范围、地域、必须覆盖项、排除项、来源偏好和交付格式。信息不足时进入 `NEEDS_INPUT`，不要让模型自行补齐关键约束。

```java
public record ResearchBrief(
        String question,
        String audience,
        LocalDate from,
        LocalDate to,
        List<String> mustCover,
        List<String> exclusions,
        List<String> preferredDomains,
        String deliverable) {
}
```

简报还要保存原始用户输入和版本号。后续重规划只能追加或显式修订约束，不能悄悄把“只看官方资料”改成“论坛也可以”。

## 检索计划要描述证据缺口

研究计划不是一串搜索词，而是一组可验收的子问题。每个子问题应包含预期证据、允许来源、完成条件和预算，例如“找到两个独立的一手来源，确认某能力的版本边界”。

建议把一次研究拆成四段：

1. **探索**：用宽查询识别术语、实体和可能的一手来源；
2. **聚焦**：围绕子问题打开原文，提取可引用片段与元数据；
3. **补证**：针对缺失、冲突和过期信息发起定向查询；
4. **收敛**：达到证据门槛或预算上限后停止搜索，转入核验。

停止条件必须由应用判断，不能只靠模型说“资料够了”。常见硬限制包括最大搜索次数、最大打开页面数、最大运行时间和成本上限；软条件包括子问题覆盖率、独立来源数与新增证据收益。连续若干轮没有新增有效证据时，应停止扩展查询。

## 证据账本是核心数据结构

网页正文不能直接塞进最终上下文。抓取后先规范化为证据项，并保留来源身份：

```java
public record EvidenceItem(
        UUID id,
        String subQuestionId,
        URI canonicalUrl,
        String title,
        Instant fetchedAt,
        String contentHash,
        String quote,
        String claim,
        SourceType sourceType,
        EvidenceStatus status) {
}

public enum EvidenceStatus {
    CANDIDATE, VERIFIED, CONFLICTING, REJECTED, STALE
}
```

`quote` 保存支持结论的最小原文片段，`claim` 保存系统从片段中抽取的候选主张，两者不能混为一列。`contentHash` 用于发现页面变化；`fetchedAt` 用于判断时效；`canonicalUrl` 用于去重。动态页面还应保存抓取快照或内部对象存储地址，避免复核时原文已变化。

来源质量不能简化成单一分数。至少分别记录来源层级、是否一手资料、发布日期、与主张的直接相关性以及是否有独立来源交叉支持。官方文档适合确认接口与版本，原始论文适合确认方法，厂商博客和社区讨论可以补充工程现象，但不能自动覆盖更直接的一手证据。

## Java 编排器只推进一个可持久化状态

长任务不要绑在一次 HTTP 请求或一次模型调用上。下面的编排器每次只处理一个状态，并在事务中持久化结果：

```java
@Service
public class ResearchJobRunner {

    private final ResearchJobRepository repository;
    private final ResearchPlanner planner;
    private final EvidenceCollector collector;
    private final EvidenceVerifier verifier;
    private final ReportWriter writer;

    @Transactional
    public void advance(UUID jobId) {
        ResearchJob job = repository.lockById(jobId);

        // 乐观版本或行锁保证同一任务不会被两个 Worker 重复推进
        switch (job.status()) {
            case CREATED, CLARIFYING -> job.attachPlan(planner.create(job.brief()));
            case PLANNED, RESEARCHING -> collector.collectNext(job);
            case VERIFYING -> verifier.verify(job);
            case SYNTHESIZING -> job.complete(writer.write(job));
            case NEEDS_INPUT, SUCCEEDED, FAILED, CANCELLED -> {
                return;
            }
        }

        // 每一步提交状态、预算和产物，宕机后从已提交断点继续
        repository.save(job);
    }
}
```

生产实现还需要 `attempt`、`nextRunAt`、租约超时和幂等键。搜索请求用“任务 ID + 子问题 ID + 查询哈希”去重；证据以规范 URL + 内容哈希去重；综合报告以证据集合版本生成。这样消息重复投递时不会重复扣费或覆盖已经验证的证据。

若使用 Spring AI 2.0.0，可用 `ChatClient` 的结构化输出生成研究计划，用 Tool Calling 对接只读搜索适配器，并通过 Micrometer 观察模型和工具调用。工具是否执行仍由应用决定；模型只能提出调用参数，不能直接获得搜索凭据、数据库连接或任意网络访问权。

## 引用校验要晚于写作，早于发布

综合阶段只允许读取 `VERIFIED` 与明确标记的 `CONFLICTING` 证据。草稿生成后，再运行一次确定性校验：

- 每个事实性句子是否绑定至少一个证据 ID；
- 引用 URL 是否存在于证据账本，而不是模型临时编造；
- 引用片段是否直接支持该句，而非只讨论相近主题；
- 时间敏感结论是否包含版本或核对日期；
- 冲突证据是否在正文中呈现差异和适用条件；
- 无法验证的结论是否被删除或降级为待确认事项。

不要让模型生成脚注编号后直接发布。编号、链接和最终参考列表应由后端根据证据 ID 渲染。这样即使调整段落，引用也不会错位。

## 可中断执行是可靠性要求

Deep Research 可能持续数分钟甚至更久。应用接口应返回 `jobId`，由队列驱动后台 Worker；客户端通过状态查询、SSE 或 Webhook 获取进度。取消请求只把任务置为 `CANCEL_REQUESTED`，Worker 在下一安全检查点停止，不能粗暴中断到“证据已写入、预算未记账”的中间状态。

一个实用状态集合是：

```text
CREATED → CLARIFYING → PLANNED → RESEARCHING → VERIFYING → SYNTHESIZING → SUCCEEDED
             ↓              ↘ NEEDS_INPUT      ↘ FAILED
             └──────────────────────────────→ CANCELLED
```

OpenAI 官方指南同样建议对长时间研究请求使用后台模式和完成通知，并用工具调用上限约束成本与延迟。这是具体平台的实现提示，不是通用协议；自建编排仍应把状态、预算和恢复点保存在自己的数据库中。

## 安全边界：外部内容都是不可信输入

搜索结果、网页正文和远程 MCP 返回值都可能包含提示注入。研究 Agent 应遵守：

- 搜索与抓取工具只读，参数使用结构化 Schema，禁止把网页指令解释为系统指令；
- 公网研究与内部敏感数据分阶段执行，避免模型把私有内容拼进下一次公网查询；
- 域名白名单、出站代理、响应大小、MIME 类型和重定向次数由应用限制；
- 凭据不进入 Prompt，工具结果先做内容清洗与数据分类；
- 保存模型请求、工具调用、来源和审批轨迹，但默认不把敏感参数写入 Span。

OpenAI 对 Deep Research MCP 的安全说明也明确提醒：即使只读搜索结果也可能携带提示注入，并建议仅连接可信服务器、记录工具轨迹，必要时把公网和私有数据研究拆成两个阶段。

## 可观测性要回答“为何可信、为何停止”

除延迟、Token 和工具错误率外，建议记录：

- 每个子问题的查询数、有效证据数和独立来源数；
- 去重率、页面抓取失败率、过期证据率和冲突率；
- 引用覆盖率、引用支持率和无证据句子数；
- 每轮新增有效证据数，以及触发停止的具体条件；
- 任务重试、恢复、取消和人工补充次数。

离线评测不能只让另一个模型给报告打总分。应分别检查问题覆盖、来源质量、引用正确性、时效性、冲突处理和成本，并保留一批固定研究任务做回归。只有这样，提示词、搜索源或模型升级后，才能判断是“写得更像报告”还是“证据真的更可靠”。

## 总结

Deep Research 的工程难点不在于让模型多调用几次搜索，而在于把不确定的研究过程变成可审计的后台作业：先澄清边界，用子问题驱动检索，把每条主张落进证据账本，再校验引用、持久化断点并按预算停止。

对 Java 后端团队而言，最稳妥的分工是：模型负责提出计划、查询和综合草稿；应用负责权限、状态、幂等、证据身份、引用渲染与发布门禁。最终报告可以由模型写，但“为什么可信”必须由系统回答。

参考资料（核对日期：2026-08-21）：

- [OpenAI API：Deep research](https://developers.openai.com/api/docs/guides/deep-research)
- [OpenAI API：Background mode](https://developers.openai.com/api/docs/guides/background)
- [OpenAI API：Webhooks](https://developers.openai.com/api/docs/guides/webhooks)
- [Spring AI 2.0.0：Tool Calling](https://docs.spring.io/spring-ai/reference/api/tools.html)
- [Spring AI 2.0.0：Observability](https://docs.spring.io/spring-ai/reference/observability/index.html)
