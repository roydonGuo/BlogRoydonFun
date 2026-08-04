---
title: RAG 混合检索工程实践：BM25、向量召回、RRF 与重排序
date: 2026-08-04
category: 后端开发
cover: /covers/backend.svg
tags: [ai, rag, spring-ai, elasticsearch, search]
excerpt: 从关键词与向量召回的互补性出发，讲清分数融合、RRF、语义重排的边界，并给出 Spring AI 2.0.0 混合检索实现与评测方法。
---

# RAG 混合检索工程实践：BM25、向量召回、RRF 与重排序

<img src="/images/posts/rag-hybrid-retrieval-rrf-knowledge-map.png" alt="RAG 混合检索工程实践：BM25、向量召回、RRF 与重排序知识串联图" style="border-radius: 10px;" />

很多 RAG 项目在 Demo 阶段只做一件事：把问题向量化，从向量数据库取 Top-K 文档，再拼进 Prompt。这个方案面对自然语言问答通常能工作，但进入真实业务后，会暴露出一类稳定问题：语义相近的内容能找到，订单号、错误码、产品型号和专有名词却经常丢失。

例如用户问“支付回调报错 `SIGN_ERROR_1024` 怎么处理”，向量检索可能召回一篇语义相近的“签名失败排查”，却漏掉包含完整错误码的版本公告；BM25 能精确命中错误码，却可能无法理解“撤销订单”和文档中的“关闭交易”表达的是同一业务动作。

混合检索（Hybrid Retrieval）的目标，就是让关键词检索与语义检索互补，再通过稳定的融合与精排流程，把真正有用的少量文档交给模型。

> 本文以 **Spring AI 2.0.0** 的模块化 RAG API 为示例。RRF 原理来自 Cormack、Clarke、Büttcher 在 SIGIR 2009 发表的论文；Elasticsearch 当前版本也提供原生 RRF Retriever。不同搜索引擎的向量字段、过滤语法、授权方式和默认参数可能不同，落地时应以实际版本文档为准。

## 一、先看完整 RAG 链路

RAG 不是一次向量查询，而是离线索引与在线检索生成两条链路的组合。

### 1. 离线索引链路

```text
数据源
  → 文档解析与清洗
  → 分块（Chunking）
  → 补充文档 ID、租户、权限、来源、版本等元数据
  ├─ 建立倒排索引，供 BM25 检索
  └─ 生成 Embedding，写入向量索引
```

分块质量决定了后续检索的上限。Chunk 过大，会混入多个主题并浪费上下文；Chunk 过小，会切断条件、结论和代码之间的关系。不存在适合所有文档的“固定 500 Token”答案，接口文档、故障手册、合同与源码应采用不同的结构化切分策略。

### 2. 在线查询链路

```text
用户问题
  → 查询清洗 / 改写（可选）
  → 权限与元数据过滤
  ├─ BM25 关键词召回
  └─ 向量语义召回
  → 去重与结果融合（如 RRF）
  → Reranker 精排（可选）
  → 上下文裁剪与排序
  → LLM 生成带依据的回答
```

这条链路中，召回、融合和重排是三个不同阶段：召回负责“尽量别漏”，融合负责“合并不同检索器的排序”，重排负责“用更昂贵的方法提高前几名精度”。

## 二、混合检索的四种信号

生产系统常用的检索信号不只有 BM25 和稠密向量，完整理解后才能确定哪些需要组合。

| 信号 | 核心依据 | 擅长场景 | 主要限制 |
|---|---|---|---|
| 关键词/稀疏检索 | 词项、词频、逆文档频率 | 编号、错误码、专有名词、精确短语 | 难理解同义表达与语义改写 |
| 稠密向量检索 | Embedding 空间中的相似度 | 自然语言语义、同义词、跨表达匹配 | 罕见 Token 与精确值可能弱，依赖模型和分块质量 |
| 学习型稀疏检索 | 模型生成或扩展稀疏词项权重 | 同时保留词项可解释性与语义扩展 | 需要额外模型与索引支持，成本更高 |
| 结构化过滤 | 租户、权限、时间、部门、文档类型 | 缩小合法候选集合 | 本身不负责相关性排序 |

结构化过滤不应被当成第四路“召回后再过滤”。租户和权限条件必须尽可能下推到每个检索器，在候选生成前生效。否则系统可能先把无权访问的 Chunk 拉回应用，再因日志、缓存或异常信息造成数据泄露。

## 三、BM25 与向量检索为什么互补

