---
title: Redis 过期删除与内存淘汰：从 TTL 到 LRU、LFU 与 LRM
date: 2026-08-04
category: Redis
cover: /images/posts/redis-expiration-and-eviction-knowledge-map.webp
tags: [redis, lru, lfu, lrm]
excerpt: 区分 Redis 过期删除与内存淘汰，完整梳理 Redis 7.x 和 8.6+ 的淘汰策略，并给出 Spring Boot 缓存、参数配置与监控实践。
---

# Redis 过期删除与内存淘汰：从 TTL 到 LRU、LFU 与 LRM
<img src="/images/posts/redis-expiration-and-eviction-knowledge-map.webp" alt="Redis 过期删除与内存淘汰：从 TTL 到 LRU、LFU 与 LRM知识串联图" style="border-radius: 10px;" />

线上 Redis 内存不断上涨时，常见的第一反应是“给 Key 加 TTL”或“把淘汰策略改成 LRU”。这两个动作解决的却不是同一个问题：TTL 决定数据何时失效，淘汰策略决定内存达到上限后牺牲哪些数据。

如果没有先分清两套机制，就容易出现两种事故：一是把 Redis 当数据库使用，却配置了会删除业务数据的淘汰策略；二是把 Redis 当纯缓存使用，却保持 `noeviction`，最终在流量高峰集中报写入错误。

> 本文以 **Redis Open Source 7.x** 的通用行为为基础，同时标注 **Redis 8.6+** 新增的 LRM 策略。Redis Cloud、Redis Software 和 Active-Active 数据库的默认值与可选项可能不同，生产环境应以实际产品文档和 `CONFIG GET` 结果为准。

## 一、先区分过期、淘汰和主动删除

Redis 中一个 Key 消失，可能来自三条完全不同的路径。

| 机制 | 触发条件 | 候选范围 | 主要目的 |
|---|---|---|---|
| 过期删除（Expiration） | Key 的 TTL 到期 | 已设置过期时间的 Key | 控制数据生命周期 |
| 内存淘汰（Eviction） | 内存超过 `maxmemory`，且命令还要增加数据 | 由 `maxmemory-policy` 决定 | 在内存压力下腾出空间 |
| 主动删除 | 应用执行 `DEL`、`UNLINK`，或覆盖原值 | 应用明确指定的 Key | 业务失效、纠错或释放资源 |

因此，“设置了 TTL”不等于“永远不会发生淘汰”。大量尚未到期的缓存仍可能让实例超过 `maxmemory`，Redis 会按淘汰策略提前删除其中一部分。反过来，没有 TTL 的 Key 在 `allkeys-*` 策略下也可能被淘汰。

## 二、TTL 到期后，Key 为什么不一定立即消失

Redis 为带 TTL 的 Key 记录绝对过期时间。达到这个时间后，Redis 通过被动过期与主动过期共同回收数据。

### 1. 被动过期：访问时再检查

客户端访问一个 Key 时，Redis 会检查它是否已经到期。如果已到期，就删除 Key 并向客户端返回不存在。

这种方式几乎不为从未访问的 Key 额外消耗 CPU，但只依赖它会产生“已过期却长期无人访问”的隐藏内存。

### 2. 主动过期：周期性抽样清理

Redis 会周期性地从设置了过期时间的 Key 中抽样，删除其中已经到期的 Key。它不是为每个 Key 创建定时器，也不是每次都全量扫描过期字典，否则大量短 TTL 数据会制造不可接受的调度或扫描成本。

主动清理需要在两种目标之间权衡：

- 清理得更积极，可以更快释放已过期数据占用的内存；
- 清理工作过多，会占用 CPU 并增加命令处理延迟。

`active-expire-effort` 可以调整主动过期投入程度，但它不是解决容量不足的万能旋钮。调整前应先观察 CPU、延迟、`expired_keys` 和数据的 TTL 分布，并在压测环境验证。

### 3. 过期时间依赖系统时钟

Redis 持久化的是绝对时间戳，即使实例停止，时间仍然向前推进。机器时钟大幅跳变，或在时钟差异很大的主机间迁移 RDB，都可能让一批 Key 提前或延后过期。生产环境应保持 NTP 同步，不要通过手工修改系统时间处理业务问题。

在主从复制中，主节点负责产生过期删除并把对应删除操作传播给 AOF 和副本；副本被提升为主节点后，才会依据自身保存的过期信息独立处理。这个设计避免同一复制拓扑中的节点各自判断过期而产生不一致。

## 三、`maxmemory` 才是淘汰机制的起点

下面是一组适用于“纯缓存实例”的基础配置示例：

