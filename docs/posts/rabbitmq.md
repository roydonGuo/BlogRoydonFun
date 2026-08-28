---
title: RabbitMQ
date: 2026-08-28 16:30:00
category: 后端开发
cover: /img-fail.svg
tags: [rabbitmq, mq, spring-amqp]
excerpt: 从同步/异步通讯聊起，搞清 RabbitMQ 的角色定位、5 种消息模型与 SpringAMQP 实战，再延伸到集群搭建与运维，配套 23 张本地配图与可直接复制的 Java/Shell 示例。
---

# RabbitMQ

<img src="/images/posts/rabbitmq/01-sync-async.webp" alt="同步通讯像打电话，异步通讯像发邮件：两种微服务通讯方式对比" style="border-radius: 10px;" />

**微服务之间的通讯**（Inter-service Communication）无非两条路：同步与异步。前者像打电话，要实时拿到对方响应；后者像发邮件，丢出去即可，等对方有空再回。两条路没有绝对优劣，关键看业务对**时效性**、**耦合度**与**吞吐**的取舍。RabbitMQ 正是异步路上最成熟的"中间人"——**消息队列**（**MQ**，Message Queue）的一种实现。

## 一、初识 MQ

### 1、同步和异步通讯

同步通讯：就像打电话，需要实时响应。

异步通讯：就像发邮件，不需要马上回复。

![同步与异步通讯对比：打电话 vs 发邮件](/images/posts/rabbitmq/01-sync-async.webp)

两种方式各有优劣——打电话能立即得到响应，却不能同时跟多人通话；发邮件可以同时跟多人收发，响应却往往有延迟。

#### 同步通讯

之前学习的 **Feign**（声明式 HTTP 调用）调用就属于同步方式，虽然可以实时得到结果，但存在下面几个问题：

![同步调用的问题：耦合、级联失败、吞吐下降](/images/posts/rabbitmq/02-sync-call.webp)

**同步调用的优点**：

+ 时效性较强，可以立即得到结果

**同步调用的问题**：

+ 耦合度高
+ 性能和吞吐能力下降
+ 有额外的资源消耗
+ 有级联失败问题

#### 异步通讯

异步调用则可以规避上述问题。以"购买商品"为例，用户支付后需要调用订单服务完成订单状态修改、调用物流服务、从仓库分配相应的库存并准备发货。在事件模式中，**支付服务**是事件发布者（**Publisher**），支付完成后只需要发布一个"支付成功"的事件（**Event**），事件中带上订单 ID。订单服务和物流服务是事件订阅者（**Consumer**），订阅"支付成功"事件，监听到事件后各自完成自己的业务。

为了解除事件发布者与订阅者之间的耦合，两者并不是直接通信，而是有一个中间人——**Broker**（代理）。Publisher 把事件丢到 Broker，不关心谁来订阅；Consumer 从 Broker 订阅事件，不关心谁发的消息。

![异步通讯：发送方服务 → Broker → 接收方服务，三者通过发布/订阅解耦](/images/posts/rabbitmq/03-async-event-broker.webp)

Broker 是一个像数据总线一样的东西，所有服务收发数据都发到这个总线上；这个总线就像协议一样，让服务间的通讯变得**标准化**、**可控**。

**好处**：

+ **吞吐量提升**：无需等待订阅者处理完成，响应更快速
+ **故障隔离**：服务没有直接调用，不存在级联失败问题
+ **调用间没有阻塞**：不会造成无效的资源占用
+ **耦合度极低**：每个服务都可以灵活插拔、可替换
+ **流量削峰**：不管发布事件的流量波动多大，都由 Broker 接收，订阅者可以按照自己的速度处理

**缺点**：

+ 架构变复杂，业务没有明显的流程线，不好管理
+ 需要依赖 Broker 的可靠、安全、性能

好在现在开源软件或云平台上 Broker 的软件非常成熟，比较常见的一种就是下文要展开的 **MQ** 技术。

### 2、技术对比

**MQ**，中文是**消息队列**（**Message Queue**），字面看就是存放消息的队列，也就是事件驱动架构中的 Broker。比较常见的 MQ 实现有：

+ **ActiveMQ**
+ **RabbitMQ**
+ **RocketMQ**
+ **Kafka**

|  | **RabbitMQ** | **ActiveMQ** | **RocketMQ** | **Kafka** |
| --- | --- | --- | --- | --- |
| 公司/社区 | Rabbit | Apache | 阿里 | Apache |
| 开发语言 | Erlang | Java | Java | Scala & Java |
| 协议支持 | AMQP，XMPP，SMTP，STOMP | OpenWire，STOMP，REST，XMPP，AMQP | 自定义协议 | 自定义协议 |
| 可用性 | 高 | 一般 | 高 | 高 |
| 单机吞吐量 | 一般 | 差 | 高 | 非常高 |
| 消息延迟 | 微秒级 | 毫秒级 | 毫秒级 | 毫秒以内 |
| 消息可靠性 | 高 | 一般 | 高 | 一般 |

