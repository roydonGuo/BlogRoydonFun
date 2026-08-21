---
title: Redis 持久化工程实践：RDB、AOF、重写与故障恢复
date: 2026-08-12
category: Redis
cover: /covers/backend.svg
tags: [redis, rdb, aof]
excerpt: 从数据安全目标出发，讲清 RDB 快照、AOF 写回与 Redis 7.0+ 多文件重写机制，并把大 Key、磁盘故障、监控告警和恢复演练串成一套可落地的持久化方案。
---

# Redis 持久化工程实践：RDB、AOF、重写与故障恢复

<img src="/images/posts/redis-persistence-rdb-aof-engineering-knowledge-map.webp" alt="Redis 持久化工程实践：RDB、AOF、重写与故障恢复知识串联图" style="border-radius: 10px;" />

从数据安全目标出发，讲清 RDB 快照、AOF 写回与 Redis 7.0+ 多文件重写机制，并把大 Key、磁盘故障、监控告警和恢复演练串成一套可落地的持久化方案。

## 先说结论：持久化不是一个开关，而是一组恢复承诺

Redis 是内存数据库，持久化解决的是进程退出或机器故障后如何重建数据集。工程上不能只问“有没有开启 AOF”，而要先定义三件事：

- **RPO（恢复点目标）**：最多允许丢失多长时间的数据；
- **RTO（恢复时间目标）**：故障后多久必须恢复服务；
- **故障范围**：只防进程崩溃，还是还要防磁盘损坏、误删除和整个可用区故障。

Redis Open Source 提供四种持久化组合：不持久化、只用 RDB、只用 AOF、同时使用 RDB 与 AOF。它们没有脱离业务语义的“最佳答案”：纯缓存可以不持久化；能从数据库重建但希望缩短预热时间的缓存适合 RDB；不能轻易重建的会话、计数或任务状态通常需要 AOF；重要数据还需要异机备份和恢复演练，不能把本机持久化文件当成备份。

本文以 Redis 7.0+ 的多文件 AOF 为主要版本边界，并用 Redis 当前官方文档与 Redis 8.8 命令参考核对，事实核对日期为 2026-08-12。Redis 7.0 以前的单文件 AOF 在目录结构、重写期间内存和写入路径上有所不同，运维方案不能直接照搬。

## 一、四种持久化策略如何选择

| 策略 | 数据恢复来源 | 典型 RPO | 启动特征 | 适用场景 |
|---|---|---:|---|---|
| 不持久化 | 上游系统重新回填 | 取决于上游 | 无持久化文件加载 | 可丢弃且可快速重建的纯缓存 |
| 只用 RDB | 最近一次时间点快照 | 通常为分钟级 | 文件紧凑，较适合备份与快速恢复 | 可接受一段数据丢失、重视恢复速度 |
| 只用 AOF | 重放写命令或加载 AOF 基础文件 | 取决于 `appendfsync` | 文件通常更大，恢复工作更多 | 希望缩小进程故障的数据丢失窗口 |
| RDB + AOF | 重启时优先使用 AOF | 通常由 AOF 决定 | 同时承担快照、追加和重写开销 | 数据重要，需要更完整的本机恢复手段 |

同时开启 RDB 与 AOF 时，Redis 重启会使用 AOF 恢复数据，因为 AOF 通常保存更完整的变更历史。RDB 仍然有价值：它是紧凑的时间点文件，适合异地备份、版本留存和更快的数据集装载。

这里要特别区分三个概念：

1. **持久化**把内存状态落到本机耐久介质；
2. **复制**把数据传播到其他 Redis 节点，主要服务于高可用和读扩展；
3. **备份**保留独立、可回退、最好跨故障域的数据副本。

主从复制不能代替备份。误执行 `FLUSHALL`、错误写入或逻辑删除也可能被复制到从节点；本机 RDB 和 AOF 又可能与机器或磁盘一起损坏。真正的数据安全需要把三者组合起来。

## 二、RDB：把某个时间点的数据集做成快照

RDB 将某个时间点的数据集编码为紧凑的二进制文件，默认文件名通常是 `dump.rdb`。它有三种常见触发方式：

