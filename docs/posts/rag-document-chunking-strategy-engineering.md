---
title: RAG 文档切分工程实践：分块策略、重叠窗口与 Java 落地
date: 2026-11-22
category: 后端开发
cover: /covers/backend.svg
tags: [ai, rag, 文档切分, chunking, spring-ai, langchain4j, 向量检索, java]
excerpt: "以 Spring AI 1.1.x 与 LangChain4j 官方文档为基线，讲清 RAG 文档切分的完整方式分类、chunk_size 与 chunk_overlap 的取值逻辑、元数据继承与父子分块，并给出 Java 后端可落地的接口契约、失败边界与选型建议。"
---

# RAG 文档切分工程实践：分块策略、重叠窗口与 Java 落地

<img src="/images/posts/rag-document-chunking-strategy-engineering-knowledge-map.png" alt="RAG 文档切分工程实践：分块策略、重叠窗口与 Java 落地知识串联图" style="border-radius: 10px;" />

以 Spring AI 1.1.x 与 LangChain4j 官方文档为基线，讲清 RAG 文档切分的完整方式分类、chunk_size 与 chunk_overlap 的取值逻辑、元数据继承与父子分块，并给出 Java 后端可落地的接口契约、失败边界与选型建议。

`RAG` 的效果上限，很大程度不是在检索或生成阶段决定的，而是在**文档切分（Chunking）**这一步就基本锁死了。原因很朴素：向量检索的单位是文本块（chunk），不是整篇文档。**切得太碎，语义断裂；切得太大，噪声淹没答案**。后面无论换多强的重排序模型、写多精巧的 Prompt，都只是在一块已经定型的素材上做补救。

> 本文以 **Spring AI 1.1.x 官方 Javadoc** 与 **LangChain4j 官方 RAG 教程**为基线，事实核对时间为 **2026-11-22**。文中框架默认值、API 名称均来自官方资料；切分方式的具体分类属于工程实践归纳，不是某一家框架的专有概念。源文件给出的 `chunk_size=500`、`chunk_overlap=50` 属于经验起点，本文会讲清它为什么只是起点。

## 一、先说结论

先把工程判断摆出来，后面再逐条展开。

| 判断 | 结论 |
|---|---|
| 切分在 RAG 中的地位 | **索引质量决定检索上限**，切分是索引环节最影响召回的一步；Garbage In, Garbage Out 在这里成立 |
| 块大小怎么定 | 从经验起点（约 500 token）出发，用真实问题集评测调参，**不存在放之四海皆准的“最佳值”** |
| 重叠怎么定 | 重叠是为了缓解**边界语义被切断**，不是越大越好；它会线性放大存储与索引成本 |
| 切分方式怎么选 | 优先递归/结构化切分，语义与智能切分作为精度兜底；固定大小只适合作为 sub-splitter 的最后手段 |
| 元数据 | 切分时必须继承原文元数据并补充序号，否则后续按文件/部门/时间过滤全部失效 |
| 框架边界 | Spring AI 的 `TokenTextSplitter` 公开参数中**没有 overlap 项**；LangChain4j 的 `DocumentSplitters.recursive` 支持重叠与 sub-splitter |

一句话记住：**切分不是把长文本剁碎，而是在“语义完整”和“检索粒度”之间找一个可评测的平衡点**。

## 二、为什么切分决定 RAG 的效果上限

很多团队调 RAG 的顺序是反的：先换 embedding 模型，再调 Top-K，最后才想起看切分。而切分实际上同时卡住了三件事。

### 1. 检索粒度

向量相似度是对**一个块**打分。块里塞了五个主题，那么无论用户问其中哪一个，这个块的向量都会被另外四个主题稀释。反过来，块里只有半句话，相似度可能很高，但注入上下文后模型拿不到可用信息。**检索单位与语义单位对齐**，是切分的第一目标。

### 2. Token 预算

召回的 Top-K 块要拼进 Prompt。块越大，同样 K 下上下文越长，成本和延迟都上升，还可能挤掉指令与历史对话。切分本质是**给生成阶段的上下文预算提前分好份**。

