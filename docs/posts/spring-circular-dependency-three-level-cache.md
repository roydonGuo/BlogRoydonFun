---
title: Spring 循环依赖工程实践：三级缓存、代理暴露与设计治理
date: 2026-08-22
category: 后端开发
cover: /images/posts/spring-circular-dependency-three-level-cache-knowledge-map.webp
tags: [spring, bean, ioc, aop]
excerpt: Spring 的三级缓存只能在特定条件下暴露尚未完成初始化的单例引用，并不等于所有循环依赖都可解决。本文从 Bean 创建时序、三级缓存与 AOP 早期代理出发，讲清可解析边界、失败原因和拆环方法。
---

# Spring 循环依赖工程实践：三级缓存、代理暴露与设计治理

<img src="/images/posts/spring-circular-dependency-three-level-cache-knowledge-map.webp" alt="Spring 循环依赖工程实践：三级缓存、代理暴露与设计治理知识串联图" style="border-radius: 10px;" />

Spring 的三级缓存只能在特定条件下暴露尚未完成初始化的单例引用，并不等于所有循环依赖都可解决。本文从 Bean 创建时序、三级缓存与 AOP 早期代理出发，讲清可解析边界、失败原因和拆环方法。

## 先说结论：三级缓存是兼容机制，不是设计方案

Spring Framework 可以尝试解析一部分单例 Bean 的属性注入循环，但这条路径有严格前提：至少有一方必须先完成实例化，容器才能暴露早期引用。构造器循环在对象尚未产生时就互相等待，因此无法靠缓存解决。

Spring Boot 当前默认将 `spring.main.allow-circular-references` 设为 `false`。工程上应把启动失败视为依赖方向异常，优先拆环；临时开启循环引用只适合迁移旧系统，不应成为新代码的默认配置。

本文以 Spring Framework 7.0.8 源码和当前 Spring Boot 配置文档为事实基线，核对日期为 2026-08-24。Spring 官方也明确建议不要依赖循环引用，因为被注入的一方可能尚未完成初始化。

## 先区分哪些循环能被解析

| 依赖形态 | 默认结果 | 原因 |
|---|---|---|
| A、B 双方构造器注入 | 失败 | A 未实例化就需要 B，B 未实例化又需要 A，没有早期对象可暴露 |
| 一方构造器、一方属性注入 | 通常失败 | 创建链仍可能在第一个对象实例化前闭环 |
| 单例 Bean 双方属性或 Setter 注入 | 容器可尝试解析 | 一方实例化后可先暴露早期引用，再继续属性填充 |
| `prototype` Bean 循环 | 失败 | 三级缓存属于单例注册表，原型 Bean 没有可复用的共享实例 |
| 涉及 AOP 的单例属性循环 | 有条件解析 | 早期引用必须与最终代理保持身份一致，否则会失败 |
| `@Lazy`、`ObjectProvider` 延迟取用 | 可能绕开启动闭环 | 注入的是代理或提供器，真正取 Bean 的时机被推迟 |

“能启动”不代表“依赖合理”。属性注入会让对象在不完整状态下短暂可见；若初始化方法提前调用对方，仍可能读到未填充字段或触发代理差异。

## 三级缓存分别保存什么

`DefaultSingletonBeanRegistry` 维护三类单例状态。所谓“三级”是社区惯用称呼，源码字段并没有层级编号。

| 惯用名称 | 源码字段 | 保存内容 | 作用 |
|---|---|---|---|
| 一级缓存 | `singletonObjects` | 完成创建并正式发布的单例 | 所有正常 `getBean` 调用的最终来源 |
| 二级缓存 | `earlySingletonObjects` | 已生成一次的早期引用 | 保证循环链中多次取到同一个早期对象 |
| 三级缓存 | `singletonFactories` | `ObjectFactory<?>` | 在确实发生早期取用时，延迟决定返回原对象还是早期代理 |

