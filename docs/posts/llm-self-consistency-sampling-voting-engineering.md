---
title: LLM 自我一致性工程实践：多路径采样、归一化投票与成本边界
date: 2026-09-01
category: AI
cover: /images/posts/llm-self-consistency-sampling-voting-engineering-knowledge-map.webp
tags: [llm, self-consistency, chain-of-thought, spring-ai, java]
excerpt: 自我一致性不是让模型反复修改同一答案，而是独立采样多条推理路径，提取并归一化最终答案，再用可审计的聚合规则选出共识；工程落地还必须处理无效样本、并列、置信门槛、并发预算和错误相关性。
---

# LLM 自我一致性工程实践：多路径采样、归一化投票与成本边界

<img src="/images/posts/llm-self-consistency-sampling-voting-engineering-knowledge-map.webp" alt="LLM 自我一致性工程实践：多路径采样、归一化投票与成本边界知识串联图" style="border-radius: 10px;" />

自我一致性不是让模型反复修改同一答案，而是独立采样多条推理路径，提取并归一化最终答案，再用可审计的聚合规则选出共识；工程落地还必须处理无效样本、并列、置信门槛、并发预算和错误相关性。

## 先说结论：它是“采样后聚合”，不是“多问几遍”

Self-Consistency 的核心可以压缩成四步：

1. 对同一个确定问题独立生成多份候选；
2. 让候选之间具有足够差异，而不是复制同一条路径；
3. 从每份候选中提取可比较的最终答案；
4. 边缘化掉推理路径，选择出现最一致的答案。

原始论文把它作为 Chain-of-Thought 的解码策略：不再只取一条贪心路径，而是采样多条不同推理路径，再按最终答案的一致程度聚合。论文在算术与常识推理基准上验证了收益，但这不等于“任何开放式任务多调用几次都会更准”。它最适合**答案空间可枚举、可规范化、可客观验证**的任务，例如分类、选择题、数值计算、有限状态判断和规则推断。

