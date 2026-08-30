---
title: RAG HyDE 工程实践：假设文档检索、融合与失败边界
date: 2026-08-30
category: 后端开发
cover: /images/posts/rag-hyde-retrieval-engineering-knowledge-map.webp
tags: [ai, rag, hyde, spring-ai, retrieval]
excerpt: HyDE 先生成一段像知识库正文的假设文档，再用它检索真实资料，从而缩小短问题与长文档之间的表达差距；生产系统还必须保留原问题召回、权限过滤、结果融合、超时降级和离线评测。
---

# RAG HyDE 工程实践：假设文档检索、融合与失败边界

<img src="/images/posts/rag-hyde-retrieval-engineering-knowledge-map.webp" alt="RAG HyDE 工程实践：假设文档检索、融合与失败边界知识串联图" style="border-radius: 10px;" />

HyDE 先生成一段像知识库正文的假设文档，再用它检索真实资料，从而缩小短问题与长文档之间的表达差距；生产系统还必须保留原问题召回、权限过滤、结果融合、超时降级和离线评测。

## 先说结论：假设文档只负责“找路”，不能充当证据

用户问题通常很短，例如“订单一直处理中怎么办”；知识库里真正相关的段落却可能写成“支付回调超时后，订单状态由异步对账任务收敛”。直接计算问题与文档的向量相似度，可能因为词汇、句式和信息密度不同而漏召回。

HyDE（Hypothetical Document Embeddings）先让模型生成一段看起来像答案或知识库正文的**假设文档**，再用这段文本的向量寻找真实文档。它改变的是检索入口，不是事实来源：假设文档允许包含错误，因此最终回答只能引用检索到的真实资料，不能把假设内容混入上下文。

本文以 2023 年 ACL 论文 *Precise Zero-Shot Dense Retrieval without Relevance Labels* 和 **2026-08-30** 的 Spring AI 当前参考文档为核对基线。论文中的 HyDE 面向无相关性标注的零样本稠密检索；下文给出的是适合企业 RAG 的工程变体：原问题与假设文档双路召回，再融合、过滤和生成，不宣称复现论文实验结果。

## 一、完整链路只有六步

1. **规范化问题**：合并必要的会话指代，但保留原始业务意图；
2. **生成假设文档**：要求模型模拟知识库正文，不输出引用、链接和未经输入提供的具体编号；
3. **双路召回**：原问题负责保住精确词、错误码和实体，假设文档负责补充语义表达；
4. **权限过滤**：两路检索都必须使用同一租户、部门、文档级权限和有效期条件；
5. **融合与裁剪**：按稳定文档 ID 去重，用排名融合而不是直接混加不同检索器的分数；
6. **基于真实文档回答**：上下文为空时明确拒答，输出引用并保留检索证据链。

这六步中，只有第二步允许“想象”。第三步之后进入回答上下文的内容必须来自受控知识库。

## 二、先定义契约，再写控制流

下面的 Java 数据结构把假设文本、真实证据和最终回答分开，避免在后续代码中误用：

```java
import org.springframework.ai.document.Document;

import java.time.Duration;
import java.util.List;
import java.util.Map;

public record HydeRequest(
        String tenantId,
        String question,
        String permissionFilter,
        int topK,
        Duration generationTimeout
) {}

public record RetrievalEvidence(
        String documentId,
        String source,
        String content,
        double fusionScore,
        Map<String, Object> metadata
) {}

public record HydeResult(
        String answer,
        List<RetrievalEvidence> evidence,
        boolean hydeUsed,
        String fallbackReason
) {}
```

`hypotheticalDocument` 不出现在 `HydeResult.evidence` 中，因为它不是证据。生产日志也不应默认记录全文；问题和假设文档可能包含用户隐私，只记录哈希、长度、模型调用耗时和受控采样即可。

## 三、用 Spring AI 实现双路召回

Spring AI 当前 RAG API 把查询转换、文档检索和后处理拆成模块。HyDE 可以实现为自定义预检索步骤：用 `ChatClient` 生成假设文档，再把原问题与假设文档分别交给同一个 `VectorStore`。

