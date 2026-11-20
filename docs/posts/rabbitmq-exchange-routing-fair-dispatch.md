---
title: RabbitMQ 交换机路由模型与公平分发：四种类型、默认交换机与 prefetch
date: 2026-11-18
category: 后端开发
cover: /covers/backend.svg
tags: [rabbitmq, amqp, 消息队列, 路由, 消费端治理]
excerpt: "AMQP 0-9-1 的路由由交换机类型与绑定决定：direct 精确匹配、fanout 广播、topic 模式匹配、headers 按消息头匹配；默认交换机是没有名字的 direct，队列名即路由键。消费侧的公平分发不靠平均分配，而靠 prefetch 上限。"
---

# RabbitMQ 交换机路由模型与公平分发：四种类型、默认交换机与 prefetch

<img src="/images/posts/rabbitmq-exchange-routing-fair-dispatch-knowledge-map.png" alt="RabbitMQ 交换机路由模型与公平分发：四种类型、默认交换机与 prefetch知识串联图" style="border-radius: 10px;" />

AMQP 0-9-1 的路由由交换机类型与绑定决定：direct 精确匹配、fanout 广播、topic 模式匹配、headers 按消息头匹配；默认交换机是没有名字的 direct，队列名即路由键。消费侧的公平分发不靠平均分配，而靠 prefetch 上限。

## 先说结论：交换机决定"怎么找队列"

生产者从不直接发消息给队列（默认交换机只是把这个动作伪装成直发）。消息先到交换机，交换机按**类型 + 绑定规则 + 路由键**决定投给零个或多个队列：

- **direct**：绑定键与路由键完全相等才投递，实现单播/多播；
- **fanout**：忽略路由键，投给所有绑定的队列，实现广播；
- **topic**：按 `.` 分段做模式匹配，`*` 匹配一段、`#` 匹配零段或多段；
- **headers**：不看路由键，按消息头属性匹配（`x-match=all/any`）。

没有匹配到任何队列的消息会被**静默丢弃**，除非开启 `mandatory` 返回、配置备用交换机（alternate-exchange）或死信链路。本文以 **RabbitMQ 4.x、AMQP 0-9-1** 为基线，核对日期 **2026-11-20**；RabbitMQ 官方建议新应用优先选择 AMQP 1.0，但 0-9-1 仍是存量系统主流。

## 一、完整分类：四种标准类型 + 默认交换机 + 插件类型

### 1. Direct（直连）

- 绑定键 == 路由键才投递，一对一路由最常用。
- 同一个绑定键可以绑多个队列，实现"同名多播"。
- 典型用途：按事件类型分发到不同业务队列（`order.created` 只进订单服务队列）。

### 2. Fanout（扇出）

- 完全忽略路由键，投给所有绑定的队列。
- 典型用途：配置刷新、缓存失效广播；每个队列有独立消费者时就是发布订阅。
- 注意：队列越多，消息副本越多，磁盘与网络成本按副本数线性增长。

### 3. Topic（主题）

- 路由键以 `.` 分段，例如 `order.paid.cn`；
- 绑定模式中 `*` 代表恰好一段，`#` 代表零段或多段（`audit.events.#` 能匹配 `audit.events` 本身）；
- 绑定模式 `#` 等价于对该绑定的 fanout；
- 典型用途：按区域/业务线/严重级别做多维订阅。

### 4. Headers（头部）

- 按消息头匹配，绑定参数里 `x-match=all` 要求全部匹配，`any` 要求任一匹配；
- 不受路由键长度与分段规则限制，适合"属性组合"筛选；
- 代价是路由需要遍历绑定条件，可读性差、排查困难，生产使用少于 topic。

### 5. 默认交换机

