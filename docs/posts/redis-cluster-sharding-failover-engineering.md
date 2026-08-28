---
title: Redis Cluster 工程实践：哈希槽、重定向与故障转移
date: 2026-08-24
category: Redis
cover: /images/posts/redis-cluster-sharding-failover-engineering-knowledge-map.webp
tags: [cluster, sharding, hash-slot]
excerpt: Redis Cluster 用固定的 16384 个哈希槽把 Key 分散到多个主分片，并通过客户端重定向、在线迁槽和 Replica 晋升维持扩缩容与故障恢复。真正的工程难点是 Key 设计、拓扑刷新、迁移期重试和异步复制的数据边界。
---

# Redis Cluster 工程实践：哈希槽、重定向与故障转移

<img src="/images/posts/redis-cluster-sharding-failover-engineering-knowledge-map.webp" alt="Redis Cluster 工程实践：哈希槽、重定向与故障转移知识串联图" style="border-radius: 10px;" />

Redis Cluster 用固定的 16384 个哈希槽把 Key 分散到多个主分片，并通过客户端重定向、在线迁槽和 Replica 晋升维持扩缩容与故障恢复。真正的工程难点是 Key 设计、拓扑刷新、迁移期重试和异步复制的数据边界。

## 先说结论：Cluster 同时解决分片与故障转移

Redis Sentinel 只为非分片主从拓扑提供故障转移；Redis Cluster 则把 Key 空间拆成固定槽位，再把槽位分配给多个主节点。一个常见拓扑由至少三个主分片组成，每个主分片再配置 Replica：

```text
16384 个槽
  ├─ Master A：一部分槽 → Replica A1
  ├─ Master B：一部分槽 → Replica B1
  └─ Master C：一部分槽 → Replica C1
```

它带来四个直接结果：

1. 写入和内存容量可以横向分散到多个主节点；
2. 客户端必须理解槽位映射以及 `MOVED`、`ASK` 重定向；
3. 扩缩容的本质是迁移槽内 Key，不是重新计算整个 Key 空间；
4. 主节点故障后只能由它的 Replica 接管对应槽，异步复制仍可能丢失最近写入。

本文以 Redis Open Source 8.8 官方文档与 Cluster Specification 为事实基线，核对日期为 2026-08-24。哈希槽、重定向和故障转移机制在多个 Redis 版本中长期存在，但部署时仍应核对实际版本的 `redis.conf`、客户端兼容矩阵和升级说明。

## 一、16384 个槽是稳定的中间层

Redis Cluster 不直接用“节点数量”对 Key 取模，也不是经典一致性哈希。普通 Key 的槽位计算规则是：

```text
HASH_SLOT = CRC16(key) mod 16384
```

每个主节点负责若干槽。增加节点时，把一部分槽从旧节点迁到新节点；删除节点时，先把它负责的槽全部迁走。因为槽位总数固定，其他未迁移槽中的 Key 不需要移动。

可以直接验证 Key 落在哪个槽：

```text
CLUSTER KEYSLOT order:1001
CLUSTER KEYSLOT order:1002
```

槽位分布均匀不等于负载均匀。一个槽里可能只有少量冷 Key，也可能包含一个高频大 Key；某个主节点即使拥有较少槽，也可能承担更高 CPU、网络或内存压力。扩容决策应同时看槽数、Key 数、内存、请求量和热点分布。

## 二、Hash Tag 解决多 Key 同槽，也可能制造热点

Redis Cluster 要求一次多 Key 命令、事务或 Lua 脚本涉及的 Key 位于同一槽。否则服务端会返回跨槽错误。Hash Tag 允许只对 Key 中第一组有效 `{...}` 内容计算槽位：

```text
order:{1001}:detail
order:{1001}:items
order:{1001}:payment
```

这三个 Key 都按 `1001` 计算槽位，因此可以执行同槽操作：

```text
CLUSTER KEYSLOT order:{1001}:detail
CLUSTER KEYSLOT order:{1001}:items
MGET order:{1001}:detail order:{1001}:payment
```

Java 代码应把 Hash Tag 规则封装在统一 Key 工厂中，避免各业务自行拼接：

```java
public final class RedisKeys {

    private RedisKeys() {
    }

    public static String orderDetail(long orderId) {
        return "order:{" + orderId + "}:detail";
    }

    public static String orderPayment(long orderId) {
        return "order:{" + orderId + "}:payment";
    }
}
```

Hash Tag 的粒度必须选择业务聚合根，而不是整个业务域。把所有订单写成 `{orders}:...` 虽然彻底避免跨槽，却会把全部订单压到一个槽和一个主节点，直接失去水平分片价值。

跨槽数据不应依赖一次 Redis 原子命令时，可以采用三类策略：

