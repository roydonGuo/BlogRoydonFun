---
title: RAG 评测工程实践：检索、生成与端到端回归
date: 2026-08-12
category: AI
cover: /covers/backend.svg
tags: [rag, llm-as-a-judge, spring-ai, retrieval]
excerpt: 从 Query、Context、Response 三元关系出发，建立检索层、生成层与端到端评测体系，并用版本化数据集、Java 评测流水线和发布门禁把 RAG 调优变成可重复的工程过程。
---

# RAG 评测工程实践：检索、生成与端到端回归

<img src="/images/posts/rag-evaluation-engineering-knowledge-map.webp" alt="RAG 评测工程实践：检索、生成与端到端回归知识串联图" style="border-radius: 10px;" />

从 Query、Context、Response 三元关系出发，建立检索层、生成层与端到端评测体系，并用版本化数据集、Java 评测流水线和发布门禁把 RAG 调优变成可重复的工程过程。

## 先说结论：不要用一个“回答正确率”评判整条 RAG 链路

RAG 的失败至少来自两个阶段：检索器没有找到正确依据，或者生成模型拿到了依据却没有正确使用。只看最终答案，会把两类故障混在一起；只看向量相似度，又无法确认回答是否忠实、完整并真正解决了问题。

可落地的评测体系应同时回答五个问题：

1. 正确依据有没有进入候选集；
2. 正确依据在排序中是否足够靠前；
3. 检索上下文是否混入过多噪声；
4. 回答中的关键主张能否由上下文支持；
5. 新版本在质量、延迟、成本和安全上是否优于旧版本。

因此，工程上应把指标分成**检索层、生成层、端到端与运行指标**，再用切片分析定位失败原因。评测集、索引、Chunk、Embedding、提示词、模型和裁判配置都要版本化，任何单一分数都不能代替这条证据链。

本文以 Spring AI 2.0.0 的 `Evaluator` API 为 Java 示例基线，事实核对时间为 2026-08-12。Spring AI 当前稳定文档提供 `RelevancyEvaluator` 与 `FactCheckingEvaluator`；Ragas 当前文档列出的 RAG 指标包括 Context Precision、Context Recall、Response Relevancy、Faithfulness 和 Noise Sensitivity。指标名称在不同框架中不完全统一，迁移时应对齐定义与输入，而不是只对齐字段名。

## 一、先建立 Query、Context、Response 三元关系

RAG Triad 把一条问答拆成三个对象：

- **Query**：用户真正提出的问题；
- **Context**：检索、过滤、融合和重排后交给模型的上下文；
- **Response**：模型最终生成的回答。

三个对象形成三条需要分别评估的边：

| 关系 | 核心指标 | 主要定位的问题 |
|---|---|---|
| Query → Context | 上下文相关性、Recall@K、Precision@K、MRR、nDCG@K | 检索是否找对、排对 |
| Context → Response | Faithfulness / Groundedness、引用支持率 | 回答是否有依据、是否幻觉 |
| Query → Response | Answer Relevance、Correctness、任务完成率 | 是否答非所问、是否遗漏关键事实 |

三元评估不等于完整质量保证。即使三条边都表现良好，知识库本身也可能过时或错误，权限过滤也可能失效。因此还要单独校验来源时效、访问控制、敏感信息和业务规则。

## 二、检索层指标：先判断“证据有没有被找到”

检索评测需要标注每个问题对应的相关文档、段落或稳定 `chunkId`。如果只有标准答案、没有相关证据标注，就能评估最终回答，却很难精确诊断检索器。

### 1. Hit@K：前 K 个结果中是否至少命中一个依据

```text
Hit@K = 1，前 K 个候选中至少有一个相关结果
Hit@K = 0，前 K 个候选中没有相关结果
```

它适合“只要找到任意一个权威说明即可回答”的 FAQ，但无法区分命中第 1 名还是第 K 名，也无法判断多份必要证据是否找全。

### 2. Precision@K：返回的候选有多少真正相关

```text
Precision@K = 前 K 个结果中的相关结果数 / K
```

Precision@K 低意味着噪声过多。噪声会占用上下文窗口、增加模型注意力负担，还可能把过期版本或相似但错误的条款带入回答。

### 3. Recall@K：所有必要依据找回了多少

```text
Recall@K = 前 K 个结果中的相关结果数 / 该问题的全部相关结果数
```

多跳问题、对比问题和需要组合多份制度的问答更依赖 Recall@K。分母必须来自相对完整的人工标注；如果只标了一个“参考 Chunk”，算出的 Recall 并不是真正的召回率。

### 4. F1@K：同时约束精准率和召回率

