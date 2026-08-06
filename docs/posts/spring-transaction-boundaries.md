---
title: Spring 事务边界：代理、自调用与七种传播行为
date: 2026-08-06
category: 后端开发
cover: /covers/backend.svg
tags: [java, spring, transaction, aop, database]
excerpt: 从 AOP 代理调用链出发，厘清 Spring 声明式事务何时创建、加入、挂起或失效，并用七种传播行为设计可验证的业务边界。
---

# Spring 事务边界：代理、自调用与七种传播行为

<img src="/images/posts/spring-transaction-boundaries-knowledge-map.png" alt="Spring 事务边界：代理、自调用与七种传播行为知识串联图" style="border-radius: 10px;" />

从 AOP 代理调用链出发，厘清 Spring 声明式事务何时创建、加入、挂起或失效，并用七种传播行为设计可验证的业务边界。

`@Transactional` 最危险的地方不是配置复杂，而是代码看起来“加了事务”，运行时却可能没有经过事务拦截器。常见事故包括：同类方法互调导致新事务没有创建、捕获异常后订单被意外提交、`REQUIRES_NEW` 用多了耗尽连接池，以及把本地数据库事务误当成跨线程、跨服务的一致性协议。

理解这些问题，只需抓住一条主线：**事务注解描述的是方法调用经过 Spring 代理时应采用的事务规则，不是方法体本身自带的语法能力。** 先确认调用是否经过代理，再讨论传播、回滚和隔离，排障会清晰很多。

> 本文以 **Spring Framework 7.0.8 与 6.2.19** 的官方文档为事实依据，核对时间为 **2026-08-06**。示例采用命令式 `PlatformTransactionManager`、Java 与关系型数据库；响应式事务使用 Reactor Context，不能直接套用本文关于 ThreadLocal 和线程切换的结论。

## 一、一次事务调用到底经过了什么

Spring 声明式事务由 AOP 代理和 `TransactionInterceptor` 协作完成。外部对象调用被代理的方法时，大致经历下面的链路：

```text
Controller / 其他 Bean
        ↓ 调用代理对象
TransactionInterceptor 读取 @Transactional
        ↓ 根据传播行为创建、加入、挂起或拒绝事务
目标 Service 方法
        ↓ JDBC / JPA 使用当前线程绑定的连接
返回或抛出异常
        ↓ 根据回滚规则提交或回滚
释放连接并恢复被挂起的事务
```

命令式事务通常把事务资源绑定到当前线程。只要调用仍在同一线程、使用同一个事务管理器并取得受其管理的数据源连接，DAO 操作就能参加当前事务。反过来，下面任一条件不成立，事务边界都可能与想象不同：

- 调用没有经过 Spring 代理；
- 方法切换到了新线程；
- 内外层使用不同的事务管理器或数据源；
- 异常没有传播到事务拦截器；
- 数据库或事务管理器不支持声明的传播能力。

因此，排查事务时不要先盯着注解，要先画出“调用方 → 代理 → 目标方法 → 数据资源”的真实链路。

## 二、自调用为什么让注解失效

默认代理模式只拦截**从代理外部进入的调用**。目标对象内部使用 `this` 调用另一个方法，本质是普通 Java 方法调用，不会再次穿过代理：

```java
@Service
public class OrderService {

    public void importOrders(List<OrderCommand> commands) {
        for (OrderCommand command : commands) {
            // 反例：this 调用没有经过 Spring 代理，REQUIRES_NEW 不会生效
            saveOne(command);
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void saveOne(OrderCommand command) {
        // 这里看似“每条订单一个新事务”，实际可能完全没有事务
        orderRepository.insert(command.toOrder());
    }
}
```

如果 `importOrders()` 本身没有事务，`saveOne()` 可能以自动提交方式执行；如果外层已有事务，`saveOne()` 也不会按 `REQUIRES_NEW` 挂起外层并创建独立事务。

最稳妥的修复是按事务职责拆分 Bean，让调用自然经过代理：

```java
@Service
public class OrderImportService {

    private final SingleOrderService singleOrderService;

    public OrderImportService(SingleOrderService singleOrderService) {
        this.singleOrderService = singleOrderService;
    }

    public void importOrders(List<OrderCommand> commands) {
        for (OrderCommand command : commands) {
            // 跨 Bean 调用会经过 SingleOrderService 的事务代理
            singleOrderService.saveOne(command);
        }
    }
}

@Service
public class SingleOrderService {

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void saveOne(OrderCommand command) {
        // 每次调用使用独立物理事务，单条失败不回滚已提交的其他订单
        orderRepository.insert(command.toOrder());
    }
}
```

