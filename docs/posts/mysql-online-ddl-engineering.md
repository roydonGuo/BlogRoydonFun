---
title: MySQL 8.4 在线 DDL 工程实践：算法、锁与发布治理
date: 2026-08-05
category: 后端开发
cover: /covers/backend.svg
tags: [mysql, innodb, online-ddl, metadata-lock, database]
excerpt: 从 INSTANT、INPLACE、COPY 与 LOCK 并发级别出发，识别表重建和 MDL 风险，建立可中止、可观测的 MySQL 生产变更流程。
---

# MySQL 8.4 在线 DDL 工程实践：算法、锁与发布治理

<img src="/images/posts/mysql-online-ddl-engineering-knowledge-map.png" alt="MySQL 8.4 在线 DDL 工程实践：算法、锁与发布治理知识串联图" style="border-radius: 10px;" />

从 INSTANT、INPLACE、COPY 与 LOCK 并发级别出发，识别表重建和 MDL 风险，建立可中止、可观测的 MySQL 生产变更流程。

给一张千万级订单表增加字段，看起来只是一条 `ALTER TABLE`。真正进入生产环境后，它却可能瞬间完成，也可能重建整张表、吃满临时磁盘、制造复制延迟，甚至因为一个忘记提交的事务长期拿不到元数据锁。

“Online DDL”最容易引起的误解，就是把 online 等同于无锁和低成本。它实际描述的是 MySQL 在特定操作、算法和锁级别组合下，能够让部分或全部查询、写入与 DDL 并发执行。工程上必须分别回答三个问题：是否修改数据页、是否重建表、业务读写能否继续。

> 本文以 **MySQL 8.4、InnoDB、普通非临时表**为适用范围，事实核对时间为 **2026-08-05**。MySQL 8.0、后续 Innovation 版本、MariaDB、Aurora MySQL 及云厂商在线变更能力可能不同；执行前应按实际版本查阅 [MySQL 8.4 Online DDL 操作矩阵](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html)，不能只依据本文示例判断支持性。

## 一、用三个维度理解“在线”

一次表结构变更至少有三个相互独立的维度。

| 维度 | 要问的问题 | 容易出现的误判 |
|---|---|---|
| 执行算法 | 使用 `INSTANT`、`INPLACE` 还是 `COPY` | 把 `INPLACE` 理解成一定不搬数据 |
| 数据组织 | 是否扫描记录、重建聚簇索引或创建中间表 | 只看 SQL 很短，就认为资源消耗很小 |
| 并发级别 | DDL 期间允许读、写，还是必须独占 | 把 `LOCK=NONE` 理解成完全不获取锁 |

例如，添加普通二级索引通常支持 `ALGORITHM=INPLACE, LOCK=NONE`：业务读写可以继续，但 MySQL 仍需扫描数据并构建索引。重定义主键也可以使用 `INPLACE`，却仍会重组聚簇索引、复制表数据。相反，修改列默认值可以使用 `INSTANT`，主要改数据字典，不需要扫描每一行。

因此评审 DDL 时，不要只问“是不是 online”，而要记录一个四元组：

```text
变更动作 + 执行算法 + 是否重建 + 允许的并发级别
```

## 二、三种算法的完整边界

MySQL 8.4 的 `ALTER TABLE` 主要提供三种算法。省略 `ALGORITHM` 时，MySQL 会依次尝试支持的 `INSTANT`、`INPLACE`、`COPY`。这种自动降级便于执行，却不适合对锁表时间有严格约束的生产发布，因为一条预期瞬时完成的语句可能悄悄落到更昂贵的算法。

### 1. `ALGORITHM=INSTANT`：只改元数据

`INSTANT` 通过更新数据字典和 InnoDB 元数据完成支持的变更，不重建表，也不逐行改写现有记录。MySQL 8.4 对支持的操作默认优先使用它，典型场景包括：

- 增加或删除满足限制的列；
- 只修改列默认值；
- 在属性不变的前提下重命名部分列；
- 在存储大小不改变时，向 `ENUM` 或 `SET` 末尾增加成员；
- 重命名表或索引等仅涉及元数据的操作。