### 3. 幻觉边界

源文提到的“省 token、避幻觉”是对的，但要理解机制：块过小导致上下文缺失，模型会用自己的参数知识补空，产生幻觉；块过大导致无关信息混入，模型会误把噪声当证据。**两头都会伤答案，只是伤法不同**。

下面这张链路图说明切分位置：

```mermaid
flowchart LR
    A[原始文档] --> B[清洗与规范化]
    B --> C[文档切分 Chunking]
    C --> D[向量化 Embedding]
    D --> E[向量库 + 元数据]
    E --> F[检索召回 Top-K]
    F --> G[注入 Prompt]
    G --> H[生成答案]
    C -. 决定检索单位与语义完整度 .-> F
```

注意虚线：**切分的质量会一路传递到检索与生成，但反过来很难在生成阶段修复**。

## 三、完整切分方式分类

源文列举了固定大小、递归、文档、语义、智能五种分片方式。这个列表方向对，但不完整。工程上公认的切分方式可以按“依据什么决定断点”补齐为六类，下面逐项解释。

### 1. 固定大小切分（Fixed-size）

按固定 token 或字符数硬切。

- **优点**：实现最简单，成本最低，块大小可控。
- **缺点**：不考虑句子、段落边界，最容易把一句话切成两半。
- **适用**：作为其他切分器的**最后一级 sub-splitter**，或处理日志、无结构文本。

### 2. 递归切分（Recursive）

按一组分隔符的优先级递归下降：先试着用段落切；段落还太大，就用句子切；句子还太大，再用词、字符切，直到满足上限。

- **优点**：兼顾语义边界与大小约束，是**通用文档的默认推荐**。
- **缺点**：依赖分隔符质量，表格、代码块、公式可能被切坏。
- **适用**：企业知识库、产品文档、FAQ 等大多数场景。LangChain4j 的 `DocumentSplitters.recursive(...)` 就是这一类。

### 3. 按文档结构切分（Document-structure / HTML / Markdown）

利用标题层级、章节、列表、表格等结构标记切分，为每个块附带它所属的标题路径。

- **优点**：语义边界最自然，块的“身份”清晰，便于加标题前缀增强检索。
- **缺点**：强依赖文档有可靠结构；扫描件、纯文本无结构可用。
- **适用**：Markdown 知识库、HTML 帮助中心、带标题的技术手册。

### 4. 语义切分（Semantic Chunking）

把文本先切成句子，再逐句计算 embedding，当相邻句子的语义距离超过阈值时断开。

- **优点**：断点跟随话题转换，粒度比规则更贴近语义。
- **缺点**：需要额外调用 embedding，索引成本明显上升；阈值需按领域校准。
- **适用**：长篇论述、会议纪要、访谈等话题自然流转的文本。

### 5. 智能 / LLM 切分（Intelligent / LLM-based）

用 LLM 判断语义边界，或先让 LLM 生成块摘要再切。

- **优点**：能理解上下文，处理复杂文档质量最高。
- **缺点**：成本与延迟最高，输出不稳定，需要工程化的重试与校验。
- **适用**：高价值、低频更新的语料，作为精度兜底手段。

### 6. 父子分块（Parent-Child / Small-to-Big）

同一份原文切成两级：**子块**小而精确，用于向量检索；命中后回填其**父块**给 LLM 作为上下文。

- **优点**：同时拿到“检索准”和“上下文全”，是生产环境高频方案。
- **缺点**：索引结构更复杂，需要维护父子映射与两级存储。
- **适用**：答案依赖周边段落、或需要引用完整章节的场景。

> 选型直觉：**递归切分是默认值，结构化文档优先文档结构切分，精度不够再加语义或父子，智能切分留作兜底**。固定大小单独用在正文上通常不是好主意。

## 四、chunk_size 与 chunk_overlap 怎么定

### 1. 源文的经验起点，以及它的适用边界

源文件给出一组很实用的经验值：`chunk_size=500`（token）、`chunk_overlap=50`，并给了中文正文的大致换算：500 token 约对应 700~1000 字连续中文正文，代码与参数较多时约 400~700 字。