也可以用 `TransactionTemplate` 显式定义局部边界；AspectJ 编织能够拦截自调用，但会增加构建、运行和排障复杂度。把自身代理注入自身虽然能绕过问题，却容易形成循环依赖并隐藏设计意图，通常不应作为首选。

## 三、七种传播行为完整对照

传播行为回答的不是“数据库隔离级别是什么”，而是：**进入方法时如果已经存在事务，该方法如何处理；如果不存在，又该怎么办。** Spring 的 `Propagation` 包含七种取值。

| 传播行为 | 已有事务 | 没有事务 | 典型用途 | 主要风险 |
|---|---|---|---|---|
| `REQUIRED` | 加入当前事务 | 新建事务 | 默认业务写操作 | 内层标记回滚后，外层可能收到 `UnexpectedRollbackException` |
| `SUPPORTS` | 加入当前事务 | 非事务执行 | 可在事务内复用的查询 | 行为随调用方变化，容易产生隐式边界 |
| `MANDATORY` | 加入当前事务 | 直接抛异常 | 强制要求上层编排事务的内部能力 | 独立调用会失败 |
| `REQUIRES_NEW` | 挂起当前事务并新建 | 新建事务 | 必须独立提交的审计、分段处理 | 额外占用连接，外层回滚也撤不掉内层提交 |
| `NOT_SUPPORTED` | 挂起当前事务 | 非事务执行 | 明确不希望持有事务资源的长任务 | 暂停能力依赖事务管理器，操作失去原子性 |
| `NEVER` | 直接抛异常 | 非事务执行 | 用契约禁止在事务中调用 | 组合调用限制强 |
| `NESTED` | 在同一物理事务中创建保存点 | 类似 `REQUIRED` 新建事务 | JDBC 局部回滚 | 依赖保存点支持，不等于独立事务 |

选择传播行为时，先区分**逻辑事务作用域**与**物理事务**。多个 `REQUIRED` 方法各有逻辑作用域，但通常共享一个物理数据库事务；`REQUIRES_NEW` 创建独立物理事务；`NESTED` 则通常在同一个物理事务里使用保存点。

### 1. `REQUIRED`：默认选择，但要理解回滚标记

`REQUIRED` 适合订单创建、库存扣减、支付单初始化等必须共同成功或失败的同线程数据库操作。内层加入外层后，内层声明的隔离级别、超时和只读标记通常不会替换外层属性。

如果内层捕获到运行时异常并把共享事务标记为 rollback-only，外层即使继续执行并尝试提交，也会收到 `UnexpectedRollbackException`。这是 Spring 防止调用方误以为提交成功的保护机制，不应简单吞掉。

### 2. `REQUIRES_NEW`：独立提交不是“更可靠”

`REQUIRES_NEW` 会暂停外层事务，并为内层申请新的事务资源。外层持有的数据库连接在暂停期间通常仍被占用，内层还要再借一个连接。如果并发线程数接近连接池大小，所有线程都持有外层连接并等待内层连接，就可能出现连接池耗尽甚至死锁式等待。

它适合真正需要独立结果的短操作，例如记录“主事务失败”本身的审计信息，但不适合把每个普通 DAO 方法都改成新事务。使用前至少确认：

- 内层提交后，即使外层失败也允许保留；
- 连接池能覆盖外层并发和内层额外连接；
- 内层事务足够短，不进行远程调用或长时间等待；
- 调用确实经过了另一个代理 Bean。

### 3. `NESTED`：保存点回滚，不是两个事务

`NESTED` 通常由 JDBC 保存点实现。内层失败可以回滚到保存点，外层仍有机会继续；但最终外层事务回滚时，内层已经“成功”的部分也会一起回滚。

它与 `REQUIRES_NEW` 的关键区别是：

```text
REQUIRES_NEW：外层事务 A 暂停 → 内层事务 B 独立提交 → 恢复 A
NESTED：       外层事务 A → 创建 Savepoint → 局部回滚或释放 → 仍是 A
```

嵌套事务依赖具体事务管理器和资源能力。Spring 官方文档说明，典型映射是 `DataSourceTransactionManager` 的 JDBC 保存点；不能看到枚举值就假定 JPA、JTA 或多资源事务一定支持。

## 四、回滚取决于异常如何离开方法

Spring 默认对 `RuntimeException` 和 `Error` 回滚，对受检异常 `Exception` 不自动回滚。业务如果使用受检异常表达失败，应显式配置类型规则：

