---
title: Agent 上下文工程实践：选择、压缩与缓存治理
date: 2026-08-17
category: 后端开发
cover: /images/posts/agent-context-engineering-selection-compaction-cache-knowledge-map.png
tags: [agent, context-engineering, spring-ai, llm, observability]
excerpt: 从“最小但足够的高信号上下文”出发，讲清 Agent 每轮调用中的指令、历史、检索、工具与运行态如何选择、排序、压缩、缓存和观测，并给出 Java 上下文装配器示例。
---

# Agent 上下文工程实践：选择、压缩与缓存治理

<img src="/images/posts/agent-context-engineering-selection-compaction-cache-knowledge-map.png" alt="Agent 上下文工程实践：选择、压缩与缓存治理知识串联图" style="border-radius: 10px;" />

从“最小但足够的高信号上下文”出发，讲清 Agent 每轮调用中的指令、历史、检索、工具与运行态如何选择、排序、压缩、缓存和观测，并给出 Java 上下文装配器示例。

## 先说结论：上下文不是聊天记录，而是一份每轮重建的执行快照

Prompt Engineering 主要回答“指令怎么写”；Context Engineering 进一步回答“模型这一次究竟能看到什么、按什么顺序看到、超出预算时舍弃什么”。Agent 运行越久，候选信息越多：系统规则、用户消息、会话历史、长期记忆、RAG 文档、工具定义、工具结果、任务计划和运行时状态都会争夺同一个有限上下文。

可靠的做法不是把能找到的内容全部塞给模型，而是每轮重新装配一份**最小但足够的高信号执行快照**：正确性与安全约束优先，当前任务证据其次，最近交互与工具结果按需保留，过期、重复和低可信内容被删除、摘要或外置。

