---
title: RabbitMQ 可靠投递：Confirm、Return 与消费幂等
date: 2026-08-04
category: MQ
cover: /images/posts/rabbitmq-reliable-delivery-knowledge-map.webp
tags: [rabbitmq, spring-amqp, message-queue]
excerpt: 从生产者 Confirm、mandatory Return、消费确认到 Outbox 与幂等表，建立 RabbitMQ 端到端至少一次投递链路。
---

# RabbitMQ 可靠投递：Confirm、Return 与消费幂等
<img src="/images/posts/rabbitmq-reliable-delivery-knowledge-map.webp" alt="RabbitMQ 可靠投递：Confirm、Return 与消费幂等知识串联图" style="border-radius: 10px;" />

在订单创建后发送“扣减库存”消息，看起来只需要一次 `convertAndSend`。但生产环境中的失败窗口远不止一次网络调用：数据库可能已经提交而消息尚未发送，消息可能进入交换机却没有匹配队列，消费者也可能完成业务后在确认前宕机。

真正的可靠投递不是打开某一个开关，而是逐段完成责任交接：业务数据库把事件交给生产者，生产者把消息交给 RabbitMQ，RabbitMQ 把消息交给消费者，消费者再把业务结果持久化。每一段都需要独立的确认、重试和去重机制。

> 本文以 **RabbitMQ 4.2、AMQP 0-9-1、Spring AMQP 4.1 API** 为主要适用范围。Spring Boot 配置项以 2026-08-04 的当前官方属性为准；使用 RabbitMQ 3.x 或旧版 Spring AMQP 时，应重新核对仲裁队列、投递次数限制及回调 API。

## 一、先定义“可靠”到底指什么

消息链路中常见的三种交付语义如下。

| 语义 | 可能丢失 | 可能重复 | 实现代价 |
|---|---:|---:|---|
| 至多一次（At-most-once） | 是 | 否 | 最低，发送或处理失败后不重试 |
| 至少一次（At-least-once） | 尽量避免 | 是 | 需要确认、重试和消费幂等 |
| 恰好一次（Exactly-once） | 否 | 否 | 通常只能在有限系统边界内成立 |

RabbitMQ 的生产者确认和消费者手动确认适合构建**至少一次**链路。网络中断时，生产者可能无法判断消息是否已被 Broker 接收；消费者也可能在数据库提交后、发送 Ack 前宕机。此时为了不丢消息，只能重试，而重试就会带来重复。

因此，工程上更准确的目标是：

```text
至少一次消息投递 + 幂等业务处理 = 对外只产生一次业务效果
```

不要把“Broker 中只有一份消息”与“业务只生效一次”混为一谈。后者才是订单、支付、库存等系统真正需要保证的结果。

## 二、四段责任交接与三个确认机制

一条完整链路可以拆成四段：

```text
业务事务 → Outbox → Exchange → Queue → Consumer → 业务事务
                          ↑          ↑
                    Confirm/Return   Consumer Ack
```

其中三个容易混淆的机制彼此独立。

| 机制 | 确认方向 | 能证明什么 | 不能证明什么 |
|---|---|---|---|
| Publisher Confirm | RabbitMQ → 生产者 | Broker 已接管该次发布，或明确 Nack | 消息一定路由成功、消费者已处理 |
| mandatory Return | RabbitMQ → 生产者 | 消息无法从交换机路由到任何队列 | Broker 是否已经持久化其他可路由消息 |
| Consumer Ack | 消费者 → RabbitMQ | 当前投递已处理，队列可以删除消息 | 生产者是否收到 Confirm、业务是否天然幂等 |

RabbitMQ 官方文档明确说明 Publisher Confirm 与 Consumer Ack 是正交的：前者只覆盖生产者到节点及目标队列的责任交接，后者只覆盖 Broker 到消费者的处理确认。

### Confirm 为什么不能替代 Return

当交换机存在、但 routing key 没有匹配任何队列时，RabbitMQ 已经正确处理了发布请求，因此仍可能向生产者发送 Ack。若消息设置了 `mandatory=true`，Broker 会先发送 `basic.return`，再发送 Confirm。

所以生产端判断成功必须同时满足：

```text
confirm.ack == true && returnedMessage == null
```

只检查 Confirm Ack 会把“成功到达交换机但无人接收”的消息误判为发送成功。

## 三、Spring Boot 开启相关能力

