---
title: 基于用户的协同过滤实战：用 UserCF 为商城推荐商品
date: 2026-08-20
category: 算法
cover: /images/posts/user-based-collaborative-filtering-ecommerce-knowledge-map.webp
tags: [推荐系统, 协同过滤, usercf, java]
excerpt: UserCF 的核心是找到兴趣相近的用户，再把邻居喜欢而目标用户尚未接触的商品推荐给他。本文从用户—商品矩阵、相似度和推荐分数讲起，并用 Java 伪代码实现商城商品推荐链路。
---

# 基于用户的协同过滤实战：用 UserCF 为商城推荐商品

<img src="/images/posts/user-based-collaborative-filtering-ecommerce-knowledge-map.webp" alt="基于用户的协同过滤实战：用 UserCF 为商城推荐商品知识串联图" style="border-radius: 10px;" />

UserCF 的核心是找到兴趣相近的用户，再把邻居喜欢而目标用户尚未接触的商品推荐给他。本文从用户—商品矩阵、相似度和推荐分数讲起，并用 Java 伪代码实现商城商品推荐链路。

## 先说结论：UserCF 推荐的是“相似用户的新选择”

基于用户的协同过滤（User-Based Collaborative Filtering，UserCF）不依赖商品标题、类目或图片，而是从群体行为中寻找规律：

1. 把每个用户表示成商品偏好向量；
2. 计算目标用户与其他用户的相似度；
3. 选出最相似的 K 个邻居；
4. 聚合邻居对未接触商品的偏好，得到候选分数；
5. 过滤下架、缺货和已购买商品，再做业务排序。

它适合用户行为较丰富、兴趣群体明显的商城。用户或商品数量很大、交互极稀疏时，不能在线两两比较所有用户；需要倒排索引、离线计算和缓存。

## 一、把商城行为变成用户—商品矩阵

显式评分系统可以直接使用 1～5 分。商城通常没有评分，只有浏览、收藏、加购和购买等隐式反馈，需要先转换为偏好强度：

| 行为 | 示例基础权重 | 含义 |
|---|---:|---|
| 浏览详情 | 1 | 兴趣较弱，噪声较多 |
| 收藏 | 3 | 主动保留，兴趣较明确 |
| 加入购物车 | 4 | 有购买意图 |
| 支付成功 | 5 | 强正反馈 |
| 退款或明确不喜欢 | 负值或过滤信号 | 需要区分商品问题与兴趣否定 |

权重不是行业标准，应通过离线评估和 A/B 实验校准。重复浏览也不应无限累加，可以使用 `log(1 + count)` 压缩次数，并用时间衰减降低很久以前的行为影响：

```text
preference(u, i) = behaviorWeight × log(1 + count) × exp(-λ × days)
```

得到的稀疏矩阵如下：

| 用户 | 跑鞋 A | 运动袜 B | 清洁剂 C | 双肩包 D |
|---|---:|---:|---:|---:|
| 小王 | 1 | 1 | 0 | 0 |
| 小李 | 1 | 1 | 1 | 0 |
| 小张 | 1 | 0 | 0 | 1 |

这里先用二值偏好演示。小王与小李共同喜欢 A、B，与小张只共同喜欢 A，因此小李更像小王。

## 二、用户相似度怎么算

常用方法有三类，选择取决于反馈类型。

### 1. Jaccard：只关心是否发生过行为

Jaccard 相似度是交集大小除以并集大小：

```text
sim(u, v) = |Iu ∩ Iv| / |Iu ∪ Iv|
```

它适合只有“看过/没看过”“买过/没买过”的集合数据，但忽略行为强弱。

### 2. 余弦相似度：适合商城隐式偏好

把用户看成商品空间中的向量：

```text
sim(u, v) = Σ(rui × rvi) / (sqrt(Σrui²) × sqrt(Σrvi²))
```

二值示例中：

```text
sim(小王, 小李) = 2 / sqrt(2 × 3) ≈ 0.816
sim(小王, 小张) = 1 / sqrt(2 × 2) = 0.5
```

余弦相似度既能处理二值数据，也能处理浏览、收藏、加购、购买形成的加权向量，是商城 UserCF 的常见起点。

### 3. Pearson：适合有评分偏差的数据

Pearson 先减去各用户平均分，再计算相关性，能缓解“有人习惯打高分、有人习惯打低分”的偏差。商城隐式反馈没有稳定的负反馈和评分基线，直接使用 Pearson 往往不如加权余弦直观。

热门商品会让很多用户产生虚假的相似。工程上可降低高频商品对相似度的贡献，例如给共同商品增加逆用户频率权重：

```text
itemWeight(i) = log(totalUsers / (1 + interactedUsers(i)))
```

## 三、从邻居生成推荐分数

选出相似度最高的 K 个邻居后，对目标用户未接触的商品计算加权分数：