本文以 Spring AI 2.0.0 当前文档为 Java 示例基线，事实核对时间为 2026-08-17。Anthropic 将 Context Engineering 描述为在每次推理前持续整理系统指令、工具、MCP、外部数据和消息历史；Spring AI 则明确区分 Chat Memory 与完整 Chat History。版本事实以 [Anthropic Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)、[Spring AI Chat Memory](https://docs.spring.io/spring-ai/reference/api/chat-memory.html)、[Advisors API](https://docs.spring.io/spring-ai/reference/api/advisors.html) 和 [Observability](https://docs.spring.io/spring-ai/reference/observability/) 为准。

## 一、一轮 Agent 上下文由哪些部分组成

工程上可把候选上下文分为六类，缺一不可地“识别”，但不代表每轮都要全部“注入”。

| 类别 | 典型内容 | 默认处理 |
|---|---|---|
| 指令与策略 | 系统规则、角色、输出契约、安全边界 | 置于稳定前缀，禁止被低优先级内容覆盖 |
| 当前请求 | 用户本轮目标、附件、明确约束 | 原意保留，歧义时先澄清 |
| 工作状态 | 计划、已完成步骤、待办、关键决策 | 用结构化状态表达，不靠聊天回忆 |
| 会话与记忆 | 最近对话、用户偏好、跨会话事实 | 按相关性召回，区分原文与摘要 |
| 外部证据 | RAG 文档、数据库结果、网页、文件片段 | 附来源、时间、权限与可信度 |
| 能力与反馈 | 工具 Schema、工具结果、错误、审批状态 | 只暴露本轮可用能力，结果最小化 |

还要为模型输出预留空间。输入刚好占满上下文窗口并不代表利用率最高：模型还需要生成回答、工具参数或推理结果，过量的低相关信息也会稀释关键约束。

## 二、Context Engineering 的完整生命周期

一轮可靠装配通常包含八步：

1. **收集候选项**：从当前请求、短期会话、长期记忆、检索和工具注册表得到候选内容；
2. **标注元数据**：记录来源、时间、租户、权限、可信度、版本和预估 Token；
3. **硬过滤**：先删除越权、过期、重复、无来源或与任务无关的内容；
4. **冲突处理**：按指令优先级和来源可信度处理矛盾，不让检索文档冒充系统命令；
5. **相关性排序**：结合当前子任务、实体、时间和证据质量排序；
6. **预算分配**：为指令、当前请求、证据、历史、工具和输出分别保留额度；
7. **压缩与装配**：先删冗余，再裁剪、摘要或外置，最后按稳定顺序组装；
8. **调用后回写**：保存决策、工具副作用和可复用事实，不把所有原始输出无脑写入长期记忆。

这不是一次性的 Prompt 拼接，而是 Agent 循环中的控制平面。每次工具返回、用户补充或计划切换后，都要重新评估下一轮需要什么。

## 三、选择：先做权限过滤，再谈相关性

### 1. 硬约束的优先级高于相似度

向量相似度高，只说明文本语义接近，不说明它属于当前租户、仍然有效或有权被模型看到。候选项应先经过以下硬过滤：

- 租户、用户、项目与数据权限匹配；
- 文档版本和有效期满足当前任务；
- 工具在本轮授权白名单内；
- 内容不含不应进入模型的密钥和敏感字段；
- 来源可追溯，且没有被撤销或标记为不可信。

权限条件应进入数据库或向量检索过滤表达式，而不是先全量召回再靠 Prompt 要求模型“忽略别人的数据”。

### 2. 用“当前子任务”而不是整段对话检索

长对话往往包含多个目标。直接拿全部历史做查询，会把已经完成的主题再次召回。更稳妥的检索查询由以下部分组成：当前子任务、关键实体、必要时间范围、期望证据类型和明确排除项。

例如排查支付回调重复，不应把“用户最初想优化结算页”一起放入查询；需要的是订单号、支付渠道、回调时间段、幂等键和相关日志类型。

### 3. 去重时保留证据，不只保留最短文本

同一事实可能同时出现在会话、记忆和 RAG 文档中。去重应优先保留更权威、更新、可引用的来源，并记录被合并项。若两个来源冲突，不要摘要成一个模糊结论，应把冲突显式交给决策层或用户处理。

## 四、预算：不要把剩余空间全交给聊天历史

Token 预算应是可配置的资源分配，而不是一个写死的“最多 N 条消息”。至少预留以下槽位：

```text
总可用输入预算
├── 不可裁剪：系统规则、安全边界、输出契约
├── 高优先级：当前请求、审批状态、关键错误
├── 任务证据：检索片段、文件内容、工具结果
├── 连贯性：近期会话、决策摘要、未完成计划
├── 能力描述：本轮允许的工具 Schema
└── 安全余量：估算误差与后续工具循环
```

预算比例没有通用答案。客服问答、代码 Agent 和数据分析的证据密度完全不同。正确做法是从代表性任务集出发，记录各类内容的实际 Token、任务成功率、引用正确率、延迟和成本，再调整策略。

当预算不足时，建议按以下顺序降级：删除完全重复内容 → 删除过期和低相关内容 → 缩小工具集 → 裁剪冗长工具结果 → 对已完成阶段做结构化摘要 → 外置原始材料并保留可回取引用。安全规则、当前用户目标和未确认的副作用不能为了省 Token 被摘要掉。

## 五、压缩：删除、裁剪、摘要、外置不是一回事

### 1. 删除

适合确定无用的内容，例如重复日志、成功但无后续价值的心跳结果、已经被新状态覆盖的旧计划。删除的信息不再可回取，因此必须有充分依据。

### 2. 裁剪

保留原始结构，只截取相关范围。例如只取异常前后日志、只保留匹配方法及其调用方、只返回查询结果中的必要字段。裁剪比生成式摘要更可验证，应优先使用。

### 3. 结构化摘要

把已经完成的一段过程压成稳定状态，例如：目标、已验证事实、关键决策、修改文件、失败尝试、待办和引用。摘要必须区分“事实”“推断”“未验证”，并保留来源指针。不要让模型把不确定性压没。

### 4. 外置

大文件、完整工具结果和长日志保存在受控存储中，上下文只放摘要、哈希、权限信息和可回取句柄。句柄必须短期有效、绑定租户，并在再次读取时重新鉴权；不能把内部任意路径或永久公开 URL 交给模型。

### 5. 分阶段重建

长任务跨越多个上下文窗口时，用检查点重建新上下文：保留目标、约束、当前状态、关键证据与下一步，把探索过程留在外部工作日志。Anthropic 的长任务实践也强调通过明确的进度工件连接不同会话，而不是期待模型永久记住全部对话。

## 六、缓存：稳定前缀在前，动态内容在后

Prompt Cache 通常围绕可复用前缀工作，具体命中条件、计费和保留时间因模型供应商与版本而异，不能在业务代码里假设统一规则。通用的装配顺序是：

```text
稳定系统规则 → 稳定工具定义 → 稳定领域说明
             → 当前会话摘要 → 本轮检索证据 → 当前用户请求
```

想提高缓存命中，应保持稳定内容的字节级顺序和序列化方式，避免把时间戳、Trace ID、随机数放在最前面；工具列表也只在能力变化时调整。缓存优化不能改变权限边界：不同租户的私有前缀不能为了命中率被错误共享，密钥也不应进入可缓存 Prompt。

缓存命中不是最终目标。需要同时观测命中输入量、总输入量、延迟、成本和任务质量；如果为了稳定前缀保留了大量无关工具或旧规则，成本下降也可能伴随选择准确率下降。

## 七、Java 示例：把上下文装配做成确定性服务

下面的示例不依赖某个供应商的 Tokenizer。生产环境应接入所用模型对应的计数器或在调用后使用供应商返回的 Usage 校准估算误差。

```java
public record ContextItem(
        String id,
        ContextKind kind,
        String content,
        int priority,
        int estimatedTokens,
        boolean mandatory) {
}

public enum ContextKind {
    POLICY, CURRENT_REQUEST, WORK_STATE, MEMORY, EVIDENCE, TOOL
}

public record ContextPacket(List<ContextItem> items, int estimatedTokens) {
}

public final class ContextAssembler {

    public ContextPacket assemble(List<ContextItem> candidates, int inputBudget) {
        // 权限、租户、有效期与敏感字段过滤必须在调用本方法前完成
        List<ContextItem> deduplicated = candidates.stream()
                .collect(Collectors.toMap(
                        ContextItem::id,
                        Function.identity(),
                        this::preferNewerOrHigherPriority,
                        LinkedHashMap::new))
                .values().stream()
                .sorted(Comparator
                        .comparing(ContextItem::mandatory, Comparator.reverseOrder())
                        .thenComparing(ContextItem::priority, Comparator.reverseOrder()))
                .toList();

        List<ContextItem> selected = new ArrayList<>();
        int used = 0;

        for (ContextItem item : deduplicated) {
            // 强制项超预算时直接失败，不能静默删除安全策略或当前请求
            if (used + item.estimatedTokens() > inputBudget) {
                if (item.mandatory()) {
                    throw new IllegalStateException("强制上下文超过输入预算: " + item.id());
                }
                continue;
            }
            selected.add(item);
            used += item.estimatedTokens();
        }

        return new ContextPacket(List.copyOf(selected), used);
    }

    private ContextItem preferNewerOrHigherPriority(ContextItem left,
                                                     ContextItem right) {
        // 示例按优先级合并；真实项目还应比较来源权威性、版本与时间
        return left.priority() >= right.priority() ? left : right;
    }
}
```

随后把确定性装配结果交给 Spring AI `ChatClient`。会话连贯性可以通过 `MessageChatMemoryAdvisor` 提供，但不要把它当完整审计历史：

```java
@Service
public class IncidentAgent {

    private final ChatClient chatClient;
    private final ContextAssembler contextAssembler;

    public IncidentAgent(ChatModel chatModel,
                         ChatMemory chatMemory,
                         ContextAssembler contextAssembler) {
        this.chatClient = ChatClient.builder(chatModel)
                .defaultAdvisors(MessageChatMemoryAdvisor.builder(chatMemory).build())
                .build();
        this.contextAssembler = contextAssembler;
    }

    public ChatResponse analyze(String conversationId,
                                String question,
                                List<ContextItem> authorizedCandidates,
                                int inputBudget) {
        ContextPacket packet = contextAssembler.assemble(
                authorizedCandidates,
                inputBudget);

        String evidence = packet.items().stream()
                .map(item -> "[%s] %s".formatted(item.id(), item.content()))
                .collect(Collectors.joining("\n\n"));

        return chatClient.prompt()
                .system("你是故障分析助手。只依据授权证据回答；区分事实、推断和待验证项。")
                .user("问题：%s\n\n授权上下文：\n%s".formatted(question, evidence))
                // Spring AI 2.0.0 要求每次使用记忆 Advisor 时显式提供会话 ID
                .advisors(advisor -> advisor.param(
                        ChatMemory.CONVERSATION_ID,
                        conversationId))
                .call()
                .chatResponse();
    }
}
```

示例刻意把“授权过滤”和“预算选择”放在模型调用之前。即使模型被检索文档中的恶意指令诱导，它也看不到未授权候选项。完整聊天记录应另存审计库；Chat Memory 只保存下一轮真正需要的对话信息。

## 八、工具结果如何进入下一轮上下文

工具结果是最容易膨胀的部分。应按类型处理：

- 数据库查询：返回明确列、分页游标、总量和查询时间，不返回整个实体图；
- 日志检索：保留匹配片段、时间范围、节点和原始日志引用；
- 文件读取：优先方法、章节或行范围，附文件版本或哈希；
- 写操作：保留审批、幂等键、业务结果 ID 和最终状态，不重复注入请求全文；
- 错误结果：区分可重试、业务拒绝、权限拒绝和未知状态，避免模型猜测。

工具返回的数据仍是不可信内容。网页、工单或代码注释中的“忽略系统规则”只能作为数据被引用，不能升级成指令。工具结果进入 Prompt 前还要做秘密扫描、字段脱敏、大小限制和来源标记。

## 九、安全与失败处理

### 上下文注入

攻击者可能把指令藏在文档、网页、邮件和工具结果中。防线包括：指令与数据分区、来源标签、最小工具集、执行端鉴权、高风险审批，以及禁止数据内容修改系统策略。仅使用 XML 标签或 Markdown 代码块不能构成安全边界。

### 摘要漂移

多轮反复摘要会逐渐丢失限定词。应从最近的可信检查点和原始证据重新生成摘要，保存摘要版本、输入引用与生成时间，并用结构化字段承载金额、状态和 ID 等关键事实。

### 估算错误

字符数不是精确 Token 数。超限时应用应有可预测的二次裁剪路径，并记录“哪一类内容因预算被丢弃”。不要捕获异常后直接重试同一个超长请求。

### 状态不一致

模型上下文里的计划可能落后于数据库或工具真实状态。副作用执行前必须重新读取权威状态；工具成功后先持久化业务结果，再把结果回写上下文。

## 十、可观测性：不仅看 Token 总数

Spring AI 当前可观测性覆盖 `ChatClient`、Advisor、ChatModel、工具、EmbeddingModel 和 VectorStore，并提供按输入、输出、总量区分的 Token 指标。Prompt 与 Completion 可能包含敏感数据，因此默认不导出内容，生产环境不应为了排障长期打开全文日志。

建议记录四组指标：

1. **规模**：各上下文类别的候选数、选中数、估算与实际 Token、压缩率；
2. **质量**：证据引用正确率、关键约束保留率、工具选择成功率、人工纠正率；
3. **效率**：缓存命中输入、模型延迟、检索延迟、工具循环次数和单任务成本；
4. **安全**：越权候选拦截、注入命中、脱敏字段、审批拒绝后调用和外置句柄鉴权失败。

每次调用还应能回答：哪些候选被选中、哪些被丢弃、依据是什么、使用了哪个装配策略版本。不要记录完整秘密内容，可记录内容哈希、来源 ID 和脱敏摘要。

## 十一、常见追问与踩坑

### 上下文窗口更大后还需要压缩吗

需要。窗口大小只解决容量上限，不解决相关性、冲突、隐私、延迟和成本。无关内容越多，关键规则越可能被淹没；超长任务仍需要检查点和外部状态。

### Chat Memory 等于 Chat History 吗

不等于。Spring AI 明确把 Chat Memory 定义为当前上下文需要保留的信息，而 Chat History 是完整交互记录。前者服务模型连贯性，后者服务审计、产品展示和分析，生命周期与存储策略应分开。

### RAG 检索到的内容都应该放进去吗

不应该。Top-K 只是候选集合，还要经过权限、版本、去重、相关性、证据质量和预算筛选。召回数量也应通过评测确定，不能照抄固定值。

### 摘要能否替代原始证据

不能完全替代。摘要适合保存任务状态和已完成阶段；金额、协议条款、错误日志和代码细节仍应保留可回取的原始引用。高风险决策前需要回到权威来源复核。

### 缓存命中率越高越好吗

不一定。把无关工具和旧说明塞进稳定前缀可以提高命中，却会增加输入并降低选择质量。应以任务成功、延迟和总成本共同判断。

## 十二、最佳实践清单

1. 把上下文视为每轮生成的执行快照，不把完整历史直接重放；
2. 先做租户、权限、有效期和敏感字段过滤，再做语义排序；
3. 明确不可裁剪项，并为输出与后续工具循环保留安全余量；
4. 先删除和裁剪，再使用生成式摘要；摘要保留来源与不确定性；
5. 大结果外置时使用短期、可鉴权、可撤销的引用；
6. 当前子任务驱动检索，完成一个阶段就写结构化检查点；
7. 每轮只暴露需要的工具，工具结果使用最小结果信封；
8. 稳定规则和工具定义放前，动态请求与证据放后，缓存规则按供应商核实；
9. Chat Memory 与完整 Chat History 分库、分目的治理；
10. 将装配策略版本化，用真实任务回放验证删除、排序和压缩决策；
11. 默认不记录完整 Prompt 与 Completion，只记录可诊断的脱敏元数据；
12. 同时监控 Token、质量、延迟、成本、安全和被丢弃内容。

## 总结

Agent 上下文工程的核心不是“如何塞进更多 Token”，而是用确定性控制面把有限注意力留给最重要的信息。指令提供边界，当前请求定义目标，工作状态维持进度，记忆和 RAG 补充证据，工具反馈推动世界状态变化；它们必须经过授权、排序、预算、压缩和观测后，才能成为下一轮模型输入。

真正可维护的 Agent 不依赖模型记住一切，而是让应用随时能够解释：这轮为什么给模型看这些、为什么没给它看另一些，以及上下文变化后如何安全地继续工作。