```text
F1@K = 2 × Precision@K × Recall@K / (Precision@K + Recall@K)
```

F1@K 适合需要一个平衡指标的场景，但它会掩盖业务偏好。合规问答可能更怕漏证据，应优先看 Recall；短上下文问答更怕噪声，应更关注 Precision。

### 5. MRR：第一个相关结果是否足够靠前

```text
RR = 1 / 第一个相关结果的名次
MRR = 所有问题 RR 的平均值
```

MRR 对第一个相关结果最敏感，适合单一答案、首条命中价值高的检索。它不关心第二、第三个相关结果，因此不适合单独评估需要多份证据的问题。

### 6. nDCG@K：多级相关性与排序质量

nDCG@K 允许把候选标为“不相关、部分相关、高度相关”等等级，并对越靠后的结果施加折损，再与理想排序比较。它比 MRR 更适合评估多文档、多等级相关性的 Reranker。

### 7. Context Precision / Context Recall：让模型辅助判定语义相关性

当人工 `chunkId` 标注不足时，可以让 LLM 判断每个 Context 是否与 Query 相关，或判断标准答案中的主张能否被 Context 覆盖。它们能降低大规模标注成本，但结果依赖裁判模型、Prompt、聚合方式和输入顺序，不能与传统基于明确 qrels 的 Precision/Recall 淵称为完全相同的指标。

## 三、生成层指标：再判断“模型有没有正确使用证据”

### 1. Faithfulness / Groundedness

将 Response 拆成可验证的原子主张，再逐项检查 Context 中是否存在支持证据：

```text
Faithfulness = 有上下文支持的主张数 / 回答中的全部可验证主张数
```

“未被上下文支持”不一定代表现实世界中是错的，但对严格 RAG 来说仍属于越界生成。尤其在企业制度、合同、诊疗和金融场景中，模型记忆中的常识不能替代当前授权知识库。

### 2. Answer Relevance

Answer Relevance 判断 Response 是否直接回应 Query。一个回答可能每句话都有依据，却只复述背景，没有给出用户要的办理条件、日期或操作步骤，此时 Faithfulness 高但 Answer Relevance 低。

### 3. Answer Correctness

Answer Correctness 需要参考答案或结构化事实标签，衡量回答与期望事实是否一致。它应重点比较金额、时间、版本、主体、条件和否定关系，而不是只看措辞相似。

开放式问答可能存在多个正确表达，因此 Exact Match、BLEU、ROUGE 等字面指标只能作为辅助。对订单状态、错误码、布尔结论等确定性输出，规则和结构化比较反而比 LLM 裁判更稳定。

### 4. Completeness 与 Citation Accuracy

- **Completeness**：参考答案中的必要事实覆盖了多少；
- **Citation Accuracy**：引用的来源是否真的支持相邻结论；
- **Citation Completeness**：应引用的关键主张是否都附有来源；
- **拒答正确性**：证据不足、权限不足或问题超出知识库时，是否按产品契约拒答或转人工。

引用不能只检查 URL 是否存在。应建立“主张 → 来源片段”的对应关系，并验证来源版本、页码、权限和有效期。

## 四、端到端与工程指标：质量之外还要能上线

完整分类至少包括以下四组：

| 指标组 | 代表指标 | 作用 |
|---|---|---|
| 任务质量 | Correctness、任务完成率、拒答正确率 | 判断业务是否完成 |
| 性能 | 检索/重排/生成 P50、P95、P99，超时率 | 找出尾延迟与阶段瓶颈 |
| 成本 | Embedding、Judge、生成 Token，单请求成本 | 防止离线评测和在线调用失控 |
| 安全与治理 | 越权召回率、敏感信息泄漏率、提示注入成功率、来源时效 | 验证权限和内容边界 |

线上还应观察追问率、改写率、复制答案率、转人工率、点踩原因和无结果率。但用户行为受页面设计、流量结构和业务周期影响，不能用线上点击指标直接替代离线事实评测。

## 五、怎样构建可用的黄金评测集

不要先问“需要多少条”，应先问“关键失败模式是否覆盖”。固定的 50、100 或 500 条都不是通用标准，样本量应由业务风险、问题分布和置信度要求决定。

一条评测样本建议至少包含：

```json
{
  "caseId": "refund-policy-001",
  "query": "签收后七天还能申请退款吗？",
  "expectedAnswer": "满足商品状态等条件时可在签收后七天内申请。",
  "relevantChunkIds": ["policy-refund-v3#section-2"],
  "requiredFacts": ["七天内", "需满足商品状态条件"],
  "forbiddenFacts": ["无条件退款"],
  "slice": ["售后", "时效", "单跳"],
  "knowledgeVersion": "refund-policy-v3"
}
```