它依然不是“零锁”。开始和提交定义时仍要取得元数据锁，繁忙表上的长事务仍可能让一条瞬时 DDL 等待很久。使用 `INSTANT` 时只允许 `LOCK=DEFAULT`，不能再指定 `LOCK=NONE`、`SHARED` 或 `EXCLUSIVE`。

```sql
-- 只接受 INSTANT；若当前表状态或操作不支持就立即报错，禁止自动降级重建
ALTER TABLE mall_order
    ADD COLUMN risk_source VARCHAR(32) NULL COMMENT '风控来源',
    ALGORITHM=INSTANT;
```

### 2. `ALGORITHM=INPLACE`：在存储引擎内完成

`INPLACE` 表示不走 Server 层的完整复制算法，但名字并不保证“原地不动”。具体操作可能只是改元数据，也可能扫描记录、创建索引，甚至重建整张表。它的优势通常是能够避免 `COPY` 的部分额外开销，并在操作支持时允许并发 DML。

```sql
-- 创建二级索引需要扫描数据，但该组合明确要求业务读写保持可用
ALTER TABLE mall_order
    ADD INDEX idx_clinic_created_at (clinic_id, created_at),
    ALGORITHM=INPLACE,
    LOCK=NONE;
```

执行期间的并发写入会记录到 online alter log，最后阶段再合并。若写入量太大，日志超过 `innodb_online_alter_log_max_size`，DDL 会失败；把上限盲目调大又会延长结束阶段应用日志时的锁定时间。

### 3. `ALGORITHM=COPY`：建立新表并复制数据

`COPY` 会按新定义建立表副本、复制数据，完成后替换原表。执行期间通常允许查询，但不允许并发 DML，至少具有 `LOCK=SHARED` 的限制；切换阶段还需要独占访问。

修改列数据类型是常见的 `COPY` 场景：

```sql
-- 类型变更需要复制整表；大表上不能把它当普通发布 SQL 直接执行
ALTER TABLE mall_order
    MODIFY COLUMN external_no VARCHAR(128) NOT NULL,
    ALGORITHM=COPY,
    LOCK=SHARED;
```

`COPY` 的成本不仅是耗时。它还会占用额外磁盘，增加 Buffer Pool 与 I/O 压力，并可能造成明显的主从延迟。对大表，应在影子环境用接近生产的数据量测算，必要时改用受控的影子表迁移工具，而不是把生产库当作第一次实验场。

## 三、四种 `LOCK` 级别控制什么

`LOCK` 不是执行算法，而是调用方对并发能力提出的约束。指定非默认值的意义在于：若 MySQL 无法满足所需并发级别，语句直接失败，而不是静默采用更强的锁。

| `LOCK` 值 | 查询 | DML | 工程含义 |
|---|---:|---:|---|
| `DEFAULT` | 尽可能允许 | 尽可能允许 | 由操作和算法选择最大并发度，必要时可退化 |
| `NONE` | 允许 | 允许 | 无法同时读写时立即报错，适合要求业务不停写的发布 |
| `SHARED` | 允许 | 阻塞 | 主动接受只读窗口，或某操作最低只能到共享锁 |
| `EXCLUSIVE` | 阻塞 | 阻塞 | 要求独占表，风险最高，只适合明确维护窗口 |

这里的“允许”指 DDL 主要执行阶段能够并发，不代表整个生命周期不获取 MDL。`INPLACE, LOCK=NONE` 在初始与最终阶段仍可能短暂请求排他元数据锁；`INSTANT` 则只能搭配 `LOCK=DEFAULT`。

生产 SQL 应把可接受边界写出来：

```sql
-- 最多等待 10 秒获取元数据锁，避免 DDL 长时间挂起并扩大阻塞队列
SET SESSION lock_wait_timeout = 10;

-- 若无法保持读写并发则失败，留给发布流程重新评估
ALTER TABLE mall_order
    ADD INDEX idx_status_pay_time (status, pay_time),
    ALGORITHM=INPLACE,
    LOCK=NONE;
```

超时只是保险丝，不是自动重试理由。发布系统收到超时后，应先定位持锁事务和排队请求，再由值班人员选择延后、清理异常会话或进入维护窗口。

