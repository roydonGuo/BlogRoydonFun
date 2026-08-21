---
title: Redis 数据类型工程实践：String/Hash/List/Set/ZSet 内部编码、场景与选型陷阱
date: 2026-08-21
category: 后端开发
cover: /images/posts/redis-data-types-engineering-knowledge-map.png
tags: [redis, data-types, string, hash, zset, encoding, listpack]
excerpt: Redis 的 type 和 encoding 是两件事：同一种类型在底层会按数据大小自动切换紧凑编码与通用结构，且转换不可逆。选型时先想清访问模式，再决定用哪种数据类型，否则容易踩到大 key、编码膨胀、序列化冗余等坑。
---

# Redis 数据类型工程实践：String/Hash/List/Set/ZSet 内部编码、场景与选型陷阱

<img src="/images/posts/redis-data-types-engineering-knowledge-map.png" alt="Redis 数据类型工程实践：String/Hash/List/Set/ZSet 内部编码、场景与选型陷阱知识串联图" style="border-radius: 10px;" />

Redis 的 type 和 encoding 是两件事：同一种类型在底层会按数据大小自动切换紧凑编码与通用结构，且转换不可逆。选型时先想清访问模式，再决定用哪种数据类型，否则容易踩到大 key、编码膨胀、序列化冗余等坑。

> 本文以 **Redis 7.0+** 的通用行为为基线（7.0 起 `ziplist` 被 `listpack` 全面替代，相关配置项改名；7.4 几乎移除了旧 `ziplist` 配置）。不同发行版（Redis Software / Redis Cloud / 阿里云 Tair 等）默认值可能不同，生产环境以 `CONFIG GET` 与官方文档为准。事实核对日期：2026-08-21。

## 先说结论：数据类型不是你看到的那个样子

许多线上问题不是因为用错了命令，而是因为没分清「逻辑类型」和「底层编码」。先记住四件事：

1. **`TYPE` 只是门面，`OBJECT ENCODING` 才是真相**：一个 `hash` 在小数据时是 `listpack`，超过阈值后悄悄变成 `hashtable`，命令完全不变。
2. **紧凑编码省内存，但扛不住大对象**：小数据用 `listpack`/`intset` 把数据塞进连续内存；一旦字段数或单值大小超过阈值，Redis 会整体换成 `hashtable`/`skiplist`，内存与结构一起变重。
3. **编码转换是单向的**：小盒换成了大箱，删掉数据也不会缩回去。
4. **选类型看访问模式，不看名字好不好听**：计数器用 `String`、对象用 `Hash`、排行榜用 `ZSet`、去重集合用 `Set`、消息流用 `Stream`，选错类型等于提前埋雷。

```bash
# 看清一个 key 的底层编码，排查内存与性能问题时这是第一手证据
OBJECT ENCODING user:1001:profile
# 返回 "listpack"（小 Hash）或 "hashtable"（大 Hash）
MEMORY USAGE user:1001:profile   # 看真实占用
```

## 一、type 与 encoding：两层结构

Redis 每个键值对是一个 `redisObject`，其中 `type` 决定它对外表现得像什么，`encoding` 决定它在内存里长什么样。命令（如 `HGET`、`ZADD`）只认 `type`，不关心 `encoding`；但 `encoding` 直接决定内存占用和单次操作成本。

```text
key ──> redisObject { type: hash, encoding: listpack, ... }
                        │
                        └─ 小数据时: listpack（连续紧凑内存）
                           超过阈值后: hashtable（哈希表，O(1) 查找但 overhead 更高）
```

工程含义：你没法「强制」一个 key 永远是紧凑编码，只能让数据保持在阈值内。当你发现某个 `hash` 内存暴涨，第一反应应是「它是不是已经变成 hashtable 了」，而不是「我的值明明很小」。

## 二、String：最常用，也最容易被误用

`String` 是唯一支持数值原子增量的类型，底层有三种编码：

| 编码 | 触发条件 | 内存特点 |
|---|---|---|
| `int` | 值是 64 位有符号整数 | 直接存数字，最省，0–9999 还有共享整数池 |
| `embstr` | 字符串长度 ≤ 44 字节（Redis 3.2+ 阈值） | `robj` 与 SDS 一次分配、连续内存，缓存友好 |
| `raw` | 字符串 > 44 字节 | `robj` 与 SDS 分两次分配，各自独立 |

44 字节是怎么来的：jemalloc 的 64 字节尺寸档，减去 `robj`(16B) + SDS header(3B) + 结尾 `\0`(1B) + 预留(4B) ≈ 44B。这意味着「短字符串」的边界比直觉更紧——把 key 设计得过长（如把整个 JSON 塞进一个 String），会直接跨过 `embstr` 进入 `raw`，多一次内存分配。

典型用法：

```bash
# 计数器：INCR 系列只对 int 编码生效
INCR article:42:views
INCRBY article:42:views 100

# 分布式锁：SET NX 是 Redis 实现锁的原子基石
SET lock:order:1001 "worker-A" NX PX 30000

# 分布式 Session：短字符串 + TTL
SET session:u1001 "token-xyz" EX 1800
```

