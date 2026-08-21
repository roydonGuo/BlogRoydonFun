---
title: Java 单例模式工程实践：七种实现、JMM 与 Spring 边界
date: 2026-08-18
category: 后端开发
cover: /images/posts/java-singleton-pattern-engineering-knowledge-map.webp
tags: [java, design-patterns, singleton, concurrency, spring]
excerpt: 从对象唯一性与安全发布出发，完整比较 Java 单例的七种实现，讲清双重检查锁、静态内部类、枚举、ClassLoader、序列化以及 Spring 容器边界。
---

# Java 单例模式工程实践：七种实现、JMM 与 Spring 边界

<img src="/images/posts/java-singleton-pattern-engineering-knowledge-map.webp" alt="Java 单例模式工程实践：七种实现、JMM 与 Spring 边界知识串联图" style="border-radius: 10px;" />

从对象唯一性与安全发布出发，完整比较 Java 单例的七种实现，讲清双重检查锁、静态内部类、枚举、ClassLoader、序列化以及 Spring 容器边界。

先说结论：普通 Java 代码需要延迟初始化时，优先使用静态内部类；需要天然抵抗反序列化和常规反射破坏时，优先使用枚举；Spring 项目里的无状态服务通常直接交给容器管理，不要再套一层手写单例。双重检查锁可以正确实现，但 `volatile` 不能省；“只有一个对象”也不等于“对象内部线程安全”。