这组数字**可以作为起点，但不要当成结论**，原因是：

1. 不同 embedding 模型有自己的上下文上限与训练粒度，块太大可能超过模型有效窗口。
2. token 与字符的换算取决于分词器。中文在不同分词器下，一个汉字可能是 1 个或多个 token。
3. 文档类型差异极大：法律条款和聊天记录用同一个块大小显然不合理。

### 2. chunk_size 的调参方法

工程上更可靠的方式是**用真实问题集反向评测**：

1. 准备 30~100 条真实用户问题，标注应该命中哪些文档段落。
2. 用同一批文档，分别以 300 / 500 / 800 token 切分建索引。
3. 比较召回命中率、答案正确率、平均上下文 token 数。
4. 选**效果达标且成本最低**的那一档，而不是盲目求大。

### 3. chunk_overlap 的真实作用

重叠的意义只有一个：**避免一段完整语义恰好横跨两个块的边界而被切断**。相邻块共享一小段文本，能让跨边界的问题仍被某一块完整覆盖。

但重叠的代价是线性的：重叠 20% 就近似多存 20% 的块。而且重叠过大反而会让召回结果高度重复，挤占 Top-K 名额。所以 50 token 这种小重叠是合理的起点，**超过 20%~25% 就要重新审视**。

### 4. 各框架默认值对照（核对日期 2026-11-22）

| 框架 | API | 相关默认值 | 说明 |
|---|---|---|---|
| Spring AI | `TokenTextSplitter` | `chunkSize=800` token、`minChunkSizeChars=350`、`minChunkLengthToEmbed=5`、`maxNumChunks=10000`、`keepSeparator=true`、标点集 `. ? ! \n`、编码 `CL100K_BASE` | 1.1.x 起构造函数已废弃，推荐 `builder()`；**公开参数中无 overlap** |
| LangChain4j | `DocumentSplitters.recursive(...)` | 官方文档未声明默认值；示例为 1000 token 块 + 200 token 重叠 | 1000/200 是**示例值不是默认值**；需显式传入 token 估算器 |

> 注意：Spring AI 的 `TokenTextSplitter` 在 token 数**未超过**块大小时不会做标点截断，整段作为单块返回；只有超过时才在 `minChunkSizeChars` 之后找标点断点。这解释了为什么短文档不会被无意义地切碎。

## 五、Spring AI 落地：TokenTextSplitter

Spring AI 把切分抽象成 `TextSplitter`，`TokenTextSplitter` 是其基于 token 计数的实现，位于 `org.springframework.ai.transformer.splitter` 包。

### 1. 构造切分器

```java
import org.springframework.ai.document.Document;
import org.springframework.ai.transformer.splitter.TextSplitter;
import org.springframework.ai.transformer.splitter.TokenTextSplitter;

/**
 * 构建中文知识库文档的切分器。
 * 说明：Spring AI 1.1.x 起 TokenTextSplitter 构造函数已废弃，官方推荐用 builder()。
 */
TextSplitter splitter = TokenTextSplitter.builder()
    // 目标块大小，单位是 token 不是字符；从经验起点 500 出发，需按评测结果调整
    .chunkSize(500)
    // 只在超长时于该字符数之后寻找标点断点，避免块在句子开头就被截断
    .minChunkSizeChars(200)
    // 长度低于此值的碎片直接丢弃，防止噪声块进入索引
    .minChunkLengthToEmbed(5)
    // 单篇文档最多生成的块数，防止超长文档拖垮索引任务
    .maxNumChunks(10000)
    // 保留换行等分隔符，维持原文的段落结构
    .keepSeparator(true)
    .build();
```

### 2. 在 ETL 管道中应用

