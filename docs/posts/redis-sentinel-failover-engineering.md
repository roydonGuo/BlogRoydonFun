---
title: Redis Sentinel 故障转移工程实践：主观下线、客观下线与数据安全
date: 2026-08-19
category: 后端开发
cover: /images/posts/redis-sentinel-failover-engineering-knowledge-map.png
tags: [redis, sentinel, high-availability, replication, failover]
excerpt: Sentinel 解决的是非分片 Redis 的故障发现、主节点切换与服务发现，不会把异步复制变成强一致。本文讲清 SDOWN、ODOWN、Leader 选举、Replica 晋升、客户端重连，以及网络分区下如何收紧数据丢失窗口。
---

# Redis Sentinel 故障转移工程实践：主观下线、客观下线与数据安全

<img src="/images/posts/redis-sentinel-failover-engineering-knowledge-map.png" alt="Redis Sentinel 故障转移工程实践：主观下线、客观下线与数据安全知识串联图" style="border-radius: 10px;" />

Sentinel 解决的是非分片 Redis 的故障发现、主节点切换与服务发现，不会把异步复制变成强一致。本文讲清 SDOWN、ODOWN、Leader 选举、Replica 晋升、客户端重连，以及网络分区下如何收紧数据丢失窗口。

## 先说结论：高可用不等于零丢失

一个可用的 Sentinel 部署至少要同时处理三件事：Redis 主从复制、多个 Sentinel 的多数派决策、客户端通过 Sentinel 发现当前主节点。只部署三个 Sentinel，却让应用把 Redis 主节点地址写死，故障转移仍然无法闭环。

工程上先记住五点：

1. **SDOWN 是单个 Sentinel 的本地判断，ODOWN 是达到 `quorum` 后的共同判断**；
2. **`quorum` 负责认定故障，多数派授权负责真正执行故障转移**，两者不是同一个票数；
3. **Replica 晋升先看是否可靠，再依次比较优先级、复制偏移量和 Run ID**；
4. **Redis 默认异步复制**，主节点已经响应客户端的写入仍可能没有到达候选 Replica；
5. **Sentinel 不负责分片**。需要水平拆分数据与槽位迁移时，应评估 Redis Cluster，而不是继续堆 Replica。

本文以 Redis Open Source 官方 `latest` 文档为准，事实核对日期为 2026-08-19。Sentinel 2 自 Redis 2.8 起稳定提供，但部署时仍应核对所用 Redis 版本自带的 `sentinel.conf`，不要照搬旧博客中的参数默认值。

## 一、Sentinel 到底承担什么职责

官方把 Sentinel 能力分为四类：

| 能力 | 作用 | 不负责的事情 |
|---|---|---|
| Monitoring | 持续检查主节点、Replica 与其他 Sentinel | 业务健康检查 |
| Notification | 通过事件与 API 报告状态变化 | 替代监控告警平台 |
| Automatic failover | 选择 Replica 晋升，并重配置其他 Replica | 保证每次写入零丢失 |
| Configuration provider | 向客户端返回当前主节点地址 | 让写死地址的客户端自动迁移 |

Sentinel 是一个分布式控制面。官方建议至少部署三个 Sentinel，并放在相互独立的故障域中。三个进程如果都在同一台宿主机，数量上是三份，故障域仍然只有一个。

一个典型拓扑如下：

```text
应用客户端 ──查询──> Sentinel A / B / C
     │                    │ 监控与投票
     └──读写──> Master <──┴──> Replica 1 / Replica 2
```

Sentinel 只需要显式配置要监控的主节点。它会从 Redis 拓扑发现 Replica，并通过 `__sentinel__:hello` 频道发现监控同一主节点的其他 Sentinel。

## 二、从 SDOWN 到 ODOWN：不要把超时当成最终判决

Sentinel 周期性发送 `PING`。如果在 `down-after-milliseconds` 时间内一直收不到可接受响应，当前 Sentinel 把实例标记为 **SDOWN（Subjectively Down，主观下线）**。

SDOWN 只代表“我认为它不可达”，可能由当前 Sentinel 的网络抖动、进程阻塞或对端故障造成。单个 Sentinel 的 SDOWN 不能直接切主。

当至少 `quorum` 个 Sentinel 都报告主节点 SDOWN，主节点才进入 **ODOWN（Objectively Down，客观下线）**。ODOWN 只用于主节点；Replica 和 Sentinel 本身只会进入 SDOWN，因为它们不触发同样的主节点故障转移流程。

```text
PING 持续失败
  → 当前 Sentinel 标记 SDOWN
  → 询问其他 Sentinel
  → SDOWN 报告数达到 quorum
  → 主节点标记 ODOWN
  → 竞选执行本轮 failover 的 Sentinel Leader
```

