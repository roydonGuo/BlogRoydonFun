---
title: MySQL 8.4 行锁工程实践：Record、Gap 与 Next-Key Lock
date: 2026-08-17
category: MySQL
cover: /images/posts/mysql-innodb-row-locks-engineering-cover-compressed.webp
tags: [mysql, innodb, row-lock, gap-lock, next-key-lock]
excerpt: 从索引记录出发，讲清 InnoDB 的 Record Lock、Gap Lock、Next-Key Lock 与插入意向锁，并用库存预占场景串起隔离级别、加锁范围、阻塞诊断和死锁治理。
top: true
---

# MySQL 8.4 行锁工程实践：Record、Gap 与 Next-Key Lock

<img src="/images/posts/mysql-innodb-row-locks-engineering-cover-compressed.webp" alt="MySQL 8.4 InnoDB 行锁封面：Record Lock 锁定记录 10，Gap Lock 保护 10 与 20 之间的间隙，二者组合表达 (10, 20] 的 Next-Key Lock，插入请求在间隙中等待" style="border-radius: 10px;" />

从索引记录出发，讲清 InnoDB 的 Record Lock、Gap Lock、Next-Key Lock 与插入意向锁，并用库存预占场景串起隔离级别、加锁范围、阻塞诊断和死锁治理。

## 先说结论：InnoDB 锁住的是索引记录和索引区间

讨论“这条 SQL 锁了几行”时，只看结果集往往会得出错误结论。InnoDB 的行级锁实际作用在索引记录上；查询走哪个索引、扫描到哪些记录、使用什么隔离级别，都会改变最终锁定范围。

工程上先记住七条结论：

1. **Record Lock** 锁住一条索引记录，不是抽象意义上的整行；
2. **Gap Lock** 只阻止其他事务向索引间隙插入，不锁住间隙两端已有记录；
3. **Next-Key Lock** 是“前开后闭”的间隙加右侧记录，即 Gap Lock + Record Lock；
4. 唯一索引的完整等值命中通常可退化为 Record Lock，范围查询、非唯一索引和未命中条件则可能锁住间隙；
5. 默认 `REPEATABLE READ` 下，锁定读和写操作会利用 Next-Key Lock 抑制幻影插入；`READ COMMITTED` 通常关闭搜索与索引扫描中的 Gap Lock，但外键检查和重复键检查仍会使用；
6. 普通 `SELECT` 在 `READ COMMITTED` 与 `REPEATABLE READ` 下通常是 MVCC 一致性读，不等同于 `SELECT ... FOR UPDATE`；
7. 索引设计既决定查询成本，也决定锁的落点和并发冲突面。

