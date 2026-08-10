---
title: MySQL 8.4 MVCC 工程实践：Read View、版本链与一致性读
date: 2026-08-10
category: 后端开发
cover: /covers/backend.svg
tags: [mysql, innodb, mvcc, read-view, transaction]
excerpt: 从 Read View、隐藏事务字段与 undo 版本链出发，讲清 RC、RR 的可见性差异，并把快照读、当前读、长事务治理落到真实订单场景。
---

# MySQL 8.4 MVCC 工程实践：Read View、版本链与一致性读

<img src="/images/posts/mysql-mvcc-read-view-engineering-knowledge-map.png" alt="MySQL 8.4 MVCC 工程实践：Read View、版本链与一致性读知识串联图" style="border-radius: 10px;" />

从 Read View、隐藏事务字段与 undo 版本链出发，讲清 RC、RR 的可见性差异，并把快照读、当前读、长事务治理落到真实订单场景。

MVCC 解决的核心问题不是“完全不用锁”，而是让普通查询在多数情况下读取一个符合隔离级别的历史快照，不必等待正在修改同一行的事务。它依赖当前聚簇索引记录、隐藏事务字段、undo log 中的旧版本，以及判断版本可见性的 Read View 共同工作。

工程上最容易出错的地方有三个：把事务开始时间误当成快照创建时间、把普通 `SELECT` 与 `SELECT ... FOR UPDATE` 当成同一种读、以及只看到“查询没有锁等待”，却忽略长快照正在阻止 purge 清理旧版本。