### 1. BM25：对词项精确度敏感

BM25 基于倒排索引计算相关性，核心考虑包括：

- 查询词在当前文档中的出现频率；
- 查询词在整个语料库中的稀有程度；
- 文档长度，避免长文档仅靠词数多获得过高分数；
- 搜索引擎的分词、同义词和字段权重配置。

它特别适合错误码、SKU、类名、配置项和法规条款编号。缺点是依赖字面词项：用户说“登录不上”，文档只写“身份认证失败”，如果没有同义词或查询扩展，召回可能很弱。

### 2. 向量检索：对语义接近度敏感

向量检索把问题与 Chunk 映射为高维向量，再按余弦相似度、点积或距离等方式寻找近邻。具体度量必须与 Embedding 模型和向量库配置一致，不能随意互换。

它能找到“忘记密码”和“重置凭证”这类表达不同但含义接近的文档。然而，向量模型可能弱化很少见的错误码或数字差异，把 `v2.1.0` 与 `v2.10.0` 视为近似文本；对于必须精确匹配的业务标识，仅依靠语义相似度风险很高。

### 3. 两路 Top-K 不应该相同地机械设置

BM25 与向量检索的结果分布不同，候选数应通过评测确定。例如关键词查询对错误码命中很集中，Top-20 可能足够；向量近邻存在更多语义噪声，可能需要 Top-50 后再融合。统一写死为 Top-5，通常会在融合前就丢失有价值候选。

## 四、三类融合与精排方案

### 1. 加权分数融合

最直观的方式是：

```text
finalScore = alpha × lexicalScore + (1 - alpha) × vectorScore
```

问题在于 BM25 分数与向量相似度不在同一量纲，且 BM25 分数范围会随查询和语料变化。直接相加会让某一路长期支配结果。必须先做 Min-Max、Z-Score 或其他稳定归一化，再用标注数据调 `alpha`。

它的优势是可以表达业务偏好，例如 SKU 查询明显偏向关键词；缺点是归一化、权重和分数漂移都需要持续治理。

### 2. RRF：只使用排名，不依赖原始分数

Reciprocal Rank Fusion（倒数排名融合）对每个文档计算：

```text
RRF(d) = Σ 1 / (k + rank_i(d))
```

- `rank_i(d)` 是文档 `d` 在第 `i` 个结果列表中的名次，从 1 开始；
- 文档不在某个列表中时，该列表不加分；
- `k` 用于降低头部名次差异带来的剧烈波动。

同一个 Chunk 在多路结果中都靠前，会累积更高分。RRF 不关心 BM25 是 12.8 分还是向量相似度 0.86，因此很适合融合量纲不同的检索器。

Elasticsearch 当前 RRF Retriever 的 `rank_constant` 默认值为 60；这只是产品默认值，不是所有数据集的理论最优值。`rank_window_size` 决定每路参与融合的候选窗口，窗口更大可能提高召回，也会增加计算成本。

### 3. Reranker：融合后的语义精排

Cross-Encoder 或专用 Reranker 会同时读取“问题 + 候选 Chunk”，逐个输出相关性分数。它通常比单独比较两个 Embedding 更准确，但计算成本也高，所以应放在粗召回与融合之后，只处理几十个候选。

RRF 与 Reranker 不是同一类算法：

- RRF 是**多路排名融合**，不理解文档正文；
- Reranker 是**内容级相关性判断**，可以重新改变融合结果；
- 常见生产链路是“BM25 + 向量召回 → RRF → Reranker → Top-N”。

如果已有充足标注数据，还可以训练 Learning to Rank 或学习型融合模型。但它会引入特征版本、训练数据偏差和在线推理复杂度，不应在没有可靠离线评测前盲目采用。

## 五、RRF 的直观示例

假设 `k = 60`，两路召回如下：

| 名次 | BM25 | 向量检索 |
|---|---|---|
| 1 | A | B |
| 2 | C | A |
| 3 | D | E |

文档 A 同时出现在两路前列：

```text
A = 1/(60+1) + 1/(60+2)
B = 1/(60+1)
C = 1/(60+2)
```

A 的单路名次不是都排第一，但因为获得两路一致支持，融合后通常会超过只在单路出现的 B、C。RRF 奖励“多个检索器共同认可”，同时保留每一路独有候选进入结果的机会。

## 六、Java 实现：稳定 ID、租户过滤与双路并行召回