下面的配置启用关联式 Confirm、Return 和消费者手动确认：

```yaml
spring:
  rabbitmq:
    addresses: rabbitmq-1:5672,rabbitmq-2:5672
    username: ${RABBITMQ_USERNAME}
    password: ${RABBITMQ_PASSWORD}

    publisher-confirm-type: correlated # 每条消息通过 CorrelationData 关联确认结果
    publisher-returns: true             # 接收无法路由的 mandatory 消息

    template:
      mandatory: true                   # 无匹配队列时返回生产者，而不是静默丢弃
      observation-enabled: true         # 接入 Micrometer Observation 时记录发送链路

    listener:
      simple:
        acknowledge-mode: manual        # 业务提交成功后再显式 Ack
        prefetch: 50                     # 每个消费者最多保留 50 条未确认消息
        default-requeue-rejected: false  # 未分类异常默认不无限回队列
        observation-enabled: true
```

Spring AMQP 4.1 的 Confirm 类型共有三种：

- `none`：关闭 Publisher Confirm，也是连接工厂的默认行为；
- `simple`：在受控 Channel 操作中调用 `waitForConfirms()` 或 `waitForConfirmsOrDie()`；
- `correlated`：通过 `CorrelationData` 把异步确认关联到具体消息，适合业务事件发布。

`simple` 模式逐条同步等待会明显限制吞吐。高并发发布应使用 `correlated` 异步接收结果，或者批量发送后统一等待尚未完成的确认。

## 四、先把交换机、队列和消息持久化语义对齐

可靠发布不能只配置 Confirm。交换机和队列需要持久化，消息也要使用持久化投递模式。对需要复制与故障恢复的业务队列，可以使用仲裁队列（Quorum Queue）。

```java
@Configuration
public class OrderRabbitTopology {

    public static final String ORDER_EXCHANGE = "mall.order.event";
    public static final String ORDER_QUEUE = "mall.order.created";
    public static final String ORDER_ROUTING_KEY = "order.created";
    public static final String ORDER_DLX = "mall.order.dlx";

    @Bean
    public DirectExchange orderExchange() {
        // durable=true，Broker 重启后仍保留交换机
        return new DirectExchange(ORDER_EXCHANGE, true, false);
    }

    @Bean
    public DirectExchange orderDeadLetterExchange() {
        return new DirectExchange(ORDER_DLX, true, false);
    }

    @Bean
    public Queue orderQueue() {
        return QueueBuilder.durable(ORDER_QUEUE)
                // 仲裁队列基于 Raft 复制，适合数据安全优先的业务消息
                .withArgument("x-queue-type", "quorum")
                .deadLetterExchange(ORDER_DLX)
                .deadLetterRoutingKey("order.created.failed")
                .build();
    }

    @Bean
    public Binding orderBinding(Queue orderQueue, DirectExchange orderExchange) {
        return BindingBuilder.bind(orderQueue)
                .to(orderExchange)
                .with(ORDER_ROUTING_KEY);
    }
}
```

RabbitMQ 4.2 的仲裁队列始终是 durable，并把消息复制到多数派成员。对于发送到仲裁队列的消息，Broker Confirm 表示队列 Leader 已获得多数派副本的接受。但即便如此，生产者仍必须等待 Confirm；没有被确认的消息不在仲裁队列的数据安全保证内。

经典队列的 durable 属性、消息的 persistent 属性也不是 Confirm 的替代品。它们解决“Broker 接管之后如何保存”，Confirm 解决“生产者何时知道 Broker 已接管”。

## 五、生产者：同时处理 Ack、Nack、Return 与超时

下面的发布器为每个业务事件生成稳定的 `eventId`，并通过 `CorrelationData` 获取异步结果。

