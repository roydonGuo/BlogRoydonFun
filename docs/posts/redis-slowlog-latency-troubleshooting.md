---
title: Redis 慢查询排查：SLOWLOG、延迟监控与大 key
date: 2026-10-13
category: 后端开发
cover: /covers/backend.svg
tags: [redis, 性能, slowlog, 大key, 可观测性]
excerpt: SLOWLOG 记录的是命令执行时间，不含 socket 读写，所以“客户端慢但慢日志为空”是常态；延迟尖刺往往来自 fork、AOF 刷盘与淘汰周期，要用 LATENCY 监控而不是慢日志。排查顺序是：慢日志 → 延迟事件 → 大 key → 客户端视角往返。
---

# Redis 慢查询排查：SLOWLOG、延迟监控与大 key

<img src="/images/posts/redis-slowlog-latency-troubleshooting-knowledge-map.png" alt="Redis 慢查询排查：SLOWLOG、延迟监控与大 key知识串联图" style="border-radius: 10px;" />

SLOWLOG 记录的是命令执行时间，不含 socket 读写，所以“客户端慢但慢日志为空”是常态；延迟尖刺往往来自 fork、AOF 刷盘与淘汰周期，要用 LATENCY 监控而不是慢日志。排查顺序是：慢日志 → 延迟事件 → 大 key → 客户端视角往返。

## 先说结论：四个视角，别只看一个

| 视角 | 工具 | 能回答什么 | 看不到什么 |
|---|---|---|---|
| 命令执行 | `SLOWLOG` | 哪条命令在服务端跑了很久 | 网络传输、排队 |
| 服务端事件 | `LATENCY` | fork、AOF、淘汰周期的尖刺 | 具体哪条命令 |
| 数据形态 | `--bigkeys`、`MEMORY USAGE` | 哪些键过大、分布是否倾斜 | 访问热度 |
| 客户端往返 | `redis-cli --latency`、客户端指标 | 用户真实感受到的耗时 | 服务端内部原因 |

四者不可互相替代。本文以 **Redis 7 及以上（含 Redis 8）** 为基线，核对日期 **2026-11-20**。

## 一、SLOWLOG：先看准它的口径

- `slowlog-log-slower-than` 单位是**微秒**，默认 10000（即 10 ms，不是 10 秒）；负值关闭，0 记录全部命令；
- `slowlog-max-len` 默认 128 条，超出后丢弃最旧的；
- 记录的是**命令执行时间**，官方明确不含与客户端通信、发送回复等 IO；但**构造回复**算在执行时间里（如 `HGETALL` 遍历大 hash）；
- `SLOWLOG GET [count]` 默认返回最近 10 条，`-1` 返回全部；每条包含自增 ID、时间戳、耗时微秒、命令与参数、客户端地址与名称（4.0+）；
- Redis 8.10 起参数数组按 `slowlog-max-argc`（默认 32）截断，并额外给出原始参数个数。

由此得到两条重要推论：

1. **大回复不一定进慢日志**：命令拼装几 MB 回复可能只要几百微秒，随后通过 socket 传输耗时几十毫秒，慢日志里看不到；
2. **慢日志里的每一条都意味着"整个实例被阻塞了这么久"**，因为 Redis 命令执行是单线程的。

## 二、LATENCY：抓不来自命令的尖刺

延迟监控默认关闭（`latency-monitor-threshold=0`），开启后按事件记录尖刺：

```bash
# 开启：超过 100ms 的事件被记录
CONFIG SET latency-monitor-threshold 100
# 最近一次各类事件的最大尖刺
LATENCY LATEST
# 某个事件的时间序列与人类可读诊断
LATENCY HISTORY fork
LATENCY DOCTOR
```

跟踪的事件包括 `command`、`fork`、`expire-cycle`、`eviction-cycle`、`aof-write`、`aof-fsync-always` 等。典型对应关系：

- `fork` 尖刺 → RDB 快照或全量同步，实例内存越大 fork 越慢；
- `aof-fsync-always` → 每次写都 fsync，磁盘抖动直接反映为延迟；
- `expire-cycle` / `eviction-cycle` → 大量键同时过期或内存打满触发淘汰。

## 三、大 key：慢的根因，也是内存的隐患

大 key 指 value 过大或元素过多的键（如百万元素的 Hash、几十 MB 的 String）。危害有三：

1. 单条命令耗时长，阻塞全实例；
2. 删除时释放内存耗时长（`DEL` 同步释放，`UNLINK` 交给后台线程）；
3. 集群下造成数据倾斜，单分片内存与流量畸高。

```bash
# 采样扫描（内部用 SCAN，不阻塞），生产建议加 -i 限速
redis-cli --bigkeys -i 0.1
# 按实际字节数找最大键（底层用 MEMORY USAGE）
redis-cli --memkeys -i 0.1
# 单键精确占用
redis-cli MEMORY USAGE user:12345:sessions SAMPLES 0
```

## 四、真实示例：慢命令的替代写法