- 名字是空字符串（权限管理中称 `amq.default`），类型是 direct，由 Broker 预声明；
- 每个新建队列自动以**队列名**为绑定键绑到它，所以"发到默认交换机 + 路由键=队列名"看起来像直发队列；
- **不允许显式绑定/解绑**，对默认交换机做绑定会报错；它只用于这种便捷直发，不应作为常规交换机设计拓扑。

### 6. 插件扩展类型

RabbitMQ 还提供一致哈希（consistent-hashing）、随机（random）、本地随机（local-random）、取模（modulus）、哈希（hash）、最近历史（recent-history）、JMS topic 等类型，均以插件或内置扩展形式存在。它们的路由语义由插件实现，跨集群行为与标准类型不同，选型时要单独评估。

## 二、绑定与未路由消息

- **绑定（binding）** 是交换机到队列的规则，声明交换机时它只是一张空路由表；
- **未路由消息**的处理有三条路：发布时设 `mandatory` 并消费 `basic.return` 回调；给交换机配置 `alternate-exchange` 兜底；或直接接受丢弃并靠监控发现（不推荐）；
- **死信** 处理的是"进了队列但没被成功消费"的消息，与"没路由到队列"是两件事，不能互相替代。

## 三、消费端公平分发：prefetch 才是开关

AMQP 的推送模型下，Broker 会按轮询把消息分给消费者，**不看消费者当前是否忙**。若消费者处理速度差异大，就会出现"一个消费者堆积、另一个空闲"。

`basic.qos` 的 `prefetch_count` 限制的是**单个消费者未确认消息数量上限**，不是速率限制：

- `prefetch=0`（不限制）：Broker 尽可能快地把消息推给每个消费者，容易造成忙闲不均与内存膨胀；
- `prefetch=1`：每个消费者最多 1 条未确认消息，处理完才拿下一批，实现"能者多劳"；
- `prefetch` 过大：单个消费者一次拿走大量消息，宕机时重投量巨大。

Spring AMQP 通过 `prefetch`、`concurrentConsumers`、`maxConcurrentConsumers` 三个参数共同决定吞吐与公平性，改动其一都会改变实际在途消息量。

## 四、真实示例：topic 拓扑 + 手动确认

```java
/**
 * 订单事件拓扑：交换机 + 队列 + 绑定一次性声明，避免运行期反复声明。
 * 交换机与队列均持久化，队列名带业务前缀便于运维定位。
 */
@Configuration
public class OrderTopologyConfig {

    public static final String EXCHANGE = "order.events";
    public static final String QUEUE_PAID_CN = "order.paid.cn.queue";

    /** topic 交换机：支持按区域与事件类型多维订阅 */
    @Bean
    public TopicExchange orderExchange() {
        return ExchangeBuilder.topicExchange(EXCHANGE).durable(true).build();
    }

    /** 已支付队列：持久化，且不自动删除，防止消费者下线时丢拓扑 */
    @Bean
    public Queue paidCnQueue() {
        return QueueBuilder.durable(QUEUE_PAID_CN).build();
    }

    /** 绑定：order.paid.* 只匹配一段，即 order.paid.cn / order.paid.us */
    @Bean
    public Binding paidCnBinding(Queue paidCnQueue, TopicExchange orderExchange) {
        return BindingBuilder.bind(paidCnQueue).to(orderExchange).with("order.paid.*");
    }
}
```

```java
/**
 * 消费者：手动 ack + prefetch=1，保证按处理能力取消息。
 */
@Component
public class OrderPaidConsumer {

    /**
     * concurrency 为初始并发，prefetch=1 表示每个消费者最多 1 条未确认消息；
     * 处理失败时 basicNack 不重回队列，交给死信链路，避免毒消息无限循环。
     */
    @RabbitListener(
            queues = OrderTopologyConfig.QUEUE_PAID_CN,
            ackMode = "MANUAL",
            concurrency = "4",
            properties = {"prefetch=1"})
    public void onPaid(OrderPaidEvent event, Channel channel,
                       @Header(AmqpHeaders.DELIVERY_TAG) long tag) throws IOException {
        try {
            // 业务处理：本地事务 + 幂等校验
            handle(event);
            channel.basicAck(tag, false);
        } catch (Exception e) {
            // requeue=false：不重回队列，交由死信交换机做延迟重试或人工处理
            channel.basicNack(tag, false, false);
        }
    }

    /** 业务处理占位：真实实现需保证幂等 */
    private void handle(OrderPaidEvent event) {
        // TODO 落库与状态流转
    }
}
```