## 四、常见操作不能凭名字推断成本

下面列出 MySQL 8.4 InnoDB 中容易误判的代表性操作。完整能力仍以官方矩阵和实际表条件为准。

| 操作 | 常见可用算法 | 是否重建 | 并发注意点 |
|---|---|---:|---|
| 增加普通列 | `INSTANT` | 否 | 有表状态、列定义和组合操作限制 |
| 删除普通列 | `INSTANT` | 否 | 会增加 row version，达到上限后需重建 |
| 增加二级索引 | `INPLACE` | 否 | 可支持并发 DML，但会扫描和排序数据 |
| 增加主键 | `INPLACE` | 是 | 重组聚簇索引，属于高成本操作 |
| 单独删除主键 | `COPY` | 是 | 不允许并发 DML |
| 重排列位置 | `INPLACE` | 是 | 只是展示顺序变化，也可能重组大量数据 |
| 修改列数据类型 | `COPY` | 是 | 写入被阻塞，应优先设计兼容迁移 |
| 设置或删除默认值 | `INSTANT` | 否 | 仅修改元数据 |
| `VARCHAR` 扩容 | 取决于字节边界 | 取决于定义 | 字符集和长度字节变化可能迫使 `COPY` |

“增加列一定是瞬时”“加索引不会影响业务”“INPLACE 不占额外空间”都不是可靠规则。存储引擎、行格式、全文索引、外键、分区、临时表、字符集和组合的多个 ALTER 动作，都可能改变可用算法。

## 五、INSTANT 也会积累 row version 债务

MySQL 8.4 使用 row version 表示瞬时增加或删除列后的记录布局。每次执行这类 `INSTANT` 变更，`INFORMATION_SCHEMA.INNODB_TABLES.TOTAL_ROW_VERSIONS` 都会增加；表重建后归零。

MySQL 8.4 每张表最多允许 64 个 row version。达到上限时，后续瞬时增删列会报错，必须通过 `INPLACE` 或 `COPY` 重建表。频繁“先加字段试试、再删掉”的开发习惯，会把一次次低成本发布积累成未来必须偿还的重建窗口。

```sql
-- 发布前检查目标表已经积累的瞬时行版本
SELECT NAME, TOTAL_ROW_VERSIONS
FROM INFORMATION_SCHEMA.INNODB_TABLES
WHERE NAME = 'mall/mall_order';
```

治理上应把 `TOTAL_ROW_VERSIONS` 纳入表结构资产清单，而不是等到报错才处理。重建表要基于容量、复制拓扑和业务窗口单独立项，不能为了清零指标随意执行 `OPTIMIZE TABLE`；后者对 InnoDB 会映射为表重建操作。

## 六、真正危险的是 MDL 阻塞链

MySQL 使用 Metadata Lock（MDL）保护表定义和正在执行的语句。事务访问过某张表后，相关 MDL 通常会持有到事务结束。DDL 需要更强的元数据锁，因此常见事故链是：

```text
长事务访问 mall_order，迟迟不提交
              ↓
ALTER TABLE 等待排他 MDL
              ↓
新的查询与写入可能继续排队
              ↓
连接池堆积，接口超时扩散到上游
```

事故的表象是“这条 ALTER 还没开始执行，数据库却越来越慢”。原因不是数据复制，而是等待中的 DDL 改变了后续锁请求的排队关系。即使最终算法是 `INSTANT`，也可能触发同样的问题。

MySQL 8.4 的 `sys.schema_table_lock_waits` 会直接展示等待与阻塞会话：

```sql
-- 只诊断当前 MDL 阻塞关系，不直接执行视图给出的 KILL 语句
SELECT object_schema,
       object_name,
       waiting_pid,
       waiting_query_secs,
       waiting_query,
       blocking_pid,
       blocking_account
FROM sys.schema_table_lock_waits
WHERE object_schema = 'mall'
  AND object_name = 'mall_order';
```

视图还提供生成好的 `KILL` 文本，但不能交给自动脚本无条件执行。阻塞者可能正在处理支付、库存或结算事务；结束连接前必须确认事务所有者、已执行时间、回滚成本和业务影响。