```java
@Transactional(rollbackFor = OrderCreateException.class)
public Long createOrder(CreateOrderCommand command)
        throws OrderCreateException {
    // 业务校验失败抛出受检异常时，也要求数据库操作整体回滚
    validateCommand(command);
    return orderRepository.insert(command.toOrder());
}
```

优先使用 `rollbackFor = SomeException.class` 这类类型安全规则，少用字符串模式，避免异常类名的模糊匹配带来误判。

更常见的坑是异常被方法内部吞掉：

```java
@Transactional
public void createOrder(CreateOrderCommand command) {
    try {
        orderRepository.insert(command.toOrder());
        inventoryClient.reserve(command.items());
    } catch (RuntimeException ex) {
        // 反例：异常没有离开代理方法，拦截器会尝试提交数据库事务
        log.error("创建订单失败", ex);
    }
}
```

如果失败意味着本地事务不能提交，应让异常继续抛出，或在极少数无法改变返回契约的场景显式调用 `setRollbackOnly()`。后者让业务代码依赖 Spring 事务 API，应当谨慎使用。

还要注意 `try-catch` 的位置：调用方在代理方法外捕获异常，不影响事务拦截器先执行回滚；被代理方法在内部吞掉异常，拦截器则看不到失败。

## 五、真实订单场景如何划分边界

以“创建订单”为例，本地数据库事务通常只负责订单、订单明细与 Outbox 事件的原子写入，不把库存 RPC、消息发送和第三方支付调用包进数据库事务：

```java
@Service
public class OrderApplicationService {

    private final OrderRepository orderRepository;
    private final OrderItemRepository orderItemRepository;
    private final OutboxRepository outboxRepository;

    @Transactional
    public Long createOrder(CreateOrderCommand command) {
        Order order = Order.create(command);
        Long orderId = orderRepository.insert(order);

        // 订单明细与主表共享 REQUIRED 事务
        orderItemRepository.batchInsert(orderId, command.items());

        // Outbox 与业务数据同事务落库，提交后再异步投递
        outboxRepository.insert(OrderCreatedEvent.from(orderId, command));
        return orderId;
    }
}
```

这里的边界有三个工程收益：

1. 本地原子性明确，数据库提交成功就一定存在待投递事件；
2. 事务内不等待远程网络，减少连接和行锁占用时间；
3. 消息投递失败可以重试，不需要让数据库事务跨越消息中间件。

如果要在提交后触发轻量级进程内动作，可以使用 `@TransactionalEventListener`。默认阶段是 `AFTER_COMMIT`，还支持 `BEFORE_COMMIT`、`AFTER_ROLLBACK` 与 `AFTER_COMPLETION`。但进程在提交后、监听器执行前崩溃时，普通内存事件仍可能丢失；需要可靠投递时，应使用持久化 Outbox，而不是把事务监听器当消息队列。

## 六、跨线程、异步与远程调用的边界

命令式 `PlatformTransactionManager` 的事务上下文通常绑定在线程上，新建线程不会自动继承：

```java
@Transactional
public void rebuildReport(Long orderId) {
    orderRepository.markBuilding(orderId);

    CompletableFuture.runAsync(() -> {
        // 新线程不会自动加入上面的命令式事务
        reportRepository.generate(orderId);
    });
}
```

同理，`@Async`、线程池、消息消费者和 HTTP/RPC 调用都不是本地事务的自然延伸。正确做法是为异步消费者定义自己的短事务，并通过幂等键、状态机、Outbox/Inbox、补偿或对账处理跨边界一致性。

响应式事务也不是简单“改用另一个线程”。`ReactiveTransactionManager` 把事务上下文放在 Reactor Context 中，参与操作必须留在同一响应式流水线。命令式方法返回 `void` 或普通对象时，应使用 `PlatformTransactionManager`；响应式方法则需要返回相应的 reactive pipeline。

## 七、事务属性要与真实资源对齐

`@Transactional` 还提供隔离级别、超时、只读和事务管理器选择，但这些属性不是万能开关：

- `isolation`、`timeout` 和 `readOnly` 主要在新建事务时生效；加入已有事务时通常继承外层边界；
- `readOnly = true` 通常是给事务管理器、JDBC 驱动或 ORM 的优化提示，不应被当作数据库写保护；
- 多数据源项目必须明确 `transactionManager`，单个本地事务管理器不会自动让两个数据库原子提交；
- 长事务会持续占用连接、锁与版本数据，远程调用、人工等待和大批量计算应移出事务；
- 数据库隔离级别解决并发读写可见性，事务传播解决方法调用如何参加事务，两者不能混用。