下面定义统一的检索结果。`chunkId` 必须在倒排索引和向量索引中保持一致，否则同一 Chunk 无法去重和累积分数。

```java
public record RetrievedChunk(
        String chunkId,
        String content,
        Map<String, Object> metadata,
        double score) {

    public RetrievedChunk withScore(double newScore) {
        return new RetrievedChunk(chunkId, content, metadata, newScore);
    }
}

public interface KeywordRetriever {
    List<RetrievedChunk> search(String query, String tenantId, int topK);
}

public interface VectorRetriever {
    List<RetrievedChunk> search(String query, String tenantId, int topK);
}
```

两种 Retriever 的实现可以分别调用 Elasticsearch BM25 与向量数据库，也可以都落在支持混合检索的同一个搜索引擎。无论底层如何实现，`tenantId` 都必须在查询候选阶段下推。

### 1. 独立的 RRF 融合器

```java
public final class RrfFusion {

    private RrfFusion() {
    }

    public static List<RetrievedChunk> fuse(
            List<List<RetrievedChunk>> rankings,
            int rankConstant,
            int limit) {

        if (rankConstant < 1 || limit < 1) {
            throw new IllegalArgumentException("rankConstant 和 limit 必须大于 0");
        }

        Map<String, Double> fusedScores = new HashMap<>();
        Map<String, RetrievedChunk> chunksById = new HashMap<>();

        for (List<RetrievedChunk> ranking : rankings) {
            for (int index = 0; index < ranking.size(); index++) {
                RetrievedChunk chunk = ranking.get(index);
                int rank = index + 1;

                // 统一 chunkId 用于跨检索器去重，同一文档在多路结果中会累积分数
                chunksById.putIfAbsent(chunk.chunkId(), chunk);
                fusedScores.merge(
                        chunk.chunkId(),
                        1.0d / (rankConstant + rank),
                        Double::sum
                );
            }
        }

        return fusedScores.entrySet().stream()
                .sorted(Map.Entry.<String, Double>comparingByValue().reversed())
                .limit(limit)
                .map(entry -> chunksById.get(entry.getKey())
                        .withScore(entry.getValue()))
                .toList();
    }
}
```

这个实现只使用名次，不使用各 Retriever 的原始 `score`。如果两路返回相同 Chunk 的正文或元数据版本不一致，`putIfAbsent` 会掩盖问题；生产系统应通过索引版本号监控并阻止不一致数据进入融合。

### 2. 接入 Spring AI 2.0.0 `DocumentRetriever`

Spring AI 的 `DocumentRetriever` 可以从搜索引擎、向量库、数据库或知识图谱获取文档，因此可以用自定义实现封装混合召回。

```java
@Component
public class HybridDocumentRetriever implements DocumentRetriever {

    private static final int KEYWORD_TOP_K = 30;
    private static final int VECTOR_TOP_K = 50;
    private static final int RRF_K = 60;
    private static final int FINAL_TOP_K = 8;

    private final KeywordRetriever keywordRetriever;
    private final VectorRetriever vectorRetriever;
    private final TenantProvider tenantProvider;
    private final Executor retrievalExecutor;

    public HybridDocumentRetriever(
            KeywordRetriever keywordRetriever,
            VectorRetriever vectorRetriever,
            TenantProvider tenantProvider,
            Executor retrievalExecutor) {
        this.keywordRetriever = keywordRetriever;
        this.vectorRetriever = vectorRetriever;
        this.tenantProvider = tenantProvider;
        this.retrievalExecutor = retrievalExecutor;
    }

    @Override
    public List<Document> retrieve(Query query) {
        String tenantId = tenantProvider.requireTenantId();

        // 两路召回相互独立，并行执行可以降低在线检索总延迟
        CompletableFuture<List<RetrievedChunk>> keywordFuture =
                CompletableFuture.supplyAsync(
                        () -> keywordRetriever.search(
                                query.text(), tenantId, KEYWORD_TOP_K),
                        retrievalExecutor);

        CompletableFuture<List<RetrievedChunk>> vectorFuture =
                CompletableFuture.supplyAsync(
                        () -> vectorRetriever.search(
                                query.text(), tenantId, VECTOR_TOP_K),
                        retrievalExecutor);

        List<RetrievedChunk> fused = RrfFusion.fuse(
                List.of(keywordFuture.join(), vectorFuture.join()),
                RRF_K,
                FINAL_TOP_K
        );

        return fused.stream()
                .map(chunk -> Document.builder()
                        .id(chunk.chunkId())
                        .text(chunk.content())
                        .metadata(chunk.metadata())
                        .score(chunk.score()) // 保存融合分，便于日志与离线分析
                        .build())
                .toList();
    }
}
```