## 五、常见追问

**问：direct 和 topic 的区别？**
direct 只做字符串完全相等比较，零匹配开销；topic 要做分段模式匹配。能用固定枚举路由键就用 direct，需要通配才用 topic。

**问：`*` 和 `#` 的区别？**
`*` 恰好匹配一段（`order.*.cn` 不匹配 `order.paid.vip.cn`）；`#` 匹配零段或多段，因此 `order.#` 能匹配 `order`、`order.paid`、`order.paid.cn`。

**问：消息发出去没人收，去哪了？**
被丢弃了。开 `mandatory` 收 `basic.return`、或给交换机配 `alternate-exchange`，否则只能靠监控发现路由键写错。

**问：多消费者为什么消息全跑到一台机器？**
Broker 按轮询推送，不看处理速度。把 `prefetch` 调小（常见 1~10）才能让快的消费者多拿。

**问：prefetch 越大吞吐越高吗？**
不一定。prefetch 提高单消费者在途量，能提升吞吐，但会放大内存占用、延长故障重投时间，也削弱公平性。要结合处理耗时与失败率压测。

## 六、踩坑记录

- **同名队列参数不一致**：`PRECONDITION_FAILED - inequivalent arg`，通常是 `durable` 或 `auto-delete` 声明冲突，改参数必须换队列名或先删除。
- **路由键拼写错误**：无 mandatory、无备用交换机时消息静默消失。
- **auto-delete 队列**：最后一个消费者断开即删队列，积压消息一起消失。
- **fanout 广播到几十个队列**：每个队列一份副本，磁盘与网络成本被低估。
- **headers 交换机做核心路由**：规则藏在消息头里，排查时看不到路由键，运维成本高。
- **手动 ack 与批量 ack 混用**：`multiple=true` 会误确认未处理的消息，故障后丢数据。

## 七、选择建议

| 需求 | 交换机类型 |
|---|---|
| 按事件类型点对点分发 | direct |
| 多服务同时收到同一事件 | fanout |
| 按区域/级别多维订阅 | topic |
| 按消息头属性组合筛选 | headers（慎用） |
| 简单直发单队列 | 默认交换机 |

消费侧建议：处理耗时差异大用 `prefetch=1~10`；吞吐优先且处理稳定用较大 prefetch 配合批量 ack；所有消费者都应显式声明 `ackMode`，禁止依赖自动 ack 处理业务消息。

## 八、最佳实践清单

1. 拓扑声明集中在一处（`@Configuration`），避免运行期参数漂移；
2. 交换机与关键队列设为 durable，队列不轻易 `auto-delete`；
3. 发布端启用 `mandatory` + `basic.return` 回调，捕获路由失败；
4. 关键链路配 `alternate-exchange` 或死信交换机兜底；
5. 消费端手动 ack，失败 `basicNack(requeue=false)` + 死信延迟重试；
6. prefetch、并发数、批量 ack 三者一起调，改一个就重新压测；
7. 路由键设计成可读的分段命名（`domain.event.region`），便于 topic 演进。

## 总结

RabbitMQ 的路由是"交换机类型 + 绑定"的函数：direct 求相等、fanout 全投、topic 做分段匹配、headers 看属性，默认交换机只是一个便捷的 direct 特例。路由错了消息会静默丢失，消费端忙闲不均则是 prefetch 没设对。把拓扑声明、失败兜底和 prefetch 三件事定死，消息链路才算可控。
