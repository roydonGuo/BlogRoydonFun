---
title: Spring Bean 生命周期工程实践：创建、初始化、代理与销毁
date: 2026-08-20
category: 后端开发
cover: /images/posts/spring-bean-lifecycle-engineering-knowledge-map.webp
tags: [spring, spring-framework, bean, ioc, lifecycle]
excerpt: Spring Bean 的生命周期不只是实例化、初始化和销毁三个词，而是一条由 BeanDefinition、依赖注入、Aware 回调、BeanPostProcessor、AOP 代理与作用域共同决定的处理链。本文以 Spring Framework 7.0.8 为基线，讲清完整顺序、扩展点和工程边界。
---

# Spring Bean 生命周期工程实践：创建、初始化、代理与销毁

<img src="/images/posts/spring-bean-lifecycle-engineering-knowledge-map.webp" alt="Spring Bean 生命周期工程实践：创建、初始化、代理与销毁知识串联图" style="border-radius: 10px;" />

Spring Bean 的生命周期不只是实例化、初始化和销毁三个词，而是一条由 BeanDefinition、依赖注入、Aware 回调、BeanPostProcessor、AOP 代理与作用域共同决定的处理链。本文以 Spring Framework 7.0.8 为基线，讲清完整顺序、扩展点和工程边界。

## 先说结论：生命周期有三条线

理解 Bean 生命周期，先把三个容易混淆的层次拆开：

1. **容器启动线**：读取配置、注册和修改 BeanDefinition、创建后处理器、预实例化单例；
2. **单个 Bean 创建线**：实例化、注入、Aware、初始化回调、后处理和代理；
3. **容器关闭线**：停止运行组件、按依赖关系销毁 Bean、释放资源。

常见的“十几步生命周期图”通常把容器阶段、单 Bean 回调和扩展点画成一条固定直线，容易产生误解。prototype、懒加载 Bean、短路代理和循环依赖都可能改变实际路径。