+ 追求**可用性**：Kafka、RocketMQ、RabbitMQ
+ 追求**可靠性**：RabbitMQ、RocketMQ
+ 追求**吞吐能力**：RocketMQ、Kafka
+ 追求**消息低延迟**：RabbitMQ、Kafka

## 二、快速入门

### 1、安装 RabbitMQ

#### 单机部署

下面以 **CentOS 7** 虚拟机 + **Docker** 为例跑一个单机版 RabbitMQ。

**第一步：启动 Docker**

```shell
systemctl start docker
```

**第二步：下载镜像**

方式一：在线拉取

```shell
docker pull rabbitmq:3-management
```

方式二：从本地加载（课前资料已提供 `mq.tar` 镜像包）

![课前资料提供的 RabbitMQ 镜像包 mq.tar](/images/posts/rabbitmq/04-mq-image-package.webp)

上传到虚拟机后加载：

```shell
docker load -i mq.tar
```

查看镜像是否加载成功：

```shell
docker images
```

![docker images 列出 rabbitmq:3-management 镜像](/images/posts/rabbitmq/05-docker-images.webp)

**第三步：启动 MQ 容器**

```shell
docker run \
 -e RABBITMQ_DEFAULT_USER=roydon \
 -e RABBITMQ_DEFAULT_PASS=qwer1234 \
 -v mq-plugins:/plugins \
 --name mq \
 --hostname mq1 \
 -p 15672:15672 \
 -p 5672:5672 \
 -d \
 rabbitmq:3-management
```

> **15672** 是管理平台端口，**5672** 是 AMQP 消息通信端口。

若启动失败：

![docker run 失败：名为 mq 的容器已存在](/images/posts/rabbitmq/06-docker-run-error.webp)

说明之前已经创建过一个名为 `mq` 的容器，可以更名或者先删除再启动：

```shell
docker container rm mq
```

![docker container rm mq 删除同名容器](/images/posts/rabbitmq/07-docker-container-rm.webp)

部署成功后浏览器访问 `http://虚拟机IP:15672/`，用上面设置的账号密码登录即可看到管理控制台：

![RabbitMQ 管理控制台登录页面（端口 15672）](/images/posts/rabbitmq/08-rabbitmq-management-ui.webp)

#### 集群部署

RabbitMQ 官方提供了两种集群模式：

+ **普通模式**：不进行数据同步，每个 MQ 都有自己的队列、数据信息（其它元数据如交换机会同步）。例如有 `mq1`、`mq2` 两个节点，消息落在 `mq1`，但连接的是 `mq2`，那么 `mq2` 会去 `mq1` 拉取消息再返回。`mq1` 宕机则消息丢失。
+ **镜像模式**：队列在各个镜像节点之间同步，连接任一节点都能拿到消息；一个节点宕机不会丢数据，但同步会带来额外的带宽消耗。

三台机器集群先要让节点互相认识——分别修改 `/etc/hosts`：

```plain
192.168.150.101 mq1
192.168.150.102 mq2
192.168.150.103 mq3
```

每台机器互相 `ping` 验证网络通畅后，再按节点加入集群的步骤（详见下文第四节）即可。

### 2、MQ 的基本结构

![RabbitMQ 基本结构：Publisher → Exchange → Queue → Consumer，全部位于 VirtualHost 中](/images/posts/rabbitmq/09-rabbitmq-architecture.webp)

RabbitMQ 中的几个核心角色：

+ **publisher**：生产者，发送消息
+ **consumer**：消费者，订阅并处理消息
+ **exchange**：交换机，负责消息路由
+ **queue**：队列，存储消息
+ **virtualHost**：虚拟主机，隔离不同租户的 exchange、queue、消息

> 注意：**Exchange 只负责转发消息，不具备存储能力**。如果没有任何队列与 Exchange 绑定，或没有队列的路由规则匹配上，那么消息会直接丢失。

### 3、RabbitMQ 消息模型