```text
score(u, i) = Σ(sim(u, v) × preference(v, i)) / Σv∈N(u)|sim(u, v)|
```

小王的候选商品中：

```text
清洁剂 C：来自小李，原始贡献约 0.816
双肩包 D：来自小张，原始贡献为 0.5
```

所以 UserCF 会优先推荐 C。真实系统还应保留分数解释，例如“与你兴趣相近的用户最近购买”，方便排查推荐异常。

K 不是越大越好：太小容易受偶然行为影响，太大会引入弱相关用户并损失个性化。应结合用户活跃度、数据稀疏度和离线指标选择，也可设置最低共同商品数与最低相似度。

## 四、Java 伪代码实现商城 UserCF

下面使用稀疏结构 `Map<userId, Map<productId, preference>>`，重点展示算法边界，不绑定具体数据库或框架。

### 1. 聚合用户偏好

```java
record UserEvent(long userId, long productId, EventType type,
                 int count, Instant lastTime) {
}

enum EventType {
    VIEW, FAVORITE, CART, PAID
}

double buildPreference(UserEvent event, Instant now) {
    double behaviorWeight = switch (event.type()) {
        case VIEW -> 1.0;
        case FAVORITE -> 3.0;
        case CART -> 4.0;
        case PAID -> 5.0;
    };

    long days = Math.max(0, Duration.between(event.lastTime(), now).toDays());
    double frequency = Math.log1p(event.count());
    double timeDecay = Math.exp(-0.03 * days);

    // 次数压缩并叠加时间衰减，防止旧的重复浏览长期主导兴趣
    return behaviorWeight * frequency * timeDecay;
}

Map<Long, Map<Long, Double>> buildUserVectors(List<UserEvent> events) {
    Map<Long, Map<Long, Double>> vectors = new HashMap<>();
    Instant now = Instant.now();

    for (UserEvent event : events) {
        vectors.computeIfAbsent(event.userId(), id -> new HashMap<>())
                .merge(event.productId(), buildPreference(event, now), Double::sum);
    }
    return vectors;
}
```

退款、取消订单和异常刷量不要简单按同一负权重处理。退款可能是质量或物流问题；风控事件则应先从训练数据中剔除，避免污染相似关系。

### 2. 计算加权余弦相似度

```java
double cosine(Map<Long, Double> left,
              Map<Long, Double> right,
              Map<Long, Double> itemWeights) {
    double dot = 0.0;
    double leftNorm = 0.0;
    double rightNorm = 0.0;

    for (var entry : left.entrySet()) {
        double value = entry.getValue();
        leftNorm += value * value;

        Double other = right.get(entry.getKey());
        if (other != null) {
            // 热门商品权重较低，减少“大家都买”带来的伪相似
            double itemWeight = itemWeights.getOrDefault(entry.getKey(), 1.0);
            dot += value * other * itemWeight;
        }
    }
    for (double value : right.values()) {
        rightNorm += value * value;
    }

    if (dot == 0.0 || leftNorm == 0.0 || rightNorm == 0.0) {
        return 0.0;
    }
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
```

生产实现还应统计共同交互数。只共同浏览一个热门商品的用户即使相似度不低，也可通过 `minCommonItems` 过滤。

### 3. 选择邻居并生成 Top-N

```java
record Neighbor(long userId, double similarity) {
}

record Recommendation(long productId, double score, String reason) {
}

List<Recommendation> recommend(
        long targetUserId,
        int neighborSize,
        int resultSize,
        Map<Long, Map<Long, Double>> vectors,
        Map<Long, Double> itemWeights,
        ProductGateway productGateway) {

    Map<Long, Double> target = vectors.get(targetUserId);
    if (target == null || target.isEmpty()) {
        // 新用户没有行为，进入热门榜、类目偏好或运营推荐兜底
        return productGateway.hotProducts(resultSize);
    }

    PriorityQueue<Neighbor> topNeighbors =
            new PriorityQueue<>(Comparator.comparingDouble(Neighbor::similarity));

    for (var entry : vectors.entrySet()) {
        if (entry.getKey() == targetUserId) {
            continue;
        }

        double similarity = cosine(target, entry.getValue(), itemWeights);
        if (similarity < 0.05) {
            continue;
        }

        topNeighbors.offer(new Neighbor(entry.getKey(), similarity));
        if (topNeighbors.size() > neighborSize) {
            // 小顶堆只保留相似度最高的 K 个邻居
            topNeighbors.poll();
        }
    }

    Map<Long, Double> weightedScores = new HashMap<>();
    double totalNeighborSimilarity = topNeighbors.stream()
            .mapToDouble(neighbor -> Math.abs(neighbor.similarity()))
            .sum();

    for (Neighbor neighbor : topNeighbors) {
        for (var item : vectors.get(neighbor.userId()).entrySet()) {
            if (target.containsKey(item.getKey())) {
                continue; // 排除目标用户已经发生过有效行为的商品
            }
            weightedScores.merge(item.getKey(),
                    neighbor.similarity() * item.getValue(), Double::sum);
        }
    }

    double normalization = totalNeighborSimilarity == 0.0
            ? 1.0 : totalNeighborSimilarity;
    return weightedScores.entrySet().stream()
            .map(entry -> new Recommendation(
                    entry.getKey(),
                    entry.getValue() / normalization,
                    "相似用户喜欢"))
            .filter(rec -> productGateway.isOnSaleAndInStock(rec.productId()))
            .sorted(Comparator.comparingDouble(Recommendation::score).reversed())
            .limit(resultSize)
            .toList();
}
```

