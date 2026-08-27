---
title: RabbitMQ 延迟消息工程实践：TTL、死信与插件退场
date: 2026-08-27
category: MQ
cover: /images/posts/rabbitmq-delayed-message-ttl-dlx-engineering-knowledge-map.webp
tags: [rabbitmq, delayed-message, ttl, dead-letter-exchange, spring-amqp, java]
excerpt: RabbitMQ 延迟消息不是“设置一个过期时间”这么简单。本文基于 RabbitMQ 4.3，说明 TTL 与死信交换的真实语义、同队列头阻塞、延迟桶设计、至少一次转发、消费幂等，以及旧 delayed-message 插件退场后的选型边界。
---

# RabbitMQ 延迟消息工程实践：TTL、死信与插件退场

<img src="/images/posts/rabbitmq-delayed-message-ttl-dlx-engineering-knowledge-map.webp" alt="RabbitMQ 延迟消息工程实践：TTL、死信与插件退场知识串联图" style="border-radius: 10px;" />

RabbitMQ 延迟消息不是“设置一个过期时间”这么简单。本文基于 RabbitMQ 4.3，说明 TTL 与死信交换的真实语义、同队列头阻塞、延迟桶设计、至少一次转发、消费幂等，以及旧 delayed-message 插件退场后的选型边界。

## 先给结论：把延迟队列当粗粒度定时器，不要当任务数据库

开源 RabbitMQ 4.3 中，常见延迟方案应按业务语义选择：

| 需求 | 更合适的方案 | 关键边界 |
| --- | --- | --- |
| 5 秒、30 秒、5 分钟等有限档位 | TTL 延迟桶 + Dead Letter Exchange | 简单、可观测，但到期时间不是精确定时承诺 |
| 每条消息任意短延迟 | 不再为新系统引入旧 `rabbitmq_delayed_message_exchange` | 官方仓库已归档且不再维护 |
| 按天、月调度，支持取消、改期、查询 | 数据库任务表 + 调度器，到期后再发 MQ | RabbitMQ 负责交付，不负责长期任务管理 |
| 商业版且需要海量延迟积压 | 评估 Tanzu RabbitMQ delayed queues | 仍须验证容量、交付与故障语义 |

本文以 RabbitMQ 4.3 官方文档为基线，核对日期为 2026-08-27。RabbitMQ 团队已在 2026-04-16 归档 delayed-message 插件仓库，并明确说明项目不再维护；旧系统可以按已验证版本维持，但新系统不应继续把它当作默认方案。

## TTL + DLX 的本质是“先暂存，再重新发布”

延迟链路由三个角色组成：

1. **延迟交换机**：按延迟档位把消息路由到对应延迟队列；
2. **延迟队列**：没有消费者，消息驻留超过队列 TTL 后过期；
3. **死信交换机**：接收过期消息，再路由到真正的业务队列。

```text
Publisher
   │ routingKey=delay.30s
   ▼
delay.exchange ──→ delay.queue.30s（无消费者，TTL=30s）
                                  │ 消息过期后 dead-letter
                                  ▼
                             work.exchange
                                  │
                                  ▼
                           work.queue ──→ Consumer
```

这里的 TTL 是“消息最多能在当前队列存活多久”，不是独立计时器。DLX 也不是特殊队列，而是普通交换机；消息因过期、拒绝、队列长度限制或仲裁队列投递次数超限而成为死信时，RabbitMQ 会把它重新发布到配置的 DLX。

因此链路至少有两次发布：生产者发布到延迟队列，Broker 再从延迟队列发布到工作队列。任何“消息绝不会丢”的设计都必须分别验证这两个交接点。

## 为什么不要在同一队列混用任意 per-message TTL

AMQP 0-9-1 允许生产者通过字符串形式的 `expiration` 为每条消息设置 TTL，但 RabbitMQ 官方文档说明：过期消息通常要到达队头时才会被实际移除或死信转发。

假设先后发布：

```text
消息 A：TTL=10 分钟，先入队
消息 B：TTL=5 秒，后入队
```

5 秒后 B 虽然已经过期，却可能被尚未过期的 A 挡在队列后方，不能立即进入 DLX。这是典型的队头阻塞。延迟要求越离散，实际触发顺序越不可预测，过期消息还会继续占用资源并出现在队列统计中。

