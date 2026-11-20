---
title: MySQL 主从复制工程实践：binlog 链路、GTID 与延迟治理
date: 2026-10-08
category: 后端开发
cover: /covers/backend.svg
tags: [mysql, 主从复制, gtid, 半同步, 延迟]
excerpt: 主从复制是把 binlog 从主库搬到从库并重放的过程，默认异步，因此“从库读到旧数据”是设计内行为而非故障。要把延迟压下去，得同时管住大事务、单线程回放、从库负载与 binlog 保留期，并用 GTID 让切换不再依赖文件位点。
---

# MySQL 主从复制工程实践：binlog 链路、GTID 与延迟治理

<img src="/images/posts/mysql-replication-lag-engineering-knowledge-map.png" alt="MySQL 主从复制工程实践：binlog 链路、GTID 与延迟治理知识串联图" style="border-radius: 10px;" />

主从复制是把 binlog 从主库搬到从库并重放的过程，默认异步，因此“从库读到旧数据”是设计内行为而非故障。要把延迟压下去，得同时管住大事务、单线程回放、从库负载与 binlog 保留期，并用 GTID 让切换不再依赖文件位点。

## 先说结论：链路上的三段，各有一段延迟

```text
主库提交 → 写 binlog → dump 线程发送 → 从库 IO 线程写 relay log
        → 从库 SQL(applier) 线程重放 → 从库可见
```

- **发送段**：网络与 binlog 落盘。主库 `sync_binlog=1` 保证提交即落盘，但增加提交延迟；
- **接收段**：从库 IO 线程拉取并写 relay log，通常不是瓶颈；
- **回放段**：SQL 线程（或并行 worker）执行事件，是延迟的主要来源。

关键认知：**从库读到的数据可能落后主库**，异步复制下主库崩溃还可能丢掉尚未送达的事务。需要"提交即可见"的强一致读，只能走主库或引入半同步/组复制。本文以 **MySQL 9.7** 为基线，核对日期 **2026-11-20**。

## 一、完整分类：复制模式的四种形态

### 1. 异步复制（默认）

主库提交后立即返回，不等从库。吞吐最高，故障切换可能丢数据（丢多少取决于网络与 binlog 是否已发送）。

### 2. 半同步复制（semi-sync）

主库等待至少一个从库**确认收到**（不是应用完成）后才向客户端返回提交成功。用 `rpl_semi_sync_source_timeout` 控制等待上限，超时后退化为异步。收益是"最多丢一个事务"，代价是每次提交多一个网络往返。

### 3. 组复制（Group Replication / MGR）

基于 Paxos 变体的多主或单主集群，事务在组内达成一致后提交，具备自动冲突检测与成员管理。运维复杂度高于主从，适合对一致性要求高的核心库。

### 4. 位点管理：文件位点 vs GTID

| 方式 | 记录内容 | 故障切换 |
|---|---|---|
| 文件 + 位点 | `binlog.000042:1934` | 每台机器位点不同，易错 |
| GTID | `server_uuid:序号` 集合 | 指向新主即可自动补齐，推荐 |

GTID 模式下 `Retrieved_Gtid_Set`（已拉取）与 `Executed_Gtid_Set`（已执行）的差集就是"已收到未应用"，比秒数更精确地反映回放进度。

## 二、延迟从哪来：五类成因

1. **大事务**：一次更新百万行，从库必须整事务重放，期间 `Seconds_Behind_Source` 持续上升；
2. **单线程回放**：默认按 binlog 顺序串行应用，主库多核并发写入，从库单核追赶；
3. **从库负载**：从库同时承担大量读查询，CPU 与 IO 被抢占，SQL 线程排队；
4. **无索引更新**：行格式下从库按主键定位行，若表缺主键则退化为全表扫描，单条事件就变慢；
5. **binlog 保留期过短**：从库离线超过 `binlog_expire_logs_seconds`，主库已清理，重连报 1236 错误，只能重做从库。

## 三、监控：先看对指标

```sql
-- 在从库执行，关键字段一眼定位问题段
SHOW REPLICA STATUS\G
-- Replica_IO_Running / Replica_SQL_Running 必须都是 Yes
-- Seconds_Behind_Source：SQL 线程正在应用的事件时间戳与当前时间差
-- Retrieved_Gtid_Set 与 Executed_Gtid_Set 的差集 = 已收到未应用
-- Last_IO_Error / Last_SQL_Error：停摆原因
```

`Seconds_Behind_Source` 有三个已知盲区：网络断开但 `replica_net_timeout` 未到时会显示 0；主从时钟不同步会影响准确性；从库读到最新位点后可能瞬间归零再跳高。生产应叠加**心跳表**（如 pt-heartbeat）测端到端延迟，并对"延迟 > 阈值且持续 N 分钟"告警，而不是对瞬时尖刺告警。

