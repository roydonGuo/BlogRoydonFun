---
title: MySQL 三大日志工程实践：redo log、binlog 与 undo log 的分工与协作
date: 2026-08-19
category: MySQL
cover: /images/posts/mysql-three-logs-redo-binlog-undo-engineering-knowledge-map.webp
tags: [mysql, innodb, redo-log, binlog, undo-log, wal]
excerpt: 一次 UPDATE 会同时留下三条日志：redo log 负责崩溃后重放已提交数据，binlog 负责把逻辑变更复制到从库，undo log 负责回滚与 MVCC 旧版本。本文讲清三者分工、两阶段提交、刷盘参数与常见踩坑。
---

# MySQL 三大日志工程实践：redo log、binlog 与 undo log 的分工与协作

<img src="/images/posts/mysql-three-logs-redo-binlog-undo-engineering-knowledge-map.webp" alt="MySQL 三大日志工程实践：redo log、binlog 与 undo log 的分工与协作知识串联图" style="border-radius: 10px;" />

一次 UPDATE 会同时留下三条日志：redo log 负责崩溃后重放已提交数据，binlog 负责把逻辑变更复制到从库，undo log 负责回滚与 MVCC 旧版本。本文讲清三者分工、两阶段提交、刷盘参数与常见踩坑。

## 先说结论：一次 UPDATE，三条日志各管一摊

很多人背过"redo 管崩溃恢复、binlog 管主从、undo 管回滚"，但遇到"为什么提交时要先 prepare 再 commit""undo 表空间为什么暴涨""双 1 到底防什么"这类问题就说不清了。本文把这些串起来。

一条 `UPDATE` 在执行与提交过程中，会同时产生三条日志记录，各自服务于完全不同的目标：

1. **undo log 最先写**：记录"这行数据改之前长什么样"，事务回滚和 MVCC 旧版本读取都靠它；
2. **redo log**：记录"哪个数据页被改成了什么"，实例崩溃后按它重放，保证**已提交**的数据不丢（持久性）；
3. **binlog**：Server 层逻辑日志，记录"这次执行了什么变更"，主从复制、时间点恢复和审计靠它。

先记住三条工程结论：

1. **持久性靠 redo，不靠立刻刷数据页**。WAL（Write-Ahead Logging）先写日志、后刷脏页，把随机 IO 变成顺序 IO；
2. **主从复制靠 binlog**。redo log 是存储引擎层的物理日志，只在本实例内部生效，无法跨实例共享；
3. **redo 与 binlog 通过两阶段提交保持一致**。崩溃恢复时，处于 PREPARE 状态的事务以"binlog 是否完整"为裁决依据，决定提交还是回滚。