[RabbitMQ 官方文档](https://www.rabbitmq.com/getstarted.html) 给出了 5 个 Demo 示例，对应 5 种不同的消息模型：

![RabbitMQ 官方 5 种消息模型：基本消息队列、工作队列、发布订阅、路由、主题](/images/posts/rabbitmq/10-message-models.webp)

+ **基本消息队列**（Basic Queue）
+ **工作消息队列**（Work Queue）
+ **发布订阅**（Publish/Subscribe），按交换机类型再分三种：
    - **Fanout Exchange**：广播
    - **Direct Exchange**：路由
    - **Topic Exchange**：主题

### 4、入门案例：简单队列模型

简单队列模型只包括三个角色：**publisher** → **queue** → **consumer**。

![简单队列模型：Publisher 把消息直接发到 Queue，Consumer 从 Queue 取消息](/images/posts/rabbitmq/11-simple-queue-model.webp)

#### publisher

实现思路：

1. 建立连接
2. 创建 **Channel**
3. 声明队列
4. 发送消息
5. 关闭连接和 Channel

```java
public class PublisherTest {

    @Test
    public void sendMessage() throws IOException, TimeoutException {
        // 1.建立连接
        ConnectionFactory factory = new ConnectionFactory();
        // 1.1.设置连接参数：主机名、端口、vhost、用户名、密码
        factory.setHost("192.168.52.128");
        factory.setPort(5672);
        factory.setVirtualHost("/");
        factory.setUsername("roydon");
        factory.setPassword("qwer1234");
        // 1.2.建立连接
        Connection connection = factory.newConnection();

        // 2.创建通道 Channel
        Channel channel = connection.createChannel();

        // 3.创建队列
        String queueName = "simple.queue";
        channel.queueDeclare(queueName, false, false, false, null);

        // 4.发送消息
        String message = "hello rabbitmq!";
        channel.basicPublish("", queueName, null, message.getBytes());
        System.out.println("发送消息成功：【" + message + "】");

        // 5.关闭通道和连接
        channel.close();
        connection.close();
    }
}
```

#### consumer

实现思路：

1. 建立连接
2. 创建 Channel
3. 声明队列
4. 订阅消息（`handleDelivery` 处理回调）

```java
public class ConsumerTest {

    public static void main(String[] args) throws IOException, TimeoutException {
        // 1.建立连接
        ConnectionFactory factory = new ConnectionFactory();
        // 1.1.设置连接参数：主机名、端口、vhost、用户名、密码
        factory.setHost("192.168.52.128");
        factory.setPort(5672);
        factory.setVirtualHost("/");
        factory.setUsername("roydon");
        factory.setPassword("qwer1234");
        // 1.2.建立连接
        Connection connection = factory.newConnection();

        // 2.创建通道 Channel
        Channel channel = connection.createChannel();

        // 3.创建队列
        String queueName = "simple.queue";
        channel.queueDeclare(queueName, false, false, false, null);

        // 4.订阅消息
        channel.basicConsume(queueName, true, new DefaultConsumer(channel) {
            @Override
            public void handleDelivery(String consumerTag, Envelope envelope,
                                       AMQP.BasicProperties properties, byte[] body) throws IOException {
                // 5.处理消息
                String message = new String(body);
                System.out.println("接收到消息：【" + message + "】");
            }
        });
        System.out.println("等待接收消息。。。。");
    }
}
```

## 三、SpringAMQP

**[SpringAMQP](https://spring.io/projects/spring-amqp)** 是基于 RabbitMQ 封装的一套模板，并且利用 Spring Boot 实现了自动装配，使用起来非常方便。

![SpringAMQP 在 RabbitMQ 客户端之上的封装层次：Spring Boot Starter AMQP → SpringAMQP Template → RabbitMQ Java Client → Broker](/images/posts/rabbitmq/12-spring-amqp.webp)

SpringAMQP 提供了三大能力：

+ 自动声明队列、交换机及其绑定关系
+ 基于 `@RabbitListener` 注解的监听器模式，**异步接收消息**
+ 封装了 **RabbitTemplate** 工具，用于发送消息

### 1、Basic Queue 简单队列模型

父工程 `rabbitmq-demo` 中引入依赖：

```xml
<!-- AMQP 依赖，包含 RabbitMQ -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-amqp</artifactId>
</dependency>
```

#### 消息发送

`publisher` 服务的 `application.yml` 配置 MQ 地址：

```yaml
spring:
  rabbitmq:
    host: 192.168.52.128
    port: 5672 # 端口
    virtual-host: / # 虚拟主机
    username: roydon # 用户名
    password: qwer1234 # 密码
```

`publisher` 服务中编写测试类 `SpringAmqpTest`，用 `RabbitTemplate` 发送消息：

```java
@RunWith(SpringRunner.class)
@SpringBootTest
public class SpringAmqpTest {

    @Resource
    private RabbitTemplate rabbitTemplate;

    @Test
    public void testSimpleQueue() {
        // 队列名称
        String queueName = "simple.queue";
        // 消息
        String message = "hello, spring amqp!";
        // 发送消息
        rabbitTemplate.convertAndSend(queueName, message);
    }
}
```

#### 消息接收

`consumer` 服务同样配置 MQ 地址，然后新建监听类：

```java
@Component
public class SpringRabbitListener {

    @RabbitListener(queues = "simple.queue")
    public void listenSimpleQueueMessage(String msg) throws InterruptedException {
        System.out.println("spring 消费者接收到消息：【" + msg + "】");
    }
}
```

#### 测试

先启动 `consumer` 服务，然后在 `publisher` 服务里运行测试代码发送消息，观察控制台打印即可看到 `spring 消费者接收到消息：【hello, spring amqp!】`。

### 2、Work Queue 任务队列

**Work Queue** 也叫 **Task Queue**，任务模型——**让多个消费者绑定到同一个队列，共同消费队列中的消息**。

![Work Queue 模型：1 个生产者发消息到队列，多个消费者竞争消费](/images/posts/rabbitmq/13-work-queue-model.webp)

当消息处理比较耗时的时候，生产消息的速度会远远大于消费速度，长此以往消息就会堆积、无法及时处理。此时就可以用 Work 模型，多个消费者共同处理消息，提高速度、避免堆积。

#### 消息发送

循环发送，模拟大量消息堆积：

```java
/**
 * workQueue：向队列中不停发送消息，模拟消息堆积。
 */
@Test
public void testWorkQueue() throws InterruptedException {
    // 队列名称
    String queueName = "simple.queue";
    // 消息
    String message = "hello, message_";
    for (int i = 0; i < 100; i++) {
        // 发送消息
        rabbitTemplate.convertAndSend(queueName, message + i);
        Thread.sleep(20);
    }
}
```

#### 消息接收

在 `consumer` 服务的 `SpringRabbitListener` 中加 2 个消费者，模拟不同处理速度：

```java
@RabbitListener(queues = "simple.queue")
public void listenWorkQueue1(String msg) throws InterruptedException {
    System.out.println("消费者1接收到消息：【" + msg + "】" + LocalTime.now());
    Thread.sleep(20);
}

@RabbitListener(queues = "simple.queue")
public void listenWorkQueue2(String msg) throws InterruptedException {
    System.err.println("消费者2........接收到消息：【" + msg + "】" + LocalTime.now());
    Thread.sleep(200);
}
```

两个消费者 `sleep` 时间不同，模拟任务耗时差异。运行后会发现总耗时大约 5 秒，远大于预期 1 秒——消费者 1 拿到了所有 25 条奇数消息，消费者 2 拿到了所有 25 条偶数消息。

这是因为 RabbitMQ 的**消息预取**机制（**Prefetch**）：每个消费者被预先分配了一批消息（数量 = Channel 上的 QoS prefetch），谁处理完谁再来取下一批；总数一定，处理能力强的消费者并不会多拿。

> 这种"按人头发"的均分方式，对**能者多劳**诉求并不友好。

#### 能者多劳

Spring 提供了一个配置项可以解决：在 `consumer` 服务的 `application.yml` 中设置：

```yaml
spring:
  rabbitmq:
    host: 192.168.52.128
    port: 5672 # 端口
    virtual-host: / # 虚拟主机
    username: roydon # 用户名
    password: qwer1234 # 密码
    listener:
      simple:
        prefetch: 1 # 每次只能获取一条消息，处理完成才能获取下一条
```

把 **prefetch 调成 1** 后，消费者只有处理完一条才会去拉下一条，速度快的消费者会拿到更多消息；总耗时下降到大约 1 秒。

#### 小结

Work Queue 模型关键点：

+ 多个消费者绑定到一个队列，**同一条消息只会被一个消费者处理**
+ 通过设置 `prefetch` 来控制消费者预取的消息数量，从而影响分配公平性

### 3、发布/订阅模型

发布订阅允许把**同一条消息**发送给**多个消费者**。

![发布订阅模型：Publisher → Exchange → Queue1、Queue2 → Consumer1、Consumer2](/images/posts/rabbitmq/14-publish-subscribe-model.webp)

相比前面的模型，这里多了一个 **Exchange** 角色，过程略有变化：

+ **Publisher**：发送消息的程序，不再直接发到队列，而是发给 Exchange
+ **Exchange**：交换机，一方面接收生产者消息，另一方面按规则路由（递交给某队列、广播给所有队列、直接丢弃等）。Exchange 有 3 种类型：
    - **Fanout**：广播，把消息交给所有绑定到该交换机的队列
    - **Direct**：定向，把消息交给符合指定 **Routing Key** 的队列
    - **Topic**：通配符，把消息交给符合 **Routing Pattern** 的队列
+ **Consumer**：与之前一样，订阅队列消费消息
+ **Queue**：接收并缓存消息

> **注意：Exchange 只负责转发消息，不具备存储消息的能力**。如果没有任何队列与 Exchange 绑定，或者没有符合路由规则的队列，**消息会丢失**。

### 4、Fanout 广播

**Fanout** 英文是"扇出"，在 MQ 中叫"广播"更合适。

![Fanout Exchange 广播模型：消息被复制到所有绑定队列](/images/posts/rabbitmq/15-fanout-exchange.webp)

广播模式的消息发送流程：

1. 可以有多个队列
2. 每个队列都要绑定到 Exchange
3. 生产者发送的消息只能发送到 Exchange，由 Exchange 决定发到哪个队列，生产者无法决定
4. Exchange 把消息发送给绑定过的**所有**队列
5. 订阅队列的消费者都能拿到消息

案例：创建一个 Fanout 类型的交换机 `itcast.fanout`，再创建两个队列 `fanout.queue1`、`fanout.queue2` 绑定到该交换机。

![Fanout 案例：itcast.fanout 交换机绑定 fanout.queue1 和 fanout.queue2](/images/posts/rabbitmq/16-fanout-binding.webp)

#### 声明队列和交换机

Spring 提供了一个 `Exchange` 接口，表示所有不同类型的交换机：

![Exchange 接口的类层次：AbstractExchange → FanoutExchange / DirectExchange / TopicExchange / HeadersExchange 等](/images/posts/rabbitmq/17-exchange-interface.webp)

在 `consumer` 中创建一个配置类，用 `@Bean` 声明队列和交换机：

```java
@Configuration
public class FanoutConfig {
    /**
     * 声明交换机
     */
    @Bean
    public FanoutExchange fanoutExchange() {
        return new FanoutExchange("itcast.fanout");
    }

    /**
     * 第 1 个队列
     */
    @Bean
    public Queue fanoutQueue1() {
        return new Queue("fanout.queue1");
    }

    /**
     * 绑定队列和交换机
     */
    @Bean
    public Binding bindingQueue1(Queue fanoutQueue1, FanoutExchange fanoutExchange) {
        return BindingBuilder.bind(fanoutQueue1).to(fanoutExchange);
    }

    /**
     * 第 2 个队列
     */
    @Bean
    public Queue fanoutQueue2() {
        return new Queue("fanout.queue2");
    }

    /**
     * 绑定队列和交换机
     */
    @Bean
    public Binding bindingQueue2(Queue fanoutQueue2, FanoutExchange fanoutExchange) {
        return BindingBuilder.bind(fanoutQueue2).to(fanoutExchange);
    }
}
```

#### 消息发送

```java
@Test
public void testFanoutExchange() {
    // 交换机名称
    String exchangeName = "itcast.fanout";
    // 消息
    String message = "hello, everyone!";
    rabbitTemplate.convertAndSend(exchangeName, "", message);
}
```

> **注意：** 此时消息是发送到交换机而不是队列。

#### 消息接收

```java
@RabbitListener(queues = "fanout.queue1")
public void listenFanoutQueue1(String msg) {
    System.out.println("消费者1接收到Fanout消息：【" + msg + "】");
}

@RabbitListener(queues = "fanout.queue2")
public void listenFanoutQueue2(String msg) {
    System.out.println("消费者2接收到Fanout消息：【" + msg + "】");
}
```

启动后两个消费者都会收到同一条消息：

```shell
消费者2接收到fanout.queue消息：【hello, everyone!】
消费者1接收到fanout.queue消息：【hello, everyone!】
```

#### 小结

**交换机的作用是什么？**

+ 接收 Publisher 发送的消息
+ 按规则路由到与之绑定的队列
+ **不能缓存消息**，路由失败则消息丢失
+ **FanoutExchange** 会把消息路由到**每个**绑定的队列

**声明队列、交换机、绑定关系的 Bean 是什么？**

+ `Queue`
+ `FanoutExchange`
+ `Binding`

### 5、Direct 路由

在 Fanout 模式下，一条消息会被所有订阅的队列消费。但在某些场景下，希望不同的消息被不同的队列消费——这时就要用到 **Direct** 类型的 Exchange。

![Direct Exchange 模型：消息按 Routing Key 精确匹配后投递到指定队列](/images/posts/rabbitmq/18-direct-exchange.webp)

Direct 模型下：

+ 队列与交换机绑定时，要指定一个 **Routing Key**
+ 消息发送方向 Exchange 发送消息时，也必须指定消息的 Routing Key
+ Exchange 不再把消息交给每一个绑定的队列，而是根据消息的 RoutingKey 判断；**只有队列的 RoutingKey 与消息的 RoutingKey 完全一致**才会接收到消息

**案例需求**：

1. 利用 `@RabbitListener` 声明 Exchange、Queue、RoutingKey
2. 在 `consumer` 服务中编写两个消费者方法，分别监听 `direct.queue1` 和 `direct.queue2`
3. 在 `publisher` 中编写测试方法，向 `roydon.direct` 发送消息

![Direct 案例：roydon.direct 交换机按 red/blue/yellow 三个 RoutingKey 投递到不同队列](/images/posts/rabbitmq/19-direct-demo.webp)

#### 基于注解声明队列和交换机

基于 `@Bean` 写起来比较麻烦，Spring AMQP 还提供了基于 `@RabbitListener` 注解的方式来声明队列、交换机、绑定关系：

```java
@RabbitListener(bindings = @QueueBinding(
    value = @Queue(name = "direct.queue1"),
    exchange = @Exchange(name = "roydon.direct", type = ExchangeTypes.DIRECT),
    key = {"red", "blue"}
))
public void listenDirectQueue1(String msg) {
    System.out.println("消费者接收到direct.queue1的消息：【" + msg + "】");
}

@RabbitListener(bindings = @QueueBinding(
    value = @Queue(name = "direct.queue2"),
    exchange = @Exchange(name = "roydon.direct", type = ExchangeTypes.DIRECT),
    key = {"red", "yellow"}
))
public void listenDirectQueue2(String msg) {
    System.out.println("消费者接收到direct.queue2的消息：【" + msg + "】");
}
```

#### 消息发送

```java
@Test
public void testSendDirectExchange() {
    // 交换机名称
    String exchangeName = "roydon.direct";
    // 消息
    String message = "hello blue!";
    // 发送消息
    rabbitTemplate.convertAndSend(exchangeName, "blue", message);
}
```

#### 小结

**Direct 交换机与 Fanout 交换机的差异？**

+ Fanout 交换机将消息路由给**每一个**与之绑定的队列
+ Direct 交换机根据 **RoutingKey** 判断路由给**哪个**队列
+ 如果多个队列具有**相同的 RoutingKey**，则与 Fanout 功能类似

**基于 `@RabbitListener` 注解声明队列和交换机有哪些常见注解？**

+ `@Queue`
+ `@Exchange`

### 6、Topic 通配符路由

**Topic** 类型的 Exchange 与 Direct 类似，都是可以根据 RoutingKey 把消息路由到不同的队列；只不过 Topic 类型 Exchange 可以让队列在绑定 RoutingKey 时使用**通配符**。

RoutingKey 一般由一个或多个单词组成，多个单词之间以 `.` 分隔，例如 `item.insert`。

**通配符规则**：

+ `#`：匹配**一个或多个词**
+ `*`：匹配**不多不少恰好 1 个词**

举例：

+ `item.#`：能匹配 `item.spu.insert` 或 `item.spu`
+ `item.*`：只能匹配 `item.spu`

![Topic Exchange 案例：4 个队列分别绑定 china.# / japan.# / #.weather / #.news，按通配符订阅](/images/posts/rabbitmq/20-topic-exchange.webp)

> + Queue1 绑定 `china.#`，凡是以 `china.` 开头的 routing key 都会被匹配，包括 `china.news`、`china.weather`
> + Queue4 绑定 `#.news`，凡是以 `.news` 结尾的 routing key 都会被匹配，包括 `china.news`、`japan.news`

**案例需求**：

1. 利用 `@RabbitListener` 声明 Exchange、Queue、RoutingKey
2. 在 `consumer` 服务中编写两个消费者方法，分别监听 `topic.queue1` 和 `topic.queue2`
3. 在 `publisher` 中编写测试方法，向 `roydon.topic` 发送消息

![Topic 案例：roydon.topic 把消息按通配符投到 topic.queue1、topic.queue2](/images/posts/rabbitmq/21-topic-demo.webp)

#### 消息发送

```java
@Test
public void testSendTopicExchange() {
    // 交换机名称
    String exchangeName = "roydon.topic";
    // 消息
    String message = "hello, china.news!";
    // 发送消息
    rabbitTemplate.convertAndSend(exchangeName, "china.news", message);
}
```

#### 消息接收

```java
@RabbitListener(bindings = @QueueBinding(
    value = @Queue(name = "topic.queue1"),
    exchange = @Exchange(name = "roydon.topic", type = ExchangeTypes.TOPIC),
    key = "china.#"
))
public void listenTopicQueue1(String msg) {
    System.out.println("消费者接收到topic.queue1的消息：【" + msg + "】");
}

@RabbitListener(bindings = @QueueBinding(
    value = @Queue(name = "topic.queue2"),
    exchange = @Exchange(name = "roydon.topic", type = ExchangeTypes.TOPIC),
    key = "#.news"
))
public void listenTopicQueue2(String msg) {
    System.out.println("消费者接收到topic.queue2的消息：【" + msg + "】");
}
```

#### 小结

**Direct 交换机与 Topic 交换机的差异？**

+ Topic 交换机接收的消息 RoutingKey **必须是多个单词**，以 `.` 分隔
+ Topic 交换机与队列绑定时的 **BindingKey** 可以指定通配符
+ `#`：代表 **0 个或多个词**
+ `*`：代表 **1 个词**

### 7、消息转换器

Spring 默认会用 **JDK 序列化**把消息转成字节发送，接收时再反序列化为 Java 对象。

![消息转换器链路：业务对象 → MessageConverter → MessageProperties → AMQP Frame → Broker → 反向流程](/images/posts/rabbitmq/22-message-converter.webp)

JDK 序列化有三个老毛病：

+ 数据体积过大
+ 有安全漏洞
+ 可读性差

#### 测试默认转换器

发送一个 `Map` 对象：

```java
@Test
public void testSendMap() throws InterruptedException {
    // 准备消息
    Map<String, Object> msg = new HashMap<>();
    msg.put("city", "河南");
    msg.put("age", 22);
    // 发送消息
    rabbitTemplate.convertAndSend("object.queue", msg);
}
```

先停止 consumer 服务，发送消息后再查看管理控制台——可以看到队列里的消息体是一长串不可读的乱码：

![RabbitMQ 管理控制台显示 JDK 序列化后的乱码消息体](/images/posts/rabbitmq/23-jdk-serialization.webp)

#### 配置 JSON 转换器

业务上更希望消息体**体积小**、**可读性高**，通常用 **JSON** 做序列化和反序列化。在 `publisher` 和 `consumer` 两个服务中都引入依赖：

```xml
<dependency>
    <groupId>com.fasterxml.jackson.dataformat</groupId>
    <artifactId>jackson-dataformat-xml</artifactId>
    <version>2.9.10</version>
</dependency>
```

> 实际生产常用 `jackson-databind`，这里只是示例依赖坐标。

然后在启动类里加一个 `MessageConverter` Bean 即可：

```java
@Bean
public MessageConverter jsonMessageConverter() {
    return new Jackson2JsonMessageConverter();
}
```

重启后再发送 `Map` 消息，控制台里看到的就是人眼可读的 JSON。

## 四、RabbitMQ 集群

RabbitMQ 最优秀的能力之一就是**内建集群**。它设计的目的是允许消费者和生产者在节点崩溃的情况下继续运行，并通过添加更多节点来线性扩展消息通信吞吐量。RabbitMQ 内部利用 Erlang 提供的分布式通信框架 **OTP**（Open Telecom Platform）来满足这些需求——客户端失去一个节点连接后，仍能重新连到集群中任何其他节点继续生产、消费消息。

### 1、集群中的一些概念

RabbitMQ 会始终记录以下四种类型的**内部元数据**（**Metadata**）：

1. **队列元数据**：包括队列名称和它们的属性，比如是否可持久化、是否自动删除
2. **交换器元数据**：交换器名称、类型、属性
3. **绑定元数据**：内部是一张表格，记录如何将消息路由到队列
4. **vhost 元数据**：为 vhost 内部的队列、交换器、绑定提供命名空间和安全属性

在单一节点中，RabbitMQ 会把所有这些信息存储在内存中，同时将标记为可持久化的队列、交换器、绑定存储到硬盘上——硬盘上的数据可以确保队列和交换器在节点重启后能够重建。集群模式下也提供两种选择：存到硬盘上（独立节点的默认设置）或存在内存中。

如果在集群中创建队列，集群只会在单个节点而不是所有节点上创建完整的队列信息（元数据、状态、内容）。结果就是只有队列的所有者节点知道有关队列的所有信息，**当集群节点崩溃时，该节点的队列和绑定就消失了**，匹配该队列的新消息也丢失。RabbitMQ 2.6.0 之后提供了**镜像队列**（Mirrored Queue）来避免这个问题。

RabbitMQ 集群中可以共享 `user`、`vhost`、`exchange` 等；**所有数据和状态都必须在所有节点上复制**，例外是消息队列本身。RabbitMQ 节点可以动态加入集群。

在集群中声明队列、交换器、绑定的时候，这些操作会等到所有集群节点都成功提交元数据变更后才返回。集群中有**内存节点**和**磁盘节点**两种类型：

+ **内存节点**：不写磁盘，执行比磁盘节点好，性能出色
+ **磁盘节点**：保障配置信息在节点重启后仍然可用

RabbitMQ 只要求集群中**至少有一个磁盘节点**，其他节点可以是内存节点。当节点加入或离开集群时，它们必须要将该变更通知到至少一个磁盘节点。**如果唯一的磁盘节点崩溃**，集群仍然可以继续路由消息，但**不能**创建队列、交换器、绑定、添加用户、更改权限、添加或删除集群节点——直到该节点恢复。

### 2、集群配置和启动

在一台机器上同时启动多个 RabbitMQ 节点组建集群时，直接用同一份脚本启动会因**节点名称**和**端口冲突**导致启动失败。所以在每次调用 `rabbitmq-server` 命令前，用环境变量 `RABBITMQ_NODENAME` 和 `RABBITMQ_NODE_PORT` 来明确指定唯一的节点名称和端口。下面的示例端口号从 5672 开始，每个新启动的节点加 1，节点分别命名为 `test_rabbit_1`、`test_rabbit_2`、`test_rabbit_3`。

**启动第 1 个节点**：

```shell
RABBITMQ_NODENAME=test_rabbit_1 RABBITMQ_NODE_PORT=5672 ./sbin/rabbitmq-server -detached
```

**启动第 2 个节点**：

```shell
RABBITMQ_NODENAME=test_rabbit_2 RABBITMQ_NODE_PORT=5673 ./sbin/rabbitmq-server -detached
```

> 启动第 2 个节点前建议将 RabbitMQ 默认激活的插件关掉，否则会因端口号冲突导致节点启动失败。

启动后两个节点都还是独立节点，不知道其他节点的存在。集群中除第一个节点外，后加入的节点需要获取集群元数据，所以要先**停止 Erlang 节点上运行的 RabbitMQ 应用程序**，并**重置该节点元数据**，再加入并获取集群的元数据，最后**重新启动 RabbitMQ 应用程序**。

**停止第 2 个节点的应用程序**：

```shell
./sbin/rabbitmqctl -n test_rabbit_2 stop_app
```

**重置第 2 个节点元数据**：

```shell
./sbin/rabbitmqctl -n test_rabbit_2 reset
```

**第 2 个节点加入第 1 个节点组成的集群**：

```shell
./sbin/rabbitmqctl -n test_rabbit_2 join_cluster test_rabbit_1@localhost
```

**启动第 2 个节点的应用程序**：

```shell
./sbin/rabbitmqctl -n test_rabbit_2 start_app
```

**第 3 个节点的配置过程类似**：

```shell
RABBITMQ_NODENAME=test_rabbit_3 RABBITMQ_NODE_PORT=5674 ./sbin/rabbitmq-server -detached

./sbin/rabbitmqctl -n test_rabbit_3 stop_app

./sbin/rabbitmqctl -n test_rabbit_3 reset

./sbin/rabbitmqctl -n test_rabbit_3 join_cluster test_rabbit_1@localhost

./sbin/rabbitmqctl -n test_rabbit_3 start_app
```

整个启动流程可概括为：

:::mermaid
flowchart LR
    A[启动节点 1<br/>detached] --> B[启动节点 N<br/>detached]
    B --> C[stop_app<br/>停止应用]
    C --> D[reset<br/>重置元数据]
    D --> E[join_cluster<br/>加入集群]
    E --> F[start_app<br/>启动应用]
:::

### 3、集群运维

**停止某个指定的节点**（比如停第 2 个节点）：

```shell
RABBITMQ_NODENAME=test_rabbit_2 ./sbin/rabbitmqctl stop
```

**查看节点 3 的集群状态**：

```shell
./sbin/rabbitmqctl -n test_rabbit_3 cluster_status
```

输出会列出集群中的所有节点、运行的 Erlang 节点名、各节点的角色（磁盘/内存）、以及当前集群的元数据版本，是判断集群健康状况最常用的命令。

## 总结

**一句话总结**：RabbitMQ 的核心价值是**通过 Broker 解耦 Publisher 与 Consumer**，配合 5 种消息模型（Basic/Work/Fanout/Direct/Topic）和 SpringAMQP 模板，可以把同步调用拆成异步、削峰填谷、避免级联失败。

**关联知识点**：

+ **AMQP 协议**：RabbitMQ 默认通信协议，0-9-1 是当前事实标准版本
+ **消息可靠性**：生产者 confirm、消费者 ack、Broker 持久化三段共同决定是否丢消息
+ **MQ 选型**：高可靠 + 低延迟 → RabbitMQ；超高吞吐 → Kafka；阿里生态事务消息 → RocketMQ

**面试常问**：

+ RabbitMQ 为什么用 Erlang 而不是 Java？——Erlang 天生支持分布式 actor 模型，进程间通信是语言级能力，配合 OTP 框架实现集群、故障转移、节点发现等能力成本极低
+ 如何保证消息不丢失？——生产者开启 confirm 模式 + 同步刷盘 + 消费者手动 ack，三段缺一不可
+ 镜像队列与普通集群的区别？——普通模式队列只在单节点，镜像模式队列在多个镜像节点间同步，宕机不丢数据但消耗更多带宽

**参考资料**：

+ [RabbitMQ 官方文档](https://www.rabbitmq.com/documentation.html)
+ [Spring AMQP 项目](https://spring.io/projects/spring-amqp)
+ [RabbitMQ Tutorials](https://www.rabbitmq.com/getstarted.html)
+ [Apache Kafka 与 RabbitMQ 选型对比](https://kafka.apache.org/documentation/)