```java
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

public final class HydeRetriever {
    private final ChatClient hydeClient;
    private final VectorStore vectorStore;
    private final Executor retrievalExecutor;

    public HydeRetriever(
            ChatClient hydeClient,
            VectorStore vectorStore,
            Executor retrievalExecutor
    ) {
        this.hydeClient = hydeClient;
        this.vectorStore = vectorStore;
        this.retrievalExecutor = retrievalExecutor;
    }

    public RetrievalBatch retrieve(HydeRequest request) {
        String hypothetical;
        String fallbackReason = null;

        try {
            hypothetical = CompletableFuture.supplyAsync(
                            () -> generateHypotheticalDocument(request.question()),
                            retrievalExecutor)
                    .orTimeout(request.generationTimeout().toMillis(), TimeUnit.MILLISECONDS)
                    .join();
        } catch (RuntimeException timeoutOrModelFailure) {
            // HyDE 是召回增强，不应让模型故障击穿基础检索。
            hypothetical = null;
            fallbackReason = "hyde_generation_failed";
        }

        List<Document> originalHits = search(
                request.question(), request.permissionFilter(), request.topK());
        List<Document> hydeHits = hypothetical == null
                ? List.of()
                : search(hypothetical, request.permissionFilter(), request.topK());

        return new RetrievalBatch(originalHits, hydeHits,
                hypothetical != null, fallbackReason);
    }

    private String generateHypotheticalDocument(String question) {
        return hydeClient.prompt()
                .system("""
                        你是企业知识库检索改写器。根据问题生成一段可能出现在知识库中的正文。
                        只补充通用术语、原因、处理步骤和失败边界；不要声称内容真实，
                        不要生成引用、URL、人员、订单号、版本号或未提供的具体数值。
                        仅输出用于向量检索的正文，不回答用户。
                        """)
                .user(question)
                .call()
                .content();
    }

    private List<Document> search(String query, String filter, int topK) {
        SearchRequest searchRequest = SearchRequest.builder()
                .query(query)
                .topK(topK)
                // 原问题和 HyDE 路径必须使用完全相同的权限过滤。
                .filterExpression(filter)
                .build();
        List<Document> hits = vectorStore.similaritySearch(searchRequest);
        return hits == null ? List.of() : new ArrayList<>(hits);
    }
}

record RetrievalBatch(
        List<Document> originalHits,
        List<Document> hydeHits,
        boolean hydeUsed,
        String fallbackReason
) {}
```

线程池必须有界，模型调用还要受全链路 deadline、并发舱壁和成本预算控制。超时后回退到原问题检索，比返回一段未经真实资料支撑的“假设答案”安全。

## 四、不要直接相加相似度，用排名融合

原问题与假设文档的相似度分数未必处于同一分布。简单相加会让某一路因为分数尺度更高而长期支配结果。可用 Reciprocal Rank Fusion（RRF）只融合排名：

```java
import org.springframework.ai.document.Document;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class RankFusion {
    private static final int RRF_K = 60; // 超参数必须通过本地评测确定

    public static List<RetrievalEvidence> fuse(
            RetrievalBatch batch,
            int limit
    ) {
        Map<String, Double> scores = new HashMap<>();
        Map<String, Document> documents = new LinkedHashMap<>();

        addRanking(batch.originalHits(), scores, documents);
        addRanking(batch.hydeHits(), scores, documents);

        return scores.entrySet().stream()
                .sorted(Map.Entry.<String, Double>comparingByValue().reversed())
                .limit(limit)
                .map(entry -> toEvidence(documents.get(entry.getKey()), entry.getValue()))
                .toList();
    }

    private static void addRanking(
            List<Document> ranking,
            Map<String, Double> scores,
            Map<String, Document> documents
    ) {
        for (int index = 0; index < ranking.size(); index++) {
            Document document = ranking.get(index);
            String id = stableDocumentId(document);
            documents.putIfAbsent(id, document);
            scores.merge(id, 1.0 / (RRF_K + index + 1), Double::sum);
        }
    }

    private static String stableDocumentId(Document document) {
        Object chunkId = document.getMetadata().get("chunk_id");
        if (chunkId == null) {
            throw new IllegalStateException("检索文档缺少稳定 chunk_id");
        }
        return chunkId.toString();
    }

    private static RetrievalEvidence toEvidence(Document document, double score) {
        return new RetrievalEvidence(
                stableDocumentId(document),
                String.valueOf(document.getMetadata().get("source")),
                document.getText(),
                score,
                document.getMetadata());
    }
}
```

