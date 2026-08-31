---
title: MySQL 分页稳定性：确定性排序、OFFSET 漂移与游标翻页
date: 2026-08-28
category: MySQL
cover: /images/posts/mysql-pagination-stability-keyset-knowledge-map.webp
tags: [mysql, sql, java]
excerpt: 分页重复和漏数据不只是 LIMIT 的问题：排序键不唯一会让同值记录顺序不确定，并发写入会让 OFFSET 的位置发生漂移。稳定分页需要唯一复合排序；大数据量或实时列表还应使用基于最后一条记录的游标翻页。
---

# MySQL 分页稳定性：确定性排序、OFFSET 漂移与游标翻页

<img src="/images/posts/mysql-pagination-stability-keyset-knowledge-map.webp" alt="MySQL 分页稳定性：确定性排序、OFFSET 漂移与游标翻页知识串联图" style="border-radius: 10px;" />

分页重复和漏数据不只是 `LIMIT` 的问题：排序键不唯一会让同值记录顺序不确定，并发写入会让 `OFFSET` 的位置发生漂移。稳定分页需要唯一复合排序；大数据量或实时列表还应使用基于最后一条记录的游标翻页。

> 事实基线：SQL 行为按 MySQL 8.4 Reference Manual 核对，核对日期为 2026-08-28。索引效果仍应以实际表结构、数据分布和 `EXPLAIN ANALYZE` 为准。

## 一、先分清两种“不稳定”

分页异常通常来自两个独立问题。

### 1、排序键不唯一

下面的查询只按创建时间倒序：

```sql
SELECT id, created_at, title
FROM article
ORDER BY created_at DESC
LIMIT 20 OFFSET 20;
```

如果多条记录的 `created_at` 相同，它们在这个排序条件下就是并列项。MySQL 官方文档明确说明：当多行的 `ORDER BY` 列值相同时，服务器可以按任意顺序返回这些行；执行计划变化后，顺序也可能变化。

`LIMIT`、索引选择或 `filesort` 都可能让并列项换位。于是同一份静态数据连续查两页，也可能看到重复记录或漏掉记录。

修复方式是追加唯一键作为最终排序项：

```sql
SELECT id, created_at, title
FROM article
-- id 为唯一兜底键，保证任意两行都能比较出先后
ORDER BY created_at DESC, id DESC
LIMIT 20 OFFSET 20;
```

**确定性排序**（Deterministic Ordering）的判断标准很简单：任意两条候选记录都能得到唯一的先后关系。

### 2、数据集在两次请求之间变化

即使已经使用 `ORDER BY created_at DESC, id DESC`，两次独立请求之间仍可能有新增、删除或排序字段更新。

假设第一页返回编号 `100` 到 `81`。用户翻页前，新记录插到列表顶部。第二页继续执行 `OFFSET 20` 时，原来的第 `81` 条被向后挤了一位，可能再次出现在第二页。若顶部记录被删除，后续记录向前移动，第二页又可能漏掉一条。

这不是排序不确定，而是 **OFFSET 漂移**（Offset Drift）：`OFFSET` 记录的是“跳过多少个当前位置”，不是“从哪条业务记录之后继续”。

## 二、OFFSET 分页适合什么场景

**偏移分页**（Offset Pagination）使用页码计算跳过行数：

```text
offset = (pageNumber - 1) × pageSize
```

它的优势很明确：

- API 容易理解，适合页码跳转；
- 可以直接访问第 N 页；
- 管理后台的小数据集实现成本低。

代价也同样明确：

- 深分页必须定位并跳过前面的记录，`OFFSET` 越大，扫描成本通常越高；
- 多次请求面对变化中的数据集，页边界会漂移；
- 仅有非唯一排序键时，结果顺序本身就不确定。

因此，数据量有限、写入频率低、确实需要随机跳页时，可以保留 OFFSET；信息流、订单流水、消息记录等持续变化的长列表，更适合游标翻页。

## 三、Keyset Pagination 如何固定位置

**键集分页**（Keyset Pagination），也常叫 **Seek Pagination**，不再说“跳过 20 条”，而是说“从上一页最后一条记录之后继续”。

第一页：

```sql
SELECT id, created_at, title
FROM article
WHERE status = 1
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

假设最后一条是：

```text
created_at = 2026-08-28 10:30:00
id         = 9527
```

下一页要严格沿用相同的复合排序：

```sql
SELECT id, created_at, title
FROM article
WHERE status = 1
  AND (
      created_at < '2026-08-28 10:30:00'
      OR (created_at = '2026-08-28 10:30:00' AND id < 9527)
  )
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

判断条件与排序方向是一一对应的：主排序键更小，或者主排序键相同且唯一键更小。新数据即使插到顶部，也不会改变游标之后的位置。

```mermaid
flowchart LR
    A[读取第一页] --> B[取得末行键]
    B --> C[编码游标]
    C --> D[按键继续查询]
    D --> E[多取一条]
    E --> F[返回下一游标]
```

问：为什么不能只把 `id` 放进游标？

因为查询按 `(created_at, id)` 排序，游标也必须包含同一组排序键。只保存 `id` 会丢失主排序维度，无法准确表达上一页结束位置。

## 四、索引必须与过滤和排序对齐

对上面的查询，可以从这个联合索引开始评估：

```sql
CREATE INDEX idx_article_status_created_id
    ON article (status, created_at DESC, id DESC);
```

索引顺序表达了查询路径：先固定 `status`，再按 `created_at` 和 `id` 继续扫描。MySQL 8.4 可以使用降序索引；是否真正避免 `filesort`，要看查询形态和优化器选择。