## 七、一次可控的生产发布流程

### 1. 先做应用兼容，再做 DDL

数据库变更应采用 Expand-Contract：先让新旧应用同时兼容，再扩展表结构，完成数据回填和流量切换，最后才收紧约束或删除旧列。不要在同一批发布中既重命名字段又要求所有实例瞬间切换。

以新增 `risk_source` 为例：

1. 应用先容忍字段不存在或值为 `NULL`，旧版本不读取它；
2. 使用 `ALGORITHM=INSTANT` 增加可空列；
3. 新应用开始双写或读取，后台任务分批回填；
4. 观察完成后，再单独评估 `NOT NULL` 等需要重建的收紧动作。

### 2. 发布前固定事实

至少确认以下内容：

```sql
-- 确认版本、存储引擎和真实表定义，禁止按开发环境猜测
SELECT VERSION();
SHOW CREATE TABLE mall.mall_order;

-- 估算数据与索引体量，数值为统计信息而非精确实时大小
SELECT table_rows,
       data_length,
       index_length,
       data_free
FROM information_schema.tables
WHERE table_schema = 'mall'
  AND table_name = 'mall_order';

-- 检查是否已有 DDL 或长查询占用目标表
SHOW FULL PROCESSLIST;
```

还要核对磁盘余量、`tmpdir` / `innodb_tmpdir`、备份可恢复性、复制拓扑和从库延迟基线。会重建的 Online DDL 可能需要接近原表及索引体量的临时空间，中间表也可能占用原表所在文件系统。

### 3. 显式声明失败边界

低风险瞬时操作显式写 `ALGORITHM=INSTANT`；需要读写并发的操作显式写 `ALGORITHM=INPLACE, LOCK=NONE`。这样当版本、表状态或操作组合不支持时，MySQL 会拒绝执行，而不是替发布者做更危险的降级决定。

### 4. 执行期间同时看数据库和业务

监控至少覆盖：

- `sys.schema_table_lock_waits` 中的 MDL 等待关系；
- DDL 会话状态、执行时间和错误码；
- 磁盘、临时目录、IOPS、CPU 与 Buffer Pool 压力；
- 主库 TPS、接口 P95/P99、连接池活跃数和超时率；
- 各级从库复制延迟、回放状态与只读流量质量；
- `DB_ONLINE_LOG_TOO_BIG`、磁盘不足、重复键等失败原因。

大表 `INPLACE` 操作没有通用的暂停或内建节流机制。若资源压力超出预案，终止语句的回滚本身也可能昂贵，因此必须在执行前设定清晰的中止阈值，而不是出问题后临场讨论。

### 5. 完成后验证契约，而不只看“执行成功”

执行结束后应检查：

- `SHOW CREATE TABLE` 是否与评审定义一致；
- 新索引是否可见，关键 SQL 的执行计划是否符合预期；
- 新旧应用实例是否都能正常读写；
- 从库是否全部完成 DDL 并追平；
- 错误率、延迟和资源曲线是否回到基线；
- `TOTAL_ROW_VERSIONS` 是否按预期变化。

## 八、原子 DDL 不等于事务 DDL

MySQL 8.4 对 InnoDB 支持原子 DDL：数据字典更新、存储引擎操作和二进制日志写入作为一个原子操作提交或回滚，服务器异常时不会暴露一半完成的表定义。

但它不是“可以放进业务事务随意回滚”的事务 DDL。DDL 会隐式结束当前会话中的活动事务，相当于执行前先 `COMMIT`。下面的做法不能提供想象中的整体回滚：

```sql
START TRANSACTION;
UPDATE release_audit SET status = 'RUNNING' WHERE release_id = 42;

-- 该 DDL 会隐式提交前面的事务，不能依赖最后的 ROLLBACK 一起撤销
ALTER TABLE mall_order
    ADD COLUMN risk_source VARCHAR(32) NULL,
    ALGORITHM=INSTANT;

ROLLBACK;
```

发布编排应把 DDL 当作独立步骤，用外部变更记录维护状态。失败后的恢复优先采用向前修复和应用兼容开关；删除新列虽然可能瞬时完成，却可能丢失已经写入的数据，不能作为默认“回滚按钮”。