本文以 [Self-Consistency 原始论文](https://arxiv.org/abs/2203.11171) 与 Spring AI 当前 **2.0.1** API 为事实基线，核对日期为 **2026-09-01**。生产示例不会要求或保存模型的隐藏推理过程，而只收集简短、可审计的理由摘要和最终答案；这是对论文方法的工程化适配，不是对供应商内部推理能力的假设。

## 一、先判断任务是否值得使用

| 任务 | 是否适合 | 原因 |
| --- | --- | --- |
| 订单风险等级 `LOW/MEDIUM/HIGH` | 适合 | 答案集合有限，可按规则复核 |
| 发票税额计算 | 有条件适合 | 数值可规范化，但应优先使用确定性计算工具 |
| SQL 查询是否只读 | 适合 | 可先投票，再交给解析器做硬校验 |
| 营销文案哪一版更好 | 不适合直接多数投票 | 开放文本没有天然等价类，“多数”未必代表质量 |
| 当前库存是多少 | 不适合 | 事实应查询权威数据源，重复采样不会创造新事实 |
| 支付、删库、发消息 | 不可直接驱动副作用 | 共识不是授权，执行仍需鉴权、审批与幂等 |

判断标准不是“任务难不难”，而是最终答案能否进入稳定的等价类。若 `42`、`42.0`、`四十二` 和 `约 42 个` 应被视为同一答案，就必须先定义规范化规则；否则投票统计的是表达差异，不是认知一致性。

## 二、数据结构要先于并发循环

先把采样、规范化和聚合结果建模，避免控制流里到处传裸字符串：

```java
import java.time.Duration;
import java.util.List;
import java.util.Map;

public record SelfConsistencyRequest(
        String question,
        int sampleCount,
        int minValidSamples,
        double minAgreement,
        Duration timeout
) {
    public SelfConsistencyRequest {
        if (question == null || question.isBlank()) {
            throw new IllegalArgumentException("question 不能为空");
        }
        if (sampleCount < 3 || sampleCount > nineSampleLimit()) {
            throw new IllegalArgumentException("sampleCount 必须在 3 到 9 之间");
        }
        if (minValidSamples < 2 || minValidSamples > sampleCount) {
            throw new IllegalArgumentException("minValidSamples 非法");
        }
        if (minAgreement <= 0.5 || minAgreement > 1.0) {
            throw new IllegalArgumentException("minAgreement 必须大于 0.5");
        }
    }

    private static int nineSampleLimit() {
        return 9; // 示例系统的成本硬上限，不是论文或框架默认值。
    }
}

public record SampleAnswer(
        String finalAnswer,
        String reasonSummary,
        List<String> assumptions
) {}

public record ValidSample(
        int sampleIndex,
        String canonicalKey,
        SampleAnswer raw
) {}

public record ConsensusResult(
        Status status,
        String answer,
        double agreement,
        int validSamples,
        Map<String, Long> votes,
        List<String> failureCodes
) {
    public enum Status {
        AGREED, TIED, LOW_CONFIDENCE, INSUFFICIENT_SAMPLES
    }
}
```

`sampleCount`、`minAgreement` 等值必须来自离线评测和成本预算，不能照搬示例。请求对象把上限放在入口，防止调用方用一次请求放大成几十次模型调用。

## 三、采样必须独立，但不能失控

“独立采样”至少意味着：每个样本单独调用、共享相同问题与输出契约、不把前一个答案塞给下一个样本。若后续样本看到前序结果，它们会发生锚定，表面共识可能只是互相抄写。

多样性可以来自供应商支持的随机采样选项、不同但等价的提示示例，或经过验证的模型组合。不要假定每个模型都支持同名参数或相同取值范围；具体温度、`top_p`、候选数和随机种子必须按当前供应商官方文档配置，并记录在实验版本中。

并发也要有三层边界：

- 单请求最多产生多少样本；
- 整个服务最多有多少在途模型调用；
- 单个租户每分钟可消耗多少样本与 Token。

并行只缩短墙钟时间，不减少费用。若所有样本同时超时或触发限流，系统还会形成重试风暴，因此模型调用层只能重试明确的瞬时网络错误，并受统一截止时间约束。

## 四、用 Spring AI 生成结构化样本

Spring AI 2.0.1 的 `ChatClient` 可以把响应映射为 Java 实体；当前文档还提供 `validateSchema()`，用于按实体 Schema 校验并在失败时携带错误反馈重试。供应商原生结构化输出是否可用仍取决于具体 Provider，不能默认开启。

```java
import org.springframework.ai.chat.client.ChatClient;

public final class SpringAiReasoningSampler {
    private final ChatClient samplingClient;

    public SpringAiReasoningSampler(ChatClient samplingClient) {
        this.samplingClient = samplingClient;
    }

    public SampleAnswer sample(String question) {
        return samplingClient.prompt()
                .system("""
                        你是受约束的判定器。
                        独立解决问题，不参考其他候选。
                        finalAnswer 只写最终答案；reasonSummary 最多三句，
                        只给可审计的理由摘要；assumptions 列出关键假设。
                        不执行工具，不产生任何业务副作用。
                        """)
                .user(question)
                .call()
                .entity(SampleAnswer.class, spec -> spec.validateSchema());
    }
}
```

这里应注入一个专门的 `samplingClient`：模型、随机采样选项、超时与重试策略在配置层固定并版本化。不要在业务方法里临时切换不明模型，也不要把最终用户的整段敏感上下文复制到每个样本。只传完成判断所需的最小数据。

Schema 校验只保证结构，不保证业务正确。`finalAnswer="HIGH"` 可以通过字符串 Schema，却仍可能违反风险规则；因此下一步必须由确定性代码完成白名单、范围和语义校验。

## 五、规范化决定投票是否可信

规范化器应针对任务类型编写，禁止用一个通用的“转小写再投票”处理所有问题：

```java
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Locale;
import java.util.Set;

public interface AnswerNormalizer {
    String canonicalize(String rawAnswer);
}

public final class RiskLevelNormalizer implements AnswerNormalizer {
    private static final Set<String> ALLOWED =
            Set.of("LOW", "MEDIUM", "HIGH", "REJECT");

    @Override
    public String canonicalize(String rawAnswer) {
        if (rawAnswer == null) {
            throw new IllegalArgumentException("答案为空");
        }
        String key = rawAnswer.strip().toUpperCase(Locale.ROOT);
        if (!ALLOWED.contains(key)) {
            throw new IllegalArgumentException("未知风险等级");
        }
        return key;
    }
}

public final class MoneyNormalizer implements AnswerNormalizer {
    @Override
    public String canonicalize(String rawAnswer) {
        // 金额统一为两位小数；币种必须由独立字段约束，不能靠字符串猜测。
        return new BigDecimal(rawAnswer.strip())
                .setScale(2, RoundingMode.UNNECESSARY)
                .toPlainString();
    }
}
```

常见规范化策略包括：

- 分类题：映射到封闭枚举，拒绝未知值；
- 数值题：统一单位、精度和舍入规则，再比较；
- 日期时间：解析为带时区的标准类型，禁止只比显示文本；
- 集合题：元素规范化、去重、排序后比较；
- 实体题：使用稳定业务 ID，不按名称模糊合并。

不要让另一个 LLM 独自承担规范化。它可能把原本不同的答案“理解”为相同，给投票引入第二层不可见误差。开放文本若确实需要语义聚类，应把聚类器版本、阈值与人工抽检纳入评测，并把结果称为工程变体，而不是原始多数投票。

## 六、聚合要显式处理无效样本、并列与低置信

```java
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.function.IntFunction;
import java.util.stream.IntStream;

public final class SelfConsistencyEngine {
    private final Executor executor;
    private final SpringAiReasoningSampler sampler;
    private final AnswerNormalizer normalizer;

    public SelfConsistencyEngine(
            Executor executor,
            SpringAiReasoningSampler sampler,
            AnswerNormalizer normalizer) {
        this.executor = executor;
        this.sampler = sampler;
        this.normalizer = normalizer;
    }

    public ConsensusResult decide(SelfConsistencyRequest request) {
        List<CompletableFuture<ValidSample>> futures = IntStream
                .range(0, request.sampleCount())
                .mapToObj(newSampleTask(request))
                .toList();

        List<ValidSample> valid = new ArrayList<>();
        List<String> failures = new ArrayList<>();
        long deadline = System.nanoTime() + request.timeout().toNanos();

        for (int i = 0; i < futures.size(); i++) {
            try {
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) {
                    throw new java.util.concurrent.TimeoutException(
                            "请求级截止时间已到");
                }
                valid.add(futures.get(i).get(remaining, TimeUnit.NANOSECONDS));
            } catch (Exception ex) {
                failures.add("SAMPLE_" + i + "_FAILED");
                futures.get(i).cancel(true);
            }
        }

        if (valid.size() < request.minValidSamples()) {
            return result(ConsensusResult.Status.INSUFFICIENT_SAMPLES,
                    null, 0.0, valid, failures, Map.of());
        }

        Map<String, Long> votes = valid.stream().collect(
                java.util.stream.Collectors.groupingBy(
                        ValidSample::canonicalKey,
                        LinkedHashMap::new,
                        java.util.stream.Collectors.counting()));

        List<Map.Entry<String, Long>> ranking = votes.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue(
                        Comparator.reverseOrder()))
                .toList();

        long topVotes = ranking.getFirst().getValue();
        boolean tied = ranking.size() > 1
                && ranking.get(1).getValue() == topVotes;
        double agreement = (double) topVotes / valid.size();

        if (tied) {
            return result(ConsensusResult.Status.TIED,
                    null, agreement, valid, failures, votes);
        }
        if (agreement < request.minAgreement()) {
            return result(ConsensusResult.Status.LOW_CONFIDENCE,
                    null, agreement, valid, failures, votes);
        }
        return result(ConsensusResult.Status.AGREED,
                ranking.getFirst().getKey(), agreement, valid, failures, votes);
    }

    private IntFunction<CompletableFuture<ValidSample>> newSampleTask(
            SelfConsistencyRequest request) {
        return index -> CompletableFuture.supplyAsync(() -> {
            SampleAnswer raw = sampler.sample(request.question());
            String key = normalizer.canonicalize(raw.finalAnswer());
            return new ValidSample(index, key, raw);
        }, executor);
    }

    private ConsensusResult result(
            ConsensusResult.Status status,
            String answer,
            double agreement,
            List<ValidSample> valid,
            List<String> failures,
            Map<String, Long> votes) {
        return new ConsensusResult(status, answer, agreement,
                valid.size(), Map.copyOf(votes), List.copyOf(failures));
    }
}
```

示例为了突出边界而省略了取消传播、全局信号量、重试分类和指标埋点。生产代码还应使用一次**请求级截止时间**，而不是让每个 `future.get()` 都重新获得完整超时；否则最坏等待时间会被样本数放大。

`agreement = 最高票数 / 有效样本数` 只能叫“内部一致率”，不能直接解释为答案正确概率。五个样本一致地犯同一个错误，内部一致率仍是 100%。

## 七、提前停止可以省成本，但要避免顺序偏差

当某答案的票数已经不可能被剩余样本追平时，可以提前结束。例如已完成 5 个样本，其中 A 得 4 票，只剩 1 个未完成，A 已确定胜出。但提前停止还要同时满足最低有效样本数与置信门槛。

不要因为“前 3 个都一样”就无条件停止。并发请求的完成顺序往往与生成长度和缓存命中相关，先返回的短答案可能不是随机子集。更稳妥的做法是：

1. 预先确定最大样本数与最小样本数；
2. 至少收齐最小样本数；
3. 只有数学上锁定胜者且达到门槛时才取消剩余任务；
4. 记录已发出但被取消的调用，成本统计不能把它们当作零。

## 八、失败处理要返回状态，不要硬凑答案

自我一致性至少有四种非成功终态：

- `INSUFFICIENT_SAMPLES`：有效样本不足，通常降级到单次确定性流程或稍后重试；
- `TIED`：最高票并列，交给规则引擎、验证器或人工复核；
- `LOW_CONFIDENCE`：有胜者但未达门槛，不产生高风险副作用；
- `AGREED`：只代表满足内部聚合规则，仍需经过业务校验与授权。

若答案可执行确定性验证，应在投票前过滤明显错误，在投票后再验证胜者。例如 SQL 判读应经过 AST 解析，金额应重新用代码计算，引用应检查来源是否真实存在。验证器的硬证据优先于模型票数。

## 九、安全与可观测性要按“放大器”设计

一次用户请求会放大为多次模型调用，因此输入中的提示注入、个人信息和恶意载荷也会被复制。工程上要做到：

- 采样器默认没有写工具；确需只读工具时使用最小权限和调用预算；
- 不因多数样本请求同一副作用就自动授权；
- 日志默认不保存完整 Prompt、候选原文和隐藏推理，只记录脱敏摘要；
- 记录 `request_id`、采样策略版本、模型配置版本、计划/有效/失败样本数、票型、内部一致率、延迟与 Token；
- 指标标签只放低基数字段，问题文本、答案和用户 ID 不进入指标标签。

Spring AI 当前为 `ChatClient`、Advisor 和 ChatModel 提供 Micrometer Observation，并默认不导出 Prompt 与 Completion 内容，因为它们体积大且可能包含敏感信息。自定义的聚合层仍需补充自己的业务 Span，才能看见“一次决策包含多少次模型调用”。

## 十、上线前必须用任务集校准

至少准备一套带标准答案的离线数据，分别对比：

| 方案 | 关注指标 |
| --- | --- |
| 单次确定性回答 | 准确率、P95 延迟、平均 Token |
| 固定 N 次 Self-Consistency | 准确率增益、成本倍数、并列率 |
| 置信门槛 + 提前停止 | 准确率、平均实际样本数、误拒率 |
| 规则/工具验证 | 硬错误拦截率、额外延迟 |

还要按问题类型、语言、长度和风险等级切片，检查错误是否高度相关。若同一类错误在所有样本中同步出现，继续增加 N 只会增加成本，不会增加信息。此时应改进事实来源、提示契约、验证器或模型组合，而不是继续投票。

上线阈值应来自曲线而不是直觉：观察 N 从 1 增加时准确率是否已进入平台期，再选择满足业务目标的最小 N。高风险任务即使达到共识，也应保留确定性验证或人工审批。

## 十一、与 Reflection、模型集成和投票器的边界

- **Self-Consistency**：同一问题独立采样多条路径，聚合最终答案；样本之间不互看。
- **Reflection**：让一条候选被批判、修订，属于纵向迭代；后一步依赖前一步。
- **模型集成**：组合多个不同模型；Self-Consistency 原始方法可以只使用同一个模型。
- **LLM-as-a-Judge**：让模型按标准排序候选，适合开放答案，但评审模型本身也会偏置和失败。

可以把这些方法组合，但每增加一层模型判断，系统就多一层成本、延迟和不可见误差。优先使用最简单、可度量的聚合方式：答案可枚举时先做确定性规范化和多数投票；只有开放任务确实无法硬比较时，才考虑带量表的评审模型，并保留人工抽检。

## 十二、上线检查清单

- 任务的最终答案能形成稳定、可测试的等价类；
- 采样彼此独立，未把前序答案泄漏给后序样本；
- 模型随机性配置按当前 Provider 文档核实并版本化；
- 输出先做 Schema 校验，再做业务白名单、范围和单位校验；
- 无效样本、并列、低置信和超时都有明确终态；
- 采样数、全局并发、租户配额、Token 与截止时间均有硬上限；
- 内部一致率未被宣传为正确概率；
- 高风险结果还会经过确定性验证、鉴权、审批与幂等执行；
- 日志不默认保存敏感 Prompt、候选全文或隐藏推理；
- 已用离线任务集证明准确率收益值得新增成本。

Self-Consistency 的价值不在于“让多个模型互相说服”，而在于把一次不稳定生成改造成一个可观察的统计决策过程。独立采样提供差异，规范化把表达映射到答案等价类，聚合规则明确何时接受、拒绝或升级处理；再用验证器、安全边界和成本预算守住最终执行，才是一套能上线的自我一致性方案。

## 参考资料

- [Self-Consistency Improves Chain of Thought Reasoning in Language Models](https://arxiv.org/abs/2203.11171)
- [Spring AI 2.0.1 ChatClient API](https://docs.spring.io/spring-ai/reference/api/chatclient.html)
- [Spring AI Provider-Native Structured Output](https://docs.spring.io/spring-ai/reference/api/structured-output/native.html)
- [Spring AI Observability](https://docs.spring.io/spring-ai/reference/observability/index.html)