示例选择“两路都成功才生成答案”的严格策略。若业务允许一路故障时降级，必须明确记录缺失的检索器，并在评测中单独衡量降级质量；不能静默返回结果，让运维误以为混合检索正常工作。

### 3. 交给 `RetrievalAugmentationAdvisor`

```java
@Configuration(proxyBeanMethods = false)
public class RagConfiguration {

    @Bean
    public Advisor hybridRagAdvisor(HybridDocumentRetriever retriever) {
        return RetrievalAugmentationAdvisor.builder()
                .documentRetriever(retriever)
                .queryAugmenter(ContextualQueryAugmenter.builder()
                        // 没有合法上下文时要求模型拒答，避免退化为无依据回答
                        .allowEmptyContext(false)
                        .build())
                .build();
    }
}
```

Spring AI 还提供 Query Transformer、Document Joiner 与 Document PostProcessor 等模块。Reranker 可以实现为 `DocumentPostProcessor` 放在检索之后；问题改写则属于检索之前。模块位置放错，会造成额外 Token 消耗或改变无法解释的排序结果。

## 七、原生搜索引擎 RRF 还是应用层 RRF

如果 BM25 与向量索引都在 Elasticsearch，优先评估原生 RRF Retriever：它能在协调节点合并候选，并提供稳定的 `rank_window_size` 与分页语义，应用无需搬运两组大结果。

应用层 RRF 更适合这些场景：

- BM25 在 Elasticsearch，向量在独立 Vector Store；
- 需要组合知识图谱、数据库或第三方搜索 API；
- 每一路需要独立的熔断、灰度和实验参数；
- 需要实现产品暂不支持的加权或业务规则。

选择应用层融合后，要额外承担超时、部分失败、去重、分页一致性和网络成本。尤其不能对每一页重新拉取不同大小的候选窗口，否则同一查询翻页时可能出现重复或丢失。

## 八、Reranker 应该放在哪里

Reranker 的输入通常是一个查询与几十个候选 Chunk，输出新的相关性顺序。推荐顺序是：

1. BM25 与向量检索各取较大的候选集；
2. 用 RRF 合并并去重；
3. 截取有限候选交给 Reranker；
4. 根据 Token 预算、来源多样性和重复度选择最终上下文。

不要把全部知识库交给 Reranker，也不要先将每路裁剪成 Top-3 再融合。前者成本不可控，后者会让召回阶段过早丢失文档。

精排还应保留这些业务规则：

- 同一来源连续 Chunk 可合并，但必须控制总长度；
- 同一文档重复片段应去重；
- 最新版本优先于已废弃版本；
- 高权限文档不能因相关性高绕过权限过滤；
- 最终上下文保留来源、页码或 URI，便于回答引用与追溯。

## 九、参数不能靠“经验默认值”决定

混合检索至少有这些可调参数：

- BM25 的字段权重、分词器、同义词与候选 Top-K；
- Embedding 模型、向量维度、相似度度量与候选 Top-K；
- 元数据过滤条件与时间范围；
- RRF 的 `k` 与每路候选窗口；
- Reranker 候选数量与最终上下文数量；
- Chunk 大小、重叠、父子关系和索引版本。

这些参数相互影响。增加向量 Top-K 可能提高 Recall，却让 Reranker 更慢；缩小 Chunk 可能提高局部匹配，却让答案失去上下文。任何调参都应绑定版本化评测集，而不是只观察几个人工问题。

## 十、如何评测混合检索是否真的更好

### 1. 检索层指标

| 指标 | 关注点 | 适用问题 |
|---|---|---|
| Recall@K | 所有相关文档中，有多少进入前 K | 是否漏掉正确依据 |
| Precision@K | 前 K 中有多少真正相关 | 上下文是否混入太多噪声 |
| MRR | 第一个相关结果的倒数名次 | 正确依据是否足够靠前 |
| nDCG@K | 考虑多级相关性与位置折损 | 多个文档相关程度不同时的排序质量 |

必须分别记录 BM25、向量、RRF 和 Reranker 的指标，才能定位收益来自哪一层。只看最终答案正确率，无法区分“检索没找到”和“模型拿到正确上下文仍回答错”。

### 2. 生成层指标