```java
import java.util.List;

/**
 * 对加载后的文档执行切分，返回可直接向量化的文本块。
 * Document 是 Spring AI 的统一文档模型，切分过程会保留原文元数据。
 */
public List<Document> splitForIndexing(List<Document> loadedDocs) {
    // apply 是 TextSplitter 继承自 DocumentTransformer 的标准入口
    List<Document> chunks = splitter.apply(loadedDocs);
    // 工程建议：记录切分前后数量，便于监控索引质量漂移
    log.info("切分完成：原文 {} 篇 → 文本块 {} 个", loadedDocs.size(), chunks.size());
    return chunks;
}
```

### 3. 需要 overlap 怎么办

`TokenTextSplitter` 的公开参数中没有 overlap。如果业务确需重叠，可选两条路：

1. **换用支持重叠的切分实现**（如 LangChain4j 的递归切分），或在 Spring AI 中自定义一个 `TextSplitter` 子类实现滑动窗口。
2. **用父子分块替代重叠**：子块精确检索、父块补全上下文，很多场景下比简单重叠更有效。

不要为了凑重叠自己硬拼字符串——很容易破坏标点边界与元数据继承。

## 六、LangChain4j 落地：递归切分与 sub-splitter

LangChain4j 提供了更细的切分器家族：按段落、行、句子、词、字符、正则切分的 `DocumentByParagraphSplitter` 等，以及把它们组合起来的 `DocumentSplitters.recursive(...)`。

### 1. 递归切分示例

```java
import dev.langchain4j.data.document.Document;
import dev.langchain4j.data.document.DocumentSplitter;
import dev.langchain4j.data.document.DocumentSplitters;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.openai.OpenAiTokenCountEstimator;

/**
 * 构建带重叠的递归切分器。
 * 官方示例值 1000/200，此处按本文的经验起点改为 500/50，需按评测调整。
 */
DocumentSplitter splitter = DocumentSplitters.recursive(
    500,   // 每个 TextSegment 目标上限 500 token
    50,    // 相邻块之间保留 50 token 重叠，缓解边界语义断裂
    // token 估算器需与所选模型的分词方式匹配；这里沿用官方文档示例写法
    new OpenAiTokenCountEstimator("gpt-4o-mini")
);

/**
 * 执行切分并返回文本段。
 * 返回值 TextSegment 同时携带切分后的文本与元数据。
 */
public List<TextSegment> splitDocument(Document document) {
    return splitter.split(document);
}
```

### 2. 递归切分的内部行为

理解这三步，才能判断它适不适合你的文档：

1. 先按最粗的分隔符（如段落）切成小单元。
2. 把小单元尽量多地装进一个 `TextSegment`，但不超过上限。
3. 如果某个单元本身仍然过大，就调用 **sub-splitter**（如句子、字符切分器）继续下钻。

这就是为什么递归切分能同时兼顾边界与大小，也是为什么固定大小切分只适合当最后一级兜底。

### 3. 元数据继承与注入

LangChain4j 在切分时把原 `Document` 的**全部元数据复制**到每个 `TextSegment`，并额外增加一个从 0 开始递增的 `index` 元数据。这直接决定了后续过滤能否生效。

```java
import dev.langchain4j.data.segment.TextSegment;

/**
 * 切分后增强：在块文本前拼接文件名与标题，提升检索命中率。
 * 保留原 metadata，避免破坏按部门、按时间的过滤能力。
 */
TextSegment enriched = TextSegment.from(
    segment.metadata().getString("file_name") + "\n" + segment.text(),
    segment.metadata()
);
```

这个技巧本质是给每个块补上“我是谁、来自哪篇文档”的上下文，对标题密集的技术文档提升尤其明显。

## 七、父子分块：检索准 + 上下文全

当答案依赖周边段落时，父子分块是比调重叠更有效的手段。核心是同一份原文保留两级粒度，并维护稳定映射。

```java
import java.util.List;

/**
 * 父块：用于命中后回填给 LLM 的完整上下文。
 */
record ParentChunk(String docId, int parentIndex, String text) {}

/**
 * 子块：粒度更细，用于向量检索；通过 parentIndex 指回父块。
 */
record ChildChunk(String docId, int parentIndex, int childIndex, String text) {}

/**
 * 检索命中子块后，回填其父块作为生成上下文。
 * 工程上用一个 Map 维护映射即可，key 为 docId + parentIndex。
 */
public String expandToParentContext(ChildChunk hit, java.util.Map<String, ParentChunk> parentStore) {
    String key = hit.docId() + "#" + hit.parentIndex();
    ParentChunk parent = parentStore.get(key);
    // 找不到父块时降级为子块本身，保证链路不中断
    return parent == null ? hit.text() : parent.text();
}
```