| 场景 | 推荐策略 | 代价 |
|---|---|---|
| 同一订单内必须原子更新 | 用订单 ID 作为 Hash Tag | 单个订单成为最小分片单位 |
| 多订单批量读取 | 客户端按槽分组并行读取，再聚合 | 不具备跨槽原子性 |
| 跨业务对象强一致修改 | 回到数据库事务或重构一致性边界 | 延迟和实现复杂度增加 |

## 三、`MOVED` 是长期地图更新，`ASK` 是迁移期借道

Cluster 客户端通常维护一份“槽 → 节点”路由表，并尽量把命令直接发送到目标主节点。若路由表过期或请求发错节点，服务端返回：

```text
-MOVED 3999 10.0.0.12:6379
```

`MOVED` 表示槽 3999 现在由另一个节点负责。完整客户端应把请求重发到新节点，并刷新或修正本地槽位映射。它不是普通业务异常，也不应直接暴露给接口调用方。

在线迁槽时，源节点和目标节点之间存在短暂过渡：有些 Key 已经迁走，有些还在源节点。此时可能收到：

```text
-ASK 3999 10.0.0.12:6379
```

`ASK` 只要求下一次请求临时发送到目标节点。客户端要先向目标节点发送 `ASKING`，再发送原命令，但不能因此永久改写槽位归属。两者的区别必须保留：

| 重定向 | 含义 | 客户端动作 |
|---|---|---|
| `MOVED` | 槽位已经稳定归属新节点 | 重试并更新槽位地图 |
| `ASK` | 槽位正在迁移，仅本次借道 | `ASKING` + 重试，不永久改地图 |

如果客户端只连接单节点、不会更新拓扑或不支持 `ASK`，Cluster 在扩容和故障切换时就会把内部变化变成业务错误。生产必须使用 Cluster-aware 客户端，并设置重定向次数上限、命令超时与拓扑刷新策略。

## 四、迁槽不是搬一个编号，而是搬槽里的 Key

在线 Resharding 会把目标槽标记为迁出和导入状态，再逐批迁移其中的 Key，最后更新槽位正式归属。管理员通常使用：

```text
redis-cli --cluster reshard 10.0.0.11:6379
redis-cli --cluster check 10.0.0.11:6379
```

迁移期间请求仍可继续，但它不是零成本操作：

- 大 Key 迁移会拉长单次传输和主线程阻塞窗口；
- 热点槽在迁移时同时承受业务流量与数据搬迁；
- 客户端会增加 `ASK` 重试和拓扑刷新；
- 网络带宽、CPU 与 Replica 同步压力会同时上升；
- 故障与迁槽并发会扩大排障复杂度。

因此，上线前要先扫描大 Key、热点 Key 和槽位负载。迁槽采用小批次，限制并发，在低峰期执行，并持续观察延迟、重定向率、复制积压和集群状态。不要一次把大量热槽全迁走，再用“操作在线”推断业务无感。

一个安全的扩容顺序是：

1. 新节点以空主节点身份加入 Cluster；
2. 确认节点地址、Cluster Bus 和所有客户端网络均可达；
3. 小批量迁移冷槽并观察；
4. 逐步迁移目标槽，持续检查全槽覆盖；
5. 为新主节点配置 Replica；
6. 故障演练后再完成容量切换。

缩容则必须先把待删主节点的所有槽迁空，再删除节点。直接停止仍持有槽的主节点可能使 Cluster 进入不可用状态。

## 五、故障转移依赖多数派与 Replica

Cluster 节点通过 Cluster Bus 交换节点状态和配置。单个节点认为某主节点不可达时先形成局部怀疑；当足够多的主节点确认故障后，故障状态传播，合格 Replica 才能发起晋升。

Replica 晋升的必要条件可以压缩为：

- 失效主节点负责的槽必须有可晋升 Replica；
- Replica 不能落后或断开到超出允许范围；
- 选举需要得到多数主节点授权；
- 新主节点取得更高配置纪元后接管旧主节点槽位。

这解释了两个常见误区：

1. 三个主节点但没有 Replica，只提供分片，不提供主节点故障后的数据接管；
2. 每个主节点有一个 Replica，也无法承受同一分片的主节点和 Replica 同时丢失。

Redis Cluster 不在网络分区的少数派侧继续提供完整服务。默认 `cluster-require-full-coverage yes` 时，只要部分槽没有节点负责，Cluster 会停止接受请求；默认 `cluster-allow-reads-when-down no` 时，Cluster 标记失败后节点也不会继续提供普通读取。修改这些选项是在一致性、完整性和可用性之间重新取舍，不能只为“少报错”而关闭保护。

## 六、故障转移不会把异步复制变成强一致

主节点默认异步把写入复制给 Replica。主节点响应成功后，如果写入尚未到达 Replica 就发生故障，新主节点可能不包含这次写入。网络分区期间，旧主节点还可能在短窗口内接受少量写入，随后因失去多数派而停止服务，这些写入也存在丢失风险。

关键写入可以在同一连接上追加 `WAIT`：

```text
SET order:{1001}:paid 1
WAIT 1 1000
```