### `quorum` 与多数派为什么必须分开理解

假设有 5 个 Sentinel，`quorum=2`：

- 2 个 Sentinel 同意主节点不可达，就可以形成 ODOWN；
- 但真正执行切主，候选 Sentinel 仍须获得至少 3 个 Sentinel 的授权。

因此，小 `quorum` 可以提高故障检测敏感度，却不能让少数分区独自完成切主。若只剩 2/5 个 Sentinel 可互通，它们可能认定 ODOWN，但拿不到多数派授权，故障转移不会执行。

## 三、一次自动故障转移发生了什么

主节点 ODOWN 后，流程可压缩为六步：

1. 某个 Sentinel 为新的配置纪元发起 Leader 竞选；
2. 获得多数派授权的 Sentinel 负责本轮故障转移；
3. 从合格 Replica 中选择晋升对象；
4. 向目标 Replica 发送晋升指令，使其成为新主节点；
5. 让其他 Replica 改为复制新主节点；
6. 发布新配置，客户端后续查询得到新主节点地址；旧主节点恢复后被重配置为 Replica。

配置纪元用于给每次新拓扑一个唯一版本。多个 Sentinel 收到更高纪元的配置后会接受它，最终收敛到同一个主节点地址。

### Replica 不是只按 offset 最大来选

Sentinel 先排除与旧主节点断开过久等不可靠 Replica，再按以下顺序排序：

1. `replica-priority` 数值更小者优先；值为 `0` 表示永不晋升；
2. 优先级相同，复制偏移量更大者优先，通常意味着数据更新；
3. 仍相同，Run ID 字典序更小者优先，用于得到确定性结果。

机房距离、磁盘性能和业务重要性不同的 Replica，可以用 `replica-priority` 表达晋升偏好。但所有节点都要配置正确，因为今天的主节点在下一次切换后也可能成为 Replica。

## 四、最小配置：参数是策略，不是复制答案

下面示例用于解释参数含义，不是生产默认答案：

```conf
# 监控名为 cache-primary 的主节点；2 表示认定 ODOWN 所需的 quorum
sentinel monitor cache-primary 10.0.1.10 6379 2

# 连续 10 秒不可达后，单个 Sentinel 才标记 SDOWN
sentinel down-after-milliseconds cache-primary 10000

# 限制故障转移重试与状态推进的时间窗口
sentinel failover-timeout cache-primary 60000

# 每次只让一个 Replica 改为同步新主节点，降低同时不可读的范围
sentinel parallel-syncs cache-primary 1
```

`sentinel.conf` 必须可写，因为 Sentinel 会把新主节点、配置纪元和发现到的拓扑写回文件。只读挂载会让进程无法按设计持久化状态。

参数取值应由故障预算决定：

- `down-after-milliseconds` 太小，短暂抖动会频繁触发检测；太大，恢复时间目标变差；
- `failover-timeout` 不是业务请求超时，它约束 Sentinel 故障转移状态机；
- `parallel-syncs` 越大，拓扑收敛更快，但多个 Replica 可能同时在全量同步加载阶段短暂不可用。

上线前用 `SENTINEL CKQUORUM cache-primary` 检查当前是否同时满足 quorum 与多数派授权条件，并把结果接入监控。

## 五、Spring Boot 客户端必须认识 Sentinel

当前 Spring Boot 使用 `spring.data.redis.*` 前缀。应用至少配置一个主节点逻辑名和多个 Sentinel 地址：

```yaml
spring:
  data:
    redis:
      sentinel:
        master: cache-primary # 必须与 sentinel monitor 的名称一致
        nodes:
          - redis-sentinel-a.internal:26379
          - redis-sentinel-b.internal:26379
          - redis-sentinel-c.internal:26379
        username: app-sentinel # Sentinel ACL 账号，与数据节点账号分离
        password: ${REDIS_SENTINEL_PASSWORD}
      username: app-cache     # Redis 数据节点 ACL 账号
      password: ${REDIS_DATA_PASSWORD}
      connect-timeout: 2s
      timeout: 1s
```

Spring Data Redis 的 Lettuce 与 Jedis 都支持通过 Sentinel 查找主节点；具体认证、Replica 读取和连接恢复能力存在驱动差异，升级时应以所用 Spring Data Redis 版本的驱动能力表为准。

业务代码仍要正确处理切换窗口：

- 连接可能断开，短时间内出现超时或只读错误；
- 只对确认可安全重复的操作做有界重试；
- 锁、限流、库存扣减等写操作不能因为客户端重试而重复生效；
- 熔断降级不能把“缓存故障”悄悄变成错误业务结果。

## 六、网络分区与脑裂：Sentinel 不承诺强一致