```java
/**
 * 用户会话读写：用 HSCAN 分页替代 HGETALL，避免单次拉取整个大 hash。
 * 说明：分页本身不保证强一致快照，业务需接受"遍历期间的并发变更"。
 */
@Repository
public class SessionRepository {

    private final StringRedisTemplate redisTemplate;

    public SessionRepository(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * 分页读取会话字段，单次最多返回 batch 条。
     *
     * @param key   会话键
     * @param count 单批条数，建议 100~500，过大退化为 HGETALL 的效果
     * @return 字段名到值的映射（仅本批）
     */
    public Map<String, String> page(String key, long count) {
        ScanOptions options = ScanOptions.scanOptions().count(count).build();
        Map<String, String> page = new LinkedHashMap<>();
        try (Cursor<Map.Entry<Object, Object>> cursor =
                     redisTemplate.opsForHash().scan(key, options)) {
            while (cursor.hasNext()) {
                Map.Entry<Object, Object> entry = cursor.next();
                page.put(String.valueOf(entry.getKey()), String.valueOf(entry.getValue()));
                if (page.size() >= count) {
                    break;   // 到达本批上限即返回，由调用方带上游标继续
                }
            }
        }
        return page;
    }

    /**
     * 删除大 key：用 UNLINK 异步释放，避免 DEL 阻塞主线程。
     */
    public void removeAsync(String key) {
        redisTemplate.unlink(key);
    }
}
```

批量写入同理：`MGET` 拆成每批 100~500 个键；`KEYS *` 一律换成 `SCAN`；`SORT` 必须带 `LIMIT`。

## 五、常见追问

**问：客户端报超时，但 SLOWLOG 是空的，怎么解释？**
三种可能：回复体积大（构造快、传输慢，慢日志不记 socket 写）；网络或客户端线程池排队；服务端在 fork/AOF 期间被阻塞但单条命令本身不慢。分别用 `--latency`、客户端指标、`LATENCY DOCTOR` 验证。

**问：`slowlog-log-slower-than` 设成 1000 微秒会不会影响性能？**
慢日志在内存中累加，开销很小，官方明确可以设为 0 记录全部命令。真正要控制的是日志条数与采集频率。

**问：为什么 `Seconds` 级别的慢在 `INFO stats` 里看不到？**
`INFO stats` 给的是命中率、连接数、命令计数等聚合值，不含单命令耗时分布；单命令分布看 `INFO latencystats` 或 `LATENCY HISTOGRAM`。

**问：大 key 只能事后发现吗？**
可以在写入侧约束：单 String 不超过几十 KB、集合元素数设上限并分片（`user:1:sessions:0..N`），配合巡检任务定期跑 `--bigkeys`。

**问：主从架构下，慢查询只影响主库吗？**
读从库同样会遇到慢命令；而且从库还要承担全量同步与复制流量，更容易被大 key 拖慢。

## 六、踩坑记录

- **把默认阈值当 10 秒**：实际 10 ms，导致"慢日志为空"的误判，或反过来被大量条目淹没。
- **`HGETALL` 读会话**：单键几十万字段，一次阻塞上百毫秒。
- **`DEL` 删除大 hash**：删除瞬间主线程卡住，客户端集体超时；应改 `UNLINK`。
- **`KEYS *` 排查数据**：生产执行直接打满 CPU。
- **只加机器不拆 key**：内存涨、fork 变慢、延迟尖刺更明显。
- **未开延迟监控**：事故后只能看到客户端超时，无法定位是 fork 还是磁盘。

## 七、选择建议

| 现象 | 首选工具 | 常见结论 |
|---|---|---|
| 偶发命令慢 | `SLOWLOG GET` | 大集合全量读、复杂 `SORT` |
| 周期性尖刺 | `LATENCY DOCTOR` | fork / AOF fsync / 淘汰 |
| 内存异常增长 | `--bigkeys`、`MEMORY STATS` | 大 key、无 TTL 键堆积 |
| 客户端视角慢 | `redis-cli --latency` | 网络 RTT、连接池不足 |

## 八、最佳实践清单

1. 生产开启 `slowlog-log-slower-than=10000`（10 ms）并按天采集分析；
2. 开启 `latency-monitor-threshold`（建议 100 ms）并接入监控；
3. 禁止 `KEYS`、无 `LIMIT` 的 `SORT`、无上限的 `HGETALL`/`LRANGE`；
4. 大 key 拆分 + 上限约束，删除用 `UNLINK`；
5. 集合遍历改用 `SCAN` 系列并限速；
6. 把 `INFO latencystats` 的 P99 纳入告警，而不只看平均值；
7. 每次事故后执行 `SLOWLOG RESET` 与 `LATENCY RESET`，让下一轮基线干净。

## 总结

Redis 慢查询排查的难点不在命令，而在口径：SLOWLOG 只测执行、不测传输；延迟尖刺多半来自 fork 与刷盘；大 key 既是慢的根因也是内存隐患。把四个视角拼起来看，才能从"客户端超时"一路定位到具体的命令、键与事件。