```java
@Service
public class OrderEventPublisher {

    private final RabbitTemplate rabbitTemplate;

    public OrderEventPublisher(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    public CompletableFuture<Void> publish(OrderCreatedEvent event) {
        String eventId = event.eventId();
        CorrelationData correlation = new CorrelationData(eventId);

        rabbitTemplate.convertAndSend(
                OrderRabbitTopology.ORDER_EXCHANGE,
                OrderRabbitTopology.ORDER_ROUTING_KEY,
                event,
                message -> {
                    // messageId 同时作为日志关联键和消费幂等键
                    message.getMessageProperties().setMessageId(eventId);
                    // 持久化消息可以在 durable 队列中跨 Broker 重启保留
                    message.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);
                    return message;
                },
                correlation
        );

        return correlation.getFuture()
                .orTimeout(5, TimeUnit.SECONDS)
                .thenCompose(confirm -> {
                    ReturnedMessage returned = correlation.getReturned();

                    if (returned != null) {
                        // Return 表示交换机存在，但消息没有路由到任何队列
                        return CompletableFuture.failedFuture(new IllegalStateException(
                                "消息无法路由，eventId=" + eventId
                                        + "，replyText=" + returned.getReplyText()));
                    }
                    if (!confirm.ack()) {
                        // Nack 表示 Broker 无法承担该消息，后续应进入有界重试
                        return CompletableFuture.failedFuture(new IllegalStateException(
                                "RabbitMQ 拒绝消息，eventId=" + eventId
                                        + "，cause=" + confirm.reason()));
                    }

                    return CompletableFuture.completedFuture(null);
                });
    }
}
```

Spring AMQP 保证在 Return 与 Correlated Confirm 同时启用时，`CorrelationData.returned` 会先于 Confirm Future 完成而填充，因此可以在 Future 回调中统一判断。

这里的 5 秒只是示例。持久化消息的 Confirm 可能受磁盘批量落盘、队列复制和网络影响，生产环境应基于 P99 确认延迟设置阈值。超时代表“结果未知”，不是“消息一定失败”：直接生成新事件 ID 重发，会让下游难以去重；重试同一业务事件时应保持原 `eventId`。

## 六、数据库与 MQ 之间用 Transactional Outbox 补齐

即使生产端正确处理 Confirm，下面两种双写顺序仍然有漏洞：

1. 先提交订单，再发送消息：数据库提交后进程宕机，消息永远未发送；
2. 先发送消息，再提交订单：消息已被消费，但订单事务最终回滚。

Transactional Outbox 的做法是，在同一个本地数据库事务中写订单与待发送事件：

```sql
CREATE TABLE mq_outbox_event (
    event_id      VARCHAR(64)  NOT NULL COMMENT '全局稳定的事件 ID',
    aggregate_id  VARCHAR(64)  NOT NULL COMMENT '订单等聚合根 ID',
    event_type    VARCHAR(64)  NOT NULL COMMENT '事件类型',
    payload       JSON         NOT NULL COMMENT '不可变事件负载',
    status        VARCHAR(16)  NOT NULL DEFAULT 'NEW' COMMENT 'NEW/SENDING/SENT',
    retry_count   INT          NOT NULL DEFAULT 0 COMMENT '已重试次数',
    next_retry_at DATETIME(3)  NOT NULL COMMENT '下次可发送时间',
    created_at    DATETIME(3)  NOT NULL,
    PRIMARY KEY (event_id),
    KEY idx_outbox_poll (status, next_retry_at)
) COMMENT='消息发送箱';
```

后台 Relay 轮询 `NEW` 事件，发布后等待 Confirm 和 Return 结果，只有 `ack=true` 且没有 Return 时才标记为 `SENT`。超时、连接异常或 Nack 使用指数退避重试，并设置最大重试次数和告警。

Relay 在“Broker 已接收，但数据库尚未标记 SENT”时宕机，恢复后会再次发布同一个事件，所以 Outbox 解决的是不丢消息，并不消除重复。`event_id` 必须贯穿 Outbox、RabbitMQ `messageId`、消费幂等表和日志链路。

对于高吞吐场景，可以用 CDC 读取 Outbox 变更代替轮询，但责任边界不变：数据库提交是事件产生的事实，发布确认是事件离开 Outbox 的依据。

## 七、消费者：业务提交后 Ack，并用唯一键去重

消费者最危险的顺序是“先 Ack、后提交业务”。如果 Ack 成功后数据库事务失败，RabbitMQ 已删除消息，业务却没有完成。更安全的顺序是：

```text
收到消息 → 幂等检查与业务事务提交 → basic.ack
```

这仍有一个窗口：数据库已提交，但 Ack 尚未发出时进程宕机。RabbitMQ 会重新投递，所以必须把消费去重与业务更新放进同一个数据库事务。