`RRF_K=60` 只是常见起点，不是标准答案。融合后仍要做文档版本过滤、相邻块合并、重复内容压缩和必要的重排序；最终上下文大小由评测结果与模型输入预算决定，不能固定照抄 `topK`。

## 五、哪些问题适合 HyDE

| 场景 | HyDE 价值 | 主要风险 |
| --- | --- | --- |
| 短问题与长文档表达差距大 | 假设正文补充领域措辞 | 生成内容把检索带偏 |
| 零样本或缺少相关性标注 | 不依赖已训练的查询-文档配对 | 不等于无需评测 |
| 用户口语与知识库术语不同 | 缩小语体和词汇差异 | 专有名词可能被改写掉 |
| 跨语言检索 | 可把问题转成语料主要语言的正文 | 翻译和生成误差叠加 |

以下情况不应默认启用：错误码、订单号、类名、法规条款等精确词检索；问题本身已经是完整文档片段；生成延迟或成本预算很紧；知识库规模很小且关键词检索足够稳定。它们通常更适合原问题检索、BM25 或混合检索。

## 六、五类失败必须提前收口

### 1. 假设内容污染答案

假设文档只进入检索器，不进入最终回答上下文。最终提示词应明确“只能依据证据回答”，并输出真实文档 ID、标题或 URL。

### 2. 精确实体被模型改写

保留原问题召回，并把错误码、产品型号和业务 ID 提取为过滤条件或关键词通道。不要让 HyDE 独占入口。

### 3. 权限绕过

权限过滤必须在向量库查询阶段执行，不能先跨租户召回再在 Java 内存中删除。原问题和 HyDE 两路使用同一可信认证上下文构造过滤表达式，客户端不能直接提交过滤字符串。

### 4. 模型超时或容量不足

为 HyDE 生成设置短 deadline、并发上限和熔断；失败时回退原问题检索并记录 `fallbackReason`。向量库失败则按业务风险选择拒答或返回可验证的非 RAG 结果，不能让模型裸答。

### 5. 提升了召回，却降低最终答案

HyDE 可能带回更多语义相近但事实无关的块。上线前至少比较原始检索与 HyDE 的 `Recall@K`、`MRR/nDCG`、上下文精确率、答案忠实度、空结果率、P95 延迟和单请求成本，并按查询类型分桶。

## 七、上线采用按查询路由，而不是全量开关

一个可治理的决策顺序是：

```text
精确实体或编号明显      → 关键词/原问题优先
问题过短且缺少领域词    → 原问题 + HyDE 双路召回
问题包含多个独立子问题  → 先拆分，再分别决定是否 HyDE
HyDE 超时或熔断         → 原问题检索
真实证据为空            → 明确拒答或转人工
```

灰度发布时使用稳定哈希分流，保证同一查询样本长期落在固定实验组。每次记录查询类型、HyDE 是否启用、两路命中文档 ID、融合排名、过滤条件摘要、最终引用和用户反馈；敏感文本只留脱敏样本或哈希。

HyDE 的价值可以压缩成一句话：让模型生成“更像文档的检索探针”，再用真实语料验证这根探针指向哪里。只要坚持假设不作证、原问题不丢弃、权限不过滤后置、失败可降级、效果靠数据评测，它就是可控的召回增强；否则只是把一次模型幻觉提前插入检索链路。

## 参考资料

- [ACL 2023：Precise Zero-Shot Dense Retrieval without Relevance Labels](https://aclanthology.org/2023.acl-long.99/)
- [Spring AI Reference：Retrieval Augmented Generation](https://docs.spring.io/spring-ai/reference/api/retrieval-augmented-generation.html)

