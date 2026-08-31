---
title: RabbitMQ 消息堆积治理：背压、扩容与过载保护
date: 2026-08-31
category: 后端开发
cover: /images/posts/rabbitmq-backlog-overload-protection-knowledge-map.webp
tags: [rabbitmq, message-queue, backpressure, spring-amqp, observability]
excerpt: RabbitMQ 堆积治理不能只靠增加消费者；先用 ready、unacknowledged、生产/投递速率和消息年龄定位瓶颈，再按下游容量调整并发与预取，并用入口背压、队列上限和失败隔离阻止积压演变为全链路雪崩。
---

# RabbitMQ 消息堆积治理：背压、扩容与过载保护

<img src="/images/posts/rabbitmq-backlog-overload-protection-knowledge-map.webp" alt="RabbitMQ 消息堆积治理：背压、扩容与过载保护知识串联图" style="border-radius: 10px;" />

RabbitMQ 堆积治理不能只靠增加消费者；先用 ready、unacknowledged、生产/投递速率和消息年龄定位瓶颈，再按下游容量调整并发与预取，并用入口背压、队列上限和失败隔离阻止积压演变为全链路雪崩。

## 先说结论：堆积是容量失衡，不是队列容量不够

只要持续一段时间满足“生产速率 > 有效消费速率”，队列就会增长。扩大磁盘或队列上限只能延后故障；盲目增加消费者又可能把数据库、第三方 API 或线程池压垮。

治理顺序应固定为四步：

1. 判断消息停在 Broker 还是消费者进程；
2. 找到限制有效消费速率的真实下游；
3. 在下游安全容量内扩并发、调预取、缩短单条耗时；
4. 给入口、队列和失败消息设置止损边界。

以下内容以 RabbitMQ **4.x 当前官方文档**和 Spring AMQP **4.1.1** 为事实基线，核对日期为 **2026-08-31**。`lazy` 队列模式只属于历史版本：RabbitMQ 3.12 起该配置已被忽略，当前经典队列本身采用低而稳定的内存策略，不能再把“开启惰性队列”当作堆积治理方案。

## 一、先把堆积分成三类

| 现象 | 关键指标 | 常见原因 | 第一动作 |
| --- | --- | --- | --- |
| Broker 待投递 | `messages_ready` 持续增长 | 消费者不足、消费暂停、路由到冷队列 | 检查消费者数、投递速率和消费者容量 |
| 客户端处理中 | `messages_unacknowledged` 很高 | 预取过大、处理慢、ACK 太晚、线程池阻塞 | 降低预取，检查线程池和下游耗时 |
| 反复重投 | redeliver/reject 增长，消息年龄上升 | 毒消息、依赖持续失败、无限 requeue | 限制重试并转入隔离队列 |

`messages_ready` 是仍在队列等待投递的消息；`messages_unacknowledged` 已经发给消费者，但尚未确认。两者都大时，不要只看队列总长度：前者说明 Broker 还在排队，后者说明压力已经搬进消费者内存或执行队列。

还要同时观察：

- `publish_details.rate` 与 `deliver_get_details.rate`：流入是否长期高于流出；
- 最老消息年龄：业务是否已经越过 SLA；
- 消费成功率、P95/P99 耗时和下游连接池等待；
- Broker 的 `mem_alarm`、`disk_free_alarm` 与连接 `flow` 状态。

积压消化时间可以粗估为：

```text
排空时间 ≈ 当前 ready 数 / (有效消费速率 - 当前生产速率)
```

当分母小于等于 0，系统永远排不空，必须降低入口速率或提高有效消费能力。

## 二、扩容前先算下游预算

假设单条消息平均占用一次数据库连接 80 ms，数据库最多允许该业务同时使用 24 个连接，则消费并发不能因为队列很长就任意提高。一个保守起点是：

```text
消费者并发上限 <= min(
  数据库可用连接数,
  下游允许并发数,
  线程池最大工作线程数,
  CPU 或内存预算
)
```

扩容应每次只增加一个小台阶，并观察成功率、下游延迟与队列斜率。若消费速率上升但数据库 P99、锁等待和错误率同时恶化，说明系统已把瓶颈从 RabbitMQ 推到了数据库；继续加消费者只会降低有效吞吐。

优先优化单条处理链路：批量读取、消除 N+1 SQL、缩短事务、给慢查询加索引、把外部调用移出数据库事务，并让幂等记录与业务变更在同一事务内提交。线程池只对可并行且下游有余量的任务有效，不会凭空创造容量。

## 三、并发与预取必须一起调

Spring AMQP 的 `concurrency` 决定消费者数量，`prefetchCount` 决定每个消费者最多持有多少条未确认消息。预取过低会让消费者等待网络；预取过高会造成单实例囤积、内存上涨和分配不均。