## 四、真实示例：从库只读 + 并行回放配置

```ini
# 从库 my.cnf 关键项（MySQL 8.0.26+ 起 master/slave 术语逐步改为 source/replica）
[mysqld]
server_id                = 2
read_only                = ON      # 阻止普通账号写入
super_read_only          = ON      # 连 SUPER 账号也禁止写入，防误操作
relay_log_recovery       = ON      # 崩溃后自动恢复 relay log，避免手工修
replica_parallel_workers = 4       # 并行回放线程数，按 CPU 核数设置
replica_parallel_type    = LOGICAL_CLOCK
replica_preserve_commit_order = ON # 保证并行回放后提交顺序与主库一致
```

```java
/**
 * 读写分离路由：强制走主库的注解，用于"写后立即读"的一致性场景。
 * 说明：路由逻辑需在事务开启之前生效，否则连接已绑定数据源无法切换。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface ForceMaster {
    /** 强制走主库的原因，便于排查时理解业务意图 */
    String reason() default "";
}
```

```java
/**
 * 订单创建后立即查询：必须走主库，否则可能读到从库旧快照。
 */
@Service
public class OrderQueryService {

    private final OrderMapper orderMapper;

    public OrderQueryService(OrderMapper orderMapper) {
        this.orderMapper = orderMapper;
    }

    @ForceMaster(reason = "下单后立即回查，需读己之写")
    public OrderDetail queryAfterCreate(long orderId) {
        // 该调用由数据源路由切面拦截并指向主库
        return orderMapper.selectDetail(orderId);
    }
}
```

写后读一致性还有两条备选路径：把刚写入的关键字段直接从写请求返回值透出，避免回查；或对同一会话在短时间内固定走主库。

## 五、常见追问

**问：为什么 `Seconds_Behind_Source` 是 0 仍可能读到旧数据？**
该指标只描述 SQL 线程与应用事件的时间差，不保证 IO 线程已拉全；网络刚断时也可能短时为 0。判断真实延迟用心跳表或 GTID 差集。

**问：半同步会不会拖慢所有写入？**
会引入一次额外往返，且从库响应慢时按超时退化。它的价值在于把"丢失窗口"从"若干事务"缩到"至多一个"。

**问：从库延迟高，加索引有用吗？**
对"从库执行慢"有用（尤其是缺主键导致的扫描），对"主库大事务"无用——那需要拆事务。

**问：切换主库后旧主怎么回归？**
GTID 下旧主可能带有未复制到新主的事务（errant transaction），必须核对并清理后才能作为从库加入，否则产生数据分叉。

**问：能用从库做备份和报表吗？**
可以，但要限流并错峰；从库同时承担读流量与报表扫描，是延迟的常见根因。

## 六、踩坑记录

- **从库被应用写入**：未开 `super_read_only`，双写导致主从不一致，最终靠重新克隆修复。
- **大事务批量更新**：单条 `UPDATE` 影响百万行，从库追了半小时；改为分批提交后延迟归零。
- **无主键表**：行格式复制下从库逐行全表扫描，单事件耗时几百毫秒。
- **binlog 保留 1 天**：周末从库维护超过保留期，周一无法增量同步，只能全量重做。
- **只看平均延迟**：平均值被掩盖的尖刺才是用户可感知的部分，应看 P99 与持续时间。
- **切换后未校验 GTID**：旧主回归带入 errant 事务，写入被静默丢弃。

## 七、选择建议

| 场景 | 建议 |
|---|---|
| 读多写少、可容忍秒级不一致 | 异步主从 |
| 核心交易，不能丢事务 | 半同步（至少一从确认） |
| 强一致多副本 | MGR / 云上托管高可用版 |
| 报表/分析 | 专用只读从库 + 限流 |

## 八、最佳实践清单

1. 全站启用 GTID，禁止依赖文件位点做切换；
2. 从库 `read_only` + `super_read_only` 双开，从权限层阻断误写；
3. 大事务拆批（每批千行级），避免长时间回放；
4. 所有表必须有主键，行格式复制才能高效定位；
5. 开并行回放并保持 `replica_preserve_commit_order=ON`；
6. 用心跳表监控端到端延迟，按持续时间而非瞬时值告警；
7. binlog 保留期覆盖最坏维护窗口，并对 1236 错误做预案。

## 总结

主从复制的本质是"binlog 的单向搬运与重放"，异步是默认语义，延迟是常态而非异常。治理的关键不在调大某个参数，而在控制事务粒度、保证表结构可定位行、让从库有足够的回放能力，并用 GTID 与心跳表把"到底落后多少"量化出来。把这四件事做实，主从才既能扩展读，也能支撑切换。