本文以 **Java SE 25 语言规范与序列化规范**、**Spring Framework 当前官方参考文档**为核对基线，事实核对时间为 **2026-08-18**。类初始化与并发语义以 [JLS 12.4](https://docs.oracle.com/javase/specs/jls/se25/html/jls-12.html#jls-12.4) 和 [JLS 17.4.5](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.4.5) 为准；枚举边界以 [JLS 8.9](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.9) 与 [Java 对象序列化规范](https://docs.oracle.com/en/java/javase/25/docs/specs/serialization/serial-arch.html#serialization-of-enum-constants) 为准；Spring Bean 作用域以 [Spring Bean Scopes](https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html) 为准。

## 一、单例到底保证什么

GoF 单例模式的目标可以拆成三件事：

1. 构造入口受控，调用方不能随意 `new`；
2. 在约定的作用域内只有一个实例；
3. 提供一个稳定的全局访问入口。

这里最容易忽略的是“约定的作用域”。手写 Java 单例通常是**每个定义它的 ClassLoader 一个实例**，不是一台机器、一个 JVM 进程甚至一个集群永远只有一个。应用服务器、插件系统、热部署框架和模块隔离都可能用多个 ClassLoader 分别加载同一个类，从而得到多个静态字段和多个实例。

单例也只约束实例数量，不自动解决以下问题：

- 实例内部的可变集合是否并发安全；
- 多个业务操作是否需要原子性；
- 进程重启后状态是否保留；
- 集群节点之间是否共享状态；
- 初始化失败后如何恢复；
- 资源是否能被正确关闭。

因此，一个保存可变 `HashMap` 的单例仍然可能产生数据竞争；一个单机单例也不能替代 Redis 分布式锁、数据库唯一约束或配置中心。

## 二、七种实现完整对比

### 1. 饿汉式：静态字段直接初始化

```java
public final class StaticFieldRegistry {

    // 类初始化阶段创建，JVM 负责初始化同步与安全发布
    private static final StaticFieldRegistry INSTANCE =
            new StaticFieldRegistry();

    private StaticFieldRegistry() {
        // 私有构造器阻止业务代码直接 new
    }

    public static StaticFieldRegistry getInstance() {
        return INSTANCE;
    }
}
```

这是最直接、最不容易写错的实现。JLS 12.4.2 规定了类初始化的同步过程；类初始化正常完成后，其他线程再使用该类时能够看到已完成的静态初始化结果。

它的代价是首次主动使用类时就创建实例，即使当前业务路径最终没有使用该对象。对于创建成本低、一定会使用且失败应尽早暴露的组件，这反而是优点。

### 2. 饿汉式：静态代码块初始化

```java
public final class StaticBlockRegistry {

    private static final StaticBlockRegistry INSTANCE;

    static {
        // 适合初始化前需要少量校验或异常转换的场景
        INSTANCE = new StaticBlockRegistry(loadRequiredConfig());
    }

    private StaticBlockRegistry(String config) {
        // 保存初始化所需的不可变配置
    }

    private static String loadRequiredConfig() {
        String value = System.getProperty("registry.endpoint");
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少 registry.endpoint");
        }
        return value;
    }

    public static StaticBlockRegistry getInstance() {
        return INSTANCE;
    }
}
```

线程安全性与静态字段方式相同，区别只是静态代码块可以容纳分支、校验和异常转换。需要注意：若静态初始化抛出异常，类会进入初始化失败状态；后续使用通常不会像普通方法那样自然重试。因此不要在静态块里执行不可控的远程调用，也不要把临时网络故障固化成类初始化失败。

### 3. 懒汉式：无同步延迟初始化

```java
public final class UnsafeLazyRegistry {

    private static UnsafeLazyRegistry instance;

    private UnsafeLazyRegistry() {
    }

    public static UnsafeLazyRegistry getInstance() {
        if (instance == null) {
            // 多线程可能同时进入并创建多个对象
            instance = new UnsafeLazyRegistry();
        }
        return instance;
    }
}
```

这种写法只适用于能够严格证明单线程访问的封闭场景，不适合 Web 服务。两个线程可能同时读到 `null`，分别创建对象；共享引用还缺少可靠的安全发布关系。它常见于面试题的反例，不应因为“本地压测没复现”就进入生产代码。

### 4. 懒汉式：同步整个访问方法

```java
public final class SynchronizedLazyRegistry {

    private static SynchronizedLazyRegistry instance;

    private SynchronizedLazyRegistry() {
    }

    public static synchronized SynchronizedLazyRegistry getInstance() {
        if (instance == null) {
            // 类锁保护检查与创建，保证只初始化一次
            instance = new SynchronizedLazyRegistry();
        }
        return instance;
    }
}
```

该实现简单且线程安全。每次调用都要进入同一个类监视器，但不要仅凭“有锁”就断定它一定成为性能瓶颈；应先看访问频率和真实性能数据。对于初始化后被高频获取的基础组件，静态内部类更清晰；对于低频管理代码，同步方法往往已经足够。

### 5. 懒汉式：双重检查锁

```java
public final class DoubleCheckedRegistry {

    // volatile 同时提供可见性与发布所需的顺序约束，不能删除
    private static volatile DoubleCheckedRegistry instance;

    private DoubleCheckedRegistry() {
    }

    public static DoubleCheckedRegistry getInstance() {
        DoubleCheckedRegistry result = instance;
        if (result == null) {
            synchronized (DoubleCheckedRegistry.class) {
                result = instance;
                if (result == null) {
                    result = new DoubleCheckedRegistry();
                    instance = result;
                }
            }
        }
        return result;
    }
}
```

两次检查分别解决不同问题：外层检查避免初始化完成后仍然加锁，内层检查避免多个线程排队进入锁后重复创建。局部变量 `result` 减少对 `volatile` 字段的重复读取，是可选的小优化。

关键不是背诵“禁止指令重排”，而是理解 JMM 契约：JLS 17.4.5 规定，对 `volatile` 字段的写 happens-before 后续线程对同一字段的读。构造完成后的引用通过 `volatile` 写发布，读取线程才能在该顺序关系下观察到完整初始化。删除 `volatile` 后，双重检查不再是正确实现。

### 6. 静态内部类：Initialization-on-demand Holder

```java
public final class HolderRegistry {

    private HolderRegistry() {
    }

    private static class Holder {
        // 只有首次主动使用 Holder 时才初始化
        private static final HolderRegistry INSTANCE = new HolderRegistry();
    }

    public static HolderRegistry getInstance() {
        return Holder.INSTANCE;
    }
}
```

外部类加载不等于内部类立即初始化。首次访问 `Holder.INSTANCE` 时，JVM 执行 `Holder` 的类初始化，并负责同步和安全发布，因此同时获得延迟加载、线程安全和无手写锁的读取路径。

对大多数不依赖容器的 Java 单例，这是最均衡的方案。它仍可能被反射调用私有构造器创建额外实例，也仍是每个 ClassLoader 一份；若这些边界重要，需要额外防护或选择枚举。

### 7. 枚举单例

```java
public enum IdGenerator {
    INSTANCE;

    public String nextId(long sequence) {
        // 示例保持无状态；真实项目需明确序列的持久化与集群边界
        return Long.toUnsignedString(sequence, 36);
    }
}
```

枚举常量本质上是受语言和运行时特殊约束的实例。JLS 8.9 明确说明：枚举不能被显式实例化，反射式创建被禁止，`Enum` 的 `final clone` 阻止克隆；序列化规范按枚举常量名称恢复既有常量，不会像普通 `Serializable` 类那样调用构造器创建新对象。

因此，枚举是“需要强单例语义且不依赖继承”的稳妥选择。它的局限也很明确：写法会暴露枚举类型语义，不能继承其他类，初始化时机仍随枚举类初始化发生，也不适合需要由 Spring 注入复杂依赖的业务服务。

## 三、怎么选：不要只看线程安全

| 实现 | 延迟初始化 | 线程安全 | 反序列化保持唯一 | 代码复杂度 | 建议 |
|---|---:|---:|---:|---:|---|
| 静态字段 | 否 | 是 | 默认否 | 低 | 轻量、必用组件 |
| 静态代码块 | 否 | 是 | 默认否 | 低 | 初始化需校验但不做远程调用 |
| 无同步懒汉 | 是 | 否 | 默认否 | 低 | 仅作反例或严格单线程 |
| 同步方法 | 是 | 是 | 默认否 | 低 | 低频访问、简单优先 |
| 双重检查锁 | 是 | 是，必须 `volatile` | 默认否 | 高 | 确有延迟与高频读取需求 |
| 静态内部类 | 是 | 是 | 默认否 | 低 | 普通 Java 代码首选 |
| 枚举 | 初始化枚举类时 | 是 | 是 | 低 | 强唯一语义首选 |

“默认否”表示普通类若实现了 `Serializable`，还需正确实现 `readResolve` 才能让反序列化返回既有实例；但反射、克隆、多个 ClassLoader 等边界仍需分别处理。不要把一个补丁误认为覆盖全部实例创建路径。

## 四、真实工程示例：SDK 签名器与 Spring 服务

### 1. 容器外的无状态 SDK 工具

假设一个支付 SDK 需要复用无状态的请求规范化器，没有依赖注入需求，可以使用枚举单例：

```java
public enum CanonicalRequestBuilder {
    INSTANCE;

    public String build(String method, String path, String bodyHash) {
        // 只处理纯函数式拼装，不在单例内部保存某次请求的数据
        return method + "\n" + path + "\n" + bodyHash;
    }
}
```

调用方使用 `CanonicalRequestBuilder.INSTANCE.build(...)`。请求参数全部来自方法入参，实例内部无用户、租户、Token 或临时缓冲区字段，因此多个线程共享同一个实例不会串数据。

### 2. Spring 项目不要重复造生命周期

```java
import org.springframework.stereotype.Service;

@Service
public class PaymentSignatureService {

    private final MerchantKeyProvider keyProvider;

    public PaymentSignatureService(MerchantKeyProvider keyProvider) {
        // 依赖由 Spring 容器装配，便于替换配置来源和生命周期治理
        this.keyProvider = keyProvider;
    }

    public String sign(String merchantId, String canonicalRequest) {
        String privateKey = keyProvider.loadPrivateKey(merchantId);
        return doSign(privateKey, canonicalRequest);
    }

    private String doSign(String privateKey, String content) {
        // 示例省略具体算法；生产代码应使用经过审查的密码库
        throw new UnsupportedOperationException("示例仅展示生命周期边界");
    }
}
```

Spring 的 `singleton` 默认表示：**每个 IoC 容器中，每个 Bean 定义对应一个共享实例**。它不是 GoF 单例的“每个 ClassLoader 每个类一个实例”。同一个类可以注册为两个不同 Bean；父子容器、多个 `ApplicationContext` 或测试上下文也可能各自拥有实例。

把 `@Service` 再配上私有构造器、静态 `getInstance()` 和容器注入，会产生两个互相竞争的生命周期来源。依赖注入、代理、配置刷新和资源销毁都会变得更难推理。Spring 业务服务应让容器成为唯一创建入口。

## 五、常见追问

### 单例 Bean 一定线程安全吗

不一定。Spring 只保证共享同一个 Bean 实例，不会把业务方法自动变成原子操作。单例 Bean 最适合无状态设计；请求级变量放在方法局部变量中，不要写进实例字段。共享缓存应使用有明确并发契约的数据结构，共享计数与状态迁移应使用锁、原子类、数据库约束或外部状态服务。

### `final` 实例字段能代替 `volatile instance` 吗

不能把两者混为一谈。正确构造的 `final` 字段有专门的内存模型语义，但共享的单例引用仍需要安全发布。双重检查锁用 `volatile instance` 建立发布关系；静态字段和静态内部类则借助类初始化协议完成安全发布。

### `synchronized` 方法是不是一定很慢

不能脱离访问频率和运行环境判断。它的语义最清楚，低频路径的锁成本往往不是主要矛盾。只有基准测试和生产观测证明获取入口是热点时，才值得为了减少加锁选择更复杂的双重检查；更多时候静态内部类已经同时满足清晰和性能需求。

### 单例能当本地缓存吗

实例唯一不等于缓存治理完整。本地缓存还需要容量上限、过期、加载抑制、刷新、统计和故障降级。高并发项目优先使用成熟缓存库；跨节点一致性需求则要评估 Redis 等外部系统，不能因为类是单例就假设集群共享。

### 多个 ClassLoader 为什么会产生多个单例

静态字段属于“某个类的定义”，而类身份包含定义它的 ClassLoader。两个互相隔离的 ClassLoader 分别加载同名类，会得到两个 `Class` 对象、两份静态字段和两个实例。插件、应用服务器和热部署场景要把全局资源的所有权放在共同父加载器、容器注册表或进程外服务中。

## 六、典型踩坑

### 1. 构造器泄漏 `this`

在构造器里启动线程、注册回调或把 `this` 放入全局集合，可能让其他代码在初始化完成前看到对象。即使单例获取方法写对，也会被构造过程的提前逃逸破坏。构造器只建立对象不变量，启动动作放到安全发布之后的显式生命周期方法中。

### 2. 单例保存请求状态

把 `currentUserId`、本次订单、临时签名串或可变 `StringBuilder` 放进单例字段，会让并发请求互相覆盖。请求数据使用局部变量或明确的 request scope；真正共享的数据必须设计并发协议。

### 3. 静态初始化做远程 IO

类初始化期间请求数据库或配置中心，一旦超时或抛异常，可能导致类初始化失败并影响后续使用。远程依赖应有显式的超时、重试、降级和健康状态，不应藏在静态块里。

### 4. 普通序列化产生第二个实例

普通类实现 `Serializable` 后，反序列化可能绕过普通构造路径产生新对象。若确实必须序列化单例，可用 `readResolve` 返回既有实例，但应继续评估 ClassLoader 与反射边界；更简单的选择通常是不序列化服务对象，只序列化状态 DTO。

### 5. 用单例代替资源池

数据库连接、HTTP 连接和线程不是“只创建一个就最好”。它们通常需要池化、并发上限、超时、健康检查和关闭协议。单例可以持有一个线程安全的池管理器，但不能把单个非线程安全连接直接共享给所有请求。

## 七、最佳实践

1. 先确认是否真的需要全局访问；能由依赖注入表达的对象优先注入；
2. 明确唯一性的作用域：ClassLoader、Spring 容器、ServletContext、进程还是集群；
3. 普通 Java 延迟初始化优先静态内部类，强唯一语义优先枚举；
4. 使用双重检查锁时必须保留 `volatile` 和内层第二次检查；
5. 单例保持无状态或不可变，共享可变状态另行设计并发协议；
6. 构造器不泄漏 `this`，静态初始化不执行不可控远程 IO；
7. 不序列化服务对象；确有需要时显式处理反序列化身份；
8. Spring Bean 交给容器管理，不混用静态访问器和私有生命周期；
9. 插件、热部署和多容器环境显式验证 ClassLoader 与容器边界；
10. 集群唯一性依赖数据库、Redis、协调服务或平台能力，不依赖 JVM 单例。

## 总结

Java 单例的难点不在于把构造器改成 `private`，而在于同时回答三个问题：何时创建、如何安全发布、唯一性到底覆盖多大范围。饿汉式借助类初始化获得简单可靠的并发语义；同步懒汉以可读性换取每次加锁；双重检查锁依赖 `volatile` 建立正确发布；静态内部类把延迟初始化交给 JVM；枚举进一步覆盖反射、克隆和序列化边界。

进入 Spring 后，问题从“这个类只能创建一次”转为“哪个容器、哪个 Bean 定义负责它的生命周期”。真正可维护的选择通常不是最炫的写法，而是让实例作用域、状态所有权、并发规则和销毁责任都能被团队一眼看懂。