工程上更稳妥的做法是使用少量**固定延迟桶**：同一个延迟队列里的消息共享 queue-level TTL，先入先出不会被不同到期时间打乱。业务若要求任意时间点、取消和改期，就把计划状态留在数据库，不要创建成千上万个 RabbitMQ 队列模拟日历。

## 先定义 Java 数据结构，再写发布逻辑

下面以订单超时关闭为例。应用只开放三个延迟档位，并把业务截止时间写入消息，避免消费者只相信 Broker 的停留时间。

```java
public enum DelayLevel {
    FIVE_SECONDS("delay.5s", java.time.Duration.ofSeconds(5)),
    THIRTY_SECONDS("delay.30s", java.time.Duration.ofSeconds(30)),
    FIVE_MINUTES("delay.5m", java.time.Duration.ofMinutes(5));

    private final String routingKey;
    private final java.time.Duration duration;

    DelayLevel(String routingKey, java.time.Duration duration) {
        this.routingKey = routingKey;
        this.duration = duration;
    }

    public String routingKey() {
        return routingKey;
    }

    public java.time.Duration duration() {
        return duration;
    }
}

public record DelayedTask(
        String taskId,               // 稳定幂等键，重试时不能重新生成
        String taskType,             // 例如 ORDER_CLOSE
        String aggregateId,          // 例如订单号
        java.time.Instant createdAt,
        java.time.Instant notBefore, // 业务最早执行时间
        int scheduleAttempt          // 防止异常回流形成无限循环
) {
    public DelayedTask {
        if (taskId == null || taskId.isBlank()) {
            throw new IllegalArgumentException("taskId 不能为空");
        }
        if (scheduleAttempt < 0 || scheduleAttempt > 3) {
            throw new IllegalArgumentException("scheduleAttempt 超出上限");
        }
    }
}
```

`taskId` 标识同一个业务计划，生产确认超时后重发仍沿用它；`notBefore` 是业务时间边界，便于诊断延迟和时钟问题；`scheduleAttempt` 只限制调度异常，不应与业务重试次数混用。

## Spring AMQP 声明三个延迟桶

下面的声明便于完整展示拓扑。RabbitMQ 官方更推荐用 policy 配置 TTL 和 DLX，因为硬编码 `x-arguments` 变更时通常需要删除并重建队列；生产环境应由运维先创建 policy，再由应用只声明稳定的交换机、队列和绑定。

```java
@org.springframework.context.annotation.Configuration
public class DelayedTaskTopology {
    public static final String DELAY_EXCHANGE = "task.delay.exchange";
    public static final String WORK_EXCHANGE = "task.work.exchange";
    public static final String WORK_QUEUE = "task.work.queue";
    public static final String WORK_ROUTING_KEY = "task.ready";

    @org.springframework.context.annotation.Bean
    public org.springframework.amqp.core.Declarables delayedTaskDeclarables() {
        var delayExchange = new org.springframework.amqp.core.DirectExchange(
                DELAY_EXCHANGE, true, false);
        var workExchange = new org.springframework.amqp.core.DirectExchange(
                WORK_EXCHANGE, true, false);

        var workQueue = org.springframework.amqp.core.QueueBuilder
                .durable(WORK_QUEUE)
                .quorum()
                .build();

        java.util.List<org.springframework.amqp.core.Declarable> declarations =
                new java.util.ArrayList<>();
        declarations.add(delayExchange);
        declarations.add(workExchange);
        declarations.add(workQueue);
        declarations.add(org.springframework.amqp.core.BindingBuilder
                .bind(workQueue).to(workExchange).with(WORK_ROUTING_KEY));

        for (DelayLevel level : DelayLevel.values()) {
            String queueName = "task." + level.routingKey() + ".queue";
            var delayQueue = org.springframework.amqp.core.QueueBuilder
                    .durable(queueName)
                    .quorum()
                    .ttl(level.duration().toMillis())
                    .deadLetterExchange(WORK_EXCHANGE)
                    .deadLetterRoutingKey(WORK_ROUTING_KEY)
                    .build();

            declarations.add(delayQueue);
            declarations.add(org.springframework.amqp.core.BindingBuilder
                    .bind(delayQueue).to(delayExchange).with(level.routingKey()));
        }
        return new org.springframework.amqp.core.Declarables(declarations);
    }
}
```