工程提醒：不要拿 `String` 当「万能桶」塞大 JSON。一个 1MB 的 `String` 每次 `GET` 都会产生 1MB 网络流量、阻塞单线程、删除还要小心大 key。对象优先拆成 `Hash` 的字段。

## 三、Hash：对象存储的正确姿势

`Hash` 是「对象的天然容器」——用户资料、商品属性、购物车都可以用 `field-value` 表达，且可以只改其中一个字段，不用读改写整个对象。

编码切换：

```text
Hash 新建时默认 listpack（紧凑）
  ├─ 字段数 > hash-max-listpack-entries（默认 128）
  └─ 任意 field 的 value 长度 > hash-max-listpack-value（默认 64 字节）
        ↓ 任一满足，单向转为 hashtable
```

购物车是教科书案例：

```bash
HSET cart:u1001 sku:8848 1        # 添加商品，数量 1
HINCRBY cart:u1001 sku:8848 1     # 加购数量 +1
HLEN cart:u1001                  # 商品种类数
HDEL cart:u1001 sku:8848         # 删除一件
HGETALL cart:u1001               # 获取全部
```

注意 `hash-max-listpack-value` 默认只有 64 字节。如果你把某个 `field` 的值设成几百字节的 JSON 串，这个 `Hash` 会立刻「升舱」成 `hashtable`，紧凑红利瞬间消失。所以 `Hash` 适合「多字段、小值」的对象，不适合「少字段、大值」。

Java 侧用 Spring Data Redis 的 `HashOperations` 即可，但要小心序列化器：

```java
// 用 StringRedisTemplate，值走 JSON 文本，避免 JdkSerialization 的二进制膨胀
HashOperations<String, String, String> ops = stringRedisTemplate.opsForHash();
ops.put("cart:u1001", "sku:8848", "1");
ops.increment("cart:u1001", "sku:8848", 1);   // 原子 +1
```

## 四、List：永远的 quicklist

`List` 是有序字符串列表，支持两端 `LPUSH`/`RPUSH`/`LPOP`/`RPOP`。自从 Redis 3.2，`List` 的底层固定是 **quicklist**——一个双向链表，每个节点是一个 `listpack`；链表节点大小由 `list-max-listpack-size` 控制。老的 `ziplist`/`linkedlist` 编码已不再使用。

```bash
LPUSH orders:queue "{orderId:1}"   # 左进
RPUSH orders:queue "{orderId:2}"   # 右进
RPOP orders:queue                  # 右出（配合 LPUSH 即 FIFO）
```

工程提示：原生 `List` 做消息队列只支持「单消费者」——一条消息 `POP` 走就再没人能拿到，没有 ACK，也没有消费组。需要多消费者、可重放、可确认，请用 `Stream`（见第七节）。别拿 `List` 硬扛 MQ。

## 五、Set：去重与集合运算

`Set` 是无序、唯一的字符串集合，底层是 `intset`（全整数且数量少）或 `hashtable`。

```text
Set 全是整数 且 元素数 ≤ set-max-intset-entries（默认 512）→ intset
否则 → hashtable
```

它真正的价值在集合运算：交集（共同关注）、并集、差集、随机取样。

```bash
# 点赞去重：一个用户对一个目标只能点一次
SADD article:1:likes uid:1001
SREM article:1:likes uid:1001

# 抽奖：去重保证不重复中奖
SPOP  lottery:2026  1     # 取出并移除（不可重复中奖）
SRANDMEMBER lottery:2026 1 # 仅取样（可重复中奖）
```

## 六、ZSet：带分的有序集合

`ZSet`（Sorted Set）在 `Set` 基础上多了 `score`，按分排序，靠 **跳表（skiplist）+ 哈希表** 双结构支撑：跳表负责按分范围遍历，哈希表负责按成员 O(1) 查分。小数据时先用 `listpack` 紧凑存储，超过 `zset-max-listpack-entries`(128)/`zset-max-listpack-value`(64) 再转 `skiplist`。

```bash
ZADD leaderboard 95 "u1001" 88 "u1002"
ZREVRANGE leaderboard 0 9 WITHSCORES   # Top 10 排行榜
ZRANGEBYSCORE leaderboard 80 100        # 分数段查询
```

注意 `ZSet` 的 `score` 是双精度浮点，别拿它存需要精确整数的金额排名后再做金额运算——分数只用来排序，业务值应另存。

## 七、扩展四型：BitMap / HyperLogLog / GEO / Stream

基础五型之外，Redis 还有几个「基于基础类型封装」的高级结构，按需取用：

- **BitMap**：本质是 `String` 的位操作，用 offset 定位。适合签到、在线状态、连续打卡统计。
  ```bash
  SETBIT uid:sign:100:202606 2 1   # 6月3日签到
  BITCOUNT uid:sign:100:202606      # 当月签到天数
  GETBIT  uid:sign:100:202606 2     # 是否签到
  ```
  5000 万用户的登录态只占约 6MB，性价比极高。

