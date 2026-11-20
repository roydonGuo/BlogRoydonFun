---
title: MySQL Upsert 工程实践：三种写法、影响行数与死锁边界
date: 2026-11-15
category: 后端开发
cover: /covers/backend.svg
tags: [mysql, upsert, 死锁, 幂等, innodb]
excerpt: “插入或更新”在 MySQL 里有三种写法，语义完全不同：ON DUPLICATE KEY UPDATE 是更新，REPLACE 是删除后重插，INSERT IGNORE 是丢弃冲突行。选错写法会带来自增 ID 空洞、级联删除、错误被吞掉和并发死锁。本文按官方手册逐项对照语义、影响行数与锁行为。"
---

# MySQL Upsert 工程实践：三种写法、影响行数与死锁边界

<img src="/images/posts/mysql-upsert-idempotency-deadlock-engineering-knowledge-map.png" alt="MySQL Upsert 工程实践：三种写法、影响行数与死锁边界知识串联图" style="border-radius: 10px;" />

"插入或更新"在 MySQL 里有三种写法，语义完全不同：ON DUPLICATE KEY UPDATE 是更新，REPLACE 是删除后重插，INSERT IGNORE 是丢弃冲突行。选错写法会带来自增 ID 空洞、级联删除、错误被吞掉和并发死锁。本文按官方手册逐项对照语义、影响行数与锁行为。

## 先说结论：先回答"冲突时到底该发生什么"

| 写法 | 冲突时的动作 | 适合场景 | 主要风险 |
|---|---|---|---|
| `INSERT ... ON DUPLICATE KEY UPDATE` | 更新已有行（部分列） | 计数累加、配置覆盖、幂等写入 | 多唯一索引只更新一行、自增空洞、并发死锁 |
| `REPLACE INTO` | 删除冲突行再插入新行 | 整行覆盖、可接受 ID 变化 | 触发级联删除/触发器、自增 ID 变化、多行被删 |
| `INSERT IGNORE` | 丢弃冲突行，保留旧数据 | 批量导入跳过重复 | 其他错误也被降级为警告 |

判断依据只有一句：冲突时旧数据要保留哪些列。只要还要保留旧行里的部分字段，就只能是 `ON DUPLICATE KEY UPDATE`。本文以 **MySQL 9.7 官方手册**为基线，核对日期 **2026-11-20**。

## 一、三种写法的完整语义

### 1. INSERT ... ON DUPLICATE KEY UPDATE

- 当插入行在 `PRIMARY KEY` 或 `UNIQUE` 索引上产生重复值时，对旧行执行 `UPDATE`。
- **只更新指定列**，未列出的列保持旧值；表达式里可以引用旧值（`c = c + 1`）。
- **影响行数**：新插入为 1，更新已有行为 2，旧行被设置为相同值（实际无变化）为 0；若连接开启 `CLIENT_FOUND_ROWS`，无变化也返回 1。
- **自增列**：即使最终走了更新分支，`AUTO_INCREMENT` 值也会被消耗，因此高并发 upsert 会持续制造 ID 空洞。
- **多唯一索引**：若表上有两个唯一索引且两个都已命中不同行，语句等价于 `UPDATE ... WHERE a=1 OR b=2 LIMIT 1`——只更新一行。官方明确建议避免在多唯一索引表上使用该子句。
- **批量 + IGNORE 的组合**：`INSERT IGNORE ... ON DUPLICATE KEY UPDATE` 会把更新分支产生的唯一键冲突降级为警告，语义更难推理，生产代码应避免。

### 2. REPLACE INTO

- 语义是"删除冲突行，再插入新行"，受影响行数 = 删除行数 + 插入行数；单行替换返回 2。
- **未指定的列会被重置为默认值**，因为底层是一次全行插入，无法引用旧行值。
- 删除+插入会带来三个连锁效应：`AUTO_INCREMENT` 主键变化、外键 `ON DELETE CASCADE` 触发、`DELETE`/`INSERT` 触发器被执行。
- 需要同时具备 `INSERT` 与 `DELETE` 权限。

### 3. INSERT IGNORE

- 把唯一键冲突、部分数据转换错误降级为警告，冲突行被丢弃，**保留旧数据**。
- 危险点在于"忽略"范围远大于唯一键：非空字段缺值、字符串超长被截断、非法日期被调整，都可能静默发生。
- 适合"批量导入时跳过已存在记录"这类明确场景，不适合业务写入路径。

### 4. 语法演进：VALUES() 与行别名

MySQL 8.0.19 起支持 `INSERT ... VALUES (...) AS new` 行别名，可以在更新子句里用 `new.col` 引用待插入值；旧的 `VALUES(col)` 函数已被标记为弃用。新代码直接用别名，避免升级时的兼容问题：

```sql
INSERT INTO sku_stock (sku_id, stock, version)
VALUES (?, ?, 1) AS new
ON DUPLICATE KEY UPDATE stock = sku_stock.stock + new.stock;
```

## 二、锁行为：死锁从哪里来

`ON DUPLICATE KEY UPDATE` 在 InnoDB 中的执行链路是：先按唯一索引尝试插入；发生重复键错误时，对已存在的索引记录加**共享锁（S 锁）**读取该行，再升级为**排他锁（X 锁）**执行更新。这个"先 S 后 X"的两段式加锁，是并发 upsert 死锁的根源。

