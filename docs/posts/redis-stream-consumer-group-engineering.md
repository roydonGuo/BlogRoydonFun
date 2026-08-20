---
title: Redis Stream 消费组工程实践：PEL、确认与故障恢复
date: 2026-08-20
category: 后端开发
cover: /images/posts/redis-stream-consumer-group-engineering-knowledge-map.png
tags: [redis, stream, consumer-group, message-queue, spring-data-redis]
excerpt: Redis Stream 消费组通过游标、消费者和待处理列表分摊消息，但可靠消费仍取决于业务幂等、处理后确认、超时认领和安全裁剪。本文用订单事件讲清 PEL 状态机与故障恢复边界。
---

# Redis Stream 消费组工程实践：PEL、确认与故障恢复

<img src="/images/posts/redis-stream-consumer-group-engineering-knowledge-map.png" alt="Redis Stream 消费组工程实践：PEL、确认与故障恢复知识串联图" style="border-radius: 10px;" />

Redis Stream 消费组通过游标、消费者和待处理列表分摊消息，但可靠消费仍取决于业务幂等、处理后确认、超时认领和安全裁剪。本文用订单事件讲清 PEL 状态机与故障恢复边界。

## 先说结论：ACK 不是业务成功证明

Stream 是追加日志，不是 Redis Pub/Sub。消息会保留在 Stream 中，消费组还会记录“已投递但未确认”的消息。一次可靠处理应遵循：

```text
XADD 写入 → XREADGROUP 投递 → 进入 PEL → 业务事务成功 → XACK 移出 PEL
                                      ↓ 失败或宕机
                              XPENDING → XAUTOCLAIM → 重试
```

这条链路提供的是至少一次处理基础，不是端到端恰好一次。消费者可能在“数据库提交成功、XACK 尚未执行”时宕机，恢复后同一消息会再次到达。因此，业务幂等必须先于 ACK。

本文以 Redis 6.2+ 的 `XAUTOCLAIM` 为恢复基线，并补充 Redis 8.2+ 的消费组感知裁剪能力；事实核对日期为 2026-08-20。

## Stream、消费组与消费者各保存什么

一个 Stream 可以服务多个消费组。不同组各自读取完整消息流；同一组内的消费者分摊消息。

| 状态 | 保存内容 | 关键命令 |
|---|---|---|
| Stream | 有序消息 ID 与字段值 | `XADD`、`XRANGE`、`XTRIM` |
| 消费组 | 最后投递位置、组级 PEL | `XGROUP`、`XINFO GROUPS` |
| 消费者 | 名称、空闲时间、自己的 PEL | `XINFO CONSUMERS`、`XPENDING` |

消息 ID 通常由 Redis 用 `*` 生成，形如“毫秒时间戳-序号”。它适合排序和定位，但不应替代业务事件 ID：重试写入可能产生新的 Stream ID，只有稳定的 `eventId` 才能做跨写入幂等。

```text
XADD order:events MAXLEN ~ 100000 * \
  eventId evt-20260820-001 orderId 9527 type PAID

# 0-0 表示新消费组从现有历史开始；$ 表示只接收创建后的新消息
XGROUP CREATE order:events order-projector 0-0 MKSTREAM
```

`MAXLEN ~` 是近似限长，通常比精确裁剪成本更低，但它不会自动证明消息已被所有消费组处理。

## `>`、PEL 与 ACK 的状态机

消费者使用 `XREADGROUP ... STREAMS key >` 读取从未投递给该组的新消息。Redis 投递后会把消息 ID、所属消费者、空闲时间和投递次数记入 Pending Entries List（PEL）。

```text
XREADGROUP GROUP order-projector worker-01 \
  COUNT 20 BLOCK 2000 STREAMS order:events >
```

处理结果只有三种值得保留的状态：

| 结果 | 动作 | 原因 |
|---|---|---|
| 业务成功或已幂等处理 | `XACK` | 从当前组的 PEL 移除 |
| 瞬时失败 | 暂不 ACK | 留在 PEL，等待后续认领 |
| 永久失败或超过重试上限 | 写入死信记录后 ACK | 避免毒消息无限占用恢复链路 |

不要在 `finally` 中 ACK，也不要对重要业务使用 `NOACK`。前者会把失败伪装成成功，后者让消息投递后不进入 PEL，消费者宕机时失去恢复依据。

## Spring Data Redis：业务提交后再确认

下面示例面向 Spring Data Redis 4.1 的命令式 API。消费者名必须标识一个真实实例，例如“服务名 + Pod UID”，不要让多个活跃实例共用同名消费者。