```conf
# 缓存数据最多使用 4 GiB；不要直接等于机器物理内存
maxmemory 4gb

# 热点变化相对平稳时，优先保留访问频率更高的 Key
maxmemory-policy allkeys-lfu

# LRU/LFU/LRM 都采用近似采样；样本越多越接近理想结果，但 CPU 成本也更高
maxmemory-samples 5

# LFU 计数器的增长因子和衰减周期，先使用默认值，再根据压测调整
lfu-log-factor 10
lfu-decay-time 1
```

Redis 在会增加数据的命令执行时检查内存。如果已超过 `maxmemory`，会按策略持续淘汰 Key，直到回到限制以内或找不到可淘汰对象。单条命令一次写入大量数据时，实际使用量可能短暂大幅超过上限。

设置容量时还要为进程本身、内存碎片、复制积压、AOF 缓冲和客户端连接等留余量。官方文档特别指出，部分复制与持久化缓冲不会计入触发淘汰的比较值，可以通过 `INFO memory` 中的 `mem_not_counted_for_evict` 辅助估算预留空间。

## 四、完整理解淘汰策略：候选范围 × 选择算法

淘汰策略最好拆成两个维度理解：

- `allkeys-*`：所有 Key 都可以成为候选；
- `volatile-*`：只有设置了 TTL 的 Key 才能成为候选。

Redis 7.x 常见的基础策略共有 8 种；Redis 8.6 又加入 2 种 LRM 策略。

| 策略 | 候选 Key | 选择规则 | 适用场景 |
|---|---|---|---|
| `noeviction` | 无 | 不淘汰；新增数据的命令返回错误 | 任何数据都不能因内存压力丢失的存储型实例 |
| `allkeys-lru` | 全部 Key | 淘汰最近最少使用的 Key | 热点集中、近期访问能代表后续访问的通用缓存 |
| `allkeys-lfu` | 全部 Key | 淘汰访问频率最低的 Key | 长期热点明显，希望抗偶发扫描污染的缓存 |
| `allkeys-random` | 全部 Key | 随机淘汰 | 访问概率接近均匀，或数据价值相近 |
| `volatile-lru` | 仅有 TTL 的 Key | 在候选中淘汰最近最少使用者 | 同实例混放缓存和常驻数据，但通常更建议拆实例 |
| `volatile-lfu` | 仅有 TTL 的 Key | 在候选中淘汰访问频率最低者 | 只允许淘汰带 TTL 数据，且长期热点明显 |
| `volatile-random` | 仅有 TTL 的 Key | 在候选中随机淘汰 | 带 TTL 数据价值接近、无需维护热点偏好 |
| `volatile-ttl` | 仅有 TTL 的 Key | 优先淘汰剩余 TTL 最短者 | 应用能用 TTL 表达数据保留价值 |
| `allkeys-lrm` | 全部 Key | 淘汰最近最少修改的 Key | **Redis 8.6+**，写入新鲜度比读取热度更重要 |
| `volatile-lrm` | 仅有 TTL 的 Key | 在候选中淘汰最近最少修改者 | **Redis 8.6+**，仅淘汰可过期数据并保留近期更新内容 |

这里有两个容易忽略的边界：

1. `volatile-*` 找不到任何带 TTL 的 Key 时，行为会退化得类似 `noeviction`，写入可能直接失败。
2. `noeviction` 不是“Redis 不受内存上限影响”，而是达到上限后拒绝会增加数据的命令；读取和不增加内存的操作仍可继续。

### 1. LRU：看最近一次访问

LRU（Least Recently Used）适合“最近访问过的数据接下来仍更可能访问”的场景。Redis 没有维护严格的全局 LRU 链表，而是随机采样一批候选 Key，从中挑选最久未使用者。`maxmemory-samples` 越大，结果越接近精确 LRU，但淘汰过程的 CPU 成本也越高。

一次全量扫描可能把大量冷数据标记成“刚访问”，污染 LRU 的判断。如果业务存在定期报表、批量巡检等扫描流量，应考虑 LFU、隔离扫描任务，或为相关客户端使用版本支持的访问标记控制能力。

### 2. LFU：看一段时间内的访问频率

LFU（Least Frequently Used）更关注访问次数，适合长期热点明显的商品、配置或字典缓存。Redis 使用概率计数器近似记录频率，并让历史频率随时间衰减，避免“曾经很热”的 Key 永久占据内存。

LFU 并非天然优于 LRU。热点快速切换时，如果衰减太慢，新热点可能迟迟无法替换旧热点；衰减太快又会退化得接近近期访问判断。`lfu-log-factor` 和 `lfu-decay-time` 应结合真实访问分布调优。

### 3. LRM：看最近一次修改

