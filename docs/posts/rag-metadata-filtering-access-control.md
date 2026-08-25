---
title: 企业 RAG 元数据过滤工程实践：版本、权限与检索前置约束
date: 2026-08-25
category: AI
cover: /images/posts/rag-metadata-filtering-access-control-knowledge-map.webp
tags: [ai, rag, spring-ai, metadata, access-control, vector-store]
excerpt: 元数据过滤不是召回后的清理步骤，而是进入相似度检索前的候选集约束。本文从元数据建模、租户与权限过滤、Spring AI 2.0.1 实现、失败语义和可观测性出发，给出企业 RAG 防止旧版本混入与越权召回的工程方案。
---

# 企业 RAG 元数据过滤工程实践：版本、权限与检索前置约束

<img src="/images/posts/rag-metadata-filtering-access-control-knowledge-map.webp" alt="企业 RAG 元数据过滤工程实践：版本、权限与检索前置约束知识串联图" style="border-radius: 10px;" />

元数据过滤不是召回后的清理步骤，而是进入相似度检索前的候选集约束。本文从元数据建模、租户与权限过滤、Spring AI 2.0.1 实现、失败语义和可观测性出发，给出企业 RAG 防止旧版本混入与越权召回的工程方案。

## 先说结论：先确定“能看什么”，再计算“像不像”

向量相似度只回答内容是否接近，不知道用户属于哪个租户、是否有权限，也不知道文档是否已过期。生产检索应按以下顺序执行：

```text
认证身份与业务上下文
  → 服务端构造强制过滤条件
  → 向量库在合法候选集内做相似度检索
  → 重排与上下文裁剪
  → LLM 生成或在空结果时拒答
```

如果先从全库取 Top-K，再在 Java 中过滤，至少有三个问题：无权文档已越过存储边界；合法结果可能被非法结果挤出 Top-K；日志、缓存和异常链路可能留下敏感内容。因此，租户、权限和有效期条件应尽可能下推到向量数据库。

本文以 **Spring AI 2.0.1** 的 `VectorStore`、`SearchRequest` 和模块化 RAG API 为事实基线，核对日期为 2026-08-25。不同 Vector Store 对字段类型、索引和操作符的支持并不完全相同，上线前必须以所用实现的官方文档和真实执行计划验证。

## 元数据不是随手附加的 Map

企业知识库的元数据可分成五类：

| 类别 | 典型字段 | 主要用途 |
|---|---|---|
| 隔离范围 | `tenant_id`、`workspace_id` | 阻断跨租户、跨空间召回 |
| 授权属性 | `visibility`、`department_id`、`role_codes` | 按公开、部门、角色等规则限定访问 |
| 生命周期 | `status`、`version`、`effective_from`、`effective_to` | 排除草稿、废弃和不在有效期的版本 |
| 来源追溯 | `document_id`、`chunk_id`、`source_uri`、`page` | 引用、审计、删除和重建 |
| 索引治理 | `embedding_version`、`schema_version`、`indexed_at` | 灰度迁移、回滚和异常定位 |

字段必须在文档入库前统一命名、类型和缺省语义。`version` 若按字符串存储，`"10"` 与 `"2"` 的比较不等于数值比较；时间字段应使用底层存储明确支持的格式；权限字段缺失时默认拒绝，不要默认公开。

同一原文切成多个 Chunk 后，访问控制元数据必须复制到每个 Chunk。只在父文档表保存权限、向量记录却没有可过滤字段，会迫使在线检索先召回再回表鉴权，既降低性能，也容易在异常分支漏掉校验。

## 权限过滤不能由用户自由拼接

一个请求中的条件通常来自三处：

1. **身份强制条件**：租户、用户、部门、角色，由认证与授权服务提供；
2. **业务强制条件**：仅发布版本、当前有效期、指定知识空间，由服务端策略决定；
3. **用户可选条件**：产品类型、年份、来源等搜索偏好，只能从白名单字段和操作符构造。

最终条件是三者的交集。用户输入不能覆盖身份条件，也不能直接作为完整 `filterExpression` 传入。否则攻击者可能构造 `tenant_id != '当前租户'` 或追加宽泛 `OR`，绕过服务端边界。

授权判断也不应委托给 LLM。模型可以理解用户意图，但不能决定某个 Chunk 是否可见；这一决定必须由确定性代码和可信身份完成。

## Spring AI：用类型化 DSL 构造服务端条件