```java
@Service
public class OrderEventConsumer {

    private static final String STREAM = "order:events";
    private static final String GROUP = "order-projector";

    private final StringRedisTemplate redisTemplate;
    private final OrderProjectionService projectionService;

    public OrderEventConsumer(StringRedisTemplate redisTemplate,
                              OrderProjectionService projectionService) {
        this.redisTemplate = redisTemplate;
        this.projectionService = projectionService;
    }

    public void poll(String consumerName) {
        List<MapRecord<String, Object, Object>> records = redisTemplate.opsForStream().read(
                Consumer.from(GROUP, consumerName),
                StreamReadOptions.empty().count(20).block(Duration.ofSeconds(2)),
                // lastConsumed 对应消费组的新消息位置，不要用 latest 跳过轮询间隙内的数据
                StreamOffset.create(STREAM, ReadOffset.lastConsumed())
        );

        if (records == null) {
            return;
        }

        for (MapRecord<String, Object, Object> record : records) {
            try {
                String eventId = String.valueOf(record.getValue().get("eventId"));
                // 数据库事务内用 eventId 唯一键实现幂等，并更新订单投影
                projectionService.applyOnce(eventId, record.getValue());

                // 只有业务事务已提交，才从当前消费组的 PEL 移除消息
                redisTemplate.opsForStream().acknowledge(STREAM, GROUP, record.getId());
            } catch (RetryableException ex) {
                // 保留 PEL；恢复任务会在超过最小空闲时间后认领
                log.warn("订单事件稍后重试, streamId={}", record.getId(), ex);
            }
        }
    }
}
```

幂等表可以只保存 `consumer_group + event_id` 唯一键和处理时间，并与业务更新放在同一个数据库事务中。只用 Redis `SETNX` 做消费幂等会引入 Redis 与数据库之间的双写窗口。

## 宕机恢复：查看、认领、限次

`XPENDING` 先回答三个问题：积压多少、最老消息空闲多久、集中在哪些消费者。详细查询还能返回每条消息的投递次数。

```text
XPENDING order:events order-projector
XPENDING order:events order-projector IDLE 60000 - + 100
```

Redis 6.2+ 可用 `XAUTOCLAIM` 扫描空闲超过阈值的 PEL，并把所有权转给恢复消费者：

```text
XAUTOCLAIM order:events order-projector recovery-01 \
  60000 0-0 COUNT 100
```

返回值中的游标不是消息 ID 断点；应把它传给下一次 `XAUTOCLAIM`，直到返回 `0-0`，下一轮扫描再从头开始。`min-idle-time` 必须大于正常处理时长的高分位值，否则慢任务仍在执行时就会被并发认领。

恢复任务还要设置投递次数上限。超过上限时，将原始字段、Stream ID、异常摘要和最后处理时间写入死信 Stream，再 ACK 原消息。死信写入和 ACK 不是跨 Redis Key 的业务事务保证；若需要强一致审计，应让死信写入具备幂等键，并定期校验“已 ACK 但无处理记录”的异常空洞。

## 裁剪最容易破坏恢复能力

`XACK` 只删除当前组的 PEL 引用，不删除 Stream 中的消息。反过来，传统 `XDEL` 或默认 `XTRIM` 可能删除消息正文，却保留 PEL 引用；消费者之后读取该 pending ID 时只能得到空内容。

因此，保留策略至少同时约束：

- 最长正常处理时间与故障恢复时间；
- 最大消费延迟和 PEL 最老空闲时间；
- 多个消费组中最慢组的进度；
- Redis 内存上限、持久化和主从故障切换的数据风险。

Redis 8.2+ 为 `XTRIM` 和 `XADD` 裁剪增加 `KEEPREF`、`DELREF`、`ACKED` 策略。多消费组场景可优先评估：

```text
# 仅裁剪所有消费组都已确认的旧条目
XTRIM order:events MAXLEN ~ 100000 ACKED
```

升级前的 Redis 版本不支持该语义时，应基于各组进度制定保留窗口，不能只看 `XLEN` 定时删最老消息。

## 生产监控与选型边界

建议持续采集：

- Stream 长度、内存占用和写入速率；
- 每组 lag、PEL 数量、最老 pending 空闲时间；
- 各消费者 pending 数、空闲时间与投递次数分布；
- 处理成功率、幂等命中率、认领数、死信数和 ACK 延迟。

Redis Stream 适合已有 Redis、吞吐规模可控、需要短链路异步处理的场景。若需要超长保留、海量分区、跨机房日志、独立存储扩展或成熟的重放治理，应优先评估 Kafka 等专用消息系统。Redis 的 AOF、复制和 Sentinel 能降低数据丢失风险，但不把一次 `XADD` 自动升级为跨故障的绝对持久承诺。

最终可以把可靠消费压缩成五条规则：业务事件有稳定 ID；数据库处理幂等；成功后才 ACK；用 PEL 与认领恢复宕机消息；裁剪必须晚于所有必要消费与恢复窗口。

## 参考资料

- [Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/)
- [XREADGROUP](https://redis.io/docs/latest/commands/xreadgroup/)
- [XAUTOCLAIM](https://redis.io/docs/latest/commands/xautoclaim/)
- [XTRIM](https://redis.io/docs/latest/commands/xtrim/)
- [Spring Data Redis：Redis Streams](https://docs.spring.io/spring-data/redis/reference/redis/redis-streams.html)