## 九、何时需要影子表迁移工具

MySQL 原生 Online DDL 适合算法边界明确、资源可控且业务能接受其锁行为的变更。出现以下情况时，应评估 `gh-ost`、`pt-online-schema-change` 或云厂商受控 DDL 服务：

- 操作只能使用 `COPY`，但业务无法接受长时间停止写入；
- 大表重建需要节流、暂停、逐步追赶或可控切换；
- 希望先在影子表验证结构和数据，再择机切换；
- 复制拓扑、分库分表或跨地域发布需要额外编排。

外部工具不是自动安全。它们通常依赖触发器或 Binlog 同步变化，仍要处理外键、磁盘放大、主键要求、切表 MDL、复制延迟与故障恢复。选型前应在相同拓扑和写入压力下演练，并明确谁有权终止或切换任务。

## 十、常见误区与最佳实践

### 误区 1：`INPLACE` 就是不重建表

`INPLACE` 描述执行路径，不描述数据移动量。增加主键、调整列顺序、修改 `NULL` 属性等操作仍可能重建表。

### 误区 2：`LOCK=NONE` 就不会有锁

它只要求主要阶段允许并发读写，初始和最终阶段仍可能需要排他 MDL。长事务治理和锁等待超时仍是必需项。

### 误区 3：省略算法最兼容

省略后 MySQL 会选择可用算法，可能从预期的 `INSTANT` 降到 `INPLACE` 甚至 `COPY`。生产发布更需要“能力不满足就失败”。

### 误区 4：DDL 失败不会影响业务

失败前可能已经消耗大量 I/O 和临时空间；回滚也可能很慢。并发写入还可能让唯一索引创建在最后阶段才失败。

### 误区 5：瞬时增删列可以无限使用

MySQL 8.4 的 row version 有上限。应治理字段生命周期，避免把短期实验残留在核心大表。

最终可以把发布原则压缩为七条：

1. 以真实版本、引擎和表定义查官方 Online DDL 矩阵；
2. 分开评估算法、是否重建、并发级别和 MDL；
3. 使用 Expand-Contract 保持新旧应用兼容；
4. 显式声明 `ALGORITHM`、`LOCK` 和合理的锁等待超时；
5. 在接近生产的数据量、写入压力和复制拓扑上演练；
6. 执行时联动观察数据库资源、业务延迟和复制状态；
7. 把完成后的结构、应用契约、从库一致性和 row version 一起验收。

## 十一、总结

MySQL 在线 DDL 的核心不是记住哪条语句“能在线”，而是建立可验证的发布边界。`INSTANT` 主要修改元数据，却仍受 MDL 和 row version 限制；`INPLACE` 能提高并发度，但可能扫描甚至重建表；`COPY` 则会复制数据并阻塞写入。`LOCK` 子句负责声明业务能够接受的并发下限，不能替代对执行算法和资源成本的判断。

真正可靠的生产变更，会在执行前完成应用兼容、算法约束、容量评估和阻塞诊断，在执行中观察资源与复制链路，在执行后验证结构与业务契约。把 DDL 当成一次数据库发布，而不是一条临时 SQL，才能让“在线”成为可证明的工程能力。

## 参考资料

- [MySQL 8.4 Reference Manual：ALTER TABLE Statement](https://dev.mysql.com/doc/refman/8.4/en/alter-table.html)
- [MySQL 8.4 Reference Manual：Online DDL Operations](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html)
- [MySQL 8.4 Reference Manual：Online DDL Limitations](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-limitations.html)
- [MySQL 8.4 Reference Manual：Online DDL Space Requirements](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-space-requirements.html)
- [MySQL 8.4 Reference Manual：Online DDL Failure Conditions](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-failure-conditions.html)
- [MySQL 8.4 Reference Manual：schema_table_lock_waits](https://dev.mysql.com/doc/refman/8.4/en/sys-schema-table-lock-waits.html)
- [MySQL 8.4 Reference Manual：Atomic DDL Support](https://dev.mysql.com/doc/refman/8.4/en/atomic-ddl.html)