这是教学版全扫描，复杂度接近用户两两比较，不能直接用于大规模线上请求。真正的商城应只比较“至少共同交互过一个商品”的用户。

## 五、工程落地：离线算邻居，在线做轻排序

一条实用链路可以拆成四段：

```text
行为日志 → 偏好聚合 → UserCF 离线召回 → 在线过滤与重排
```

### 离线层

1. 从订单、收藏、购物车和埋点日志构建时间窗口内的偏好；
2. 建立 `productId -> userIds` 倒排索引，只枚举有共同商品的用户对；
3. 计算每个用户的 Top-K 邻居，或直接预计算 Top-N 推荐商品；
4. 将结果按模型版本写入推荐表或 Redis，例如 `rec:user:{userId}:{version}`。

建议保存三类结果：

| 数据 | 关键字段 | 用途 |
|---|---|---|
| 用户偏好 | user_id、product_id、weight、updated_at | 重算与解释 |
| 用户邻居 | user_id、neighbor_id、similarity、version | 复用相似关系 |
| 推荐结果 | user_id、product_id、score、reason、version | 在线低延迟读取 |

### 在线层

在线接口不要重新计算全量相似度，只读取预计算候选，再执行：

- 上架、库存、区域和价格资格过滤；
- 排除近期已购买、已屏蔽或曝光过多的商品；
- 同品牌、同类目去重，保留一定多样性；
- 与热门、新品、内容召回结果合并；
- 记录曝光所用的算法版本、候选分和最终位次。

缓存未命中时应有明确兜底，不能让推荐服务拖慢商品首页。常见顺序是用户类目热榜、全站热榜、运营池。

## 六、冷启动、稀疏性与兴趣漂移

UserCF 有三个天然短板：

1. **新用户冷启动**：没有行为就找不到邻居。可用注册偏好、首屏点击、地域热榜或全站热门兜底；
2. **新商品冷启动**：没有用户交互就无法被协同过滤召回。需要类目、品牌、文本或向量内容召回；
3. **兴趣漂移**：去年买过的商品不一定代表当前需求。应采用滑动时间窗口、时间衰减和会话信号。

因此线上系统通常是混合推荐：UserCF 提供“人群兴趣”候选，热门召回保证覆盖，内容召回解决新品，规则层负责库存与合规，重排模型综合最终顺序。

## 七、如何验证推荐真的有效

离线评估应按时间切分：用较早行为建模，用之后发生的购买或加购作为验证目标，避免把未来数据泄漏进训练集。

至少观察：

- `Recall@K`：用户后续感兴趣的商品有多少被召回；
- `Precision@K`：推荐列表中有多少命中后续兴趣；
- `NDCG@K`：命中的商品是否排在更靠前的位置；
- Coverage：算法能覆盖多少用户和商品；
- Diversity：列表是否被同一类目或品牌占满。

离线指标通过后再做 A/B 实验，关注点击率、加购率、支付转化率和每千次曝光成交额，同时设置退款率、投诉率、缺货曝光率等护栏。只优化点击率，可能得到吸引眼球却不成交的商品。

## 总结

UserCF 的完整闭环不是一句“猜你喜欢的人也喜欢”，而是：把商城行为变成可靠偏好，计算用户邻居，聚合未接触商品，执行库存与业务过滤，再通过离线指标和 A/B 实验验证。

它实现简单、解释性强，适合作为商城推荐系统的第一条个性化召回通道。但数据规模上来后，必须用倒排索引缩小用户对、离线预计算降低延迟，并与热门、内容和规则召回组合，才能同时处理冷启动、稀疏性和业务约束。

参考资料：

- [GroupLens：An Open Architecture for Collaborative Filtering of Netnews](https://doi.org/10.1145/192844.192905)
- [Herlocker 等：An Algorithmic Framework for Performing Collaborative Filtering](https://doi.org/10.1145/312624.312682)
- [GroupLens：MovieLens 数据集说明](https://files.grouplens.org/datasets/movielens/ml-latest-README.html)