```sql
CREATE TABLE mq_consumed_message (
    event_id      VARCHAR(64)  NOT NULL COMMENT '生产者生成的稳定事件 ID',
    consumer_name VARCHAR(64)  NOT NULL COMMENT '消费组或业务消费者名称',
    consumed_at   DATETIME(3)  NOT NULL,
    PRIMARY KEY (event_id, consumer_name)
) COMMENT='消息消费幂等记录';
```

```java
@Service
public class OrderCreatedConsumer {

    private final InventoryApplicationService inventoryService;

    public OrderCreatedConsumer(InventoryApplicationService inventoryService) {
        this.inventoryService = inventoryService;
    }

    @RabbitListener(queues = OrderRabbitTopology.ORDER_QUEUE)
    public void onMessage(OrderCreatedEvent event, Message message, Channel channel)
            throws IOException {
        long deliveryTag = message.getMessageProperties().getDeliveryTag();

        try {
            // 方法内部用一个本地事务写入幂等记录并扣减库存
            inventoryService.consumeOrderCreated(event);

            // 只有业务事务成功提交后才确认；false 表示只确认当前这一条
            channel.basicAck(deliveryTag, false);
        } catch (PermanentBusinessException ex) {
            // 参数非法、商品不存在等永久错误不应无限重试，拒绝并进入 DLX
            channel.basicReject(deliveryTag, false);
        } catch (Exception ex) {
            // 数据库瞬时故障等可恢复错误允许回队列，但必须配合有界重试
            channel.basicNack(deliveryTag, false, true);
        }
    }
}
```

`consumeOrderCreated` 的事务逻辑应先尝试插入 `(event_id, consumer_name)` 唯一键：插入成功才执行业务；唯一键已存在则把它视为重复消息并直接返回成功。不能只在 Redis 中做去重，因为缓存过期、淘汰或数据库事务回滚都可能让幂等状态与业务结果不一致。

Delivery Tag 只在当前 Channel 内有效，Ack 必须在接收该消息的同一个 Channel 上发送。跨线程保存 Delivery Tag 再使用其他 Channel 确认，会触发 `unknown delivery tag` 并关闭 Channel。

## 八、失败类型必须分层，不能全部 requeue

把所有异常都执行 `basicNack(..., true)` 会制造“毒消息”循环：同一条永远失败的消息不断回到队列头部，消耗 CPU、日志和消费者吞吐。

| 失败类型 | 示例 | 处理建议 |
|---|---|---|
| 瞬时基础设施错误 | 数据库连接闪断、下游短暂超时 | 有界重试，指数退避并加入抖动 |
| 永久业务错误 | 数据格式非法、实体不存在 | 不重回原队列，进入 DLX 等待人工或补偿 |
| 路由配置错误 | routing key 无绑定 | 生产端通过 Return 立即告警，不交给消费端处理 |
| 不确定发布结果 | Confirm 超时、连接断开 | 使用同一 eventId 重发，由消费端幂等兜底 |

RabbitMQ 4.0+ 的仲裁队列默认 Delivery Limit 为 20；超过限制的消息会被丢弃，配置 DLX 后则进入死信链路。不要把默认值当作业务重试策略，生产环境应通过 Policy 明确配置 `delivery-limit` 与 `dead-letter-exchange`，并监控死信队列积压。

需要延迟重试时，可以使用“重试队列 + TTL + DLX”或专门的延迟机制，但应记录原始 `eventId`、首次失败时间、重试次数和最后一次错误。重试消息不能悄悄生成新的业务事件身份。

## 九、按失败窗口验收整条链路

可靠性设计应通过故障点逐项检查，而不是只看正常发送日志。

| 故障窗口 | 预期结果 | 兜底机制 |
|---|---|---|
| 订单事务提交前宕机 | 订单与事件都不存在 | 本地事务回滚 |
| 订单提交后、首次发布前宕机 | 恢复后继续发布 | Outbox Relay |
| 发布后、Confirm 到达前断网 | 可能重复发布但不能丢 | 同 eventId 重试 |
| 交换机存在但无队列绑定 | 生产端识别失败 | mandatory Return |
| Broker 无法接管消息 | 生产端识别失败 | Confirm Nack/超时 |
| 消费事务提交前宕机 | 消息重新投递 | 手动 Ack + 自动 Requeue |
| 消费事务提交后、Ack 前宕机 | 重复投递但业务不重复 | 数据库唯一键幂等 |
| 永久失败反复投递 | 有界退出主队列 | Delivery Limit + DLX |