它表示等待此前写入被至少一个 Replica 确认，最多等待 1000 毫秒。调用方必须检查返回确认数是否达到要求。官方明确说明：`WAIT` 只能提高现实中的数据安全性，不能把 Redis Cluster 变成强一致系统，也不能保证故障转移一定选择已收到该写入的 Replica。

工程上应按数据价值分层：

- 缓存、可重建索引：接受短暂丢失，用数据库回源；
- 幂等状态、限流窗口：评估丢失对业务语义的影响；
- 订单、余额、支付最终状态：权威数据放在事务数据库，Redis 只承担加速或派生状态。

高可用、持久化、备份和业务一致性是四个不同问题。配置 Replica 不能替代 AOF/RDB，开启持久化不能替代异地备份，`WAIT` 也不能替代数据库事务。

## 七、Java 客户端的正确边界

Spring Boot 通常通过 `spring.data.redis.cluster.nodes` 提供多个种子节点：

```yaml
spring:
  data:
    redis:
      cluster:
        nodes:
          - redis-a.internal:6379
          - redis-b.internal:6379
          - redis-c.internal:6379
        max-redirects: 5
      connect-timeout: 2s
      timeout: 1s
      username: app-cache
      password: ${REDIS_PASSWORD}
```

种子节点不是完整固定拓扑，只是发现入口。至少提供多个跨故障域地址，避免应用启动依赖单个节点。属性名和默认值会随 Spring Boot 版本变化，部署前应以项目实际版本的配置元数据为准。

业务代码还要遵守四条边界：

1. 不自行捕获 `MOVED` 后手写节点地址，交给 Cluster 客户端刷新路由；
2. 重试必须有次数、退避和整体 Deadline，不能无限追逐重定向；
3. 非幂等操作不能因为超时就盲目重发，先确认命令语义；
4. Pipeline、事务和 Lua 脚本按槽分组，同批命令不要跨槽。

建议监控客户端侧的重定向次数、拓扑刷新失败、连接重建、命令超时和每个节点连接数。只看 Redis 节点存活，无法发现客户端仍持有旧拓扑或无法访问节点对外地址。

## 八、生产检查与故障演练

至少持续观察：

- `CLUSTER INFO` 的 `cluster_state`、已分配槽数和失败槽数；
- `CLUSTER NODES` 的角色、槽位、连接状态和配置纪元；
- 每个主节点的内存、OPS、CPU、网络和热点 Key；
- 主从复制延迟、断链、全量同步和积压缓冲区；
- `MOVED`、`ASK`、跨槽错误、命令超时与客户端拓扑刷新；
- 大 Key 数量、单槽 Key 数和迁槽速率。

发布前应演练以下场景：

| 场景 | 预期结果 | 重点验证 |
|---|---|---|
| 单个主节点停止 | Replica 晋升并接管原槽 | 切换时间、错误率、最近写入 |
| 主与 Replica 同时停止 | 对应槽不可用 | 降级与告警是否准确 |
| 节点处于少数网络分区 | 少数侧停止完整服务 | 是否仍产生孤岛写入 |
| 在线迁移热槽 | 请求通过 `ASK` 继续 | P99、重定向率、网络峰值 |
| 客户端只剩一个种子可用 | 仍能发现完整拓扑 | 启动与重连路径 |
| Hash Tag 设计错误 | 测试应暴露 `CROSSSLOT` | Key 工厂与集成测试 |

演练记录要覆盖时间线，而不是只看最终 `cluster_state:ok`：故障何时被发现、Replica 何时晋升、客户端何时刷新、失败了多少请求、是否发生重复写和数据空洞。

## 总结

Redis Cluster 的核心抽象是固定的 16384 个哈希槽。Key 先映射到槽，槽再归属于主节点；扩缩容只迁移槽内 Key，主节点故障则由 Replica 接管原槽。`MOVED` 负责稳定拓扑变更，`ASK` 负责迁槽期间的一次性借道，Cluster-aware 客户端必须正确处理两者。

真正上线时，最容易出问题的不是 CRC16 公式，而是边界设计：Hash Tag 过大会制造单槽热点，错误客户端会在迁槽时暴露重定向，异步复制会留下数据丢失窗口，主从同故障会让部分槽无人负责。把 Key 设计、客户端拓扑刷新、迁槽节奏、Replica 分布和故障演练一起治理，Cluster 才真正提供可扩展、可恢复的 Redis 服务。

## 参考资料

- [Redis 官方：Scale with Redis Cluster](https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/)
- [Redis 官方：Redis Cluster Specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)
- [Redis 官方：CLUSTER KEYSLOT](https://redis.io/docs/latest/commands/cluster-keyslot/)
- [Redis 官方：WAIT](https://redis.io/docs/latest/commands/wait/)
- [Redis 官方：Redis Replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)
- [Spring Data Redis：Drivers](https://docs.spring.io/spring-data/redis/reference/redis/drivers.html)
