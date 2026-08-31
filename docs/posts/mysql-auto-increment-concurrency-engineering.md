---
title: MySQL 8.4 AUTO_INCREMENT 并发工程实践：锁模式、批量插入与复制边界
date: 2026-08-30
category: MySQL
cover: /images/posts/mysql-auto-increment-concurrency-engineering-knowledge-map.webp
tags: [mysql, innodb, auto-increment, concurrency, replication]
excerpt: AUTO_INCREMENT 只负责并发分配唯一递增值，不保证连续、无空洞或业务时序。本文讲清 MySQL 8.4 的三种自增锁模式、批量插入行为、复制约束，以及 Java 批处理如何安全取得生成主键。
---

# MySQL 8.4 AUTO_INCREMENT 并发工程实践：锁模式、批量插入与复制边界

<img src="/images/posts/mysql-auto-increment-concurrency-engineering-knowledge-map.webp" alt="MySQL 8.4 AUTO_INCREMENT 并发工程实践：锁模式、批量插入与复制边界知识串联图" style="border-radius: 10px;" />

AUTO_INCREMENT 只负责并发分配唯一递增值，不保证连续、无空洞或业务时序。本文讲清 MySQL 8.4 的三种自增锁模式、批量插入行为、复制约束，以及 Java 批处理如何安全取得生成主键。

## 先说结论：自增主键是分配器，不是业务序号

InnoDB 为每张含 `AUTO_INCREMENT` 列的表维护自增计数器。插入线程取得一个值或一段值后再写记录；这个分配动作与事务最终提交不是一回事。因此以下现象都正常：

- 事务回滚后，自增值通常不会归还；
- `INSERT IGNORE`、唯一键冲突和混合显式主键插入可能消耗未落库的值；
- 并发事务拿到的主键大小，不代表提交先后；
- 删除最大主键后，不应期待下次插入自动补洞；
- 批量插入得到一组主键，也不能据此替代业务订单号或严格连续票号。