三个延迟队列都**不能配置消费者**。一旦消费者提前取走消息，TTL + DLX 的延迟机制就失去意义。部署时还要保证 `work.exchange` 与工作队列在消息到期前已经存在；DLX 不存在时，普通 dead-letter 转发可能直接丢失消息。

若用 policy 管理延迟桶，至少配置：

```bash
# 示例只展示 30 秒桶；其他档位用不同匹配规则和 TTL
rabbitmqctl set_policy delay-30s '^task\.delay\.30s\.queue$' \
  '{"message-ttl":30000,"dead-letter-exchange":"task.work.exchange","dead-letter-routing-key":"task.ready","dead-letter-strategy":"at-least-once","overflow":"reject-publish"}' \
  --apply-to quorum_queues
```

仲裁队列的 `at-least-once` dead-letter 策略不是默认值。RabbitMQ 4.3 要求同时设置 `dead-letter-strategy=at-least-once`、`overflow=reject-publish` 和 DLX；还应设置队列长度或字节上限，防止目标队列不可用时死信长期积压。

## 发布端：稳定 ID、持久化与 Confirm 缺一不可

```java
@org.springframework.stereotype.Service
public class DelayedTaskPublisher {
    private final org.springframework.amqp.rabbit.core.RabbitTemplate rabbitTemplate;

    public DelayedTaskPublisher(
            org.springframework.amqp.rabbit.core.RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    public java.util.concurrent.CompletableFuture<Void> schedule(
            DelayedTask task, DelayLevel level) {
        var correlation = new org.springframework.amqp.rabbit.connection.CorrelationData(
                task.taskId());

        rabbitTemplate.convertAndSend(
                DelayedTaskTopology.DELAY_EXCHANGE,
                level.routingKey(),
                task,
                message -> {
                    var properties = message.getMessageProperties();
                    properties.setMessageId(task.taskId());
                    properties.setDeliveryMode(
                            org.springframework.amqp.core.MessageDeliveryMode.PERSISTENT);
                    properties.setHeader("task-type", task.taskType());
                    return message;
                },
                correlation
        );

        return correlation.getFuture().thenCompose(confirm -> {
            if (confirm.ack()) {
                return java.util.concurrent.CompletableFuture.completedFuture(null);
            }
            return java.util.concurrent.CompletableFuture.failedFuture(
                    new IllegalStateException("延迟任务未被 Broker 接管: " + confirm.reason()));
        });
    }
}
```

发布端仍要开启 correlated Publisher Confirm 和 mandatory Return。Confirm 超时代表结果未知，不代表消息一定未进入队列；重发可能制造重复，因此消费者必须幂等。涉及“订单提交后一定创建关闭任务”时，应使用 Outbox 把订单状态和待发布事件放进同一本地事务，再由发布器异步投递。

## 消费端：先校验计划状态，再产生副作用

取消任务不能靠“从队列中删除某个 messageId”。RabbitMQ 队列不适合作为可查询、可改期的任务表。数据库应保存 `taskId`、目标时间和 `SCHEDULED/CANCELLED/EXECUTED` 状态；消息到达后再次读取状态，只有仍有效的计划才能执行业务。

```java
@org.springframework.stereotype.Component
public class DelayedTaskConsumer {
    private final ScheduledTaskRepository taskRepository;
    private final OrderService orderService;

    public DelayedTaskConsumer(
            ScheduledTaskRepository taskRepository,
            OrderService orderService) {
        this.taskRepository = taskRepository;
        this.orderService = orderService;
    }

    @org.springframework.amqp.rabbit.annotation.RabbitListener(
            queues = DelayedTaskTopology.WORK_QUEUE)
    @org.springframework.transaction.annotation.Transactional
    public void handle(DelayedTask message) {
        ScheduledTaskRow row = taskRepository.lockByTaskId(message.taskId())
                .orElseThrow(() -> new IllegalStateException("调度记录不存在"));

        if (row.status() == TaskStatus.CANCELLED
                || row.status() == TaskStatus.EXECUTED) {
            return; // 重复投递或任务已取消，不再产生副作用
        }
        if (java.time.Instant.now().isBefore(row.notBefore())) {
            throw new IllegalStateException("消息早于业务截止时间到达");
        }

        // 更新语句还应带业务状态条件，例如只允许关闭 WAITING_PAYMENT 订单
        orderService.closeIfWaitingPayment(row.aggregateId());
        taskRepository.markExecuted(row.taskId(), java.time.Instant.now());
    }
}
```