关键工程约束：**父块与子块必须用同一套稳定的 ID 关联**，并在文档更新时一起失效重建，否则会召回“父块是旧版、子块是新版”的错位上下文。

## 八、常见追问

**Q：切分是不是越细，召回越准？**
不一定。过细会丢失上下文，命中率高但答案质量差。判断标准是“块能否单独回答一个子问题”。

**Q：中文文档按字符切还是按 token 切？**
按 token 切更贴近模型预算，但要意识到中文的 token/字符比不固定；调参时以评测结果为准，不要靠字符数硬换算。

**Q：表格和代码怎么处理？**
它们最容易被规则切分切坏。工程上通常把表格单独识别为一个块（保留表头），代码块按函数边界切，且不要把它们和相邻正文合并。

**Q：重叠到底设多少？**
从 50 token 或 10% 起，看评测是否改善跨边界问题；超过 20%~25% 就要检查是不是切分策略本身有问题。

**Q：切分一次就一劳永逸吗？**
不是。文档结构变化、模型更换、业务问题分布变化都会让原有切分失效，需要纳入常态评测。

## 九、踩坑清单

1. **把源文的 500/50 当常量写死**：换模型、换文档类型后效果断崖，却没有排查切分。
2. **忽略元数据继承**：切分后按文件/部门过滤失效，权限与时效控制跟着失效。
3. **重叠过大**：Top-K 被高度重复的块占满，表面命中率高，答案却更差。
4. **父子块更新不同步**：文档改版后父子错位，召回旧上下文。
5. **误认为调 API 就能解决结构问题**：代码块、表格被切坏，再强的重排序也救不回。
6. **不评测就调参**：凭感觉改块大小，无法判断改动是变好还是变坏。
7. **忽略 maxNumChunks**：超长文档生成海量块，索引任务被单篇文档拖垮。

## 十、选择建议与最佳实践

| 场景 | 推荐切分 | 起点配置 |
|---|---|---|
| 通用企业知识库 | 递归切分 + 小重叠 | 500 token / 50 重叠 |
| 结构化技术文档 | 按标题层级切分 + 标题前缀增强 | 按章节，超长再 sub-split |
| 答案依赖上下文 | 父子分块 | 子块 300~500，父块 1000~1500 |
| 长篇论述、纪要 | 语义切分 | 句级 embedding + 语义阈值 |
| 高价值小语料 | 智能 / LLM 切分 | 作为精度兜底，控制成本 |
| 日志、无结构文本 | 固定大小 + 标点断点 | 仅作最后手段 |

落地时建议固定四步节奏：**清洗 → 切分 → 评测 → 再调参**。把切分配置（块大小、重叠、方式、token 估算器）作为可版本化的配置项管理，而不是散落在代码里的魔法数字。

## 十一、总结

- 切分决定向量检索的单位，是 RAG 效果的上游瓶颈，**生成阶段很难补救切分的错误**。
- 完整方式分六类：固定大小、递归、按文档结构、语义、智能、父子分块；**递归切分是通用默认值**。
- `chunk_size` 与 `chunk_overlap` 没有万能值，500/50 只是起点，必须用真实问题集评测调参。
- Spring AI `TokenTextSplitter`（1.1.x，默认 800 token、无 overlap 参数）适合快速接入；LangChain4j `DocumentSplitters.recursive(...)` 支持重叠与 sub-splitter，控制更细。
- 切分时务必继承元数据、补充序号，并维护父子块稳定映射；忽略这些会让过滤、权限与更新一致性同时出问题。

切分做对了，后面的检索与生成才有发挥空间。把它当成一项需要持续评测的工程能力，而不是一次性配置。