本文以 MySQL 8.4、InnoDB 为基线，事实核对日期为 **2026-08-30**。MySQL 8.4 的 `innodb_autoinc_lock_mode` 默认值是 `2`，作用域为全局且不可动态修改；变更需要写入启动配置并重启实例。具体语义以 [AUTO_INCREMENT Handling in InnoDB](https://dev.mysql.com/doc/refman/8.4/en/innodb-auto-increment-handling.html) 和 [InnoDB 系统变量](https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_autoinc_lock_mode) 为准。

## 一、先区分三类插入语句

锁模式不是只看 `INSERT` 关键字，而是看语句能否提前知道要生成多少行：

| 类型 | 典型语句 | 分配特点 |
| --- | --- | --- |
| 简单插入 | `INSERT ... VALUES (...), (...)` | 解析时就知道行数，可一次预留一段值 |
| 批量插入 | `INSERT ... SELECT`、`LOAD DATA` | 执行前不知道最终行数，只能边读边分配 |
| 混合插入 | 一部分行显式给 ID，一部分行传 `NULL` | 预留值可能与显式值交错，容易产生空洞 |

`REPLACE`、`INSERT ... ON DUPLICATE KEY UPDATE` 等语句也会影响自增分配，但不能简单按“最终新增几行”推导计数器变化。容量评估和排障应观察实际工作负载，不要用业务成功数反推自增值消耗量。

## 二、三种 `innodb_autoinc_lock_mode`

### 模式 0：Traditional

所有会生成自增值的语句都取得表级 `AUTO-INC` 锁，并持有到当前语句结束。同一张表上的其他插入语句需要等待，因此一个语句内的值容易保持连续、结果也最可预测，但批量导入会把并发插入串行化。

模式 0 主要用于旧行为兼容和问题定位，不适合作为现代高并发系统的默认选择。

### 模式 1：Consecutive

简单插入提前知道行数，InnoDB 通过轻量互斥一次预留所需值，不持有表级 `AUTO-INC` 锁到语句结束；批量插入仍取得表级 `AUTO-INC` 锁，避免同一语句生成的值被其他插入穿插。

它在“简单插入并发”与“批量语句结果可重放”之间折中。混合插入可能预留多余值，所以即使模式名叫 Consecutive，也不等于整张表永远无空洞。

### 模式 2：Interleaved

所有插入类语句都不使用表级 `AUTO-INC` 锁，各线程在需要时取得自增值。简单插入仍可一次预留已知数量的值；多个 `INSERT ... SELECT` 或导入任务并发时，同一语句生成的值可能被其他语句穿插。

这是 MySQL 8.4 默认模式，优先吞吐量，适配默认的行格式二进制日志。它保证每个成功插入行拿到唯一值，但不保证某个批量语句获得连续区间。

| 模式 | 简单插入 | 批量插入 | 同一批量语句值可被穿插 | 常见定位 |
| --- | --- | --- | --- | --- |
| `0` Traditional | 表级锁到语句结束 | 表级锁到语句结束 | 否 | 旧行为兼容 |
| `1` Consecutive | 预留值，不持有表级锁 | 表级锁到语句结束 | 否 | 语句复制兼容与并发折中 |
| `2` Interleaved | 预留值，不持有表级锁 | 按需分配 | 是 | MySQL 8.4 默认，高并发 + 行复制 |

## 三、用订单写入看清“唯一”与“连续”

```sql
CREATE TABLE orders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    request_id VARCHAR(64) NOT NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    amount_cent BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uk_orders_request (request_id)
) ENGINE = InnoDB;
```

`id` 负责存储层定位，`request_id` 才负责一次业务请求的幂等。若两个请求使用相同 `request_id`，其中一个可能先取得自增值，随后因唯一键冲突失败；失败值形成空洞，但业务幂等仍然正确。

```sql
INSERT INTO orders (request_id, customer_id, amount_cent)
VALUES ('req-20260830-001', 42, 19900);
```

不能把 `id` 当成“当天第几个订单”。事务 A 先拿到 `id=100` 后停顿，事务 B 拿到 `id=101` 并先提交，按 ID 排序得到的是分配顺序，不是提交顺序。需要业务时序时，应保存受明确定义的业务时间、状态版本或事件序列；需要无缺号票据时，应设计独立的受控号段服务，并接受它带来的串行化与可用性成本。

## 四、Java 批处理应读取驱动返回的主键

不要在插入后执行 `SELECT MAX(id)`，它会读到其他连接提交的记录。也不要根据第一个 ID 自行推算后续 ID：批处理改写、触发器、冲突处理和锁模式都会让这种推算失效。JDBC 应在同一 `Connection` 上请求生成键：

```java
import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

public final class OrderBatchWriter {
    private static final String INSERT_SQL = """
            INSERT INTO orders (request_id, customer_id, amount_cent)
            VALUES (?, ?, ?)
            """;

    private final DataSource dataSource;

    public OrderBatchWriter(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public List<Long> insert(List<NewOrder> orders) throws Exception {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try (PreparedStatement statement = connection.prepareStatement(
                    INSERT_SQL, Statement.RETURN_GENERATED_KEYS)) {
                for (NewOrder order : orders) {
                    statement.setString(1, order.requestId());
                    statement.setLong(2, order.customerId());
                    statement.setLong(3, order.amountCent());
                    statement.addBatch();
                }

                statement.executeBatch();
                List<Long> ids = new ArrayList<>(orders.size());
                try (ResultSet keys = statement.getGeneratedKeys()) {
                    while (keys.next()) {
                        ids.add(keys.getLong(1));
                    }
                }
                if (ids.size() != orders.size()) {
                    // 驱动配置或批处理改写可能改变返回行为，不能静默推算缺失 ID。
                    throw new IllegalStateException("生成主键数量与成功插入行数不一致");
                }
                connection.commit();
                return List.copyOf(ids);
            } catch (Exception failure) {
                connection.rollback();
                throw failure;
            }
        }
    }
}

record NewOrder(String requestId, long customerId, long amountCent) {}
```

上线前要用实际 Connector/J 版本验证 `getGeneratedKeys()`、`rewriteBatchedStatements` 与失败行处理的组合行为。业务代码还应区分整批失败、部分成功和结果未知；如果允许重试，必须依赖 `request_id` 等业务幂等键，而不是依赖自增主键是否已经出现。

## 五、复制边界决定锁模式能否调整

模式 2 允许并发批量语句的值交错。如果二进制日志只记录原 SQL，副本重放时的并发时序可能不同，从而分配出不同 ID；行格式日志直接记录行变化，不依赖副本重新执行同一分配过程。

因此 MySQL 8.4 把模式 2 作为默认值，并明确面向行格式复制。使用 `STATEMENT` 或 `MIXED`、跨版本复制、触发器写自增列，或把 `LAST_INSERT_ID()` 带入后续语句时，都要先核对 [Replication and AUTO_INCREMENT](https://dev.mysql.com/doc/refman/8.4/en/replication-features-auto-increment.html) 与真实 `binlog_format`，不能只做单机压测后改锁模式。

```sql
SELECT VERSION(), @@global.innodb_autoinc_lock_mode, @@global.binlog_format;
```

`innodb_autoinc_lock_mode` 在 MySQL 8.4 不是动态变量，不能把生产变更写成临时 `SET GLOBAL`。正确做法是先确认复制拓扑和回滚方案，再修改实例启动配置，通过重启生效，并在副本与故障切换节点上核对一致配置。

## 六、空洞不是故障，耗尽才是

自增值被分配后，即使插入失败或事务回滚也可能不复用。官方文档还说明，在模式 1 或 2 下，InnoDB 的 `INSERT IGNORE` 即使忽略重复行，也可能推进计数器。`LAST_INSERT_ID()` 返回当前连接最近语句首个成功自动生成的值，不代表本批次最大值；具体边界可查 [MySQL 信息函数](https://dev.mysql.com/doc/refman/8.4/en/information-functions.html#function_last-insert-id)。

不要用“补洞脚本”更新已有主键，也不要定期重置计数器来追求编号美观。这会破坏外键、缓存键、消息引用和审计链。真正需要监控的是类型容量：

```sql
SELECT
    table_schema,
    table_name,
    auto_increment
FROM information_schema.tables
WHERE table_schema = 'app'
  AND auto_increment IS NOT NULL
ORDER BY auto_increment DESC;
```

对高写入表优先使用 `BIGINT UNSIGNED`，并基于实际分配速率估算剩余时间。告警应关注“距离类型上限还有多久”，而不是“空洞比例是否好看”。

## 七、上线检查清单

1. 自增列是否只承担存储标识，不承诺业务顺序、连续性或安全性；
2. 是否用业务唯一键承接幂等，而不是用“有没有生成 ID”判断请求是否执行；
3. 是否识别简单、批量和混合插入，并压测真实并发比例；
4. 是否确认 `innodb_autoinc_lock_mode`、`binlog_format`、复制拓扑和故障切换节点配置；
5. Java 是否读取驱动返回的生成键，并验证实际 Connector/J 批处理行为；
6. 重试是否能处理唯一键冲突、事务回滚和结果未知；
7. 是否接受回滚、忽略行和冲突造成的空洞，禁止补洞；
8. 是否监控自增类型容量、批量写延迟和插入吞吐，而非只盯最大 ID；
9. 变更锁模式是否按启动参数发布，并准备配置回滚与重启窗口。

AUTO_INCREMENT 的工程边界可以概括为：数据库保证并发分配的唯一性，应用接受空洞与顺序不确定性；模式 0 用串行换可预测，模式 1 为批量语句保留连续分配，模式 2 为并发吞吐允许穿插。只要把业务编号、幂等和时序从自增主键中拆开，再让锁模式与复制格式配套，自增列就能保持简单、可靠且高效。