```sql
EXPLAIN ANALYZE
SELECT id, created_at, title
FROM article
WHERE status = 1
  AND (
      created_at < '2026-08-28 10:30:00'
      OR (created_at = '2026-08-28 10:30:00' AND id < 9527)
  )
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

重点观察实际读取行数、耗时、所用索引，以及是否出现 `Using filesort`。不要看到 `LIMIT 20` 就认为数据库只读取了 20 行。

还要注意三个边界：

1. 排序列允许 `NULL` 时，必须先定义 `NULL` 的业务顺序，并让查询条件与之匹配；更简单的做法是让游标排序列 `NOT NULL`。
2. 排序字段会被更新时，记录可能在翻页过程中移动。实时列表通常接受这种语义；强一致导出应使用固定快照或批次边界。
3. 过滤条件必须在翻页期间保持一致。租户、状态、搜索条件变化后，应丢弃旧游标重新查询。

## 五、Java API 不要暴露裸 SQL 游标

游标属于服务端查询契约，不应让客户端拼接时间和 ID。可以把复合键序列化后进行 Base64 URL 编码，并增加版本字段，方便以后演进。

```java
public record ArticleCursor(
        int version,
        Instant createdAt,
        long id) {
}

public record CursorPage<T>(
        List<T> items,
        String nextCursor,
        boolean hasMore) {
}
```

查询时多取一条，用额外记录判断是否还有下一页：

```java
public CursorPage<ArticleSummary> queryArticles(String cursor, int requestedSize) {
    int size = Math.min(Math.max(requestedSize, 1), 100);
    ArticleCursor anchor = cursorCodec.decode(cursor);

    // 多取一条只用于判断 hasMore，不返回给客户端
    List<ArticleSummary> rows = articleMapper.selectAfter(anchor, size + 1);
    boolean hasMore = rows.size() > size;
    List<ArticleSummary> items = hasMore
            ? List.copyOf(rows.subList(0, size))
            : List.copyOf(rows);

    String nextCursor = null;
    if (hasMore && !items.isEmpty()) {
        ArticleSummary last = items.get(items.size() - 1);
        // 游标必须保存完整复合排序键
        nextCursor = cursorCodec.encode(new ArticleCursor(1, last.createdAt(), last.id()));
    }
    return new CursorPage<>(items, nextCursor, hasMore);
}
```

生产游标还应包含或绑定：

- 查询方向和版本；
- 租户与关键过滤条件的摘要；
- 必要时的签名和过期时间，防止客户端篡改；
- 明确的解析错误码，例如 `INVALID_CURSOR`、`EXPIRED_CURSOR`。

不要把数据库主键是否连续当作分页正确性的前提。键集分页只要求排序键可比较且最终唯一，不要求 ID 没有空洞。

## 六、稳定排序不等于一致性快照

复合排序解决“同一数据集如何稳定排列”，键集分页解决“从哪个位置继续”，但它们都不保证多次 HTTP 请求看到同一时刻的数据。

如果业务要求导出期间一条不多、一条不少，可以选择：

- 在一个短事务的一致性读中完成可控规模的批量读取；
- 先固化导出任务的记录 ID 或截止边界，再分批处理；
- 使用业务版本号、批次号或 `created_at <= snapshotTime` 固定候选集合；
- 对超大导出使用异步任务，避免长事务拖住 Undo 清理。

MySQL 的 Repeatable Read 快照也不是跨多个独立请求自动共享。把事务跨用户翻页长期保持，会占用连接并延长历史版本生命周期，通常不是在线列表的正确方案。

## 七、落地检查清单

- `ORDER BY` 是否以唯一键收尾；
- 下一页条件是否与排序列、方向完全一致；
- 联合索引是否覆盖固定过滤前缀和排序键；
- 游标是否携带版本、完整复合键和过滤条件约束；
- 是否用“多取一条”计算 `hasMore`；
- 是否定义新增、删除、更新排序字段时的产品语义；
- 是否用 `EXPLAIN ANALYZE` 验证深分页前后的实际读取量；
- 强一致导出是否另有快照或批次方案。

## 八、总结

分页正确性的第一步不是换框架，而是把“顺序”和“位置”定义清楚。

**要点回顾**：非唯一 `ORDER BY` 会让并列记录顺序不确定；唯一复合排序只能修复顺序，不能阻止 OFFSET 在并发写入下漂移；键集分页用上一页末行的完整排序键继续扫描；联合索引、游标契约和数据变化语义必须一起设计。

**关联知识点**：覆盖索引减少回表；`filesort` 是额外排序阶段而不等同于磁盘排序；MVCC 决定一致性读能看到哪些版本；异步导出适合固化批次后分段处理。

**面试常问**：为什么 `ORDER BY created_at` 仍会重复？→ 同一时间值的记录没有唯一先后；为什么加 `id` 后 OFFSET 仍可能漏数据？→ 两次请求之间的插入或删除改变了偏移位置；Keyset Pagination 为什么更适合深分页？→ 它从索引锚点继续扫描，不需要跳过越来越多的前置记录。

**参考资料**：[MySQL 8.4：LIMIT Query Optimization](https://dev.mysql.com/doc/refman/8.4/en/limit-optimization.html)；[MySQL 8.4：ORDER BY Optimization](https://dev.mysql.com/doc/refman/8.4/en/order-by-optimization.html)；[MySQL 8.4：SELECT Statement](https://dev.mysql.com/doc/refman/8.4/en/select.html)；[MySQL 8.4：Comparison Functions and Operators](https://dev.mysql.com/doc/refman/8.4/en/comparison-operators.html)。