特别要验证“Confirm Ack 与 Return 同时出现”的不可路由场景，以及“业务已提交但未 Ack”的重复消费场景。这两个窗口最容易被普通联调遗漏。

## 十、可观测性要围绕 eventId 建立

只监控队列长度无法判断消息卡在哪一段。建议至少建立以下指标：

- Outbox 中 `NEW`、`SENDING`、最终失败事件的数量与最老等待时间；
- Publisher Confirm 的 Ack、Nack、超时、Return 数量和 P95/P99 延迟；
- Queue 的 Ready、Unacked、发布速率、投递速率与 Consumer Capacity；
- 消费成功、重复命中、重试、Reject、DLX 数量和处理耗时；
- 连接恢复、Channel 关闭、`unknown delivery tag` 与磁盘/内存告警。

日志中统一输出 `eventId`、`aggregateId`、exchange、routingKey、queue、retryCount 和处理结果。Trace 可以描述一次调用链，但异步消息可能跨越较长时间，稳定的业务事件 ID 才是跨重试、跨进程关联的主键。

告警也要区分原因：Return 持续出现通常是拓扑或 routing key 错误；Confirm 延迟升高可能与磁盘、复制或网络有关；Unacked 上升则更可能是消费者处理变慢、Prefetch 过大或 Ack 未正确发送。

## 十一、常见误区与最佳实践

### 1. 认为 `convertAndSend` 不抛异常就是成功

方法返回只说明消息已交给客户端发送路径，不能证明 Broker 已接管。必须观察 Confirm，启用 mandatory 时还要检查 Return。

### 2. 只设置消息持久化，不使用 Confirm

Persistent 与 durable 描述 Broker 接管后的存储行为。连接可能在消息到达 Broker 前断开，没有 Confirm 时生产者无法知道责任是否完成交接。

### 3. Confirm Ack 后立即认为业务完成

Confirm 不知道消费者是否存在，也不知道库存、支付等业务是否成功。需要业务完成回执时，应设计独立的结果事件或状态查询接口。

### 4. 每次重试都生成新的 eventId

这会让同一业务事件看起来像多条新消息，消费端无法可靠去重。事件身份应在业务事务中生成，并在所有传输重试中保持不变。

### 5. 业务异常全部重新入队

永久错误会形成高频重投。先分类可恢复与不可恢复错误，再配置有界重试、退避、Delivery Limit 和 DLX。

### 6. 把 Ack 放进异步线程

Delivery Tag 属于接收它的 Channel。业务异步化后如果 Channel 已归还连接池，延迟 Ack 很容易使用错误 Channel。需要异步处理时，应使用容器支持的模式并明确 Channel 生命周期，不要手工跨线程确认。

### 7. 让 Outbox 无限增长

Outbox 需要定期归档或清理 `SENT` 记录，对长时间未发送事件告警，并对 Relay 做批量锁定、并发隔离和退避控制。它是可靠性基础设施，不是永久审计仓库。

## 十二、总结

RabbitMQ 可靠投递是一组连续的责任交接，而不是单个配置项。生产端用 Transactional Outbox 解决数据库与 MQ 双写，使用 Correlated Publisher Confirm 判断 Broker 是否接管，再用 mandatory Return 识别无法路由的消息；消费端在业务事务提交后手动 Ack，并通过数据库唯一键承受重复投递。

这条链路的本质是接受分布式系统中的“不确定结果”：无法确认时宁可使用同一 `eventId` 重试，再由幂等业务消除重复效果。最终得到的不是神话式的全局 Exactly-once，而是一套可验证、可重放、可观测的 At-least-once 工程方案。

## 参考资料

- [RabbitMQ 4.2：Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/4.2/confirms)
- [RabbitMQ 4.2：Reliability Guide](https://www.rabbitmq.com/docs/4.2/reliability)
- [RabbitMQ 4.2：Quorum Queues](https://www.rabbitmq.com/docs/4.2/quorum-queues)
- [Spring AMQP 4.1：CorrelationData API](https://docs.spring.io/spring-amqp/docs/current/api/org/springframework/amqp/rabbit/connection/CorrelationData.html)
- [Spring AMQP：RabbitTemplate Publisher Confirms and Returns](https://docs.spring.io/spring-amqp/reference/amqp/template.html)
- [Spring Boot：Common Application Properties](https://docs.spring.io/spring-boot/appendix/application-properties/)