- `SAVE`：前台同步保存，执行期间阻塞服务处理请求，生产环境通常不应随意使用；
- `BGSAVE`：创建后台子进程生成快照，父进程继续服务客户端；
- `save <seconds> <changes>`：满足时间与变更次数条件时自动触发后台保存。

一个 `BGSAVE` 的主流程是：

```text
主进程 fork 子进程
        ↓
子进程读取 fork 时刻的数据视图
        ↓
写入临时 RDB 文件
        ↓
写完后原子替换旧 RDB
```

### 1. Copy-on-Write 为什么既高效又有风险

`fork()` 后父子进程最初共享物理内存页。子进程读取旧视图并写 RDB；父进程如果修改某个共享页，操作系统才为该页创建副本，这就是 Copy-on-Write（COW）。因此，后台保存不是把整个数据集同步复制一遍后才继续提供服务。

但 COW 不是“免费快照”：

- 数据集越大，`fork()` 复制页表的成本越高，主线程暂停越明显；
- 快照期间写流量越大，被复制的内存页越多，额外内存压力越大；
- 大 Key 往往跨越许多内存页，更新少量业务字段也可能放大 COW；
- 磁盘写入慢会延长子进程存活时间，从而扩大 COW 发生窗口。

所以容量规划不能让 `used_memory` 长期贴近机器物理内存。必须给页表、内存碎片、复制缓冲区、客户端缓冲区和持久化期间的 COW 留出余量。

### 2. RDB 的优势与边界

RDB 的优势是文件紧凑、适合复制和归档，并且大数据集恢复通常比逐条重放纯命令 AOF 更快。它的核心边界也很明确：两次快照之间的变更在意外停机时可能丢失。因此，不能把“每 5 分钟生成快照”解释成“绝不超过 5 分钟数据丢失”，还要考虑最后一次快照是否成功、文件是否完成转移、恢复时能否读取。

## 三、AOF：记录写命令，再重放得到数据集

AOF（Append Only File）记录会改变数据集的命令。客户端写命令执行后，数据先进入 Redis 的 AOF 缓冲，再通过 `write()` 进入操作系统页缓存；何时调用 `fsync()` 把数据推进耐久存储，由 `appendfsync` 策略决定。

```text
客户端写命令
    ↓
Redis 执行并更新内存
    ↓
AOF 缓冲区
    ↓ write()
操作系统页缓存
    ↓ fsync()
耐久存储
```

### 1. 三种 AOF 写回策略

| 配置 | 行为 | 数据安全 | 延迟与吞吐 |
|---|---|---|---|
| `appendfsync always` | 每批追加后执行 `fsync` | 丢失窗口最小 | 磁盘延迟更容易进入请求路径，代价最高 |
| `appendfsync everysec` | 通常每秒由后台执行 `fsync` | 灾难时可能丢失约一秒写入 | 官方建议且默认的折中策略 |
| `appendfsync no` | Redis 不主动 `fsync`，交给操作系统 | 丢失窗口由内核刷盘行为决定 | 性能较好，但耐久性最弱 |

`always` 不是业务“零数据丢失”的同义词。Redis 返回成功之后，控制器缓存、磁盘设备、虚拟化存储或故障域仍可能影响最终结果；跨节点复制也有自己的确认语义。支付、账务等强一致数据仍应以事务数据库为事实源，Redis 只承担缓存、加速或可重建的派生状态。

### 2. Redis 7.0+ 的多文件 AOF

从 Redis 7.0 开始，AOF 由单文件演进为多文件结构：

- **Base AOF**：最多一个，表示最近一次重写时的数据基础，可使用 RDB 或 AOF 格式；
- **Incremental AOF**：一个或多个，保存 Base 生成后持续到来的增量命令；
- **Manifest**：记录哪些 Base 和增量文件共同组成当前有效 AOF。

这些文件位于 `appenddirname` 指定的目录中。重写时，父进程会打开新的增量文件继续承接写入；子进程生成新的 Base；完成后通过临时 Manifest 和原子替换让新文件集合生效。这个版本边界很重要：旧教程里“重写期间把全部增量同时保存在内存缓冲，最后一次性追加到新 AOF”的描述主要针对 Redis 7.0 以前，不能原样描述当前机制。

## 四、AOF 重写不是压缩日志，而是重建最短状态