若希望内层 `REQUIRED` 声明与外层隔离级别或只读属性不一致时直接失败，可以研究具体事务管理器的 `validateExistingTransaction` 配置。默认的宽松行为可能会忽略内层声明，因此生产代码应把关键事务属性放在最外层业务入口。

## 八、常见误区与排查顺序

### 误区 1：只要方法上有注解就一定生效

注解只是元数据。先确认对象由 Spring 容器管理、调用从代理外部进入、方法可被当前代理方式拦截，再确认事务管理器和数据源。

### 误区 2：`REQUIRES_NEW` 能隔离所有失败

它只创建独立物理事务，不会隔离线程池耗尽、远程依赖失败或业务逻辑错误，而且会增加连接占用。独立提交本身还可能破坏外层业务原子性。

### 误区 3：`NESTED` 等于内层独立提交

保存点只能让外层选择局部回滚；最终提交权仍属于同一个物理事务。需要外层失败后仍保留内层结果时，语义上才可能考虑 `REQUIRES_NEW`。

### 误区 4：捕获异常后返回失败即可回滚

事务拦截器只根据它观察到的返回或异常决定结果。内部捕获并正常返回，默认就是提交路径。

### 误区 5：数据库事务可以覆盖消息与 HTTP

Spring 不会把事务上下文自动传播到远程调用。跨服务一致性应通过本地事务加可靠事件、幂等、补偿和状态核对实现。

遇到“事务没有按预期工作”时，可以按以下顺序排查：

```text
调用是否经过代理
  → 实际选中了哪个 TransactionManager
  → 进入方法前是否已有事务
  → 传播行为产生了哪一个物理事务
  → 异常是否离开代理方法且命中回滚规则
  → 是否发生线程、数据源或远程边界切换
  → 数据库最终提交、锁和连接指标是否吻合
```

日志中至少记录业务操作 ID、事务入口方法、传播行为、数据源标识和最终异常类型；连接池应监控活动连接、等待线程和获取超时。不要在生产环境长期打印包含参数值的底层事务 DEBUG 日志，以免泄露敏感信息或制造大量噪声。

## 九、最佳实践清单

- 把事务放在表达完整业务动作的 Service 入口，而不是零散 DAO 方法；
- 默认使用 `REQUIRED`，只有业务语义明确时才选择其他传播行为；
- 通过拆分 Bean 消除自调用，保持调用链和事务职责可见；
- 让需要回滚的异常离开代理方法，受检异常显式配置类型规则；
- 保持事务短小，不在事务内执行慢 RPC、消息确认或大文件处理；
- 使用 `REQUIRES_NEW` 前评估独立提交后果与连接池容量；
- 使用 `NESTED` 前验证事务管理器、数据库驱动和保存点支持；
- 跨线程、跨服务和跨资源一致性使用独立事务、幂等与可靠消息方案；
- 在最外层定义隔离、超时和只读属性，避免内层声明被已有事务忽略；
- 用真实失败路径验证最终数据库状态，不以“没有抛异常”作为事务正确的证据。

## 十、总结

Spring 事务的核心不是 `@Transactional` 注解本身，而是一次方法调用是否穿过代理，以及拦截器如何把逻辑作用域映射到物理事务。`REQUIRED` 适合共享原子边界，`REQUIRES_NEW` 提供独立事务但消耗额外资源，`NESTED` 依赖同一物理事务中的保存点，其余传播行为则用于表达允许、强制或禁止事务的调用契约。

工程落地时，先画调用链，再选传播行为；先定义本地数据库原子性，再设计跨线程和跨服务一致性。把自调用、异常传播、连接池、事务管理器和资源边界一起纳入设计，才能让“加了事务”真正变成可解释、可验证、可运维的事务边界。

## 参考资料

- [Spring Framework 7.0.8：声明式事务实现原理](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-decl-explained.html)
- [Spring Framework 7.0.8：使用 `@Transactional`](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html)
- [Spring Framework 7.0.8：事务传播语义](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html)
- [Spring Framework 7.0.8 API：`Propagation` 枚举](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/annotation/Propagation.html)
- [Spring Framework 7.0.8：声明式事务回滚](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/rolling-back.html)
- [Spring Framework：事务绑定事件](https://docs.spring.io/spring-framework/reference/data-access/transaction/event.html)