数据集应覆盖：

1. 高频正常问题；
2. 长尾表达、错别字、简称和同义改写；
3. 多跳、对比、时间计算和否定问题；
4. 无答案、过期答案和冲突来源；
5. 权限隔离、提示注入和敏感数据问题；
6. 线上真实失败样本与用户投诉；
7. 每次修复对应的最小回归样本。

训练、调参与验收集合要隔离。开发者长期盯着同一批问题优化，会对评测集过拟合；上线前应使用未参与调参的保留集，并对关键样本进行人工复核。

## 六、Java 评测流水线：规则优先，模型裁判补位

Spring AI 2.0.0 的 `EvaluationRequest` 接收原始问题、上下文列表和回答，`RelevancyEvaluator` 可判断回答是否与问题及上下文一致。下面不是测试用例，而是可以由管理命令、定时任务或 CI 调用的批量评测服务：

```java
public record RagEvalCase(
        String caseId,
        String query,
        String expectedAnswer,
        Set<String> requiredFacts) {
}

public record RagRunResult(
        RagEvalCase evalCase,
        List<Document> contexts,
        String answer,
        long latencyMillis) {
}

public record CaseScore(
        String caseId,
        boolean requiredFactsPassed,
        boolean relevancyPassed,
        long latencyMillis) {
}
```

```java
@Service
public class RagEvaluationService {

    private final RelevancyEvaluator relevancyEvaluator;

    public RagEvaluationService(ChatModel judgeModel) {
        // 裁判模型与线上生成模型解耦，便于独立固定版本和评测成本
        this.relevancyEvaluator = new RelevancyEvaluator(
                ChatClient.builder(judgeModel));
    }

    public CaseScore evaluate(RagRunResult run) {
        boolean factsPassed = run.evalCase().requiredFacts().stream()
                // 确定性事实先用规则校验，避免无谓调用裁判模型
                .allMatch(run.answer()::contains);

        EvaluationRequest request = new EvaluationRequest(
                run.evalCase().query(),
                List.copyOf(run.contexts()),
                run.answer());

        EvaluationResponse response = relevancyEvaluator.evaluate(request);

        return new CaseScore(
                run.evalCase().caseId(),
                factsPassed,
                response.isPass(),
                run.latencyMillis());
    }
}
```

这段代码只展示最小接线。生产流水线还应保存 `caseId`、检索候选及分数、最终 Context、索引版本、模型版本、Prompt 哈希、裁判理由、Token、耗时和异常。没有这些原始轨迹，分数下降后无法判断是数据、检索、生成还是裁判漂移。

`FactCheckingEvaluator` 可用于检查 claim 是否被 document 支持，但复杂回答最好先拆分原子主张。把整段长答案作为一个 claim，容易让裁判忽略局部错误。

## 七、LLM-as-a-Judge 的四种用法与边界

### 1. 二元判定

输出 `PASS/FAIL`，适合发布门禁，解析稳定，但无法表达接近边界的样本。

### 2. 分级量表

例如 1～4 级，每一级都给出清晰、互斥的行为描述。不要只写“1 很差，4 很好”，否则不同裁判会使用不同尺度。

### 3. 成对比较

对同一问题比较候选 A 与 B，适合判断新旧版本谁更好。要随机交换 A/B 顺序并统计平局，降低位置偏差。

### 4. 主张级证据核验

拆分回答中的事实主张，为每条主张查找支持、矛盾或证据不足。它最利于诊断，但模型调用和 Token 成本最高。

裁判系统必须做校准：准备一组多人复核的样本，测量裁判与人工的一致性；固定模型快照、温度、Prompt 和结构化输出；记录拒答与解析失败；对低置信度、模型分歧和高风险样本转人工。不要让被测模型在没有独立校准的情况下直接给自己打分。

## 八、从评测报告定位故障，而不是只看总分

常见组合可以直接指向责任层：

| 检索表现 | Faithfulness | Answer Relevance | 可能原因 |
|---|---|---|---|
| 低 | 低 | 低 | 没找对资料，模型又自由发挥 |
| 高 | 低 | 中或高 | 上下文正确，但生成越界或提示词约束不足 |
| 高 | 高 | 低 | 回答有依据，却没有正面解决用户问题 |
| Recall 高、Precision 低 | 可能波动 | 可能波动 | 候选过多、Chunk 噪声或重排能力不足 |
| 离线高、线上低 | 不确定 | 不确定 | 数据集失真、流量漂移、权限或知识版本差异 |