三级缓存不是“专门存代理的工厂”。`AbstractAutowireCapableBeanFactory` 放入的是一个调用 `getEarlyBeanReference` 的 `ObjectFactory`；若没有相关 `SmartInstantiationAwareBeanPostProcessor`，它返回原始 Bean，存在 AOP 时才可能返回早期代理。

这层延迟有两个价值：

- 没有循环引用时，不必为了所有单例提前创建代理；
- 发生循环时，容器有机会让其他 Bean 注入将来可继续作为最终引用的早期代理。

工厂第一次产出早期引用后，该引用会进入二级缓存，同时删除三级缓存中的工厂。这样后续依赖拿到的是同一对象，不会重复执行代理创建逻辑。

## 一次属性注入循环如何穿过缓存

假设 `OrderService` 属性依赖 `InventoryService`，后者又属性依赖前者，并且容器允许循环引用：

```text
创建 OrderService
  -> 实例化 OrderService
  -> 将 OrderService 的 ObjectFactory 放入三级缓存
  -> 填充 inventoryService，需要创建 InventoryService
       -> 实例化 InventoryService
       -> 将 InventoryService 的 ObjectFactory 放入三级缓存
       -> 填充 orderService
            -> 一级缓存未命中
            -> 二级缓存未命中
            -> 调用三级缓存中的 OrderService ObjectFactory
            -> 生成早期引用并移入二级缓存
       -> InventoryService 初始化完成，进入一级缓存
  -> OrderService 注入完整的 InventoryService
  -> OrderService 初始化完成，进入一级缓存
  -> 清理其二级、三级缓存条目
```

关键断点发生在“实例化完成、属性填充开始之前”。构造器循环失败，正是因为流程还没有走到这个可暴露断点。

## AOP 为什么让问题更敏感

带有 `@Transactional`、`@Async` 或自定义切面的 Bean，业务方通常应拿到代理，而不是原始对象。若 B 在循环处理中注入了 A 的原始对象，A 初始化结束后又被包装成代理，就会出现两个身份：

```text
B 持有的 A：原始对象
容器最终发布的 A：代理对象
```

此时从 B 调用 A 可能绕过事务或切面。Spring 的早期代理机制试图让循环链拿到与最终发布一致的引用；如果某个后处理器只能在初始化后包装 Bean，或前后两次包装结果不一致，容器会拒绝把原始对象悄悄留在依赖方，并抛出 `BeanCurrentlyInCreationException`。

因此，“加了三级缓存就能解决 AOP 循环”并不准确。更严谨的说法是：三级缓存为 `SmartInstantiationAwareBeanPostProcessor#getEarlyBeanReference` 提供了延迟入口，但最终能否保持代理一致性取决于完整的后处理链。

## 正确拆环：让依赖图重新变成有向无环图

假设订单服务和库存服务互相调用：

```java
@Service
public class OrderService {
    private final InventoryService inventoryService;

    public OrderService(InventoryService inventoryService) {
        this.inventoryService = inventoryService;
    }
}

@Service
public class InventoryService {
    private final OrderService orderService;

    public InventoryService(OrderService orderService) {
        this.orderService = orderService;
    }
}
```

不要先把构造器改成字段注入。先判断互调逻辑属于哪一种职责，再选择拆法。

### 1. 抽取共同职责

如果双方都依赖“预占库存规则”，把规则提取为第三个组件，让两个服务单向依赖它：

```java
@Component
public class InventoryReservationPolicy {

    public ReservationDecision decide(OrderSnapshot order,
                                      StockSnapshot stock) {
        // 规则组件只做计算，不反向调用订单或库存服务
        return stock.available() >= order.quantity()
                ? ReservationDecision.allowed()
                : ReservationDecision.rejected("库存不足");
    }
}
```

这种方式最直接：共同逻辑有了明确所有者，依赖图从 `A ↔ B` 变成 `A → C ← B`。

### 2. 用应用编排层确定调用方向

若“下单”本来就是跨订单和库存的用例，应由编排服务控制顺序，而不是让两个领域服务互相知道：