LRM（Least Recently Modified）从 Redis 8.6 开始提供。它只在写操作时更新时间，不因读取而更新，适合需要保留近期生成或近期变更数据、但不希望高频读取改变淘汰次序的场景。

例如，报表结果会被旧页面持续读取，但业务更希望优先保留刚计算出的新报表，此时 LRM 比 LRU 更贴合“数据新鲜度”的含义。升级前不能提前配置该策略，否则旧版本无法识别配置项。

### 4. Random 与 TTL：简单但有明确语义

随机策略维护成本低，适合 Key 价值和访问概率都相近的工作负载。`volatile-ttl` 则把剩余生存时间当成业务提示：越接近自然过期，越适合先牺牲。它只比较已设置 TTL 的 Key，不会保护 TTL 很短但业务上极其重要的数据，TTL 设计必须先准确表达价值。

## 五、Spring Boot 示例：原子写入 TTL，并打散过期时间

缓存写入与设置 TTL 应尽量在同一个 Redis 命令中完成，避免 `SET` 成功、`EXPIRE` 失败后留下永久 Key。Spring Data Redis 的带过期时间 `set` 方法会表达为一次带 TTL 的写入。

```java
@Service
public class ProductCacheService {

    private static final Duration BASE_TTL = Duration.ofMinutes(30);
    private static final int JITTER_SECONDS = 300;

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public ProductCacheService(StringRedisTemplate redisTemplate, ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    public void put(ProductView product) {
        String key = "mall:product:" + product.getId();
        String value = writeJson(product);

        // 在基础 TTL 上增加 0～300 秒随机抖动，减少大量 Key 同时过期造成的回源尖峰
        long jitter = ThreadLocalRandom.current().nextLong(JITTER_SECONDS + 1L);
        Duration ttl = BASE_TTL.plusSeconds(jitter);

        // 值和 TTL 一次写入，避免分两条命令造成永久缓存
        redisTemplate.opsForValue().set(key, value, ttl);
    }

    private String writeJson(ProductView product) {
        try {
            return objectMapper.writeValueAsString(product);
        } catch (JsonProcessingException ex) {
            // 序列化失败不应写入残缺缓存，保留原始异常供统一日志与告警处理
            throw new IllegalStateException("商品缓存序列化失败", ex);
        }
    }
}
```

TTL 抖动只能缓解同一批缓存同时到期，不能解决热点 Key 失效后的瞬时并发回源。热点数据还需要互斥重建、逻辑过期、提前刷新或请求合并等方案。

Redis 7.0+ 的 `EXPIRE` 还支持条件选项：

```bash
# 仅当 Key 当前没有 TTL 时设置，避免无意覆盖已有过期策略
EXPIRE mall:product:1001 1800 NX

# 仅当新 TTL 更长时更新，适合会话续期等明确需要“只延长”的业务
EXPIRE login:session:abc 3600 GT
```

`NX`、`XX`、`GT`、`LT` 互斥。使用前要先明确业务语义，不能把它们当成并发控制的通用替代品。

## 六、如何按工作负载选择策略

### 1. 纯缓存实例

如果所有数据都能从数据库或下游重新构建，通常优先考虑 `allkeys-lru` 或 `allkeys-lfu`。这样无需依赖“每个 Key 是否都正确设置 TTL”来形成候选集合。

- 热点随时间快速变化：先从 `allkeys-lru` 开始；
- 长期热点稳定、存在偶发全量扫描：重点评估 `allkeys-lfu`；
- Redis 8.6+ 且数据的新旧修改时间比读取热度重要：压测 `allkeys-lrm`。

### 2. 存储型实例

队列状态、幂等记录、分布式协调数据等如果不能因内存压力丢失，应使用 `noeviction`，同时设置更早的容量告警。`noeviction` 只能阻止 Redis 主动淘汰，不能替代持久化、高可用、备份和业务清理机制。

### 3. 缓存与常驻数据混合实例

`volatile-*` 看起来可以保护无 TTL 数据，但它把“有没有 TTL”同时变成生命周期标记与淘汰权限，维护成本很高。一处漏设 TTL 就会让缓存变成不可淘汰对象；候选耗尽后写入仍会失败。条件允许时，应把可丢缓存和不可丢数据拆到不同实例，分别配置容量、持久化和告警。

## 七、监控不能只看 `used_memory`

可以通过以下命令建立基础观测面：

```bash
# 查看数据内存、碎片率、淘汰不计入内存的缓冲等指标
INFO memory

# 查看过期数、淘汰数、命中与未命中等累计指标
INFO stats

# 确认运行时真实配置，避免只看仓库中的 redis.conf
CONFIG GET maxmemory
CONFIG GET maxmemory-policy
CONFIG GET maxmemory-samples
```