典型死锁场景：两个事务分别 upsert 键 A 与键 B，且两条语句都涉及"A 与 B 的联合唯一索引"或更新了对方的唯一列，形成 S-S 互持后各自等 X 锁。

工程上的三条约束：

1. **减少唯一索引数量**：唯一索引越多，冲突判定路径越多，锁组合越复杂；
2. **固定访问顺序**：批量 upsert 按主键升序排序后再提交，避免交叉加锁；
3. **缩短事务**：把 upsert 放在短事务里，不要在 upsert 之后继续持有事务做远程调用。

## 三、真实示例：库存累加与配置覆盖

```java
/**
 * 库存写入仓储：演示两种语义的 upsert。
 * 依赖 Spring JdbcTemplate，SQL 中均使用 ON DUPLICATE KEY UPDATE。
 */
@Repository
public class SkuStockRepository {

    private final JdbcTemplate jdbcTemplate;

    public SkuStockRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * 入库累加：冲突时在旧库存上累加，保留旧行的其他列。
     * 注意 affected rows 为 1（新增）或 2（更新），不要用返回值判断"是否新建"。
     */
    public void increaseStock(long skuId, int delta) {
        jdbcTemplate.update("""
                INSERT INTO sku_stock (sku_id, stock) VALUES (?, ?) AS new
                ON DUPLICATE KEY UPDATE stock = sku_stock.stock + new.stock
                """, skuId, delta);
    }

    /**
     * 配置覆盖：只覆盖指定列，未列出的列（如 created_at、owner）保持旧值。
     */
    public void upsertConfig(String key, String value) {
        jdbcTemplate.update("""
                INSERT INTO sys_config (config_key, config_value, updated_at)
                VALUES (?, ?, NOW()) AS new
                ON DUPLICATE KEY UPDATE
                    config_value = new.config_value,
                    updated_at = new.updated_at
                """, key, value);
    }
}
```

幂等性提醒：`stock = stock + new.stock` 本身**不幂等**，同一条消息重投会重复累加；真正的幂等要落一张去重表或用业务流水号，upsert 只解决"行是否存在"的原子性。

## 四、常见追问

**问：upsert 能替代分布式幂等吗？**
不能。upsert 保证"同一主键只有一行"，但不保证"同一次业务请求只生效一次"。重复投递的增量更新照样会叠加，需要幂等键、去重表或状态机。

**问：为什么影响行数是 2？**
`ON DUPLICATE KEY UPDATE` 按"插入 1 + 更新 1"累计，所以更新分支返回 2；如果把旧值更新为完全相同的值则返回 0。用 `affected == 1` 判断"新增"在批量场景下并不可靠。

**问：REPLACE 比 UPDATE 快吗？**
不会。REPLACE 是删除+插入，需要维护所有索引两次，还会受外键与触发器影响，通常更慢。

**问：MyBatis-Plus 的 `saveOrUpdate` 是 upsert 吗？**
不是，它是"先查再插或改"，两步之间没有行锁保护，并发下会抛唯一键冲突。需要原子性请自己写 `ON DUPLICATE KEY UPDATE`。

## 五、踩坑记录

- **用 REPLACE 更新带外键的业务表**：级联删除把子表数据一起清掉，事后靠 binlog 才查到原因。
- **INSERT IGNORE 吞掉超长截断**：字符串被静默截断入库，直到对账才发现数据不完整。
- **在多唯一索引表上 upsert**：只更新了匹配到的第一行，另一行仍是旧值。
- **自增 ID 大面积空洞**：高并发 upsert 不断消耗自增值，ID 段位快速逼近上限类型边界。
- **批量 upsert 不排序**：两个批次交叉提交，线上出现 `Deadlock found when trying to get lock`。
- **用 `VALUES(col)` 写新代码**：该函数已弃用，后续版本迁移要额外改造成本。

## 六、选择建议

- 需要保留旧行部分字段 → `ON DUPLICATE KEY UPDATE`；
- 需要整行替换且能接受 ID 变化、触发器与级联 → `REPLACE`（业务表慎用）；
- 只需要跳过重复、不关心其他错误场景 → `INSERT IGNORE`，并接受告警噪音；
- 涉及外键级联、审计字段、软删除的表 → 一律显式 `UPDATE` + `INSERT` 两段，用唯一键兜底而不是让数据库隐式删除。

## 七、最佳实践清单

1. 只在单唯一索引（通常是主键）的表上使用 upsert；
2. 批量写入前按唯一键升序排序，缩短事务、避免交叉加锁；
3. 用行别名 `AS new` 引用待插入值，不用 `VALUES()`；
4. 增量类更新必须有业务幂等键，不依赖 upsert；
5. 不用受影响行数判断业务分支，改为显式查询或状态字段；
6. 上生产前用并发脚本压测同一批键，观察 `SHOW ENGINE INNODB STATUS` 的死锁段。

## 总结

MySQL 的三种 upsert 写法是三种不同的业务决定：更新、替换、丢弃。真正的工程难点不在 SQL 语法，而在锁——`ON DUPLICATE KEY UPDATE` 的"先 S 后 X"让并发同键写入天然存在死锁窗口，唯一索引数量越少、访问顺序越固定、事务越短，窗口越小。把语义选对、把幂等放在应用层，upsert 才是可靠的工具。
