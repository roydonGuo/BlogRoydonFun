---
title: LLM 反思机制工程实践：让模型自我批判与迭代修订的 Agent 闭环
date: 2026-08-18
category: AI
cover: /images/posts/llm-reflection-self-critique-engineering-knowledge-map.webp
tags: [llm, reflection, self-reflection, agent, spring-ai, prompt-engineering]
excerpt: 反思机制让 LLM 先产出草稿，再让模型（或另一个角色）以评论家身份挑毛病，然后修订，反复逼近更可靠的答案。本文讲清它的组成、适用边界、Spring AI 2.0.0 的 Java 闭环实现、预算与停止条件、常见追问和踩坑。
---

# LLM 反思机制工程实践：让模型自我批判与迭代修订的 Agent 闭环

<img src="/images/posts/llm-reflection-self-critique-engineering-knowledge-map.webp" alt="LLM 反思机制工程实践：让模型自我批判与迭代修订的 Agent 闭环知识串联图" style="border-radius: 10px;" />

反思机制让 LLM 先产出草稿，再让模型（或另一个角色）以评论家身份挑毛病，然后修订，反复逼近更可靠的答案。本文讲清它的组成、适用边界、Spring AI 2.0.0 的 Java 闭环实现、预算与停止条件、常见追问和踩坑。

## 先说结论：反思是“生成—批判—修订”的循环，不是多调一次模型

反思（Reflection，有时也叫 Self-Refinement / Self-Correction）的本质，是把一次生成拆成多轮：先给出一个答案，再让模型以“审阅者”的视角评估这个答案哪里不行，最后把批判意见塞回上下文里重做一版。它能稳定提升代码、SQL、方案设计和长文类任务的质量，代价是延迟、成本和上下文开销同步上升。

落地时要守住四条边界：

1. **反思是结构，不是魔法**：它只改变“调用次数和组织方式”，不改变模型本身的能力上限。模型不会的，多反思也不会突然会。
2. **必须有停止条件**：循环要受迭代次数、Token 预算、耗时和“是否收敛”约束，否则会无限空转、成本失控。
3. **评判标准要可判定**：评论家要么输出结构化裁决（通过 / 需修订 + 问题清单），要么对照可验证的事实（编译结果、单测、查询结果）判断，不能只说“我感觉不太好”。
4. **它是 Agent 工程化手段**：反思通常需要多轮或多次模型调用，属于比单次 COT 更高层次的编排，不应写在一条 Prompt 里硬挤。

