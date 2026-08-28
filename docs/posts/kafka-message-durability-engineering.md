---
title: Kafka 消息不丢失工程实践：确认、ISR 与端到端提交
date: 2026-08-19
category: 后端开发
cover: /images/posts/kafka-message-durability-engineering-knowledge-map.webp
tags: [kafka, mq]
excerpt: Kafka 的可靠性不是一个开关，而是生产确认、副本提交、消费位点和业务结果共同组成的链路。本文以 Apache Kafka 4.3.1 为基线，拆清三段丢失窗口，并给出可落地的配置、提交顺序与故障验证方法。
---

# Kafka 消息不丢失工程实践：确认、ISR 与端到端提交

<img src="/images/posts/kafka-message-durability-engineering-knowledge-map.webp" alt="Kafka 消息不丢失工程实践：确认、ISR 与端到端提交知识串联图" style="border-radius: 10px;" />

Kafka 的可靠性不是一个开关，而是生产确认、副本提交、消费位点和业务结果共同组成的链路。本文以 Apache Kafka 4.3.1 为基线，拆清三段丢失窗口，并给出可落地的配置、提交顺序与故障验证方法。

## 先说结论：先定义“没有丢”

一条订单事件至少经过三段：

```text
业务事务 → Producer → 分区 Leader / ISR → Consumer → 业务结果
```

因此“发送成功”不等于“业务完成”。工程上要分别保证：

1. **生产端**收到明确成功或失败，不能忽略异步回调；
2. **Broker 端**只在足够多同步副本确认后接受成功；
3. **消费端**先完成业务处理，再推进位点；
4. **端到端**允许重放，并用唯一键、状态机或 Kafka 事务收敛重复。