建议至少关注这些指标的速率或比例，而不是只看累计值：

- `used_memory_dataset`：数据集本身使用的内存；
- `mem_fragmentation_ratio`：内存碎片与分配器行为的线索，不能脱离 RSS 单独下结论；
- `expired_keys`：由 TTL 到期删除的 Key 数；
- `evicted_keys`：因内存压力被淘汰的 Key 数；
- `keyspace_hits` / `keyspace_misses`：评估缓存命中效果；
- `current_eviction_exceeded_time`：当前连续超过淘汰内存上限的时间；
- 命令拒绝数、应用错误率和 P95/P99 延迟：确认 `noeviction` 或候选耗尽是否影响业务。

`evicted_keys` 持续上升不一定代表故障，但如果同时出现命中率下降、数据库回源增加和延迟抖动，通常说明容量不足、策略不匹配或缓存正在发生抖动式替换。

## 八、常见误区与踩坑

### 1. 把过期删除叫作“淘汰”

两者都会删除 Key，但触发条件、候选范围和监控指标不同。排障时应先看是 `expired_keys` 还是 `evicted_keys` 在增长。

### 2. 认为 Key 到点会被实时定时删除

Redis 使用被动访问检查与主动抽样清理，不承诺每个 Key 在到期毫秒被物理回收。业务读取不会拿到已经过期的 Key，但内存释放可能存在短暂延迟。

### 3. 把 `maxmemory` 配成机器总内存

Redis 进程还有数据结构开销、碎片、复制、AOF 和连接缓冲。没有预留空间时，操作系统可能先发生交换或 OOM，Redis 的淘汰机制来不及提供保护。

### 4. 盲目提高 `maxmemory-samples`

样本数增大只能让近似选择更接近理想算法，不能修复错误的策略、过小的实例或不合理的 Key 设计。它还会增加淘汰时的 CPU 消耗。

### 5. 在同一实例混放不同数据等级

缓存、会话、分布式锁和消息状态对丢失的容忍度不同。依靠一个复杂的 `volatile-*` 策略同时满足所有目标，往往比按数据等级拆分实例更难维护。

### 6. 升级后直接采用新策略

LRM 是 Redis 8.6+ 的新能力。客户端、配置中心、托管产品和回滚版本是否支持，都要在变更前核对；策略切换还会改变保留数据的分布，应通过影子流量或压测比较命中率和回源成本。

## 九、落地最佳实践

1. **先定义数据是否允许丢失**：不可丢数据与可重建缓存使用不同实例或至少不同容量策略。
2. **同时设计 TTL 与淘汰**：TTL 表达业务生命周期，淘汰策略表达容量压力下的牺牲顺序。
3. **为内存留安全余量**：结合 RSS、碎片、复制与 AOF 缓冲，而不是只看数据集大小。
4. **基于真实访问分布选择算法**：先采集命中率、热点变化和扫描特征，再比较 LRU、LFU 或 LRM。
5. **写入时原子携带 TTL**：避免值已写入但过期时间未设置的永久 Key。
6. **打散批量 TTL**：对同批缓存加入合理抖动，并为热点回源设计额外保护。
7. **上线前验证版本与运行时配置**：以 `redis-server --version`、`CONFIG GET` 和托管产品能力为准。
8. **用业务指标验证效果**：淘汰策略的最终目标是更低延迟和更少回源，不是单独追求某个 Redis 指标好看。

## 十、总结

Redis 的内存治理不是选择一个“最先进”的淘汰算法，而是把三层语义对齐：应用用 TTL 表达数据生命周期，Redis 用主动与被动过期回收失效数据，再用 `maxmemory-policy` 处理容量压力。

Redis 7.x 的 8 种基础策略已经覆盖不淘汰、全 Key/仅 TTL Key，以及 LRU、LFU、随机和剩余 TTL 等主要选择；Redis 8.6+ 的 LRM 又补充了“按最近修改时间保留数据”的维度。选型时先判断数据能否丢失，再分析访问或修改模式，最后用压测、命中率、淘汰速率和回源成本验证，而不是凭策略名称作决定。

## 参考资料

- [Redis 官方文档：Key eviction](https://redis.io/docs/latest/develop/reference/eviction/)
- [Redis 官方文档：EXPIRE](https://redis.io/docs/latest/commands/expire/)
- [Redis 官方文档：Redis 8.6 新特性](https://redis.io/docs/latest/develop/whats-new/8-6/)
- [Redis 官方文档：Redis configuration](https://redis.io/docs/latest/operate/oss_and_stack/management/config/)