AOF 会随着写命令不断增长。例如同一个计数器执行 100 次 `INCR`，恢复最终状态并不一定需要重放全部 100 条历史命令。`BGREWRITEAOF` 根据当前内存数据生成能恢复当前状态的更短表示，再切换到新 AOF 文件集合。

重写有三个工程意义：

1. 降低 AOF 占用空间；
2. 减少启动恢复需要处理的数据量；
3. 清除已经被后续写入覆盖的历史操作。

它也会带来资源竞争：`fork()` 暂停、COW 内存、子进程 CPU、磁盘读写和新文件切换。不要把自动重写阈值设置得过于激进，也不要让 RDB 快照、AOF 重写、宿主机备份和批量任务同时争抢磁盘。Redis 会避免让 `BGSAVE` 与 AOF 重写两个重型后台持久化任务并行，但应用侧和基础设施侧的 I/O 峰值仍需自行错峰。

下面是一份面向 Redis 7.0+ 的示意配置，数值必须通过真实写流量、磁盘基线和 RPO 压测调整：

```conf
# 开启 AOF；重要业务通常仍保留 RDB 作为独立时间点备份来源。
appendonly yes

# 每秒刷盘是官方默认折中；若业务选择 always，必须先验证尾延迟。
appendfsync everysec

# AOF 目录在 dir 配置目录下；Redis 7.0+ 在其中维护 Base、增量文件和 Manifest。
appenddirname "appendonlydir"

# 当前 AOF 相对上次重写后的基础体积增长 100% 且达到最小体积后，才自动重写。
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 256mb

# 保留 RDB 快照：900 秒内至少发生 1 次变更时生成快照。
# 这里只是示例，不代表通用的 RPO 承诺。
save 900 1
```

## 五、大 Key 为什么会放大持久化风险

大 Key 不只是“单条命令慢”，它会同时影响持久化的多个阶段：

- **主线程执行成本**：读取、序列化、删除或更新大对象可能阻塞其他命令；
- **COW 放大**：`BGSAVE` 或 AOF 重写期间修改大对象，会复制更多内存页；
- **fork 成本**：总数据集越大，页表越大，`fork()` 越慢；
- **AOF 与网络放大**：大写命令增大 AOF 写入量，也可能推高复制缓冲和网络流量；
- **恢复时间**：大对象的加载、内存分配和重放会拉长 RTO。

治理要从模型设计开始：把超大 Hash、List、Set 或字符串按业务维度拆成有界 Key；设置元素数量与序列化后字节上限；删除大 Key 时优先评估 `UNLINK`，把内存回收移到后台线程；用 `MEMORY USAGE`、`SCAN` 配合采样工具定位大 Key，但不要在生产上无边界执行 `KEYS *`。

需要注意，拆 Key 不是越碎越好。大量小 Key 会增加对象、字典和过期元数据开销，还会改变原子操作边界。正确做法是给单 Key 大小、集合元素数、单命令处理量和业务事务边界同时设预算。

## 六、真实项目：订单状态缓存应该怎样落地

假设订单服务以 MySQL 为事实源，Redis 保存订单摘要、幂等结果和短期状态。这里不应把 Redis 持久化包装成数据库事务的一部分，而应明确恢复层级：

```text
MySQL 订单事实
    ↓ 事务提交后发布变更
Redis 在线缓存
    ├─ AOF everysec：缩短节点重启后的丢失窗口
    ├─ RDB：时间点备份和快速恢复材料
    └─ 缓存修复任务：从 MySQL 重放缺失或过期数据
```

应用写路径可以采用 Cache-Aside，并给重建任务保留可观测的版本字段：

```java
@Service
public class OrderCacheService {

    private final StringRedisTemplate redisTemplate;

    public OrderCacheService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void refreshOrder(OrderSnapshot order) {
        String key = "order:summary:" + order.id();

        // MySQL 已提交后再刷新缓存；Redis 失败时由重试任务修复，不能回滚数据库事实。
        Map<String, String> fields = Map.of(
                "status", order.status(),
                "version", String.valueOf(order.version()),
                "updatedAt", order.updatedAt().toString()
        );
        redisTemplate.opsForHash().putAll(key, fields);

        // TTL 限制陈旧缓存生命周期；具体时长应由业务读写模式决定。
        redisTemplate.expire(key, Duration.ofHours(24));
    }
}
```