Spring AI 的 `SearchRequest` 接受字符串表达式或 `Filter.Expression`。字符串适合固定配置；包含身份与权限时，优先使用 `FilterExpressionBuilder`，避免手工转义和表达式注入。

下面把租户、发布状态和可见范围组合为强制条件：

```java
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.filter.Filter;
import org.springframework.ai.vectorstore.filter.FilterExpressionBuilder;

public record RagPrincipal(
        String tenantId,
        String departmentId,
        List<String> roleCodes) {
}

public final class RagAccessFilterFactory {

    public Filter.Expression build(RagPrincipal principal) {
        if (principal == null || principal.tenantId() == null) {
            throw new IllegalArgumentException("缺少 RAG 访问主体");
        }

        FilterExpressionBuilder b = new FilterExpressionBuilder();

        Filter.Expression tenant = b.eq("tenant_id", principal.tenantId());
        Filter.Expression published = b.eq("status", "PUBLISHED");

        // 公开文档与本部门文档可以访问；角色 ACL 可按底层存储能力继续扩展
        Filter.Expression visibility = b.or(
                b.eq("visibility", "PUBLIC"),
                b.and(
                        b.eq("visibility", "DEPARTMENT"),
                        b.eq("department_id", principal.departmentId())
                )
        );

        // 租户与发布状态始终是强制条件，调用方不能删除
        return b.and(tenant, published, visibility).build();
    }
}
```

调用检索时，把过滤条件和相似度参数放进同一个 `SearchRequest`：

```java
public final class AuthorizedVectorRetriever {

    private final VectorStore vectorStore;
    private final RagAccessFilterFactory filterFactory;

    public AuthorizedVectorRetriever(
            VectorStore vectorStore,
            RagAccessFilterFactory filterFactory) {
        this.vectorStore = vectorStore;
        this.filterFactory = filterFactory;
    }

    public List<Document> retrieve(String question, RagPrincipal principal) {
        Filter.Expression accessFilter = filterFactory.build(principal);

        SearchRequest request = SearchRequest.builder()
                .query(question)
                .topK(8)
                .similarityThreshold(0.65)
                .filterExpression(accessFilter)
                .build();

        // 过滤由 Vector Store 翻译并下推，不在应用内对全库 Top-K 做事后清理
        return vectorStore.similaritySearch(request);
    }
}
```

`topK` 和阈值只是示例，不是通用最优值。应基于本项目的标注集调整，并分别观察过滤前候选规模、合法召回率和空结果率。

## 动态 Advisor 过滤：上下文参数不是信任边界

Spring AI 的 `QuestionAnswerAdvisor` 与 `VectorStoreDocumentRetriever` 支持在每次请求中传入动态过滤条件。这适合不同请求使用不同租户或知识空间，但条件仍应由服务端生成：

```java
// 编译器只接受可信主体和白名单策略，负责值编码，不接收用户原始表达式
String filter = accessFilterCompiler.compile(principal, policy);

String answer = chatClient.prompt()
        .user(question)
        // 这里只传服务端生成的表达式，不透传浏览器提交的原始过滤字符串
        .advisors(a -> a.param(
                VectorStoreDocumentRetriever.FILTER_EXPRESSION,
                filter))
        .call()
        .content();
```

如果框架入口只接受字符串，应把允许字段、值类型和操作符封装在一个专用编译器中，并对值做严格编码。不要开放“高级搜索语法”后再试图用关键字黑名单拦截。

## 版本与有效期：检索过滤和索引切换要配合

仅过滤 `status == 'PUBLISHED'` 仍可能同时召回同一文档的多个发布版本。常见策略有两种：

- **单活版本**：新版本成功写入后，将旧版本标记为非活动或删除，查询只过滤 `active == true`；
- **索引代际切换**：新版本写入新的 `index_version`，完成校验后原子切换在线版本，旧代保留一段时间用于回滚。

无论采用哪种策略，都应保留稳定 `document_id` 与唯一 `chunk_id`，并把文档状态变更与向量写入设计成可重试流程。不能先删除旧版，再因 Embedding 调用失败导致线上无可用版本。

时间有效性需要明确时区与边界。例如“有效至 2026-08-31”究竟在当天零点还是次日零点失效，必须在入库时转换为统一时间点。若底层向量库不支持所需时间比较，可以预计算 `active` 或使用版本化索引，但要保证状态更新及时且可审计。

## 底层存储决定过滤能力与成本

Spring AI 提供可移植过滤 DSL，但可移植接口不代表各数据库执行代价相同。