最危险的场景不是旧主节点立刻宕机，而是它与 Sentinel 多数派失联，却仍能接收一部分客户端写入：

```text
客户端 A → 旧主节点（少数网络分区，仍接受写）
Sentinel 多数派 → 晋升新主节点 ← 客户端 B
网络恢复 → 旧主节点降级并同步新主节点
```

旧主节点在孤岛期间接收、但没有复制到新主节点的写入可能丢失。原因在于 Redis 默认异步复制，而不是 Sentinel “选错了主”。`WAIT` 可以等待指定数量 Replica 确认已接收数据，能缩小风险，但官方明确说明它不会把 Redis 变成强一致系统。

可以在主节点设置：

```conf
# 至少有 1 个延迟不超过 10 秒的 Replica，主节点才接受写入
min-replicas-to-write 1
min-replicas-max-lag 10
```

这是一种 best-effort 安全阀：孤立主节点失去合格 Replica 后会拒绝写入，从而限制潜在丢失窗口，但也会牺牲可用性。数值必须按写入速率、网络延迟、RPO 与容灾演练结果确定。

持久化也不能省略。官方特别警告：若主节点关闭持久化又自动重启，它可能以空数据集恢复，并让 Replica 同步成空。数据重要时，应在主从节点启用合适的 RDB/AOF 策略，或在无持久化方案中禁止自动重启，并准备独立备份。

## 七、部署与运维最容易忽略的边界

### 1. 三个 Sentinel 要跨故障域

至少跨宿主机，条件允许时跨可用区。Sentinel 与 Redis、应用的网络视角也要接近真实客户端，否则控制面认为可用的地址，应用未必可达。

### 2. Docker、NAT 和端口映射要显式验证

Sentinel 依赖发现到的 IP 与端口重配置拓扑。容器上报内部地址、端口映射不一致时，可能选出应用无法连接的地址。应配置 announce 地址，并从应用网络实际验证发现结果。

### 3. Sentinel 与数据节点分别做 ACL

客户端需要查询 Sentinel，也需要访问 Redis 数据节点；两套连接应最小授权。不要把管理账号和密码直接写进仓库，也不要把 26379 暴露到公网。

### 4. 读 Replica 要接受一致性代价

异步复制意味着 Replica 读取可能落后。刚写后读、会话、分布式锁、幂等记录等强时序数据应读取主节点，不能为了“分担读压力”无差别切到 Replica。

### 5. 监控状态，而不只监控进程

至少观察：

- `+sdown`、`+odown`、`+try-failover`、`+elected-leader`、`+switch-master` 事件；
- 主从角色、复制偏移量、Replica lag、断链与全量同步次数；
- Sentinel 可达数、`CKQUORUM` 结果、配置纪元和 TILT 状态；
- 客户端连接重建耗时、Redis 错误率、超时率与降级量。

## 八、发布前必须演练的故障矩阵

| 场景 | 预期结果 | 重点验证 |
|---|---|---|
| 主进程停止 | Replica 自动晋升 | RTO、错误峰值、客户端重连 |
| 主机断网 | 多数派完成切换 | 旧主是否停止接收写 |
| 单个 Sentinel 停止 | 不切主，控制面仍可用 | `CKQUORUM` 与告警 |
| Sentinel 失去多数派 | 不执行自动切主 | 应用降级与人工处置 |
| Replica 严重落后 | 不应优先晋升 | priority、offset、数据差异 |
| 旧主恢复 | 自动成为 Replica | 是否触发全量同步、资源峰值 |
| NAT 地址错误 | 演练应直接失败并暴露问题 | 应用实际可达地址 |

故障注入要从可控环境开始，记录每个时间点的 Sentinel 事件、Redis 角色、复制 offset 和应用错误。只看到“最终恢复”不够，还要回答切换期间失败了多少请求、是否重复执行、丢失窗口多大。

## 总结

Redis Sentinel 的核心不是“主挂了就随便挑个从”，而是一套分层决策：单点超时形成 SDOWN，`quorum` 形成 ODOWN，多数派授权唯一执行者，再按可靠性、优先级和复制进度选择 Replica，最后让客户端和整个复制拓扑收敛到新主节点。

它提高的是非分片 Redis 的可用性，不是强一致性。真正可上线的方案还必须包括 Sentinel 感知客户端、持久化与备份、幂等重试、网络分区写保护、跨故障域部署，以及可重复的故障演练。

参考资料：

- [Redis 官方：High availability with Redis Sentinel](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)
- [Redis 官方：Redis replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)
- [Spring Data Redis：Connection Modes](https://docs.spring.io/spring-data/redis/reference/redis/connection-modes.html)
- [Spring Boot：Working with NoSQL Technologies](https://docs.spring.io/spring-boot/reference/data/nosql.html)