本文以 MySQL 8.4 LTS、InnoDB 为基线，事实核对时间为 2026-08-19。redo log 容量机制、undo 表空间等涉及 8.0.30+ 的行为差异均已按官方文档标注。主要参考：[Redo Log 官方文档](https://dev.mysql.com/doc/refman/8.4/en/innodb-redo-log.html)、[Binary Log 官方文档](https://dev.mysql.com/doc/refman/8.4/en/binary-log.html)、[Undo Logs 官方文档](https://dev.mysql.com/doc/refman/8.4/en/innodb-undo-logs.html)、[InnoDB 刷盘参数](https://dev.mysql.com/doc/refman/8.4/en/innodb-flush-log-at-trx-commit.html)。

## 一、三大日志全景：一张表分清职责

把三条日志放进同一张表，差异一目了然：

| 日志 | 所在层 | 记录内容 | 类型 | 核心用途 | 写入与清理方式 |
|---|---|---|---|---|---|
| redo log | InnoDB 存储引擎层 | 数据页的物理变更（页号、偏移、新值） | 物理日志 | 崩溃恢复、持久性 | 循环写，容量由 `innodb_redo_log_capacity` 控制，8.0.30+ 默认 100MB |
| binlog | Server 层 | 执行的逻辑变更（语句或行前后像） | 逻辑日志 | 主从复制、时间点恢复、审计 | 追加写，按 `max_binlog_size` 滚动新文件，按 `binlog_expire_logs_seconds` 过期清理 |
| undo log | InnoDB 存储引擎层 | 事务修改前的旧版本数据（反操作） | 逻辑反操作 | 事务回滚、MVCC 版本链 | 存放在独立 undo 表空间（默认 `undo_001`/`undo_002`），由 purge 线程按需清理 |

要点：**redo 是"物理"的，binlog 是"逻辑"的，undo 是"反操作"的**。这三句话能解释绝大多数面试追问。

另外还有几类日志，别和它们混为一谈：

- **error log**：错误日志，排查启动失败和崩溃原因；
- **slow query log**：慢查询日志，DBA 调优入口；
- **relay log**：从库专属，是 binlog 在从库的中转站；
- **general log**：记录所有请求的全量日志，性能开销大，一般不开启。

## 二、redo log：崩溃后把已提交的数据"重做"回来

### 为什么必须有它

InnoDB 用 Buffer Pool 缓存数据页，读写都在内存里进行，性能好，但**内存不可靠**——断电或进程崩溃，脏页（已修改未刷盘的数据页）会丢。如果每次提交都同步把数据页刷到磁盘，写入性能会被随机 IO 拖垮。

WAL 的思路是：**先写日志，再刷数据**。更新发生时，先把"这次对哪个页做了什么修改"以顺序追加的方式写进 redo log，数据页留在内存里，后台再择机刷盘。这样即使崩溃，也能靠 redo log 把修改重放回来。

### 一条 UPDATE 时 redo 怎么流转

1. 在 Buffer Pool 中修改目标数据页，标记为脏页；
2. 生成对应的 redo 记录，写入内存中的 **redo log buffer**；
3. 事务提交时，按 `innodb_flush_log_at_trx_commit` 决定 redo 何时刷盘；
4. 后台线程在合适时机把脏页刷到磁盘，并推进 checkpoint。

### 刷盘参数：0 / 1 / 2

| 取值 | 行为 | 安全性 | 适用场景 |
|---|---|---|---|
| 0 | 每秒由后台线程刷一次盘 | 实例崩溃最多丢约 1 秒已提交事务 | 对数据丢失容忍度高、追求极致写性能 |
| 1 | 每次事务提交都 fsync 到磁盘 | 最安全，已提交事务不丢 | **默认值**，生产首选 |
| 2 | 提交时只写入操作系统缓存，每秒刷盘 | mysqld 崩溃不丢，但 OS 宕机/断电可能丢约 1 秒 | 可接受操作系统级故障丢失 |

### 容量与循环写（8.0.30 之后变化较大）

redo log 是**循环写**的：写满后从最早的位置覆盖，前提是 checkpoint 已经推进，说明对应的脏页已安全刷盘。

- **8.0.30 之前**：默认两个文件 `ib_logfile0`、`ib_logfile1`，由 `innodb_log_file_size` 和 `innodb_log_files_in_group` 控制；
- **8.0.30 起**：改用 `innodb_redo_log_capacity` 统一控制总容量，默认 **100MB**（最大 128GB），文件放在数据目录下的 `#innodb_redo/` 中（约 32 个 `#ib_redo*` 文件），并支持**运行时动态调整**。

```sql
-- 查看当前 redo 容量配置
SHOW VARIABLES LIKE 'innodb_redo_log_capacity';

-- 运行时调大（如批量导入大事务前临时扩容）
SET GLOBAL innodb_redo_log_capacity = 4 * 1024 * 1024 * 1024;
```

注意：如果 redo log 写满但 checkpoint 迟迟追不上（通常因为脏页刷盘太慢），InnoDB 会**强制刷脏页**，表现为写入骤停、性能断崖。批量大事务场景下容量给得太小，这是最常见的翻车点。

### 崩溃恢复：从 checkpoint 向后重放

实例启动时，InnoDB 从最近一次 checkpoint 记录的 LSN 位置开始，向后重放 redo log，把崩溃前已提交的事务恢复出来。处于 PREPARE 状态（提交到一半）的事务，则要看 binlog 是否完整——这就是下一节要讲的两阶段提交。

监控方式：`SHOW ENGINE INNODB STATUS` 的 LOG 段，或查 `information_schema.innodb_metrics` 中 `log_lsn_*` 系列指标，观察 redo 写入与 checkpoint 之间的差距。

## 三、binlog：把"逻辑变更"复制到从库、恢复现场

### 定位

binlog 是 **Server 层**的逻辑日志，和存储引擎无关——用任何引擎（包括 MyISAM）都会记录。它记录的是"这次执行了什么变更"，而不是"哪个页被改了"。

### 三种格式

| 格式 | 记录内容 | 优点 | 缺点 |
|---|---|---|---|
| STATEMENT | 原始 SQL 语句 | 体积小 | 非确定函数（`NOW()`、`UUID()`）、自增等场景可能导致主从不一致 |
| ROW | 每一行变更的前后像 | 最安全，复制结果精确一致 | 体积大 |
| MIXED | 自动切换 | 默认 STATEMENT，检测到不安全语句自动转 ROW | 行为有隐式切换，排障时略绕 |

MySQL 8.0 起默认就是 **ROW**。8.4 中基于 writeset 的冲突检测也仅支持 ROW 格式，所以生产环境就选 ROW，不必犹豫。

### 写入与刷盘

事务内的 binlog 先写进内存的 **binlog cache**（`binlog_cache_size`），提交时刷到 binlog 文件。刷盘频率由 `sync_binlog` 控制：

- `0`：交给操作系统决定何时落盘，性能最好但可能丢 binlog；
- `1`：**每次提交都 fsync**（默认值），最安全；
- `N`：每 N 次提交刷一次盘。

生产环境的"**双 1**"配置，就是 `innodb_flush_log_at_trx_commit=1` + `sync_binlog=1`：redo 和 binlog 每次提交都落盘，正常情况下已提交事务不丢。

### 三大用途

1. **主从复制**：主库的 dump 线程把 binlog 推给从库，从库 IO 线程写入 relay log，SQL 线程再重放；
2. **时间点恢复**：全量备份 + 回放 binlog 到指定 GTID 或位置，把误删前的数据找回来；
3. **审计与订正**：从 binlog 反查某段时间内谁改了哪些数据。

### 文件管理

- `max_binlog_size` 默认 1GB，写满自动滚动新文件；
- `binlog_expire_logs_seconds` 控制过期清理（默认 30 天；8.4 已移除旧的 `expire_logs_days`）；
- 8.4 起复制相关语法全面改为 `SOURCE`/`REPLICA` 命名（如 `CHANGE REPLICATION SOURCE TO`），GTID 复制是主流做法。

## 四、undo log：回滚的底气，也是 MVCC 的时光机

### 两种记录

- **insert undo**：INSERT 产生，只用于回滚（撤销插入），purge 线程可以快速回收；
- **update undo**：UPDATE/DELETE 产生，除了回滚，还要承担 MVCC 旧版本读取，生命周期更长，也是 undo 膨胀的主要来源。

### 两个核心作用

1. **事务回滚**：`ROLLBACK` 时按 undo log 反向执行，把数据恢复成修改前的样子，保证原子性；
2. **MVCC 版本链**：聚簇索引记录上有隐藏列 `roll_pointer`，指向 undo log 中的旧版本记录，形成版本链。Read View 顺着版本链找到对当前事务可见的版本，实现无锁的一致性读。

### 存储与清理

- MySQL 8.0 起，undo log 从系统表空间（ibdata）中独立出来，存放在专门的 undo 表空间：默认 `undo_001`、`undo_002`（`.ibu` 文件），**至少保持 2 个**才能支持自动截断；
- 8.0.14 起可以用 SQL 在线管理：`CREATE UNDO TABLESPACE` / `ALTER UNDO TABLESPACE ... SET INACTIVE` / `DROP UNDO TABLESPACE`（最多 127 个）；
- 清理由 **purge 线程**完成：`innodb_undo_log_truncate` 默认 ON，undo 表空间超过 `innodb_max_undo_log_size`（默认 1GB）时会自动截断回收。

### 风险与监控

undo 表空间膨胀、查询变慢，十有八九是**长事务或长查询**：只要还有事务引用旧版本，对应 undo 就不能被 purge。

- 看 `SHOW ENGINE INNODB STATUS` 里的 **History List Length（HLL）**，持续走高说明 purge 追不上；
- 用 `information_schema.innodb_trx` 找运行最久的事务，评估后处理；
- **严禁手动删除 `undo_*.ibu` 文件**，那不是释放空间，是制造灾难。

## 五、协作：一条 UPDATE 的完整旅程与两阶段提交

把三条日志串起来看一条 `UPDATE`：

```text
1. BEGIN，事务分配事务 id
2. 加锁：MDL（表结构）+ 行锁
3. 写 undo log：记录旧值，roll_pointer 指向旧版本   ← 旧账
4. 更新 Buffer Pool 中的数据页，标记为脏页
5. 写 redo log buffer                                 ← 重做账（先写内存）
6. 提交：两阶段提交
   ├─ 阶段一：redo prepare（按 innodb_flush_log_at_trx_commit 刷盘）
   ├─ 阶段二：binlog write + fsync（按 sync_binlog）   ← 复制账
   └─ 阶段三：redo commit（打上 commit 标记）
7. 后台：脏页异步刷盘，checkpoint 推进，redo 可被覆盖
```

### 为什么需要两阶段提交

redo log 和 binlog 分属两层（引擎层 / Server 层），各自独立落盘。如果不做协调，崩溃时可能只写了其中一个：

- 只有 redo 没有 binlog → 主库恢复了，但从库没收到这条变更，主从不一致；
- 只有 binlog 没有 redo → 从库多执行了，主库却没有，同样不一致。

所以两阶段提交以 **binlog 是否完整** 作为 PREPARE 状态事务的裁决依据：binlog 完整 → 提交；不完整 → 用 undo 回滚。这保证了"主库看到的提交集合"与"从库复制的提交集合"严格一致。

### 组提交（group commit）

高并发下如果每个事务提交都做一次 fsync，代价很高。InnoDB 会把多个事务的 prepare/binlog/commit 阶段**批量合并**刷盘（`binlog_group_commit_sync_delay`、`binlog_group_commit_sync_no_delay_count` 可调），这就是组提交。它解释了"为什么双 1 不一定拖垮性能"。

## 六、真实场景：订单状态更新、主从复制与误删恢复

### 场景一：订单支付回调

```sql
-- 订单支付成功回调
UPDATE orders SET status = 'PAID', paid_at = NOW()
WHERE order_no = '202608191001';
```

这条语句执行后：

| 日志 | 它记录了什么 |
|---|---|
| undo log | 该行原来的 `status='UNPAID'` 旧值（回滚 + MVCC 旧版本） |
| redo log | `orders` 表对应数据页的物理变更（页号 + 新值），供崩溃重放 |
| binlog（ROW） | `orders` 表这一行的变更前后像，供从库复制、审计、闪回 |

### 场景二：主从复制链路

```text
主库 binlog ──dump 线程推送──▶ 从库 IO 线程 ──写入──▶ relay log ──SQL 线程重放──▶ 从库数据
```

排查从库延迟时，看 `SHOW REPLICA STATUS` 的 `Seconds_Behind_Source`（8.4 命名）。从库延迟通常是：大事务在主库很快、在从库重放慢，或从库查询压力大。ROWS 格式下大事务会产生海量 binlog，这是延迟最常见的来源。

### 场景三：误删恢复

误删一张表后，标准流程是：

1. 找最近一次**全量备份**（逻辑备份 mysqldump 或物理备份）；
2. 用 `mysqlbinlog` 把误删时间点之前的 binlog 导出来回放，恢复到误删前一刻；
3. 验证数据后再切流量。

所以"备份"从来不只是全量备份，**binlog 就是你的增量备份**。`binlog_expire_logs_seconds` 要覆盖你"从发现到恢复"的最长窗口。

## 七、常见追问

**redo log 和 binlog 有什么区别？**
物理 vs 逻辑；InnoDB 层 vs Server 层；循环写 vs 追加写；作用上 redo 管崩溃恢复（本实例），binlog 管复制/恢复/审计（跨实例）。redo 记录"页变了"，binlog 记录"变更发生了"。

**为什么有了 redo 还需要 binlog？**
redo 是引擎内部物理日志，无法跨实例共享；复制、时间点恢复、审计都需要 Server 层的逻辑日志。两者不是替代关系，是分工关系。

**`innodb_flush_log_at_trx_commit=2` 安全吗？**
对 mysqld 崩溃安全（数据已进 OS 缓存），但对 OS 宕机、断电不安全，可能丢约 1 秒已提交事务。选 0/1/2 本质是"性能 vs 丢多少数据"的权衡。

**双 1 就一定不丢数据吗？**
正常磁盘故障下，已提交事务不丢；但磁盘物理损坏、文件系统异常等仍可能丢，所以备份和主从依然必不可少。

**binlog 三种格式怎么选？**
生产用 ROW（8.0 默认、8.4 推荐）；老版本兼容或体积敏感可评估 MIXED；STATEMENT 不要用于生产复制。

**undo 表空间暴涨怎么办？**
先查长事务：`SELECT * FROM information_schema.innodb_trx ORDER BY trx_started LIMIT 10;`，评估后 kill 或等其结束，purge 会自动回收；确认 `innodb_undo_log_truncate=ON`。不要手动删文件。

**redo log 写满会怎样？**
checkpoint 追不上时 InnoDB 会强制刷脏页，写入卡顿。大事务批量写入前评估容量，或临时调大 `innodb_redo_log_capacity`。

**从库读的也是 binlog 吗？**
从库读的是 relay log——binlog 在从库的中转文件，SQL 线程从 relay log 重放。复制延迟排查主要看 relay log 与 SQL 线程状态。

## 八、踩坑与最佳实践

1. **双 1 是底线**：`innodb_flush_log_at_trx_commit=1` + `sync_binlog=1`，配 SSD；实在要性能再说服自己降级并明确丢失窗口；
2. **binlog 用 ROW**，过期时间按备份窗口设置（如 7~30 天），别让 binlog 占满磁盘或过早过期；
3. **绝不手动删除日志文件**：redo、undo、binlog 都是数据库自身管理，删文件等于自杀；
4. **大事务拆批**：一批 10 万行的 UPDATE 会让 redo 写满、从库延迟、undo 暴涨，改成小批循环提交；
5. **长事务治理**：监控 `innodb_trx` 与 History List Length，定时任务里开事务记得及时提交；
6. **备份 = 全量 + binlog 增量**，并且要定期演练恢复，别等出事了第一次跑恢复流程；
7. **留意 8.4 默认值变化**：`innodb_log_buffer_size` 默认从 16MiB 提到 64MiB、Linux 下 `innodb_flush_method` 默认 `O_DIRECT`、`innodb_io_capacity` 默认 10000，升级后行为可能与旧版本不同，先在测试环境压测。

## 九、总结

一条 UPDATE 的本质是"三方对账"：先写**旧账**（undo log），再记**重做账**（redo log），提交时发**复制账**（binlog），并通过两阶段提交保证重做账与复制账一致。

- 崩溃了，靠 redo 重放已提交数据；
- 要复制，靠 binlog 把变更推给从库；
- 要反悔，靠 undo 回滚、靠版本链读旧值。

把这三个"账本"的写入时机和清理机制想清楚，MySQL 的持久性、复制和高可用问题就都有了解题的锚点。