- PgVector 实现会把过滤表达式转换为 PostgreSQL JSON Path；高频字段需要结合实际 SQL 和索引验证；
- Cassandra 的可过滤元数据需要是主键或配置 SAI 索引；
- Weaviate、OpenSearch 等实现也有各自的字段声明、类型和原生操作符限制。

过滤选择性过低时，查询仍会扫描大量候选；选择性过高或权限字段索引不当，则可能导致延迟升高。应至少用生产规模数据验证 P95/P99、召回率和执行计划，不能只在几十条样本上确认“能返回结果”。

## 空结果、异常与降级

过滤后没有合法 Chunk，是一种正常业务结果，不应自动移除权限条件重试。推荐区分：

| 状态 | 对外行为 | 内部记录 |
|---|---|---|
| 合法但无匹配 | 明确告知未找到依据，可引导补充问题 | `EMPTY_RETRIEVAL` |
| 身份或租户缺失 | 拒绝请求 | `AUTH_CONTEXT_MISSING` |
| 过滤表达式不受支持 | 失败关闭，不做无过滤降级 | `FILTER_UNSUPPORTED` |
| 向量库超时 | 返回稍后重试或走已授权缓存 | `VECTOR_STORE_TIMEOUT` |
| 权限服务不可用 | 默认拒绝，不使用上次不明状态 | `AUTHZ_UNAVAILABLE` |

“失败关闭”意味着系统宁可不给答案，也不越权返回。若业务要求高可用，可以使用带主体、策略版本和过期时间的授权缓存；不能简单关闭过滤。

## 可观测性与评测

日志不要记录完整 Chunk 或原始权限列表。建议记录：

- 请求追踪 ID、租户哈希、知识空间和策略版本；
- 过滤模板 ID、字段名与条件数量，不记录敏感字段值；
- 检索耗时、候选数、最终 Chunk 数和空结果原因；
- 向量索引版本、Embedding 版本和知识版本；
- 越权拦截数、过滤编译失败数、存储降级数。

离线评测除 Recall@K、Precision@K 外，还要加入安全样本：跨租户同名文档、旧版与新版冲突、角色刚撤销、字段缺失、恶意过滤表达式和权限服务异常。安全门禁应检查“无权 Chunk 召回数必须为 0”，不能被平均相关性分数稀释。

## 常见误区

1. **召回后再鉴权**：无权内容已进入应用，且会挤占合法 Top-K。
2. **把租户 ID 放进 Prompt**：Prompt 不是数据库访问控制，模型也无法阻止检索器越权。
3. **允许前端提交完整过滤表达式**：用户可改变逻辑结构并扩大范围。
4. **权限字段缺失时默认公开**：历史数据或入库失败会静默变成越权入口。
5. **只有文档级权限，没有 Chunk 级元数据**：在线检索无法可靠下推条件。
6. **相信统一 DSL 就忽略数据库差异**：字段类型、索引和操作符支持仍需逐实现验证。
7. **空结果时取消过滤重试**：相关性问题被错误升级为安全事件。
8. **只测正常用户**：不测跨租户、撤权、旧版本与异常分支，就无法证明边界成立。

## 总结

元数据过滤的核心不是给向量搜索多加几个字段，而是把合法候选集定义为检索契约的一部分：可信身份生成强制条件，业务策略补充版本与有效期，用户偏好只能在白名单内收窄范围，最终由 Vector Store 在相似度搜索前执行。

落地时要同时治理元数据模型、Chunk 继承、类型化过滤构造、底层索引、空结果语义和安全评测。只有当“无权 Chunk 永远进不了候选集”，RAG 才能从内部 Demo 走向可审计的企业知识服务。

## 参考资料

- [Spring AI 2.0.1：Vector Databases 与 Metadata Filters](https://docs.spring.io/spring-ai/reference/api/vectordbs.html)
- [Spring AI 2.0.1：Retrieval Augmented Generation](https://docs.spring.io/spring-ai/reference/api/retrieval-augmented-generation.html)
- [Spring AI 2.0.1：PGvector Metadata Filtering](https://docs.spring.io/spring-ai/reference/api/vectordbs/pgvector.html)
- [Spring AI 2.0.1：Apache Cassandra Vector Store](https://docs.spring.io/spring-ai/reference/api/vectordbs/apache-cassandra.html)
- [Spring AI 2.0.1：Weaviate Vector Store](https://docs.spring.io/spring-ai/reference/api/vectordbs/weaviate.html)