`lockByTaskId` 可以用行锁，也可以使用带状态条件的原子更新。关键是“业务状态变更 + 任务置为已执行”在同一数据库事务中完成。消费者在事务提交后 Ack；若提交后、Ack 前连接中断，RabbitMQ 会再次投递，但 `EXECUTED` 状态会吸收重复。

## DLX 的可靠性边界

RabbitMQ 默认的 dead-letter 重新发布没有内部 Publisher Confirm。消息从源队列移除后，若目标队列不可用，可能在两者之间丢失。

对不能丢的延迟任务，源延迟队列使用仲裁队列并显式启用 `at-least-once` dead-letter。此模式由内部消费者等待目标队列 Confirm 后再确认源消息，但代价同样明确：

- 目标 DLX 不存在、无法路由或目标队列拒绝时，源队列会保留并重试；
- 重试可能让目标队列出现重复消息；
- 死信在确认前继续占用源队列资源，需要长度和磁盘告警；
- 消息必须以 persistent 模式发布，目标队列也必须 durable；
- 从 `at-least-once` 切回 `at-most-once` 会删除尚未完成转发的死信。

所以“至少一次转发”仍然不等于“业务恰好执行一次”。Broker 保证交付，数据库状态机保证业务效果。

## delayed-message 插件为什么不再是默认答案

旧插件通过 `x-delayed-message` 交换机和 `x-delay` 毫秒头实现每条消息不同延迟，短延迟场景使用方便；但 RabbitMQ 团队现在已明确标记它不再维护，并给出以下边界：

- 延迟消息只在当前节点保存一份，节点丢失可能丢消息；
- 不适合数十万、数百万级延迟积压；
- 只尝试一次到期发布，且不支持可靠的 mandatory Return；
- 设计目标是秒、分、小时，最多一两天，不是长期调度器；
- RabbitMQ 4.3 开发周期移除了它依赖的 Mnesia 架构基础。

这不意味着在线旧系统必须立刻停机迁移，而是应该冻结已验证的 RabbitMQ/插件版本组合，盘点节点故障时的消息风险，并把新业务迁到 TTL 延迟桶、商业 delayed queues 或数据库调度器。不要因为 Spring AMQP 仍保留 `setDelay` API，就误判底层插件仍处于维护状态。

## 上线前检查清单

1. 延迟档位是否有限，是否真的不需要取消、改期和长期查询；
2. 每个延迟桶是否无消费者，并使用统一 queue-level TTL；
3. DLX、路由键和目标队列是否在消息到期前存在；
4. 延迟队列是否启用仲裁复制、`at-least-once` dead-letter 和 `reject-publish`；
5. 生产者是否同时处理 Confirm、Return、超时和 Outbox 重发；
6. 消费者是否用稳定 `taskId`、业务状态条件和本地事务实现幂等；
7. 是否监控延迟桶深度、最老消息年龄、dead-letter 数量、目标不可路由、磁盘与 Confirm 延迟；
8. 压测是否覆盖目标队列不可用、节点重启、重复投递、积压恢复和时钟偏差。

## 总结

RabbitMQ 延迟消息的可靠实现不是一个 `expiration` 参数，而是一条两阶段交付链路。有限档位用 queue-level TTL 延迟桶隔离到期时间，再由 DLX 转入工作队列；重要任务用仲裁队列的 `at-least-once` dead-letter，并在消费端以数据库状态机吸收重复。

真正需要任意时间、取消、改期和长期留存时，让数据库或调度器保存计划，RabbitMQ 只在任务到期后承担消息交付。这样才能把“延迟多久”和“业务是否执行一次”拆成两个可验证的责任边界。

## 参考资料

- [RabbitMQ 4.3：Time-To-Live and Expiration](https://www.rabbitmq.com/docs/ttl)
- [RabbitMQ 4.3：Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx)
- [RabbitMQ 4.3：Quorum Queues](https://www.rabbitmq.com/docs/quorum-queues)
- [RabbitMQ delayed-message 插件归档说明](https://github.com/rabbitmq/rabbitmq-delayed-message-exchange/blob/main/README.md)
- [Spring AMQP：Delayed Message Exchange](https://docs.spring.io/spring-amqp/reference/4.2/amqp/delayed-message-exchange.html)