- **HyperLogLog**：基数统计，标准误差约 0.81%，12KB 内存可统计接近 2^64 个元素。适合网页 UV、搜索词去重计数。**不适合**需要取出具体元素的场景。
  ```bash
  PFADD  uv:2026-08-21 "user:1001" "user:1002"
  PFCOUNT uv:2026-08-21
  ```

- **GEO**：基于 `ZSet` + GeoHash 编码存经纬度。`GEORADIUS` 已在 Redis 6.2 起废弃，请改用 `GEOSEARCH`：
  ```bash
  GEOADD   cars:locations 116.034579 39.030452 "car:33"
  GEOSEARCH cars:locations FROMLONLAT 116.054579 39.030452 BYRADIUS 5 km ASC COUNT 10
  ```

- **Stream**：为消息队列而生的类型，支持持久化、自动全局唯一 ID、消费组、ACK 确认。需要可靠 MQ 时优先于 `List`。
  ```bash
  XADD    orders * event "created" id 42
  XREADGROUP GROUP g1 c1 COUNT 10 STREAMS orders >
  XACK    orders g1 "1710000000000-0"
  ```
  （Stream 的完整工程实践已另文详述，此处不展开。）

## 八、选型常见坑

1. **大 key 陷阱**：一个 `Hash`/`ZSet` 字段膨胀到几十万，或 `String` 上百 KB，会阻塞单线程、撑爆网络、慢删卡主。拆分大 key，删除用 `UNLINK`（异步）而非 `DEL`。
2. **序列化冗余**：Java 用 `RedisTemplate` 默认 JDK 序列化会写出带类名的二进制，体积大且不可读。统一用 `StringRedisTemplate` + JSON，或配置 `GenericJackson2JsonRedisSerializer`。
3. **把 Redis 当数据库又开 `noeviction`**：没设 TTL 又用默认策略，内存打满后写入直接报错。缓存场景用 `allkeys-lru`/`allkeys-lfu`；需要持久数据请用 `String`/`Hash` 显式管理生命周期。
4. **误以为编码可回退**：数据删回小了，`hashtable` 也不会变回 `listpack`，内存不会自动回收。
5. **`List` 当 MQ 却要多消费者**：没有消费组与 ACK，消息被一个消费者 `POP` 走就丢了。
6. **`ZSet` 的 score 当精确金额**：浮点排序够用，但别在 score 里塞需要精确计算的金额。

## 九、选型速查与最佳实践

| 需求 | 首选类型 | 关键命令 | 注意 |
|---|---|---|---|
| 计数器 / 锁 / 短 Session | `String` | `INCR` / `SET NX` | 大 JSON 别塞 String |
| 对象（多字段小值） | `Hash` | `HSET` / `HINCRBY` | 单值别超 64B 阈值 |
| 队列（单消费者） | `List` | `LPUSH`/`RPOP` | 无 ACK、无消费组 |
| 去重 / 共同关注 | `Set` | `SADD` / `SINTER` | 全整数时最省 |
| 排行榜 / 分数排序 | `ZSet` | `ZADD` / `ZREVRANGE` | score 是浮点 |
| 签到 / 状态位 | `BitMap` | `SETBIT` / `BITCOUNT` | 本质是 String 位操作 |
| 海量 UV 去重计数 | `HyperLogLog` | `PFADD` / `PFCOUNT` | 不能取元素 |
| 附近的人 / LBS | `GEO` | `GEOADD` / `GEOSEARCH` | 底层是 ZSet |
| 可靠消息流 | `Stream` | `XADD` / `XREADGROUP` | 有消费组与 ACK |

最佳实践总结：

- **先定访问模式，再选类型**：读多写少、整对象、部分更新 → `Hash`；排序 → `ZSet`；去重 → `Set`。
- **保持小数据，享受紧凑编码**：让 `Hash`/`ZSet` 的字段数和单值大小留在阈值内，避免悄悄「升舱」。
- **排查先 `OBJECT ENCODING` + `MEMORY USAGE`**：内存异常时这是第一手证据，比猜更快。
- **Java 侧统一序列化**：`StringRedisTemplate` + JSON，杜绝二进制膨胀与跨语言不可读。
- **大 key 提前拆、删除用 `UNLINK`**：把阻塞风险挡在上线前。

## 总结

Redis 数据类型工程的本质，是理解「门面类型」与「底层编码」的分离：同一个 `Hash` 在数据小的时候是紧凑的 `listpack`，超阈值后单向切换为 `hashtable`；这种切换不可逆，也恰恰是内存与性能的开关。把它和访问模式、序列化方式、阈值配置一起考量，才能既省内存又稳性能，而不是上线后用 `DEL` 大 key 救火。

把 `OBJECT ENCODING` 当成你的日常探针，让每一个 key 都用对类型、留在紧凑编码里——这是 Redis 用得「便宜又稳」的第一步。