本文以 MySQL 8.4、InnoDB 为基线，事实核对时间为 2026-08-17。锁类型与区间语义以 [MySQL 8.4 InnoDB Locking](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking.html) 为准，语句加锁行为参考 [Locks Set by Different SQL Statements](https://dev.mysql.com/doc/refman/8.4/en/innodb-locks-set.html)，隔离级别差异参考 [Transaction Isolation Levels](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html)。

## 一、先建立完整的锁分类

InnoDB 锁不只有 Record、Gap 和 Next-Key。把相关概念放在同一张表里，才能避免把表级意向锁、记录锁和插入意向锁混为一谈。

| 类型 | 作用对象 | 核心目的 | 常见来源 |
|---|---|---|---|
| Shared Lock（S） | 索引记录 | 允许并发读取，阻止不兼容写入 | `SELECT ... FOR SHARE` |
| Exclusive Lock（X） | 索引记录 | 保护更新、删除或排他读取 | `UPDATE`、`DELETE`、`SELECT ... FOR UPDATE` |
| Intention Shared（IS） | 表 | 表示事务准备在记录上加 S 锁 | `SELECT ... FOR SHARE` 前置获取 |
| Intention Exclusive（IX） | 表 | 表示事务准备在记录上加 X 锁 | DML、`SELECT ... FOR UPDATE` 前置获取 |
| Record Lock | 索引记录 | 锁住已有索引项 | 唯一键等值锁定读 |
| Gap Lock | 索引记录之间的间隙 | 阻止间隙内插入 | RR 下的范围扫描、未命中扫描 |
| Next-Key Lock | 前一间隙 + 右端记录 | 同时保护已有记录与区间 | RR 下的范围锁定读 |
| Insert Intention Lock | 待插入位置所在间隙 | 表达插入意图，允许不同位置并发插入 | `INSERT` 写入前 |
| AUTO-INC Lock | 表 | 协调部分自增值分配模式 | 含 `AUTO_INCREMENT` 的插入 |
| Predicate Lock | 空间索引区域 | 保护无法线性排序的空间范围 | `SPATIAL` 索引操作 |

S/X 描述的是锁模式，Record/Gap/Next-Key 描述的是锁定对象和范围。二者不是互斥分类。例如，`lock_mode X locks rec but not gap` 表示“X 模式的纯记录锁”。

IS/IX 是表级意向锁，主要让表锁请求快速判断表内是否已有记录锁。它们通常不会互相阻塞，也不是“先把整张表锁住再加行锁”。

## 二、Record Lock：锁的是索引项，不是结果集里的对象

假设有库存批次表：

```sql
CREATE TABLE inventory_batch (
    id BIGINT PRIMARY KEY,
    sku_code VARCHAR(64) NOT NULL,
    warehouse_id BIGINT NOT NULL,
    available_qty INT NOT NULL,
    expire_at DATETIME NOT NULL,
    KEY idx_sku_warehouse_expire (sku_code, warehouse_id, expire_at)
) ENGINE = InnoDB;
```

按主键锁定一条记录：

```sql
START TRANSACTION;

-- 完整命中唯一主键，通常只需要该主键索引记录的 X 锁
SELECT *
FROM inventory_batch
WHERE id = 1001
FOR UPDATE;
```

主键是唯一索引，完整等值条件能定位唯一记录，因此不需要为了防止同一主键被插入而扩大到前置间隙。官方文档把这种输出描述为 `locks rec but not gap`。

但“等值查询”不一定只锁一条：

- 使用非唯一索引时，同一个键值可能对应多条记录，还要保护键值范围；
- 只使用联合唯一索引的部分列时，条件并不唯一；
- 没有合适索引时，InnoDB 必须扫描更多索引记录，锁定范围可能显著扩大；
- 通过二级索引定位并更新时，还会涉及对应的聚簇索引记录。

因此，`EXPLAIN` 不只是性能工具。它提供了判断加锁路径的第一份证据，但最终锁状态仍应以运行时观测为准。

## 三、Gap Lock：锁住“还不存在的数据位置”

假设某索引当前有值 `10、20、30`。间隙可以表示为：

```text
(-∞, 10)  (10, 20)  (20, 30)  (30, +∞)
```

Gap Lock 不锁住 `10、20、30` 这些记录本身，它只阻止其他事务向被保护的间隙插入新索引记录。它是一种“纯抑制”锁：目标是阻止插入，而不是阻止另一个事务持有同一间隙的 Gap Lock。

这解释了一个反直觉现象：所谓 Gap S 锁和 Gap X 锁可以共存，因为它们都只表达“这个间隙不能插入”，彼此并不需要争夺对已有记录的读写权。

未命中查询也可能加锁。假设 `id=1002` 不存在：

```sql
-- RR 隔离级别下，未命中的锁定读可能保护 1002 所在的索引间隙
SELECT *
FROM inventory_batch
WHERE id = 1002
FOR UPDATE;
```

此时结果集是空的，却不能据此推断“什么都没锁”。事务可能正通过间隙锁阻止另一个事务插入 `id=1002`，以维持当前锁定判断。

## 四、Next-Key Lock：用前开后闭区间抑制幻影插入

Next-Key Lock 由“某条索引记录的 Record Lock + 它前面的 Gap Lock”组成。若索引值为 `10、11、13、20`，可能出现的区间是：

```text
(-∞, 10]  (10, 11]  (11, 13]  (13, 20]  (20, +∞)
```

最后一个区间会涉及 `supremum` 伪记录。它不是业务表里的真实行，而是代表大于当前最大索引值的边界。因此看到锁监控中的 `supremum`，通常意味着最大值之后的尾部间隙也被保护。

在默认 `REPEATABLE READ` 下执行：

```sql
START TRANSACTION;

-- 按复合索引扫描可售批次，并锁住扫描到的记录与相关间隙
SELECT id, available_qty
FROM inventory_batch
WHERE sku_code = 'SKU-RED-42'
  AND warehouse_id = 7
  AND expire_at >= CURRENT_DATE
ORDER BY expire_at
LIMIT 1
FOR UPDATE;
```

InnoDB 按实际执行计划遍历索引。Next-Key Lock 防止其他事务在被保护区间插入一条新的、更早到期的批次，使当前事务的“最早可用批次”判断突然出现幻影。

需要特别注意：SQL 文本里的业务区间不等于最终锁区间。实际边界由索引排序、已有记录、扫描方向、谓词是否能在存储引擎层确定、优化器选择以及隔离级别共同决定。

## 五、插入意向锁：同一间隙内的插入不必全部串行

Insert Intention Lock 是 `INSERT` 在真正写入索引记录前取得的一种 Gap Lock。它不会让同一大间隙中的所有插入自动排队。

例如，索引中已有 `4` 和 `7`，两个事务分别插入 `5` 和 `6`。它们会在 `(4, 7)` 内表达插入意向，但因为目标位置不同，可以并发推进。如果另一个事务已经通过 Gap/Next-Key Lock 禁止该间隙插入，两者才会等待。

这也是排障时常见的状态：

```text
lock_mode X locks gap before rec insert intention waiting
```

它表达的是“事务正在等待进入某个受保护间隙”，而不是已经锁住整张表。应继续追查谁持有阻塞它的记录或间隙锁。

## 六、隔离级别如何改变加锁范围

### REPEATABLE READ

MySQL 8.4 的 InnoDB 默认隔离级别是 `REPEATABLE READ`。普通 `SELECT` 通常走 MVCC 一致性读；锁定读、`UPDATE` 和 `DELETE` 则会对扫描到的索引记录加锁，并在需要时使用 Next-Key Lock 防止幻影插入。

### READ COMMITTED

`READ COMMITTED` 下，每次一致性读建立新的快照。对搜索和索引扫描通常关闭 Gap Lock，未匹配 `WHERE` 条件的记录锁也会在条件判断后释放，从而降低冲突面。但 Gap Lock 并非彻底消失：外键约束检查和重复键检查仍需要它。

### SERIALIZABLE

`SERIALIZABLE` 会把更普通的读取也纳入强隔离语义，并显著增加等待概率。不要把它当作“不理解锁范围时先开到最高”的默认修复手段。

### READ UNCOMMITTED

`READ UNCOMMITTED` 允许脏读，保护最弱，通常不适合作为交易和库存业务的常规选择。

隔离级别是应用一致性契约，不只是数据库调优开关。切到 `READ COMMITTED` 可能减少 Gap Lock，但应用必须接受同一事务中两次一致性读看到不同已提交结果，并重新评估防重、校验和写入竞态。

## 七、真实项目：库存预占如何缩小锁范围

一个稳妥的预占流程通常是“短事务 + 确定索引 + 原子条件更新”，而不是先读取大量候选行再慢慢计算。

```java
@Service
public class InventoryReservationService {

    private final JdbcTemplate jdbcTemplate;

    public InventoryReservationService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional
    public long reserve(String skuCode, long warehouseId, int quantity) {
        // 按复合索引顺序锁定一个候选批次，避免无索引扫描扩大锁范围
        Long batchId = jdbcTemplate.queryForObject("""
                SELECT id
                FROM inventory_batch
                WHERE sku_code = ?
                  AND warehouse_id = ?
                  AND expire_at >= CURRENT_DATE
                  AND available_qty >= ?
                ORDER BY expire_at, id
                LIMIT 1
                FOR UPDATE
                """, Long.class, skuCode, warehouseId, quantity);

        if (batchId == null) {
            throw new IllegalStateException("可用库存不足");
        }

        // 再用数量条件做一次原子保护，防止未来改造绕过前置锁定读
        int affected = jdbcTemplate.update("""
                UPDATE inventory_batch
                SET available_qty = available_qty - ?
                WHERE id = ?
                  AND available_qty >= ?
                """, quantity, batchId, quantity);

        if (affected != 1) {
            throw new IllegalStateException("库存并发变化，请重试");
        }

        return batchId;
    }
}
```

这段示例的重点不是复制 SQL，而是四条边界：

1. `sku_code, warehouse_id, expire_at` 与查询前缀对齐，减少扫描记录；
2. `ORDER BY expire_at, id` 给候选顺序补上稳定的主键决胜条件；
3. 事务中只做数据库内的必要读写，不夹带模型调用、HTTP 请求或消息发送；
4. 更新语句保留 `available_qty >= ?`，让正确性不只依赖调用顺序。

如果业务允许跳过已被其他事务占用的候选，可评估 `SKIP LOCKED`；如果拿不到锁就应立即失败，可评估 `NOWAIT`。两者会改变业务语义：`SKIP LOCKED` 返回的是不一致视图，适合队列式抢占，不适合要求完整结果的通用查询；具体契约应参考 [MySQL 8.4 Locking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)。

## 八、如何复现并诊断一次间隙阻塞

准备数据：

```sql
CREATE TABLE lock_demo (
    id BIGINT PRIMARY KEY,
    amount INT NOT NULL
) ENGINE = InnoDB;

INSERT INTO lock_demo (id, amount) VALUES (10, 100), (20, 200);
```

会话 A：

```sql
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION;

-- 锁定 (10, 20] 对应范围，事务保持未提交用于观察
SELECT *
FROM lock_demo
WHERE id > 10 AND id <= 20
FOR UPDATE;
```

会话 B：

```sql
START TRANSACTION;

-- 15 位于被保护间隙中，此插入将等待会话 A
INSERT INTO lock_demo (id, amount) VALUES (15, 150);
```

诊断连接中先查看摘要：

```sql
SELECT
    wait_age_secs,
    locked_table,
    locked_index,
    locked_type,
    waiting_query,
    blocking_query,
    waiting_pid,
    blocking_pid
FROM sys.innodb_lock_waits
ORDER BY wait_age_secs DESC;
```

再查看原始锁对象：

```sql
SELECT
    ENGINE_TRANSACTION_ID,
    OBJECT_SCHEMA,
    OBJECT_NAME,
    INDEX_NAME,
    LOCK_TYPE,
    LOCK_MODE,
    LOCK_STATUS,
    LOCK_DATA
FROM performance_schema.data_locks
WHERE OBJECT_SCHEMA = DATABASE()
  AND OBJECT_NAME = 'lock_demo';
```

`performance_schema.data_lock_waits` 可进一步关联请求锁与阻塞锁。官方提醒这些表展示的是快速变化的瞬时状态，不同表之间不保证形成完全一致的快照，因此排障系统应连续采样并结合事务开始时间、当前 SQL、Trace ID 和应用日志，而不是只保存一张截图。详见 [InnoDB Transaction and Locking Information](https://dev.mysql.com/doc/refman/8.4/en/innodb-information-schema-transactions.html)。

## 九、常见追问与踩坑

### 普通 SELECT 会加行锁吗

在 `READ COMMITTED` 和 `REPEATABLE READ` 下，普通 `SELECT` 通常是一致性非锁定读，通过 MVCC 读取可见版本。`FOR SHARE`、`FOR UPDATE`、写操作以及部分特殊语句才进入不同的锁定路径。不要把“查询访问了某行”直接等同于“持有该行锁”。

### 没查到记录就一定没锁吗

不一定。RR 下的锁定读可能锁住目标值所在间隙，防止另一个事务插入后破坏当前判断。空结果集和空锁集合是两回事。

### 有索引就一定只锁命中的行吗

不一定。非唯一索引、范围条件、联合索引前缀、扫描到但最终不匹配的记录，以及二级索引到聚簇索引的访问，都可能扩大锁集合。要同时看执行计划和运行时锁信息。

### Gap Lock 会阻止更新已有记录吗

纯 Gap Lock 只抑制向间隙插入。已有记录能否更新，要看记录本身是否还有 S/X Record Lock 或 Next-Key Lock。排障时应读完整 `LOCK_MODE`，不要只看到 `GAP` 就下结论。

### 锁等待和死锁是一回事吗

不是。锁等待可能在阻塞事务提交后正常继续；死锁是等待关系形成环，InnoDB 会检测并回滚其中一个事务。应用应把死锁当作可预期的并发结果：保持事务可重试、限制重试次数并加入抖动，同时记录数据库错误码和业务幂等键。

### 发生阻塞就直接 KILL 吗

先识别阻塞者是否仍在执行、是否持有关键业务事务、回滚成本多大，再按运维权限和处置流程决定。贸然终止大事务可能带来长时间回滚。应用侧更应建立超时、告警和降级，而不是依赖人工长期盯库。

## 十、选择建议与最佳实践

1. 把索引视为并发控制设计的一部分，不只为查询提速；
2. 锁定读尽量使用完整唯一键，范围抢占必须明确索引顺序和业务边界；
3. 为联合索引补齐高选择性前缀和稳定排序列，避免扫描无关记录；
4. 事务内禁止远程调用、人工等待、文件 I/O 和大批量业务计算；
5. 多表、多行更新统一访问顺序，降低形成死锁环的概率；
6. 对死锁和可重试锁超时设计有限重试，但必须配合业务幂等；
7. 不要为了减少 Gap Lock 就盲目改隔离级别，先确认一致性契约；
8. 上线前用两会话脚本复现关键路径，观察 `data_locks` 与 `data_lock_waits`；
9. 监控锁等待时长、阻塞链长度、长事务、死锁次数和回滚耗时；
10. 将数据库连接中的业务 Trace ID、订单号或任务 ID 与锁诊断信息关联；
11. 分页批处理使用小批量提交，避免一个事务锁住过长索引区间；
12. 生产处置优先终止根因、缩短事务和修正索引，不把增大锁等待超时当作永久方案。

## 总结

InnoDB 行锁的关键不是背诵三个名词，而是建立“SQL 条件 → 执行计划 → 索引扫描 → 锁对象 → 等待关系”的完整链路。Record Lock 保护已有索引记录，Gap Lock 保护尚不存在的位置，Next-Key Lock 将二者组合起来抑制范围内的幻影插入，Insert Intention Lock 则让不冲突的插入保持并发。

真正可落地的治理来自确定索引、短事务、统一访问顺序、有限重试和实时锁观测。只要能从索引顺序画出锁区间，再用 `performance_schema` 验证实际状态，复杂的库存超卖、任务抢占和范围更新问题就不再只能靠猜。