```java
@Service
public class PlaceOrderUseCase {

    private final OrderRepository orderRepository;
    private final InventoryGateway inventoryGateway;

    public PlaceOrderUseCase(OrderRepository orderRepository,
                             InventoryGateway inventoryGateway) {
        this.orderRepository = orderRepository;
        this.inventoryGateway = inventoryGateway;
    }

    @Transactional
    public Long place(PlaceOrderCommand command) {
        // 编排层拥有事务和调用顺序，底层能力不反向依赖编排层
        inventoryGateway.reserve(command.skuId(), command.quantity());
        return orderRepository.save(Order.create(command)).getId();
    }
}
```

### 3. 用事件切断非即时反馈

审计、通知、搜索索引更新等不要求当前调用立即返回的动作，可以监听领域事件。事件只表达已经发生的事实，不应被滥用为同步查询的替代品。

如果事件需要跨进程可靠投递，还要增加 Outbox、幂等消费和失败补偿；这属于消息一致性问题，不是简单加一个 `@EventListener` 就结束。

### 4. 延迟查找只作为迁移手段

旧系统暂时无法拆分时，可在非核心路径使用 `ObjectProvider` 延迟获取：

```java
@Service
public class LegacyInventoryService {

    private final ObjectProvider<OrderService> orderServiceProvider;

    public LegacyInventoryService(ObjectProvider<OrderService> provider) {
        this.orderServiceProvider = provider;
    }

    public void reconcile(Long orderId) {
        // 只在业务方法执行时取 Bean，避免启动阶段立即闭环
        OrderService orderService = orderServiceProvider.getObject();
        orderService.refreshStatus(orderId);
    }
}
```

`@Lazy` 也会注入延迟代理，但两者只是把依赖解析推迟到运行期，业务耦合仍然存在。应记录迁移任务、调用频率和移除期限，避免“临时方案”永久化。

## 排查与治理清单

遇到启动失败时，先读取异常中的依赖链，不要直接打开循环引用开关：

1. 找到最短闭环，例如 `orderService → inventoryService → orderService`；
2. 标出每条边来自构造器、字段、Setter、`@Bean` 方法还是运行时查找；
3. 检查环内是否有事务、异步、缓存等代理增强；
4. 判断互调逻辑应归共同组件、应用编排层还是事件订阅方；
5. 保持构造器注入，让新的循环在启动期尽早暴露；
6. 只在旧系统迁移窗口临时开启 `spring.main.allow-circular-references=true`，并设置退出条件。

架构约束还可以进入 CI：按包或模块提取依赖图，禁止领域模块反向依赖应用层，并检测有向环。这样比等 Spring 启动时报错更早，也能覆盖未被注册为 Bean 的普通 Java 类。

## 边界总结

三级缓存解决的是“单例创建中，如何安全复用一次早期引用”的容器时序问题：一级保存成品，二级保存已生成的早期引用，三级按需生成原始或代理引用。它不能创造尚未实例化的对象，不能支持原型 Bean 循环，也不能自动保证所有后处理器的代理一致性。

生产代码应默认禁止循环依赖，用构造器注入暴露错误方向，再通过抽取共同职责、增加应用编排层或发布事件拆环。只有依赖图本身清晰，Bean 生命周期、事务边界和代理行为才真正可预测。

## 参考资料

- [Spring Framework：Dependency Injection 与循环依赖](https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-collaborators.html)
- [Spring Framework 7.0.8：DefaultSingletonBeanRegistry](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/beans/factory/support/DefaultSingletonBeanRegistry.html)
- [Spring Framework 源码：DefaultSingletonBeanRegistry](https://github.com/spring-projects/spring-framework/blob/main/spring-beans/src/main/java/org/springframework/beans/factory/support/DefaultSingletonBeanRegistry.java)
- [Spring Framework 源码：AbstractAutowireCapableBeanFactory](https://github.com/spring-projects/spring-framework/blob/main/spring-beans/src/main/java/org/springframework/beans/factory/support/AbstractAutowireCapableBeanFactory.java)
- [Spring Boot：Common Application Properties](https://docs.spring.io/spring-boot/appendix/application-properties/)