本文以 [Spring Framework 7.0.8](https://docs.spring.io/spring-framework/reference/) 为事实基线，核对日期为 2026-08-20。核心创建流程以 AbstractAutowireCapableBeanFactory 当前契约为准。

## 一、创建 Bean 之前：先处理定义

@Component、@Bean、XML 或程序化注册首先形成 BeanDefinition。它是创建对象的配方，不是 Bean 实例。

容器刷新时，重要扩展点按职责分为两类：

| 扩展点 | 操作对象 | 典型用途 |
|---|---|---|
| BeanDefinitionRegistryPostProcessor | Bean 定义注册表 | 扫描并新增定义 |
| BeanFactoryPostProcessor | 已注册的 Bean 定义 | 改属性、占位符和元数据 |
| BeanPostProcessor | 后续创建出的 Bean 实例 | 注入、回调、校验、包装代理 |

BeanFactoryPostProcessor 执行时，普通 Bean 通常还没有实例化。不要在这里调用 getBean() 拉起业务对象，否则可能让它过早创建，错过后续完整处理。

BeanPostProcessor 自身也必须提前创建并注册。通过 @Bean 声明时，应让返回类型明确为实现类或 BeanPostProcessor，并优先使用无依赖的 static 方法，避免配置类和依赖被提前实例化。

## 二、单个 Bean 的完整创建链

正常路径可以压缩为下面九步：

~~~text
合并 BeanDefinition
→ 实例化前处理
→ 构造器或工厂方法创建实例
→ 实例化后处理
→ 属性填充与依赖注入
→ Aware 回调
→ 初始化前处理
→ 初始化方法
→ 初始化后处理并暴露最终对象
~~~

### 1. 合并 BeanDefinition

容器先把父定义、通用定义和当前定义合并为 RootBeanDefinition。MergedBeanDefinitionPostProcessor 可读取并缓存注解、注入点等元数据。

这一阶段仍在处理配方。它回答“怎样创建”，还没有业务对象可用。

### 2. 实例化前处理

InstantiationAwareBeanPostProcessor.postProcessBeforeInstantiation() 发生在目标对象构造之前。它可以返回一个替代对象；一旦返回非 null，默认实例化、属性填充和常规初始化都会被短路，之后只继续执行初始化后处理。

这是框架级特殊扩展点，不适合普通业务初始化。

### 3. 实例化

Spring 根据定义选择构造器、静态或实例工厂方法、Supplier 等方式创建原始对象。

构造器阶段只应建立对象不变量。此时字段注入、Setter 注入、@Value 和 @PostConstruct 都尚未完成；在构造器里启动线程、注册全局回调或发布 this，会让其他代码看到半初始化对象。

### 4. 实例化后处理与属性填充

对象创建后、属性注入前，postProcessAfterInstantiation() 可以决定是否继续属性填充；postProcessProperties() 则有机会处理属性值。

AutowiredAnnotationBeanPostProcessor 正是通过这类扩展点完成 @Autowired、@Value 等注入。随后 Bean 定义中的显式属性也会应用到实例。

构造器注入在实例化时已经完成；字段和 Setter 注入属于属性填充阶段。两者不是同一个时点。

### 5. Aware 回调

依赖填充后，容器让 Bean 感知必要的基础设施。核心 BeanFactory 回调包括：

1. BeanNameAware.setBeanName()；
2. BeanClassLoaderAware.setBeanClassLoader()；
3. BeanFactoryAware.setBeanFactory()。

ApplicationContextAware、EnvironmentAware、ResourceLoaderAware 等由 ApplicationContextAwareProcessor 在初始化前处理阶段调用。

业务 Bean 应优先使用普通依赖注入。Aware 适合框架组件或确实需要容器设施的代码，滥用会把领域逻辑绑定到 Spring。

### 6. 初始化前处理

所有 BeanPostProcessor.postProcessBeforeInitialization() 依次执行。此时依赖已经填充，但最终代理不一定已经产生。

@PostConstruct 由 CommonAnnotationBeanPostProcessor 识别，因此它本质上位于初始化前处理阶段。Spring 7 使用 jakarta.annotation.PostConstruct；JDK 11 起注解不再随 JDK 自带。

### 7. 初始化方法

一个 Bean 同时配置多种初始化机制且方法名不同时，官方顺序是：

1. @PostConstruct；
2. InitializingBean.afterPropertiesSet()；
3. 自定义 initMethod。

普通业务代码优先使用 @PostConstruct 或不耦合 Spring 的自定义方法。InitializingBean 更适合框架组件。

~~~java
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.util.Map;

public final class PricingRuleCache {

    private final RuleRepository repository;
    private volatile Map<String, Rule> snapshot = Map.of();

    public PricingRuleCache(RuleRepository repository) {
        this.repository = repository;
    }

    @PostConstruct
    void initialize() {
        // 只校验配置并构建本地状态，不在单例创建锁内启动后台任务
        snapshot = Map.copyOf(repository.loadInitialRules());
    }

    @PreDestroy
    void clear() {
        // 销毁回调应幂等，即使初始化只完成了一部分也能安全执行
        snapshot = Map.of();
    }
}
~~~

Spring 当前文档特别提醒：@PostConstruct 等初始化方法运行在单例创建锁内，只适合配置校验和本地数据结构准备。长时间数据库预热、远程调用或等待其他 Bean，可能拖慢启动甚至造成初始化死锁。

### 8. 初始化后处理与 AOP 代理

最后执行 BeanPostProcessor.postProcessAfterInitialization()。Spring AOP 的自动代理创建器通常在这里把原始 Bean 包装为代理，容器对外暴露的可能已不是构造器创建的对象。

这解释了两个常见现象：

- @PostConstruct 通常运行在原始目标对象上，不能依赖该 Bean 自身的 @Transactional、@Async 拦截器；
- BeanPostProcessor 的返回值必须继续向后传递，后一个处理器看到的可能是前一个处理器包装后的对象。

需要在事务中初始化数据，应把事务逻辑放到另一个已完成代理的 Bean 中，并从更晚的启动阶段调用，而不是在当前 Bean 的 @PostConstruct 中自调用。

## 三、Bean 初始化完成不等于应用已经就绪

单个 Bean 完成初始化后，还有三个常用时点：

| 时点 | 保证 | 适用任务 |
|---|---|---|
| SmartInitializingSingleton | 常规非懒加载单例已创建 | 全局注册、跨 Bean 汇总校验 |
| SmartLifecycle.start() | 容器刷新时按 phase 启动 | 消费者、监听器、后台任务 |
| ContextRefreshedEvent | ApplicationContext 已刷新 | 应用级刷新后动作 |

SmartInitializingSingleton 不会为 prototype 或刷新后才创建的懒加载单例回调。需要管理异步组件的启动、停止和顺序时，优先使用 SmartLifecycle。

~~~java
import org.springframework.context.SmartLifecycle;

public final class OrderEventConsumer implements SmartLifecycle {

    private final ConsumerClient client;
    private volatile boolean running;

    public OrderEventConsumer(ConsumerClient client) {
        this.client = client;
    }

    @Override
    public void start() {
        // 依赖已装配且容器进入启动阶段后，再接收外部流量
        client.start();
        running = true;
    }

    @Override
    public void stop(Runnable callback) {
        // 异步停止完成后必须调用 callback，避免容器一直等待
        client.stop(() -> {
            running = false;
            callback.run();
        });
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    @Override
    public boolean isAutoStartup() {
        return true;
    }

    @Override
    public int getPhase() {
        // 正 phase：依赖组件启动后再启动，关闭时更早停止接流量
        return 100;
    }
}
~~~

启动时 phase 小的组件先启动，关闭时顺序反转。同一 phase 内不要依赖隐含顺序；有直接依赖时使用正常依赖关系或 @DependsOn 明确表达。

## 四、循环依赖为什么会出现“早期引用”

单例 Setter 或字段循环依赖场景中，Spring 可能在属性填充和初始化完成前暴露早期引用。SmartInstantiationAwareBeanPostProcessor.getEarlyBeanReference() 让代理创建器有机会提前返回与最终一致的包装对象。

这不是生命周期的正常业务扩展点，也不是应该依赖的编程模型：

- 构造器循环依赖无法靠提前暴露实例解决；
- 早期引用可能让其他 Bean 看见尚未完成注入和初始化的对象；
- AOP 包装时机与原始对象注入容易产生不一致。

正确做法是重构职责、引入事件或中间服务。@Lazy 只能延后解析，不会修复设计上的强耦合。

## 五、销毁链：先停服务，再释放资源

正常关闭 ApplicationContext 时，运行组件先收到停止通知，然后容器销毁单例。单个 Bean 的销毁回调顺序为：

1. DestructionAwareBeanPostProcessor.postProcessBeforeDestruction()，其中包含 @PreDestroy；
2. DisposableBean.destroy()；
3. 自定义 destroyMethod。

通过 @Bean 创建的对象，Spring 可自动推断公共 close() 或 shutdown() 方法；实现 AutoCloseable 的资源通常能直接进入销毁链。不希望推断时可显式设置 destroyMethod = ""。

销毁还有四个边界：

- singleton 通常由容器完整管理，并按依赖关系让依赖方先销毁；
- prototype 只负责创建、注入和初始化，容器不会自动调用其销毁回调；
- request、session、application、websocket 等作用域由相应作用域结束触发销毁；
- kill -9、断电和进程崩溃不会保证任何 Java 销毁回调执行。

因此资源关闭必须幂等，并配合超时、外部租约和服务端连接回收，不能把一致性只寄托在 @PreDestroy。

## 六、作用域会改变生命周期

Spring 内置作用域并非只有 singleton 和 prototype：

| 作用域 | 实例边界 | 销毁责任 |
|---|---|---|
| singleton | 每个 Bean 定义、每个容器一个实例 | 容器关闭 |
| prototype | 每次获取创建新实例 | 调用方负责 |
| request | 每个 HTTP 请求 | 请求结束 |
| session | 每个 HTTP Session | Session 结束 |
| application | 每个 ServletContext | Web 应用结束 |
| websocket | 每个 WebSocket 会话 | WebSocket 结束 |

将 prototype 直接注入 singleton，只会在 singleton 创建时取得一次 prototype 实例。若每次调用都需要新对象，应注入 `ObjectProvider<T>` 或使用作用域代理。

## 七、常见误区

### @PostConstruct 为什么没有执行？

常见原因包括：对象由业务代码 new 出来、类没有被注册为 Bean、处理 @PostConstruct 的后处理器没有启用，或初始化前已经抛出异常。先确认对象是否真的由当前 ApplicationContext 创建。

### @Transactional 为什么在初始化方法里失效？

初始化回调发生在最终 AOP 代理暴露之前，而且同对象自调用也不会经过代理。把事务动作放到另一个 Bean，通过 SmartInitializingSingleton、生命周期组件或明确的应用启动编排调用。

### @Lazy 是否意味着启动时完全不会创建？

不保证。Bean 可能被非懒依赖、后处理器或类型查询提前触发；SmartLifecycle 的自动启动也会显著削弱懒加载效果。懒加载是创建策略，不是隔离边界。

### BeanPostProcessor 是否会处理自己？

后处理器必须先被创建才能处理其他 Bean，因此它自身及其过早拉起的依赖可能无法获得完整后处理，例如自动代理。不要给后处理器注入普通业务依赖。

### prototype 能否依赖 @PreDestroy？

不能。Spring 把 prototype 交给调用方后不再跟踪它，销毁责任也随所有权一起移交。持有线程、文件或连接的 prototype 应实现显式 close()，由创建方用 try-with-resources 或统一资源管理器关闭。

## 八、工程检查清单

1. 构造器只建立不变量，不启动线程、不访问自身代理；
2. 优先构造器注入，减少半初始化状态；
3. @PostConstruct 只做快速校验和本地准备；
4. 跨 Bean 汇总使用 SmartInitializingSingleton；
5. 消费者、监听器和后台任务使用 SmartLifecycle 管理启停；
6. 不在 Bean 或 BeanPostProcessor 创建期间主动拉取大量业务 Bean；
7. 代理能力不在当前 Bean 初始化回调中自调用；
8. prototype 明确所有者和关闭协议；
9. 销毁方法幂等、有超时，并能处理部分初始化状态；
10. 通过启动日志、Actuator 和故障演练验证真实顺序，不只背流程图。

## 总结

Spring Bean 生命周期的主线是：定义先被注册和调整，目标对象再经历实例化、依赖注入、Aware、初始化前处理、初始化方法和初始化后处理，最后以原对象或代理形式对外暴露；容器关闭时则先停止运行组件，再按作用域和依赖关系执行销毁。

真正需要掌握的不是回调名称数量，而是每个时点能看到什么状态、对象是否已经代理、谁拥有销毁责任。把耗时任务移出 @PostConstruct，把运行组件交给 SmartLifecycle，把 prototype 清理交给明确所有者，生命周期才会从面试背诵题变成可治理的工程契约。

参考资料：

- [Spring Framework：Customizing the Nature of a Bean](https://docs.spring.io/spring-framework/reference/core/beans/factory-nature.html)
- [Spring Framework：Container Extension Points](https://docs.spring.io/spring-framework/reference/core/beans/factory-extension.html)
- [Spring Framework：Bean Scopes](https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html)
- [Spring Framework 7.0.8：AbstractAutowireCapableBeanFactory](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/beans/factory/support/AbstractAutowireCapableBeanFactory.html)
- [Spring Framework 7.0.8：InstantiationAwareBeanPostProcessor](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/beans/factory/config/InstantiationAwareBeanPostProcessor.html)
- [Spring Framework 7.0.8：SmartLifecycle](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/SmartLifecycle.html)