- Faithfulness：回答是否能被检索上下文支持；
- Answer Relevance：是否直接回答用户问题；
- Correctness：与人工标注事实是否一致；
- Citation Accuracy：引用来源是否真正支持对应结论。

LLM-as-a-Judge 可以扩大评测规模，但裁判模型本身存在偏差。关键样本仍需要人工复核，评测 Prompt、模型版本和温度也要一并版本化。

### 3. 工程指标

- BM25、Embedding、向量检索、融合、重排和生成各阶段 P95/P99；
- 各路超时率、降级率与空召回率；
- 每次请求的候选数、上下文 Token 与模型成本；
- 租户过滤命中、权限拒绝和敏感文档泄漏告警；
- 索引延迟、Embedding 版本分布与双索引一致性。

## 十一、常见误区与踩坑

### 1. 不归一化就直接加权原始分数

BM25 与向量相似度量纲不同，直接相加没有稳定语义。选择分数融合就必须明确归一化和权重训练方式；否则使用 RRF 更容易建立可解释基线。

### 2. 把 RRF 当成语义 Reranker

RRF 完全不读取正文，只看名次。它无法判断某个 Chunk 是否真正回答问题，仍可能需要内容级 Reranker。

### 3. 先召回再做权限过滤

权限条件必须下推到每一路 Retriever。应用层事后过滤不仅有泄漏风险，还会造成合法候选数量不足。

### 4. 两套索引使用不同 Chunk ID

同一文本在 BM25 和向量索引中 ID 不一致，RRF 会把它当成两个文档，既无法累积分数，也会重复占用上下文。

### 5. Embedding 升级后不重建索引

查询向量和文档向量必须来自兼容的模型与维度。升级模型、改变归一化方式或维度时，应使用新索引重建并灰度切换，不能在旧索引上直接混用。

### 6. 把 Top-K 固定为 3 或 5

最终上下文可能只有 3～8 个 Chunk，但粗召回通常需要更大的候选集。召回窗口、融合窗口和最终上下文数量是三个不同参数。

### 7. 没有上下文仍允许模型自由回答

企业知识问答通常应在合法上下文为空时明确拒答或转人工。否则系统会从“检索增强”静默退化为模型记忆回答，用户却无法感知依据已经缺失。

## 十二、最佳实践

1. **先建立单路基线**：分别测 BM25 与向量检索，确认它们确实互补。
2. **权限过滤前置**：租户、角色、部门和文档状态进入每一路候选查询。
3. **统一 Chunk 身份**：内容、来源、版本、哈希和权限元数据在双索引中一致。
4. **先用 RRF 建立稳定基线**：没有可靠标注数据时，优先避免跨量纲分数调权。
5. **有限候选再精排**：Reranker 只处理融合后的有限窗口，并设置超时与降级。
6. **拒绝空上下文自由生成**：事实型问答明确无依据时的产品行为。
7. **保留来源与版本**：最终回答可以追溯到原始文档、页码和更新时间。
8. **分层观测与评测**：检索、融合、重排、生成分别记录质量、延迟和成本。
9. **索引变更可灰度回滚**：Chunk、Embedding 与检索参数都要版本化。

## 十三、总结

混合检索不是简单地“BM25 查一次、向量库查一次，然后拼起来”。一条可靠的生产链路需要先把权限过滤下推到候选生成阶段，再用稳定 Chunk ID 去重，通过 RRF 或经过归一化的分数融合合并排序，最后只把有限候选交给 Reranker 精排。

BM25 负责守住错误码、编号和专有名词等精确信号，向量检索负责理解同义表达与自然语言语义，RRF 负责跨量纲融合，Reranker 负责内容级精筛。把四者的职责分清，并用 Recall@K、nDCG、Faithfulness、延迟和成本分层验证，RAG 才能从“能回答”走向“可解释、可调优、可上线”。

## 参考资料

- [Spring AI 2.0.0：Retrieval Augmented Generation](https://docs.spring.io/spring-ai/reference/api/retrieval-augmented-generation.html)
- [Spring AI 2.0.0：DocumentRetriever API](https://docs.spring.io/spring-ai/docs/current/api/org/springframework/ai/rag/retrieval/search/DocumentRetriever.html)
- [Elasticsearch：Reciprocal Rank Fusion](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion)
- [Elasticsearch：Hybrid Search](https://www.elastic.co/docs/solutions/search/hybrid-search)
- [Cormack、Clarke、Büttcher：Reciprocal Rank Fusion 论文](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf)