这个例子的关键不是 Java API，而是边界：AOF 减少缓存状态在进程故障后的损失，但 MySQL 仍是最终事实；恢复后要按 `version` 对账，不能只比较 Key 数量；幂等结果若会影响扣款或发货，还必须在数据库中保存可审计记录。

## 七、故障恢复必须按剧本执行

### 1. 启动前先保护现场

发现 AOF 截断、加载失败或磁盘满时，不要直接修改唯一文件。先停止写入或隔离故障节点，复制整个 `appenddirname`、Manifest、RDB、配置和日志，再在副本上分析。Redis 当前版本通常能够在 `aof-load-truncated yes` 时丢弃末尾不完整命令并继续加载；更严重的损坏可以使用 `redis-check-aof`，但修复可能删除无法解析之后的数据，必须先备份并审查差异。

### 2. 同时开启 RDB 与 AOF 时确认恢复来源

Redis 会优先用 AOF 重建数据集。若 AOF 失效而决定改用 RDB，必须把它当作一次显式降级：记录将回退到哪个时间点、预计丢失多少变更、哪些下游数据需要重放。不能为了“先启动”悄悄删除 AOF 文件。

### 3. 恢复后验证业务不变量

只验证 `DBSIZE` 不够。至少还要检查：

- 关键业务 Key 的数量、版本和抽样内容；
- 过期时间是否符合预期；
- Stream、消费者组、延迟任务等状态是否完整；
- 应用侧缓存修复和幂等逻辑是否启动；
- 主从角色、复制偏移和客户端路由是否正确；
- 恢复过程中是否发生新的写入覆盖。

### 4. 备份要做恢复演练

RDB 文件生成成功不等于备份成功，上传对象存储成功也不等于能够恢复。应定期在隔离环境执行启动恢复，记录文件校验值、Redis 版本、加载耗时、Key 数量、业务抽样结果和实际 RPO/RTO。没有演练过的备份，只是一份尚未证实可用的文件。

## 八、监控：不要等重启时才发现持久化坏了

`INFO persistence` 是最直接的入口。建议至少采集并告警：

| 指标 | 关注点 |
|---|---|
| `rdb_last_bgsave_status` | 最近一次后台 RDB 是否成功 |
| `rdb_last_save_time` | 距离最后成功快照是否过久 |
| `rdb_changes_since_last_save` | 未进入最近快照的变更规模 |
| `rdb_bgsave_in_progress` | 快照是否长时间未结束 |
| `aof_enabled` | 实际运行配置是否符合预期 |
| `aof_last_bgrewrite_status` | 最近一次 AOF 重写是否成功 |
| `aof_rewrite_in_progress` / `aof_rewrite_scheduled` | 重写是否卡住或反复排队 |
| `aof_current_size` / `aof_base_size` | 增长速度与重写阈值是否合理 |
| `aof_pending_bio_fsync` / `aof_delayed_fsync` | 磁盘刷写是否出现积压或延迟 |
| `latest_fork_usec` | `fork()` 对主线程暂停的影响 |

还应监控磁盘剩余空间、磁盘延迟、容器内存限制、宿主机 swap、进程 RSS、复制积压和写入尾延迟。Redis 的 Latency Monitoring Framework 能记录 `fork`、`aof-write`、`aof-fsync-always`、`aof-rename` 等事件；可按业务可接受延迟设置 `latency-monitor-threshold`，再通过 `LATENCY LATEST` 或 `LATENCY DOCTOR` 排查。

```bash
# 查看持久化状态，不要只检查进程是否存活。
redis-cli INFO persistence

# 查看 Redis 记录的最新延迟事件。
redis-cli LATENCY LATEST

# 手动触发前先确认没有其他持久化任务和磁盘峰值。
redis-cli BGSAVE
redis-cli BGREWRITEAOF
```

## 九、常见追问与踩坑

### 1. `appendfsync everysec` 是否一定只丢一秒？

不能把它当成跨所有故障的绝对上限。官方描述是灾难时可能丢失约一秒写入，但真实结果还受后台 `fsync` 调度、操作系统、存储设备和故障类型影响。RPO 必须用实际基础设施故障注入和恢复演练验证。

### 2. 开启 AOF 后还需要 RDB 吗？

