---
title: MySQL 索引优化实战
date: 2026-06-08
category: 后端开发
cover: /covers/backend.svg
tags: [mysql, database, performance]
excerpt: 通过实际案例学习 MySQL 索引的设计原则与优化技巧，提升查询性能。
---

# MySQL 索引优化实战

索引是数据库性能优化的核心手段之一。本文将结合实际案例，介绍 MySQL 索引的设计原则和优化技巧。

## 索引类型

MySQL 中常用的索引类型：

- **B+Tree 索引**：最常用的索引类型，适用于全值匹配、范围查询和排序
- **Hash 索引**：Memory 引擎默认，仅支持等值比较
- **全文索引**：用于全文检索
- **空间索引**：MyISAM 引擎支持的地理位置索引

## 最左前缀原则

联合索引遵循最左前缀原则：

```sql
CREATE INDEX idx_a_b_c ON user(name, age, city);
```

以下查询可以命中索引：

```sql
SELECT * FROM user WHERE name = 'Roydon';
SELECT * FROM user WHERE name = 'Roydon' AND age = 25;
SELECT * FROM user WHERE name = 'Roydon' AND age = 25 AND city = 'Beijing';
```

以下查询**无法**命中索引：

```sql
SELECT * FROM user WHERE age = 25;           -- 跳过了 name
SELECT * FROM user WHERE city = 'Beijing';    -- 跳过了 name 和 age
```

## 索引下推优化

MySQL 5.6 引入了索引下推（ICP），可以在索引遍历过程中过滤数据，减少回表次数：

```sql
-- 联合索引 (name, age)
SELECT * FROM user WHERE name LIKE '张%' AND age = 25;
```

没有 ICP 时：先根据 `name LIKE '张%'` 找到所有记录行号，再回表过滤 `age = 25`。
有 ICP 时：在索引遍历过程中同时过滤 `age = 25`，减少回表次数。

## 常见优化场景

### 1. 覆盖索引

当查询所需的字段都在索引中时，可以避免回表：

```sql
-- 如果只需要 id 和 name，name 上有索引即可覆盖
SELECT id, name FROM user WHERE name = 'Roydon';
```

### 2. 防止索引失效

- 避免在索引列上使用函数：`WHERE DATE(create_time) = '2026-01-01'`
- 避免隐式类型转换：`WHERE phone = 123456`（phone 为 varchar）
- 避免 `LIKE` 以通配符开头：`LIKE '%keyword'`

## 总结

索引优化需要结合实际的查询模式来设计，合理利用联合索引、覆盖索引和索引下推，能显著提升数据库查询性能。