本文以 Spring AI 2.0.0 当前 `ChatClient` API 为 Java 示例基线，事实核对时间为 2026-08-19。Spring AI 2.0.0 是当前稳定版（2026-06-12 GA），`ChatClient` 是面向模型调用的统一流式入口；结构化输出、Advisor 链、评估工具均为官方一等能力。具体以 [Spring AI 2.0.0 GA 公告](https://spring.io/blog/2026/06/12/spring-ai-2-0-0-GA-available-now) 与 [ChatClient API](https://docs.spring.io/spring-ai/reference/api/chatclient.html) 为准。

## 一、反思机制是什么

原始资料把反思描述为一条进阶链路：**生成 → 反思 → 修订 → 再反思 → 再修订 …… → 生成最终答案**。它和 COT（思维链）的区别在于：COT 是单次调用内“一步步想”，而反思是多次调用之间“做出来、挑毛病、改一版、再看”。

它常被归在“Agent 工程化”而非“单次提示技巧”里，原因有二：

- 需要**多轮或多次模型调用**，调用之间要保存草稿、批判和修订结果；
- 需要在调用之外做**对比、评估、汇总**，最终收敛到更高质量、更可靠的答案。

原始资料也明确点出两个代价：**响应时间延长**（多次往返）和**上下文爆炸**（每一轮都把历史草稿和批判累积进上下文）。这两点直接决定了它不能无脑套用到所有场景。

## 二、一个反思闭环由哪些角色组成

一个最小可用的反思闭环，通常拆成四个角色：

- **生成器（Generator）**：根据任务产出一版草稿。它不需要一次到位，允许粗糙，但要能跑、能看。
- **评论家（Critic）**：以审阅者身份评估草稿，输出“通过 / 需修订”的裁决，以及具体的问题清单与修改建议。评论家可以是同一个模型换一套系统提示，也可以是更强的模型，或是一个规则/工具（如编译器、单测、SQL 执行器）。
- **修订器（Reviser）**：把“草稿 + 批判意见”合并，产出下一版草稿。它的输入必须同时包含原稿和问题，否则模型会丢上下文。
- **裁决器 / 停止条件（Judge & Stop）**：决定“这一版够不够好、还要不要继续”。它可以是评论家的裁决、一个外部校验结果，或预算耗尽。

这四个角色不一定都是 LLM。在偏工程的实现里，**评论家常常退化成一个可执行校验**（编译、测试、SQL explain、接口返回码），这比让模型“自评”更可靠，也更便宜。

## 三、什么场景值得上反思，什么场景不值得

反思不是默认选项。按收益/成本判断：

| 维度 | 适合反思 | 不适合反思 |
|---|---|---|
| 任务类型 | 代码生成、SQL、方案设计、长文写作、数学/逻辑推导 | 简单的 factual 问答、摘要、分类、翻译 |
| 可验证性 | 有编译、测试、执行结果、明确评分标准可对照 | 纯主观、无标准答案、难以自动判定 |
| 延迟容忍 | 离线批处理、IDE 辅助、评审助手 | 实时对话、在线低延迟接口 |
| 成本敏感度 | 高价值、低频、一次做对比多次重试更贵 | 高频、低成本、用户不在乎微小质量差 |
| 失败代价 | 出错代价高，值得多花几轮换可靠性 | 出错代价低，快速返回即可 |

一个务实的判断：当“第一次生成的结果经常能用外部手段验证对错”时，反思收益最高（代码能编译、SQL 能跑、答案能对照知识库）。当“对不对只能靠模型自己感觉”时，反思很容易变成模型自己和自己打太极，收益有限。

## 四、完整数据流

一次典型运行的数据流如下：

```text
任务输入
  │
  ▼
[生成器] ──► 草稿 v1
  │
  ▼
[评论家] ──► 裁决：PASS / REVISE + 问题清单
  │
  ├─ PASS ──────────────► 最终答案（收敛，结束）
  │
  └─ REVISE
        │
        ▼
  [修订器] 合并(草稿 v1 + 批判) ──► 草稿 v2
        │
        ▼
  回到 [评论家]（受 迭代次数 / Token 预算 / 耗时 约束）
```

关键点是：**每一轮都把“上一版草稿 + 批判意见”原样带回下一轮**。如果修订器只看到批判意见而看不到原稿，模型会凭空重写，反而丢掉已经写对的部分。另外，停止条件要独立于模型意志——不能指望模型主动说“我满意了就停”，必须由编排器用机械阈值掐断。

## 五、Spring AI 2.0.0 Java 实现

下面是一套可由服务直接调用的反思闭环，不是测试用例。基线为 `ChatClient` 流式 API；评论家返回 JSON，由应用侧解析成结构化裁决，避免把“判断”完全交给模型的自由文本。

```java
// 评论家的结构化裁决：通过，或需修订并附带问题清单
public record CriticVerdict(
        String decision,        // "PASS" 表示可收敛；"REVISE" 表示仍需修订
        List<String> issues,    // 当前草稿存在的问题，空列表表示无明显问题
        String suggestion       // 给修订器的具体修改方向
) {
    public boolean isPass() {
        return "PASS".equalsIgnoreCase(decision);
    }
}

// 反思引擎：编排生成、批判、修订与停止条件
@Service
public class ReflectionEngine {

    private final ChatClient chatClient;
    // 简单计数估算 Token，真实项目应替换为模型对应的 tokenizer
    private static final int MAX_ITERATIONS = 3;
    private static final int MAX_APPROX_TOKENS = 8000;

    public ReflectionEngine(ChatModel chatModel) {
        this.chatClient = ChatClient.builder(chatModel).build();
    }

    // 对外入口：给定任务，返回收敛后的最终答案
    public String run(String task) {
        String draft = generate(task, "");
        int approxTokens = estimateTokens(task) + estimateTokens(draft);

        for (int round = 1; round <= MAX_ITERATIONS; round++) {
            CriticVerdict verdict = critique(task, draft);
            if (verdict.isPass()) {
                return draft; // 收敛，直接返回当前草稿
            }
            // 修订器必须同时拿到原稿和批判，否则会丢上下文
            draft = revise(task, draft, verdict);
            approxTokens += estimateTokens(draft) + estimateTokens(verdict.suggestion());
            if (approxTokens > MAX_APPROX_TOKENS) {
                return draft; // 预算耗尽，返回当前最优草稿而非无限空转
            }
        }
        return draft; // 达到最大迭代次数仍非 PASS，返回最后一版并交由上层人工复核
    }

    // 生成器：先出一版草稿，可携带上一轮批判作为前置约束
    private String generate(String task, String priorCritique) {
        String userText = "任务：" + task;
        if (!priorCritique.isBlank()) {
            userText += "\n注意避免上一轮暴露的问题：" + priorCritique;
        }
        return chatClient.prompt()
                .system("你是严谨的资深工程师，先给出可运行、自洽的草稿，不要解释过程。")
                .user(userText)
                .call()
                .content();
    }

    // 评论家：以审阅者身份评估，必须返回可解析的 JSON 裁决
    private CriticVerdict critique(String task, String draft) {
        String json = chatClient.prompt()
                .system("""
                        你是严格的技术审阅者。请评估草稿是否满足任务要求、
                        是否存在逻辑错误、边界遗漏或不可运行的问题。
                        只输出 JSON，不要任何额外文字，格式：
                        {"decision":"PASS 或 REVISE","issues":["问题1","问题2"],"suggestion":"修改方向"}
                        """)
                .user("任务：" + task + "\n草稿：\n" + draft)
                .call()
                .content();
        return parseVerdict(json);
    }

    // 修订器：合并草稿与批判，产出下一版
    private String revise(String task, String draft, CriticVerdict verdict) {
        String issues = String.join("；", verdict.issues());
        return chatClient.prompt()
                .system("你是修订者。基于审阅意见修改草稿，保留已正确的部分，只改有问题的地方。")
                .user("任务：" + task
                        + "\n当前草稿：\n" + draft
                        + "\n审阅意见：" + issues
                        + "\n修改方向：" + verdict.suggestion())
                .call()
                .content();
    }

    // 解析评论家返回的 JSON；解析失败时默认进入修订，避免误判为通过
    private CriticVerdict parseVerdict(String json) {
        try {
            // 真实项目建议用 Jackson 绑定到 CriticVerdict，这里仅示意提取
            if (json.contains("\"decision\"") && json.contains("PASS")) {
                return new CriticVerdict("PASS", List.of(), "");
            }
            String suggestion = json.lines()
                    .filter(l -> l.contains("suggestion"))
                    .findFirst().map(l -> l.replaceAll("[\",}]", "").split(":")[1].trim())
                    .orElse("请根据问题清单优化草稿");
            return new CriticVerdict("REVISE", List.of("见原始 JSON"), suggestion);
        } catch (Exception e) {
            return new CriticVerdict("REVISE", List.of("裁决解析失败"), "请重新评估并修正草稿");
        }
    }

    private int estimateTokens(String text) {
        // 中文约 1 字 ≈ 1~2 token，这里用长度近似，仅用于预算告警
        return text == null ? 0 : text.length();
    }
}
```

几个工程要点：

- **裁决要机器可判定**：上面的 `parseVerdict` 在解析失败时默认 `REVISE` 而不是 `PASS`。宁可多改一轮，也不要因为格式异常就误判“通过”。
- **真实项目用结构化输出更稳**：Spring AI 2.0 的 `ChatClient` 支持 `.entity(Class)` 把模型输出直接绑定到 POJO，且 `StructuredOutputValidationAdvisor` 能在校验失败时自动纠错。若追求严谨，可让评论家直接返回 `CriticVerdict` 对象，省去手写 JSON 解析（参见仓库内《Spring AI 结构化输出工程实践》）。
- **预算独立于模型**：`MAX_ITERATIONS` 和 `MAX_APPROX_TOKENS` 由编排器机械控制，模型无法自行突破。

## 六、常见追问

### 反思等于自我一致性（Self-Consistency）吗

不等于。自我一致性是“同一个问题采样多条推理路径，少数服从多数”的聚合策略；反思是“一条路径上不断改进同一份答案”。前者靠量投票，后者靠改提质，二者可以叠加。

### 反思等于 ReAct 吗

不等于。ReAct 是“思考—行动—观察”的工具驱动循环，重点在调用外部工具获取事实；反思是“草稿—批判—修订”的质量驱动循环，重点在自我修正。ReAct 的“观察”可以充当反思里的评论家（用工具结果判定草稿对错），二者是正交的两个维度。

### 评判标准由谁定

三种来源：① 模型自评（最便宜但最松，适合主观任务）；② 更强的模型或独立提示做评审（质量更高）；③ 可执行校验（编译、测试、SQL 执行、接口返回码，最可靠）。生产环境优先 ③，把 ① 当作兜底。

### 上下文爆炸怎么治

- 只把“上一版草稿 + 结构化问题清单”带入下一轮，不要把全部历史对话原样堆叠；
- 定期用摘要压缩早期轮次（参考仓库内《Agent 上下文工程：选择性压缩与缓存》）；
- 设硬上限，超预算即停。

### 模型不会承认错误怎么办

不要把“批判性”寄托在模型的自觉性上。改用外部可验证信号：让评论家对照测试用例、编译输出或查询结果给出 `PASS/REVISE`，而不是问模型“你觉得自己对不对”。

### 什么时候反思反而更差

当任务本身简单、或对错无法客观判定、或延迟/成本敏感时，多次调用只会放慢速度、推高费用，质量却没有可验证提升。这时一次直出 + 必要的人工复核更划算。

## 七、踩坑

1. **无限循环**：没有硬停止条件，模型反复说“还需修订”，Token 和钱一起烧光。
2. **评论家与生成器同质化**：同一个模型、同一套知识，自我批判很容易“自己挑自己挑过的毛病”，陷入自洽但错误的闭环。高价值任务应换更强模型或接外部校验。
3. **把批判当最终答案**：评论家输出的是“问题清单”，不是“修订后的草稿”，必须再过一次修订器。
4. **修订器看不到原稿**：只喂批判意见，模型凭空重写，把本来对的部分也改没了。
5. **预算失控**：只限制迭代次数却不限 Token，长草稿多轮后上下文溢出。
6. **评判标准泄露给用户**：评论家的内部裁决（红叉、问题清单）直接返回给终端用户，体验差且暴露内部逻辑。
7. **忽略收敛判定**：每轮都返回新草稿却不判断是否已足够好，最终只用最后一版，浪费前面的轮次。

## 八、选择建议与最佳实践

1. 先确认任务“对不对能被客观验证”，能验证才上反思；
2. 评论家优先用可执行校验（编译、测试、SQL、接口），其次才是模型自评；
3. 生成、批判、修订用清晰的系统提示分工，不混在一个角色里；
4. 每一轮都把“原稿 + 结构化问题”完整带入修订器；
5. 停止条件用机械阈值（次数、Token、耗时），不靠模型自觉；
6. 解析评论家输出失败时默认进入修订，绝不默认通过；
7. 长任务压缩早期轮次，控制上下文总量；
8. 评论家内部裁决不直出给用户，只暴露最终结果或必要摘要；
9. 高价值任务让评论家使用更强模型，避免同质化自洽；
10. 记录每轮的草稿版本、裁决、Token 与耗时，便于复盘和回归。

## 九、总结

反思机制不是“让模型多想一会儿”，而是把一次生成拆成“生成—批判—修订”的多轮闭环，用结构换取质量。它最擅长那些**结果可被客观验证**的任务：代码、SQL、方案、长文；最怕被用在一次直出就能搞定的简单问答上。

真正可靠的落地，是把模型当“会写草稿、也会挑刺的同事”，但由应用侧牢牢握着三样东西：**可判定的评论标准、必须带回的上下文、以及谁都改不了停止条件**。把角色分工、预算边界和可观测性同时做好，反思才能从 Prompt 技巧变成可上线的 Agent 工程组件。

## 参考资料

- [Spring AI 2.0.0 GA Available Now](https://spring.io/blog/2026/06/12/spring-ai-2-0-0-GA-available-now)
- [Spring AI：ChatClient API](https://docs.spring.io/spring-ai/reference/api/chatclient.html)
- [Spring AI：Structured Output](https://docs.spring.io/spring-ai/reference/api/structured-output.html)
- [Spring AI：Advisors API](https://docs.spring.io/spring-ai/reference/api/advisors.html)