通常仍值得保留。RDB 适合紧凑备份、异地归档和时间点回退；AOF 更侧重缩短写入丢失窗口。二者解决的问题有重叠，但并不相同。

### 3. AOF 重写会阻塞客户端吗？

大部分重写工作由子进程完成，但 `fork()` 在主线程执行，文件切换、磁盘竞争和 COW 都可能造成延迟。正确说法是“后台重写降低了持续阻塞”，而不是“完全无阻塞”。

### 4. 复制节点能否代替持久化？

不能。复制提升可用性，但逻辑错误可能被同步，异步复制也可能在故障切换时丢失尚未到达副本的数据。是否在副本开启持久化，要结合故障切换策略、备份职责和托管平台约束设计。

### 5. 可以直接复制 AOF 目录做备份吗？

Redis 7.0+ 的 AOF 是由 Manifest 管理的多文件集合。官方建议在复制期间避免 AOF 重写，并先确认 `aof_rewrite_in_progress` 为 0；否则可能拿到互不匹配的文件集合。备份后还要校验大小或摘要并执行恢复验证。

### 6. 为什么磁盘满会变成线上故障？

持久化失败不仅意味着“下次重启可能丢数据”。根据配置与错误路径，Redis 还可能拒绝后续写命令；AOF 写入、重写和临时文件也都需要额外空间。磁盘水位应在耗尽前分级告警，并为重写峰值保留空间。

## 十、选择建议与最佳实践

### 纯缓存，可从数据库完整重建

- 可以关闭持久化，或用 RDB 缩短重启预热；
- 明确缓存击穿时的数据库保护和限流方案；
- 恢复目标是业务容量，不是恢复每一条缓存记录。

### 可容忍秒级丢失的业务状态

- 常见选择是 AOF `everysec`，并保留周期性 RDB；
- 通过副本、异机备份和业务重放进一步缩小影响；
- 对 `aof_delayed_fsync`、重写失败和磁盘延迟设置告警。

### 不能容忍数据丢失的核心账务

- 不要仅依赖 Redis `appendfsync always`；
- 使用具备明确事务和复制承诺的事实存储；
- Redis 保存可重建视图或加速数据，写路径保留幂等日志与对账能力。

### 通用落地清单

1. 用 RPO、RTO 和故障域选择策略，不照抄默认配置；
2. 标注 Redis 7.0+ 多文件 AOF 的目录、Manifest 和备份流程；
3. 给 `fork()`、COW、重写临时文件和复制缓冲留出 CPU、内存与磁盘余量；
4. 拆分大 Key，同时控制 Key 数量和原子操作边界；
5. 错开 RDB、AOF 重写、宿主机快照和批处理 I/O 峰值；
6. 监控持久化结果、延迟、磁盘空间，而不是只监控 Redis 存活；
7. 修改运行配置后同步持久化到配置文件，避免重启回退；
8. 备份文件、配置、版本信息和校验值，并跨机器或跨故障域保存；
9. 在隔离环境定期恢复，验证业务不变量和真实 RPO/RTO；
10. 把修复、降级和数据回灌写成演练过的操作手册。

## 总结

Redis 持久化的主线可以压缩成一句话：RDB 保存时间点，AOF 保存写入轨迹，重写把不断增长的历史重新折叠为可恢复的当前状态。

真正困难的地方不在于写下 `appendonly yes`，而在于把数据安全、请求延迟、内存余量、磁盘空间和恢复时间放进同一套约束。RDB 的 `fork()` 与 COW、AOF 的三种 `fsync` 策略、Redis 7.0+ 的 Base/Incremental/Manifest、多文件备份边界以及大 Key 放大效应，都必须进入容量规划和监控。

最后记住：持久化文件只有经过异地保存和恢复演练，才是可信的恢复材料；Redis 只有与事实源、复制、备份、对账和故障剧本一起设计，才是一套完整的数据安全方案。

## 参考资料

- [Redis 官方文档：Persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis 官方文档：INFO](https://redis.io/docs/latest/commands/info/)
- [Redis 官方文档：Diagnosing latency issues](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/)
- [Redis 官方文档：Latency monitoring](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency-monitor/)
- [Redis 官方文档：Redis 8.8 Commands Reference](https://redis.io/docs/latest/commands/)