报告必须按业务域、问题类型、知识版本、语言、长度、权限、是否多跳等维度切片。一个平均 90 分的系统，可能在退款时效问题上只有 50 分；平均值会掩盖真正需要阻断发布的风险。

## 九、发布门禁：比较退化，不迷信统一阈值

一套实用流程如下：

```text
数据集与配置冻结
        ↓
基线版本运行并保存逐样本轨迹
        ↓
候选版本使用同一环境运行
        ↓
比较检索、生成、延迟、成本与安全切片
        ↓
失败样本人工复核
        ↓
通过门禁后灰度发布，线上继续观察
```

门禁应同时包含：

- 关键安全用例必须全部通过；
- 核心业务切片不允许明显退化；
- 整体质量达到团队基线；
- P95 延迟和单请求成本不超预算；
- 评测失败、裁判解析失败和超时必须显式计数；
- 新增线上事故样本后，旧问题不能再次出现。

不要照搬别人给出的“Faithfulness 必须大于 0.8”。不同数据、裁判和定义产生的分数不可直接横向比较。更可靠的做法是先建立自己的人工校准基线，再比较同一数据集、同一裁判配置下的版本变化，并检查逐样本差异。

## 十、常见踩坑

### 1. 只评最终答案

无法区分检索失败与生成失败，调参只能靠猜。

### 2. 用生产答案反向生成标准答案

错误会被复制进评测集，导致系统“自己证明自己正确”。标准事实应追溯到权威来源并经过人工复核。

### 3. 评测时没有保存原始 Context

索引更新后无法复现当时输入，也无法审计 Faithfulness 分数。

### 4. 把相似度阈值当成质量阈值

向量分数只反映特定模型和度量下的接近程度，不等于事实相关，更不等于答案正确。

### 5. 只跑平均分

少数高频简单问题会稀释权限、否定、多跳等困难样本的失败。

### 6. 裁判 Prompt、模型升级却沿用旧基线

裁判变化会让分数不可比。评测系统本身也要做版本管理、回归和校准。

### 7. 只做离线评测

离线集合不能完整覆盖真实流量。线上失败应进入标注队列，再沉淀为离线回归样本，形成闭环。

## 十一、最佳实践

1. **先定义业务失败**：先写清“漏答、错答、越权、无依据、过期”分别意味着什么。
2. **分层采集轨迹**：保存 Query、候选排序、最终 Context、Response 和各阶段版本。
3. **规则优先**：金额、日期、ID、枚举、引用存在性先用确定性代码检查。
4. **模型裁判补语义**：将 LLM 用在相关性、完整性、依据性等开放判断上。
5. **裁判先校准**：用人工复核集测一致性，再扩大自动评测规模。
6. **数据集分层切片**：核心业务、困难样本、安全样本分别设门禁。
7. **逐样本比较版本**：关注哪些问题变好、哪些退化，不只比较平均值。
8. **质量、延迟、成本同屏**：高分但延迟翻倍的方案未必可上线。
9. **线上失败回流**：将真实问题脱敏、标注并加入回归集。
10. **知识与评测一起版本化**：知识变更后同步更新标准答案与证据标签。

## 十二、总结

RAG 评测不是给最终答案打一个分，而是建立可复现的故障定位系统。检索层用 Hit@K、Precision@K、Recall@K、MRR 和 nDCG@K 判断证据是否找对、排对；生成层用 Faithfulness、Answer Relevance、Correctness、Completeness 和引用指标判断模型是否正确使用证据；端到端再纳入任务完成、性能、成本、安全与线上反馈。

真正决定评测是否有用的，不是接入了多少框架，而是有没有版本化的真实数据集、明确的指标定义、可追溯的中间轨迹、经过人工校准的裁判，以及能阻止退化版本上线的发布门禁。做到这些，RAG 调优才会从“凭感觉试参数”变成可比较、可审计、可持续回归的工程过程。

## 参考资料

- [Spring AI 2.0.0：Evaluation Testing](https://docs.spring.io/spring-ai/reference/api/testing.html)
- [Spring AI 2.0.0：Retrieval Augmented Generation](https://docs.spring.io/spring-ai/reference/api/retrieval-augmented-generation.html)
- [Ragas：Available Metrics](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/)
- [TruLens：What is the RAG Triad?](https://truera.com/ai-quality-education/generative-ai-rags/what-is-the-rag-triad/)
- [RAGAS 原始论文：Automated Evaluation of Retrieval Augmented Generation](https://arxiv.org/abs/2309.15217)
- [OpenAI：Graders API](https://developers.openai.com/api/reference/resources/graders)
