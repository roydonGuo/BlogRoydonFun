---
title: MySQL 8.4 SQL 执行链路：连接、解析、优化与执行
date: 2026-08-24
category: MySQL
cover: /images/posts/mysql-sql-execution-pipeline-knowledge-map.webp
tags: [sql, explain]
excerpt: 一条 SQL 的耗时不只发生在存储引擎读写：它还要经过连接认证、解析与语义检查、基于成本的计划选择、执行器迭代取数和结果返回。理解每一段的边界，才能把连接慢、优化慢、锁等待和扫描量过大分别定位。
---

# MySQL 8.4 SQL 执行链路：连接、解析、优化与执行

<img src="/images/posts/mysql-sql-execution-pipeline-knowledge-map.webp" alt="MySQL 8.4 SQL 执行链路：连接、解析、优化与执行知识串联图" style="border-radius: 10px;" />

一条 SQL 的耗时不只发生在存储引擎读写：它还要经过连接认证、解析与语义检查、基于成本的计划选择、执行器迭代取数和结果返回。理解每一段的边界，才能把连接慢、优化慢、锁等待和扫描量过大分别定位。

## 先说结论：SQL 慢，要先判断慢在哪一段

对一条普通查询，可以把 MySQL 服务端的主链压缩为：

```text
客户端建连与认证
  → 接收 SQL
  → 解析语法并解析对象
  → 优化器选择执行计划
  → 执行器按计划请求存储引擎
  → InnoDB 访问缓存页或磁盘页
  → 逐批返回结果
```

这是一张用于排障的概念地图，不是所有语句都严格经过相同内部函数。DDL、存储过程、预处理语句和管理命令都有各自分支；`UPDATE` 还会进入事务、锁、undo、redo 与 binlog 链路。

本文以 MySQL 8.4 Reference Manual 为事实基线，核对日期为 2026-08-24。来源笔记提到的 Query Cache 已过时：Query Cache 在 MySQL 8.0 系列就已移除，MySQL 8.4 的查询链路中不存在“先查 Query Cache”这一步。

## 一、连接阶段：先建立会话，再谈 SQL

远程客户端通常先建立 TCP 连接，再完成 MySQL 协议握手、能力协商与认证。服务端连接校验至少关注账号的 `User`、来源 `Host`、认证凭据和锁定状态；连接成功后才进入后续请求阶段。

默认线程处理模型下，服务端以“每个客户端连接对应一个线程”的方式执行语句。应用侧连接池解决的是反复建连成本，不能替代服务端的并发治理：连接池开得越大，不代表吞吐越高，反而可能把数据库推入线程调度、内存和锁竞争。

Java 服务应给连接池设定有界容量和获取超时：

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
      connection-timeout: 2000
      validation-timeout: 1000
```

这些数字只是示例，不是通用推荐值。实际容量要结合实例 CPU、活跃事务数、单查询耗时和下游并发压测确定。连接故障优先检查：

- 建连是否慢在 DNS、网络、TLS 或认证；
- `Threads_connected` 与真正执行中的线程是否同时增长；
- 应用是否泄漏连接，事务是否长时间占用连接；
- 连接池等待时间是否已高于 SQL 执行时间。

## 二、解析与语义解析：语法正确不等于可以执行

服务端收到 SQL 后，先做词法与语法解析，把文本组织成内部结构。随后还要解析数据库对象、列、函数和类型，并完成权限检查等准备工作。

因此，下面几类错误属于不同层次：

| 现象 | 典型阶段 | 排查重点 |
|---|---|---|
| SQL 语法错误 | 解析 | 关键字、括号、表达式结构 |
| 表或列不存在 | 对象解析 | 默认库、别名、字段名、部署版本 |
| 访问被拒绝 | 权限检查 | 实际匹配账号、来源 Host、对象权限 |
| 参数类型不兼容 | 表达式与类型处理 | JDBC 参数类型、隐式转换、字符集 |

不要把“预处理”简单理解成把 `SELECT *` 替换为列名。工程上更重要的是：SQL 文本要先变成服务端可验证、可优化的内部表示。JDBC `PreparedStatement` 的核心价值是参数绑定和复用协议，不是绕过权限与优化器；元数据变化时，预处理语句还可能触发重新准备。

```java
String sql = """
        SELECT id, status, total_amount
        FROM orders
        WHERE tenant_id = ? AND id = ?
        """;