本文以 [Apache Kafka 4.3.1](https://kafka.apache.org/blog/2026/06/25/apache-kafka-4.3.1-release-announcement/) 为版本基线，事实核对日期为 2026-08-19。若启用 Eligible Leader Replicas 等新特性，应重新核对对应版本中 `min.insync.replicas` 的语义。

## 三种交付语义

Kafka 官方把交付语义分为三类：

| 语义 | 处理顺序 | 结果 |
|---|---|---|
| At-most-once | 先提交位点，再处理 | 不重复，但失败时可能丢 |
| At-least-once | 先处理，再提交位点 | 不丢，但故障恢复可能重复 |
| Exactly-once | 数据处理与位点推进原子提交 | 在受支持边界内不丢不重 |

多数业务系统应选择 **At-least-once + 业务幂等**。Kafka 的 Exactly-once 适合“消费 Kafka、处理、再写回 Kafka”的链路；若结果写入 MySQL、调用支付接口或发送短信，Kafka 事务不能自动覆盖外部副作用。

## 生产端：成功必须可确认

### `acks` 的完整取值

- `acks=0`：不等待 Broker 响应，客户端无法确认服务端是否收到，重试也无法正常发挥作用；
- `acks=1`：Leader 写入本地日志就响应；若 Leader 随即故障且 Follower 尚未复制，记录可能丢失；
- `acks=all`：当前 ISR 中所有副本确认后才成功，是最强的内置确认级别。

Kafka 4.3.1 Producer 默认 `acks=all`，且在没有冲突配置时默认启用幂等生产者。但生产配置最好显式表达可靠性意图，防止后续改动无意破坏约束：

```java
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "kafka-1:9092,kafka-2:9092");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());

// 可靠性组合：ISR 全部确认、失败可重试，并消除重试导致的分区内重复写入
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, 120_000);

try (KafkaProducer<String, String> producer = new KafkaProducer<>(props)) {
    ProducerRecord<String, String> record =
            new ProducerRecord<>("order-created", orderId, payload);

    // 必须观察异步结果；失败记录进入重试表或 Outbox，不能只打印日志后丢弃
    producer.send(record).get();
}
```

`enable.idempotence=true` 依赖 `acks=all`、正数 `retries`，并要求 `max.in.flight.requests.per.connection <= 5`。它通过 Producer ID 和序列号消除同一生产会话中重试产生的重复，不等于业务请求幂等，也不能替代数据库 Outbox。

`delivery.timeout.ms` 是从 `send()` 返回后到最终报告成功或失败的总上限，覆盖排队、等待确认和可重试失败。超时表示结果未知：原请求可能已经写入，应用不能换一个新业务 ID 盲目重发。

### 业务事务到 Kafka：用 Outbox 补上断点

下面两步无法靠普通本地事务保持原子性：

```text
提交订单数据库事务
发送 order-created 到 Kafka
```

数据库成功、进程却在发送前崩溃，消息就会丢。常用解法是 Transactional Outbox：在同一数据库事务中写订单和事件表，再由独立发布器投递 Kafka；只有收到 Broker 成功确认后，才把事件标记为已发送。发布器可能重复发送，因此事件必须带稳定的 `eventId`。

## Broker：`acks=all` 还需要 ISR 门槛

`acks=all` 等待的是**当前 ISR**，并不要求副本数永远达到设计值。若三副本主题只剩 Leader 仍在 ISR，而 `min.insync.replicas=1`，单副本也能确认成功。

典型可靠性组合是：

```bash
bin/kafka-topics.sh --bootstrap-server kafka-1:9092 \
  --create --topic order-created --partitions 12 --replication-factor 3 \
  --config min.insync.replicas=2 \
  --config unclean.leader.election.enable=false
```

其含义是：正常情况下 ISR 中全部副本都要确认；ISR 少于 2 时，Producer 收到 `NotEnoughReplicas` 一类错误，而不是继续接受只有一份的数据。这里要接受一个现实取舍：**宁可暂时写失败，也不把可能丢失的数据伪装成成功**。

还要注意三个边界：

- 副本应跨故障域部署；三副本都在同一磁盘或机架，数量没有意义；
- Kafka 的确认与操作系统、磁盘和跨地域灾备不是同一层保证，相关性故障仍需备份或跨集群复制；
- `unclean.leader.election.enable=true` 能在极端故障时更快恢复可用，但可能截断未同步的数据。

## 消费端：业务完成后再提交位点

`enable.auto.commit=true` 会在后台周期性提交位点。若位点已提交、业务处理随后失败，重启后消费者会从更后位置恢复，形成真正的消费丢失。

可靠消费应关闭自动提交，并把顺序固定为：

```text
poll → 执行业务事务 → 事务成功 → 提交位点
```

```java
props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);

try (KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props)) {
    consumer.subscribe(List.of("order-created"));

    while (true) {
        ConsumerRecords<String, String> records = consumer.poll(Duration.ofSeconds(1));
        for (ConsumerRecord<String, String> record : records) {
            // eventId 建唯一约束；重复投递时直接返回已处理结果
            orderEventService.handleIdempotently(record.key(), record.value());
        }

        // 只提交已成功处理的批次；失败时不推进位点，让消息能够重放
        consumer.commitSync();
    }
}
```

这段代码仍有一个窗口：数据库已提交，但进程在 `commitSync()` 前崩溃，消息会再次消费。所以正确目标不是“永不重复”，而是“重复不会产生第二次扣款”。批量消费还要避免一条失败消息带过后续未处理记录；可按分区维护已完成位点，或在失败时 `seek` 回准确位置。

## Exactly-once 的真实边界

Kafka 事务可以把“写多个 Kafka 分区”和“提交已消费位点”放进同一事务。消费者设置 `isolation.level=read_committed` 后，只读取已提交的事务记录。这适合 Kafka → 计算 → Kafka：

```text
poll
→ beginTransaction
→ produce result
→ sendOffsetsToTransaction
→ commitTransaction
```

但它不能让 MySQL 更新、HTTP 调用与 Kafka 位点自动成为一个原子事务。外部副作用仍需选择：

- 数据库写入：Inbox 表或业务唯一约束；
- DB → Kafka：Transactional Outbox；
- 外部 API：稳定幂等键 + 状态查询 + 有界重试；
- 无法幂等的操作：人工补偿与审计，不承诺恰好一次。

## 失败处理与观测

不要把无限重试当作可靠性。可恢复异常做有界退避；不可恢复数据错误进入隔离主题，并保留原 Topic、Partition、Offset、异常类型和事件 ID。隔离消息必须有重放工具和权限审计，否则只是换了位置的丢失。

至少观察以下信号：

| 环节 | 关键指标或事件 | 说明 |
|---|---|---|
| Producer | 发送错误率、重试率、超时、回调失败 | 发现应用到 Broker 的断点 |
| Broker | ISR 缩减、未充分复制分区、离线分区 | 发现副本安全余量下降 |
| Consumer | Lag、提交失败、重平衡、处理失败 | 区分“没消费”与“消费失败” |
| 业务 | eventId 重复数、Outbox 积压、隔离主题积压 | 验证端到端结果是否闭环 |

可靠性必须用故障演练验证：发送过程中停止 Leader、缩减 ISR、在数据库提交后杀死消费者、制造毒消息，再确认消息最终可达、重复被幂等吸收、位点没有越过失败记录。

## 发布检查清单

1. Producer 显式使用 `acks=all` 与幂等发送，并处理最终失败；
2. Topic 副本跨故障域，`min.insync.replicas` 与副本数匹配；
3. 非干净 Leader 选举保持关闭，除非业务明确接受数据回退；
4. DB 到 Kafka 使用 Outbox，事件 ID 稳定；
5. Consumer 关闭自动提交，业务成功后才推进位点；
6. 业务写入有唯一约束或状态机，能够安全重放；
7. 隔离消息可定位、可审计、可重放；
8. 监控覆盖生产错误、ISR、Lag、Outbox 和业务去重；
9. 上线前演练 Leader 故障、消费者崩溃和毒消息。

## 总结

Kafka 消息不丢失的核心不是堆配置，而是让每一段都满足同一个原则：**成功有证据，失败可重试，重试可去重，结果可核对**。

`acks=all`、幂等 Producer、三副本与 ISR 门槛守住 Kafka 内部持久性；先处理后提交守住消费恢复；Outbox、唯一约束和状态机补齐 Kafka 之外的事务断点。只有把这三层连起来，“不丢失”才是可演练、可观测的工程结论。

参考资料：

- [Apache Kafka 4.3.1 Producer 配置](https://kafka.apache.org/43/configuration/producer-configs/)
- [Apache Kafka 4.3.1 Broker 配置](https://kafka.apache.org/43/configuration/broker-configs/)
- [Apache Kafka 4.3.1 Topic 配置](https://kafka.apache.org/43/configuration/topic-configs/)
- [Apache Kafka 4.3.1 Consumer 配置](https://kafka.apache.org/43/configuration/consumer-configs/)
- [Apache Kafka：Message Delivery Semantics](https://kafka.apache.org/43/design/design/)