> 本文以 **MySQL 8.4、InnoDB** 为适用范围，事实核对时间为 **2026-08-10**。主要依据 [InnoDB Multi-Versioning](https://dev.mysql.com/doc/refman/8.4/en/innodb-multi-versioning.html)、[Consistent Nonlocking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html)、[Transaction Isolation Levels](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html) 与 [Locking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)。Read View 内部字段名属于实现细节，不是业务 SQL 的稳定 API；升级版本时应重新核对源码和官方手册。

## 一、先用一句话理解 MVCC

一次普通一致性读可以抽象成下面这条链路：

```text
普通 SELECT
    ↓
取得或复用 Read View
    ↓
读取聚簇索引中的最新记录
    ↓
检查记录版本的事务标识是否可见
    ├─ 可见：直接返回
    └─ 不可见：沿 roll pointer 读取 undo，重建更早版本
                    ↓
              重复可见性判断
```

这解释了两个看似矛盾的现象：

1. 事务 B 已经把某行改成新值并提交，事务 A 仍可能读到旧值；
2. 事务 A 读取旧值时通常不需要锁住事务 B，因为旧版本是从 undo 信息重建出来的。

MVCC 不是独立于事务和锁的另一套机制。普通一致性读主要使用快照；写入、锁定读、唯一性检查、外键检查仍然要使用锁。隔离级别决定何时创建快照、快照能看到什么，以及锁定范围如何变化。

## 二、完整组成：当前行、隐藏字段、undo 与 Read View

### 1. 聚簇索引中的当前记录

InnoDB 表的数据按聚簇索引组织。主键存在时通常使用主键作为聚簇索引；没有合适索引时，InnoDB 会生成内部行标识。聚簇索引记录保存当前版本，旧版本并不是在表中完整复制多份。

### 2. 三个内部隐藏字段

InnoDB 为记录维护三个内部字段：

| 内部字段 | 大小 | 作用 |
|---|---:|---|
| `DB_TRX_ID` | 6 字节 | 标识最后插入或更新该行的事务 |
| `DB_ROLL_PTR` | 7 字节 | 指向 rollback segment 中的 undo 记录，用于回滚或重建旧版本 |
| `DB_ROW_ID` | 6 字节 | 没有适用聚簇索引时使用的内部行 ID，并非每张表的每个索引都出现 |

删除同样会形成版本：InnoDB 先给记录打删除标记，等相关旧版本不再被任何快照需要后，再由 purge 真正清理记录和索引项。因此，“事务已经提交”不等于“旧版本可以立即物理删除”。

### 3. undo log 与版本链

undo log 既服务于事务回滚，也服务于一致性读。更新一行时，当前聚簇索引记录被原地修改，`DB_ROLL_PTR` 指向能还原修改前内容的 undo 记录；继续沿指针访问，就形成从新到旧的逻辑版本链。

```text
当前版本：status = PAID，DB_TRX_ID = 120
    ↓ DB_ROLL_PTR
旧版本：status = CREATED，事务 105 生成
    ↓
更旧版本：记录尚不存在
```

insert undo 通常只为回滚插入事务所需，事务提交后即可丢弃；update undo 还可能被其他事务的快照用于重建旧行，必须等相关 Read View 消失后才能清理。官方 [Undo Logs](https://dev.mysql.com/doc/refman/8.4/en/innodb-undo-logs.html) 对 rollback segment、undo segment 与 undo record 的关系有更严格定义。

### 4. Read View

Read View 可以理解为“一致性读在某个时点判断版本可见性的规则集合”。常见源码讲解会把它概括为：

- 创建快照时仍活跃的读写事务 ID 集合；
- 活跃集合中的最小事务 ID 边界；
- 创建快照时尚未分配给普通事务的下一事务 ID 边界；
- 创建当前 Read View 的事务 ID。

不同资料会使用 `m_ids`、`m_up_limit_id`、`m_low_limit_id` 等内部名称。不要只背字段名，因为“up/low”容易按数值大小理解反了。更可靠的记忆方式是：**快照之前已经提交的版本可见；快照时仍活跃的版本不可见；快照之后才出现的版本不可见；事务自己的修改可见。**

## 三、可见性判断到底怎么走

对一条候选记录的版本事务 ID，可以用四步判断：

1. **是否由当前事务自己生成？** 是则可见，保证事务能读到自己的先前写入；
2. **是否早于快照时所有活跃事务？** 是则说明创建快照前已提交，可见；
3. **是否晚于或等于快照的未来事务边界？** 是则说明快照创建时它尚未开始，不可见；
4. **是否落在两个边界之间？** 再检查它是否位于快照的活跃事务集合：仍活跃则不可见，当时已提交则可见。

如果当前版本不可见，InnoDB 就沿 `DB_ROLL_PTR` 找到更早版本，重复判断，直到找到可见版本或确认该记录在快照时尚不存在。

假设创建快照时：

```text
活跃事务：105、108、112
最早活跃边界：105
未来事务边界：115
```

那么事务 99 生成的版本已经在快照前提交，可以直接看到；事务 108 的版本在快照创建时仍活跃，不能看到；事务 113 如果当时已提交，则即使 ID 位于两个边界之间也可以看到；事务 120 在快照之后才开始，不能看到。

事务 ID 大小本身不能单独代表提交顺序。事务可能启动很早、提交很晚，因此必须结合活跃事务集合判断中间区间，而不能写成“事务 ID 比我小就一定可见”。

## 四、RC 与 RR 的真正差异：快照创建频率

MySQL/InnoDB 支持四种标准隔离级别，但 MVCC 讨论中最常见的是 `READ COMMITTED` 与 `REPEATABLE READ`。

| 隔离级别 | 普通读的主要行为 | 快照时机 | 典型影响 |
|---|---|---|---|
| `READ UNCOMMITTED` | 允许读取尚未提交的版本 | 不提供 RC/RR 意义上的一致性快照保证 | 可能脏读，业务系统很少采用 |
| `READ COMMITTED` | 一致性非锁定读 | 每条一致性读创建新快照 | 同一事务两次查询可能看到不同已提交结果 |
| `REPEATABLE READ` | 一致性非锁定读，InnoDB 默认级别 | 同一事务的第一次一致性读建立快照，后续普通读复用 | 同一事务普通读通常保持相同视图 |
| `SERIALIZABLE` | 在 RR 基础上施加更强限制 | 普通 `SELECT` 在特定条件下转为共享锁定读 | 并发度最低，用于确有串行化要求的场景 |

最需要纠正的一句话是：“RR 在 `START TRANSACTION` 时创建快照。”更准确的说法是：默认情况下，快照由事务内**第一次一致性读**建立。若确实需要在开启事务时固定快照，可以在 RR 下使用：

```sql
-- 仅在支持一致性快照的隔离级别使用；应立即开始需要同一视图的查询
START TRANSACTION WITH CONSISTENT SNAPSHOT;
```

因此下面两个流程得到的视图可能不同：

```text
流程 A：BEGIN → 普通 SELECT → 其他事务提交 → 普通 SELECT
        第一次 SELECT 固定视图，第二次仍复用

流程 B：BEGIN → 其他事务提交 → 第一次普通 SELECT
        快照直到这次 SELECT 才建立，能看到之前已经提交的数据
```

RC 则让每条普通一致性读都重新取快照，适合希望尽快看到其他事务提交结果、并能接受同一事务内重复查询变化的场景。RR 更适合分页汇总、批量核对等需要多条普通查询共享逻辑时点的场景，但事务必须短，不能把数据库快照当成长时间报表缓存。

## 五、快照读、当前读与写操作必须分开

### 1. 一致性非锁定读

在 RC、RR 下，普通 `SELECT` 默认属于 consistent nonlocking read。它读取快照，不给访问到的记录加行锁，其他事务可以同时修改这些记录。

```sql
-- 读取符合当前隔离级别的快照，只适合观察数据
SELECT status, pay_amount
FROM mall_order
WHERE order_no = 'M20260810001';
```

### 2. 锁定读

如果读取结果将决定本事务后续写入，普通快照通常不够。`FOR SHARE` 给读取记录加共享锁；`FOR UPDATE` 按更新语义获取排他锁，并读取最新可用版本。

```sql
START TRANSACTION;

-- 锁住目标订单的当前版本，避免并发线程同时从 CREATED 推进状态
SELECT id, status
FROM mall_order
WHERE order_no = 'M20260810001'
FOR UPDATE;

-- 更新仍要带旧状态条件，让状态机约束在数据库层可验证
UPDATE mall_order
SET status = 'PAID', paid_at = CURRENT_TIMESTAMP
WHERE order_no = 'M20260810001'
  AND status = 'CREATED';

COMMIT;
```

不要把 `FOR UPDATE` 解释成“刷新当前事务的 Read View”。它是另一类读取语义：读取当前版本并获取锁。旧版本是内存中通过 undo 重建的，不能对一个历史版本加行锁。

### 3. 写操作

`UPDATE`、`DELETE` 和锁定读关注当前可写版本，不是简单复用普通 `SELECT` 的历史快照。因此 RR 事务中可能出现：普通查询仍看不到另一事务刚插入的行，但随后带条件的 `UPDATE` 或 `SELECT ... FOR UPDATE` 却操作或看到较新的当前版本。

这不是 MVCC 失效，而是应用混用了快照读和当前读。若业务要求“先判断、再修改”基于同一个当前状态，应从第一步就使用正确的锁定读或单条原子条件更新。

## 六、真实订单场景：为什么两次 SELECT 结果不同

准备一张简化订单表：

```sql
CREATE TABLE mall_order (
    id BIGINT PRIMARY KEY,
    order_no VARCHAR(32) NOT NULL UNIQUE,
    status VARCHAR(16) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    updated_at DATETIME(3) NOT NULL
) ENGINE = InnoDB;

INSERT INTO mall_order
    (id, order_no, status, amount, updated_at)
VALUES
    (1, 'M20260810001', 'CREATED', 199.00, NOW(3));
```

### RR：复用第一次一致性读的快照

```sql
-- 会话 A
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION;

SELECT status FROM mall_order WHERE id = 1;
-- 结果：CREATED，此时建立本事务的一致性读快照
```

```sql
-- 会话 B
UPDATE mall_order
SET status = 'PAID', updated_at = NOW(3)
WHERE id = 1;
COMMIT;
```

```sql
-- 会话 A
SELECT status FROM mall_order WHERE id = 1;
-- 仍为 CREATED：PAID 版本在会话 A 的 Read View 中不可见

SELECT status FROM mall_order WHERE id = 1 FOR UPDATE;
-- 读取当前版本 PAID，并获取排他锁；这不是普通快照读

COMMIT;
```

### RC：每条一致性读使用新快照

若会话 A 改为 `READ COMMITTED`，在会话 B 提交后执行第二条普通 `SELECT`，就能看到 `PAID`。这降低了历史版本的复用时间，也减少部分锁范围，但不能保证多条查询看到完全相同的业务时点。

## 七、幻读不能只背“MVCC 已解决”

幻读讨论必须说明隔离级别和读取类型。

- 在 RR 下，同一事务连续执行相同条件的普通一致性读，会复用快照，其他事务之后提交的新行通常不可见；
- `SELECT ... FOR UPDATE`、`UPDATE`、`DELETE` 属于当前读或写操作，需要锁保护搜索范围；InnoDB 在 RR 下通常使用 next-key lock，也就是记录锁与间隙锁的组合，阻止其他事务向扫描间隙插入；
- 如果先普通快照读，后来改用当前读，两条语句语义不同，后者可能看到前者快照中不存在的新行；
- 在 RC 下，普通查询每次取新快照，而且锁定语句的间隙锁行为也与 RR 不同，不能直接套用 RR 结论。

所以正确的设计问题不是“MVCC 能不能解决幻读”，而是“这一段业务需要稳定快照，还是需要锁住当前范围并基于当前值写入”。

## 八、Spring 事务里怎样表达读取意图

下面以订单对账为例。方法需要在一个短事务里读取汇总和明细，要求二者共享 RR 快照，但不修改业务数据：

```java
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

@Service
public class OrderReconciliationService {

    private final JdbcTemplate jdbcTemplate;

    public OrderReconciliationService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional(
            readOnly = true,
            isolation = Isolation.REPEATABLE_READ)
    public ReconciliationResult reconcile(LocalDate day) {
        // 第一条普通查询建立 RR 一致性快照；后续普通查询复用同一视图
        BigDecimal total = jdbcTemplate.queryForObject("""
                SELECT COALESCE(SUM(amount), 0)
                FROM mall_order
                WHERE DATE(updated_at) = ?
                  AND status = 'PAID'
                """, BigDecimal.class, day);

        // 明细与汇总共享快照，避免统计口径因并发提交在两条 SQL 间漂移
        List<String> orderNos = jdbcTemplate.queryForList("""
                SELECT order_no
                FROM mall_order
                WHERE DATE(updated_at) = ?
                  AND status = 'PAID'
                ORDER BY id
                """, String.class, day);

        // 事务内只做必要数据库读取，不调用慢速远程接口，也不等待用户输入
        return new ReconciliationResult(total, orderNos);
    }

    public record ReconciliationResult(
            BigDecimal total,
            List<String> orderNos) {
    }
}
```

这段代码表达的是快照一致性，不是“绝对实时”。若任务持续几分钟甚至几小时，不应一直占着 RR 事务；更稳妥的方案是使用业务截止时间、批次号、只读副本或离线数仓固定统计边界。

对于库存扣减、状态流转等写场景，更推荐单条条件更新并检查影响行数：

```java
int updated = jdbcTemplate.update("""
        UPDATE mall_order
        SET status = 'PAID', updated_at = NOW(3)
        WHERE order_no = ?
          AND status = 'CREATED'
        """, orderNo);

if (updated != 1) {
    // 0 行可能表示重复回调或状态不允许，必须按业务状态分类处理
    throw new IllegalStateException("订单状态已变化，拒绝重复推进");
}
```

这比“普通 SELECT 判断状态，再 UPDATE”少一个竞态窗口。确实需要读取多列后再决策时，才使用 `SELECT ... FOR UPDATE`，并确保有合适索引，避免锁住远超预期的扫描范围。

## 九、二级索引下的 MVCC 还有一层回表边界

聚簇索引记录带有隐藏系统字段，二级索引记录没有同样的版本信息，也不是简单原地更新。当二级索引列变化时，旧索引项被标记删除，新索引项被插入，之后再由 purge 清理。

如果二级索引记录带删除标记，或索引页被更新事务修改过，InnoDB 可能需要回到聚簇索引检查 `DB_TRX_ID`，再从 undo 重建正确版本。此时即使查询列都包含在二级索引中，也不一定能按理想的 covering index 路径直接返回。

这意味着长快照不仅增加 undo 保留，还可能让查询付出更多版本检查和回表成本。索引设计仍然重要，但“覆盖索引必然不回表”在 MVCC 和删除标记场景下不是无条件成立的承诺。

## 十、长事务为什么会拖慢整个实例

一个只读事务可能没有持有大量行锁，却仍长期占用旧 Read View。只要它可能需要某些 update undo 重建旧版本，purge 就不能清理对应历史，进而产生：

- undo tablespace 持续增长；
- history list 变长，版本链遍历成本上升；
- 删除标记记录和旧二级索引项不能及时回收；
- 缓冲池与磁盘 I/O 压力增加；
- 在线 DDL、备份和运维窗口变得更难预测。

诊断时先找事务，而不是先调大 undo 空间：

```sql
-- 查找持续时间较长的 InnoDB 事务；只读非锁定事务不一定立即分配 TRX_ID
SELECT trx_mysql_thread_id,
       trx_started,
       TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS trx_age_seconds,
       trx_state,
       trx_isolation_level,
       trx_rows_modified,
       trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started;
```

`INNODB_TRX` 能看到事务开始时间、状态、隔离级别和当前语句，但不能只凭一张瞬时表判断全部因果。还应结合：

```sql
-- 查看 TRANSACTIONS 区域中的 History list length、活跃事务和 purge 进度
SHOW ENGINE INNODB STATUS\G
```

以及应用连接池指标、慢查询、事务耗时分布和业务请求链路。发现长事务后，不要让脚本无条件 `KILL`：先确认事务所有者、是否正在写入、回滚成本和业务影响。只读报表应优先缩短事务、分批处理或迁移到专用分析链路。

## 十一、常见追问与踩坑

### 1. 事务启动后就一定有事务 ID 和 Read View 吗？

不一定。只读非锁定事务可以被优化，`INNODB_TRX.TRX_ID` 也可能尚未分配；RR 的普通快照默认由第一次一致性读建立。不要用“执行了 BEGIN”推断所有内部对象都已创建。

### 2. 普通 SELECT 完全不加锁吗？

在 RC、RR 下的普通一致性读通常不设置记录锁，但仍会涉及元数据锁、内部 latch 等并发控制；`SERIALIZABLE`、锁定读以及某些 `INSERT ... SELECT` 等组合语句有不同规则。“快照读不加行锁”不能扩大成“MySQL 什么锁都不拿”。

### 3. RR 为什么还能读到自己的新写入？

一致性读的例外是当前事务自己的先前修改始终可见。官方文档也提醒，这可能让一次查询组合出数据库从未在某个单一时点完整存在过的状态：自己修改的行是新版本，其他会话修改的行仍是旧快照。需要严格业务时点时，应避免在同一事务里混杂大范围快照读与局部写入。

### 4. `FOR UPDATE` 能保证只有一行被锁吗？

不能。InnoDB 根据执行计划实际扫描的索引记录加锁，锁范围受索引、条件和隔离级别影响。条件没有合适索引时，可能扫描并锁住大量记录。上线前应核对执行计划，并保持不同业务流程的锁定顺序一致。

### 5. `SKIP LOCKED` 能用来提升普通查询并发吗？

它会跳过已锁记录，返回的不是一致业务视图，不适合普通订单查询或报表。它更适合多个消费者争抢队列表任务的场景，并且仍需幂等状态更新、重试和任务超时回收。

### 6. 改成 RC 就能解决所有长事务问题吗？

RC 每条一致性读创建新快照，通常减少单个旧快照的复用时间，但一个长时间不提交的事务仍可能持有锁、连接和其他资源。隔离级别不能替代事务边界治理。

## 十二、选择建议与最佳实践

### 什么时候优先使用 RR

- 同一短事务中的多条普通查询需要共享稳定视图；
- 业务已经理解快照读与当前读差异；
- 能严格控制事务耗时，不把远程调用和人工等待放进事务；
- 写路径通过条件更新或锁定读明确处理并发。

### 什么时候考虑 RC

- 更希望每条语句看到最近已提交数据；
- 可以接受同一事务重复查询结果变化；
- 高并发写场景希望减少 RR 下部分范围锁影响；
- 团队已经用业务幂等、唯一约束和条件更新处理一致性。

### 落地清单

1. 明确每条查询是观察快照，还是为后续写入做决策；
2. 普通读使用合适隔离级别，写前决策使用原子条件更新或锁定读；
3. RR 中记住快照通常在第一次一致性读时创建，不是机械地等同于 `BEGIN`；
4. 给事务设置明确的代码边界和耗时监控，事务中不做慢远程调用；
5. 为 `FOR UPDATE`、`UPDATE`、`DELETE` 的过滤条件建立合适索引并核对扫描范围；
6. 监控长事务、history list、undo 空间、锁等待与连接池占用；
7. 所有死锁和锁超时都按可预期并发结果处理，重试必须有上限并保证幂等；
8. 不根据事务 ID 大小、一次 `INNODB_TRX` 快照或单条慢 SQL武断归因。

## 总结

MySQL MVCC 的主线并不复杂：聚簇索引保存当前版本，隐藏事务字段连接 undo 版本链，Read View 决定哪个版本对当前一致性读可见。RC 与 RR 的关键差异，是每条一致性读创建新快照，还是在同一事务中复用第一次一致性读的快照。

真正进入工程实践后，必须再加上读取语义：普通 `SELECT` 读历史快照，`FOR SHARE`、`FOR UPDATE` 和写操作读取并保护当前数据。把二者混用而不建模，就会制造“同一事务怎么前后不一致”的错觉。

最后，MVCC 用空间和旧版本换取读写并发，不代表没有成本。最有效的优化往往不是调一个参数，而是让事务更短、查询意图更明确、锁定范围更可控，并让长快照和 purge 滞后在监控中可见。