```java
import org.springframework.amqp.core.AcknowledgeMode;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OrderConsumerConfig {

    @Bean
    SimpleRabbitListenerContainerFactory orderContainerFactory(
            ConnectionFactory connectionFactory) {
        var factory = new SimpleRabbitListenerContainerFactory();
        factory.setConnectionFactory(connectionFactory);

        // 从 4 个消费者起步，最多弹性扩到 12 个；上限必须小于下游预算。
        factory.setConcurrentConsumers(4);
        factory.setMaxConcurrentConsumers(12);

        // 每个消费者最多持有 20 条未确认消息，避免把积压搬进 JVM。
        factory.setPrefetchCount(20);
        factory.setAcknowledgeMode(AcknowledgeMode.MANUAL);
        return factory;
    }
}
```

调参时可从“单条平均处理时间 × 期望吞吐”反推并发，再用压测寻找能覆盖网络往返、但不会造成明显囤积的最小预取值。大消息、慢任务、严格顺序场景应使用更低预取；`prefetch=0` 表示不设上限，不适合作为堆积时的激进加速开关。

手动 ACK 必须放在业务成功提交之后：

```java
import com.rabbitmq.client.Channel;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Component
public class OrderPaidListener {
    private final OrderPaidService service;

    public OrderPaidListener(OrderPaidService service) {
        this.service = service;
    }

    @RabbitListener(
            queues = "order.paid",
            containerFactory = "orderContainerFactory"
    )
    public void consume(OrderPaidEvent event, Message message, Channel channel)
            throws IOException {
        long tag = message.getMessageProperties().getDeliveryTag();
        try {
            // 内部用 eventId 做幂等，事务提交后才确认消息。
            service.applyOnce(event);
            channel.basicAck(tag, false);
        } catch (RetryableDependencyException ex) {
            // 短暂故障交给有次数和退避上限的重试设施，不在这里无限回队。
            channel.basicNack(tag, false, false);
        } catch (Exception ex) {
            // 数据非法等永久失败直接拒绝，由 DLX 进入隔离队列。
            channel.basicReject(tag, false);
        }
    }
}
```

上例假设队列已配置死信交换机，且短暂故障由带次数上限的重试队列或应用重试机制承接。不要把所有异常都 `requeue=true`，否则毒消息会在热路径无限循环，吞掉消费能力。

## 四、入口背压要早于 Broker 资源告警

RabbitMQ 会用流控降低过快发布连接的速度；节点触发内存或磁盘告警时，也会阻塞发布连接。但这些是 Broker 的自我保护，不是业务容量规划。应用应更早做三层背压：

1. **业务入口**：按租户或业务键限流，非关键任务降级、合并或延后；
2. **发布端**：限制在途发布数量，设置超时，并正确处理 publisher confirm 的 ACK/NACK；
3. **队列端**：用 policy 配置 `max-length` 或 `max-length-bytes`，明确溢出策略。

队列上限只统计 ready 消息，不包含 unacknowledged。默认溢出行为会丢弃或死信队头的旧消息；若配置 `reject-publish`，新发布可被拒绝，开启 publisher confirms 后发布者会收到 `basic.nack`。选择哪种策略必须由业务语义决定：实时状态可保新弃旧，订单和资金事件通常应拒绝入口并保留可审计失败记录。

## 五、故障期间按优先级止血

发生大规模堆积时，按以下顺序操作：

1. 冻结非关键生产者或降低发布速率，先让分母转正；
2. 隔离持续失败的消息，阻断无限重投；
3. 确认下游有余量后分批扩消费者，不一次拉满；
4. 临时关闭耗时但非关键的消费副作用，例如通知或非必要画像更新；
5. 按业务优先级拆队列，避免低价值大流量阻塞关键消息；
6. 以最老消息年龄和排空时间判断恢复，而不是只看 CPU。

不要直接清空队列、批量 ACK 未成功处理的消息，也不要在没有 publisher confirm 和审计记录时把消息搬来搬去。任何丢弃都应有明确业务批准、数量记录、时间范围和补偿方案。

## 六、上线前检查表

- 同时监控 ready、unacknowledged、生产/投递速率和最老消息年龄；
- 消费并发上限受数据库、外部 API、线程池和内存预算约束；
- 预取有界，且经过消息大小和处理耗时压测；
- ACK 在事务成功后发送，消费逻辑可幂等重放；
- 重试有次数、退避和隔离队列，禁止无限 requeue；
- 发布端处理 confirm ACK/NACK、超时与连接阻塞；
- 队列有容量或字节上限，并明确 drop-head、reject-publish 或死信策略；
- 演练过生产突增、消费者全停、数据库变慢、毒消息和磁盘告警。

## 参考资料

- [RabbitMQ Monitoring](https://www.rabbitmq.com/docs/monitoring)
- [RabbitMQ Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/confirms)
- [RabbitMQ Consumer Prefetch](https://www.rabbitmq.com/docs/consumer-prefetch)
- [RabbitMQ Queue Length Limit](https://www.rabbitmq.com/docs/maxlength)
- [RabbitMQ Flow Control](https://www.rabbitmq.com/docs/flow-control)
- [RabbitMQ Classic Lazy Queues 历史说明](https://www.rabbitmq.com/docs/lazy-queues)
- [Spring AMQP Listener Concurrency](https://docs.spring.io/spring-amqp/reference/amqp/listener-concurrency.html)