try (PreparedStatement statement = connection.prepareStatement(sql)) {
    // 参数值与 SQL 结构分离，避免字符串拼接造成注入风险
    statement.setLong(1, tenantId);
    statement.setLong(2, orderId);
    try (ResultSet resultSet = statement.executeQuery()) {
        // 及时消费并关闭结果集，避免长期占用连接
        return mapOrder(resultSet);
    }
}
```

## 三、优化阶段：选的是成本更低的计划，不是永远最快的计划

优化器会基于可用索引、连接顺序、谓词、统计信息和成本模型比较候选方案，选出估算成本较低的执行计划。它面对的是统计分布和估算值，不知道每次请求的完整现实，所以计划可能因统计信息陈旧、数据倾斜或参数分布而偏离实际。

`EXPLAIN` 展示优化器计划怎样执行语句；排查时至少关注：

- 访问类型与使用的索引；
- 预计扫描和输出行数；
- 多表连接顺序与每层循环次数；
- 是否出现排序、临时表或回表；
- 过滤条件是在存储引擎侧还是 Server 层生效。

```sql
EXPLAIN FORMAT=TREE
SELECT id, status, total_amount
FROM orders
WHERE tenant_id = 42
  AND created_at >= '2026-08-01'
ORDER BY created_at DESC
LIMIT 50;
```

`EXPLAIN ANALYZE` 会真正执行语句，并把估算成本、预计行数、实际首行时间、实际耗时、返回行数和循环次数放在迭代器树上。它适合验证“估算错了还是执行真的慢”，但绝不能把它当作无副作用的静态分析命令。

```sql
EXPLAIN ANALYZE FORMAT=TREE
SELECT id, status, total_amount
FROM orders
WHERE tenant_id = 42
  AND created_at >= '2026-08-01'
ORDER BY created_at DESC
LIMIT 50;
```

若预计行数与实际行数相差很大，先检查数据分布和统计信息，再考虑 `ANALYZE TABLE`、直方图或索引调整。不要一看到未使用某个索引就立即加 `FORCE INDEX`；提示会缩小优化器选择空间，数据分布变化后可能成为新的性能问题。

## 四、执行阶段：执行器拉取，存储引擎读写

执行计划确定后，执行器按计划中的迭代器请求数据。Server 层负责通用 SQL 语义，例如表达式计算、部分过滤、连接、聚合与结果组织；存储引擎负责底层数据访问。MySQL 的可插拔存储引擎架构通过统一接口隔离两者，不同引擎可以有不同物理实现。

以 InnoDB 查询为例，访问路径可能是：

1. 根据主键或二级索引定位记录；
2. 先从 Buffer Pool 查找所需页；
3. 未命中时把磁盘页读入内存；
4. 按事务可见性判断版本；
5. 把符合条件的行交回上层迭代器；
6. 上层完成剩余过滤、连接、排序或聚合后返回客户端。

这里没有一个独立的“执行器缓存”替代索引和 Buffer Pool。命中 Buffer Pool 只说明页在内存中，不代表扫描行数合理；全表扫描即使全部命中内存，也可能消耗大量 CPU、内存带宽并挤出其他热点页。

`LIMIT 50` 也不保证只读取 50 行。若过滤和排序不能利用合适索引，执行器可能先扫描、过滤甚至排序大量候选行，最后才截取 50 行。真正应该观察的是迭代器的实际行数、循环次数和耗时。

## 五、SELECT 与 UPDATE 在执行阶段分叉

`SELECT` 主要围绕一致性读、锁定读和结果返回；`UPDATE` 除了查找目标行，还会进入修改链路：

```text
定位目标行
  → 获取必要的行锁
  → 校验条件与约束
  → 生成旧版本信息并修改页
  → 记录事务与日志信息
  → 提交或回滚
```

所以“同一个 WHERE 条件，SELECT 很快但 UPDATE 很慢”并不矛盾。后者可能在等锁、维护多个索引、执行外键检查或等待提交相关 I/O。定位更新慢时，除了执行计划，还要看事务持续时间、锁等待、被阻塞线程和提交延迟。

事务边界也会改变连接占用时间。禁止在数据库事务中执行长时间 HTTP 调用、文件上传或模型推理；这些外部等待会让连接、锁和版本链一起变长。

## 六、用三组证据定位慢点

### 1. 当前会话：谁正在等什么

```sql
SHOW FULL PROCESSLIST;
```

它适合紧急观察当前线程状态，但只能提供现场快照。不要根据一次快照直接下结论，应结合持续采样、事务信息和应用 trace。

### 2. 执行计划：估算与实际是否一致

```sql
EXPLAIN FORMAT=TREE SELECT ...;
EXPLAIN ANALYZE FORMAT=TREE SELECT ...;
```

先用 `EXPLAIN` 静态看计划，再在安全环境和可控数据范围内用 `EXPLAIN ANALYZE` 获取实际执行证据。对会修改数据的语句尤其谨慎，因为分析本身会执行语句。

### 3. Performance Schema：时间花在哪个事件

Performance Schema 可以记录语句、阶段和等待事件。阶段表示语句执行过程中的步骤，例如解析、打开表或 `filesort`；等待事件还能继续下钻到锁、文件与同步对象。层级关系可以理解为：事务包含语句，语句包含阶段，阶段包含等待。

```sql
SELECT EVENT_NAME,
       ROUND(TIMER_WAIT / 1000000000, 3) AS elapsed_ms,
       SQL_TEXT
FROM performance_schema.events_statements_history_long
WHERE SQL_TEXT IS NOT NULL
ORDER BY TIMER_WAIT DESC
LIMIT 20;
```

阶段采集项并非全部默认开启。临时启用前要评估观测开销，只开启需要的 instrument 与 consumer，并记录恢复方式；生产环境不要为了“看得更全”无差别打开所有历史采集。

## 七、从症状反推链路位置

| 症状 | 优先怀疑 | 首要证据 |
|---|---|---|
| 获取连接慢，SQL 本身快 | 连接池耗尽、网络、认证 | 连接池等待、建连耗时、连接数 |
| 首次执行慢，后续明显变快 | 冷页、缓存预热、计划或元数据开销 | Buffer Pool、实际 I/O、重复执行对比 |
| `EXPLAIN` 看似合理但仍慢 | 估算偏差、迭代器循环、锁或 I/O | `EXPLAIN ANALYZE`、等待事件 |
| CPU 高且返回行很少 | 扫描/过滤过多、排序、表达式计算 | 实际扫描行数、filesort、火焰图 |
| UPDATE 卡住而 SELECT 正常 | 行锁、长事务、提交链路 | 锁等待、事务年龄、阻塞者 |
| 数据库很快但接口仍慢 | 结果传输、对象映射、下游逻辑 | 端到端 trace、返回字节数、JVM profile |

最常见的误判，是只看接口总耗时就说“数据库慢”，或只看数据库语句耗时就忽略连接等待和结果传输。时间线必须从应用获取连接开始，一直覆盖结果集消费结束。

## 落地检查表

1. 应用指标是否区分连接等待、SQL 执行和结果映射；
2. 连接池是否有界，并为获取连接设置超时；
3. SQL 是否使用参数绑定，而非字符串拼接；
4. 是否先用 `EXPLAIN` 看计划，再安全使用 `EXPLAIN ANALYZE`；
5. 是否比较预计行数与实际行数，而非只盯着索引名；
6. 是否检查扫描量、循环次数、排序和临时表；
7. 更新慢时是否同步检查锁等待和长事务；
8. 是否避免在事务中执行不可控的外部调用；
9. Performance Schema 是否按需开启并有恢复方案；
10. 是否明确 MySQL 8.4 已无 Query Cache，不沿用旧版链路图排障。

## 总结

一条 SQL 不是直接从文本跳到磁盘。连接层建立会话和安全边界，解析与对象解析把文本变成可验证结构，优化器用统计信息选择估算成本较低的计划，执行器再通过统一接口驱动 InnoDB 等存储引擎读写数据。

工程排障的关键不是背模块名，而是为每段建立证据：连接池指标回答“是否卡在拿连接”，`EXPLAIN` 与 `EXPLAIN ANALYZE` 回答“计划如何、估算是否准确”，Performance Schema 与事务锁信息回答“时间具体耗在执行、等待还是 I/O”。链路位置判断正确，索引、SQL、事务和容量治理才不会变成盲调。

## 参考资料

- [MySQL 8.4 Reference Manual：Connection Management](https://dev.mysql.com/doc/refman/8.4/en/connection-management.html)
- [MySQL 8.4 Reference Manual：Connection Verification](https://dev.mysql.com/doc/refman/8.4/en/connection-access.html)
- [MySQL 8.4 Reference Manual：Storage Engine Architecture](https://dev.mysql.com/doc/refman/8.4/en/pluggable-storage-overview.html)
- [MySQL 8.4 Reference Manual：Understanding the Query Execution Plan](https://dev.mysql.com/doc/refman/8.4/en/execution-plan-information.html)
- [MySQL 8.4 Reference Manual：EXPLAIN Statement](https://dev.mysql.com/doc/refman/8.4/en/explain.html)
- [MySQL 8.4 Reference Manual：Performance Schema Stage Event Tables](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-stage-tables.html)
- [MySQL 8.0 Reference Manual：Removed Options and Variables](https://dev.mysql.com/doc/refman/8.0/en/added-deprecated-removed.html)
