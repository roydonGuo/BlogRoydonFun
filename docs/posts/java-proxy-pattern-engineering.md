---
title: Java 代理模式工程实践：静态代理、JDK 动态代理与 CGLIB
date: 2026-08-31
category: 后端开发
cover: /images/posts/java-proxy-pattern-engineering-knowledge-map.webp
tags: [java, proxy, design-pattern, reflection, spring-aop]
excerpt: 代理模式用一个可替代目标对象的入口承接调用，再统一附加鉴权、事务、监控等横切逻辑；静态代理显式稳定，JDK 动态代理面向接口，CGLIB 通过子类代理具体类，但三者都受调用边界约束。
---

# Java 代理模式工程实践：静态代理、JDK 动态代理与 CGLIB

<img src="/images/posts/java-proxy-pattern-engineering-knowledge-map.webp" alt="Java 代理模式工程实践：静态代理、JDK 动态代理与 CGLIB知识串联图" style="border-radius: 10px;" />

代理模式用一个可替代目标对象的入口承接调用，再统一附加鉴权、事务、监控等横切逻辑；静态代理显式稳定，JDK 动态代理面向接口，CGLIB 通过子类代理具体类，但三者都受调用边界约束。

## 先说结论：代理只拦截经过代理入口的调用

**代理模式**（Proxy Pattern）的核心不是“反射”，而是让调用方先访问代理对象，由代理决定是否、何时以及怎样调用真实对象。它适合访问控制、缓存、事务、审计、重试和指标等横切逻辑。

三类实现的差异可以先记成一句话：

- 静态代理：手写代理类，编译期就确定结构；
- JDK 动态代理：运行时生成接口实现类，调用统一进入 `InvocationHandler`；
- CGLIB：运行时生成目标类的子类，通过覆写方法完成拦截。

无论使用哪一种，**调用没有经过代理对象，就不会触发增强逻辑**。Spring 事务自调用失效、`final` 方法无法被 CGLIB 增强，本质都来自这条边界。

以下内容以 Java SE **25** 的 `Proxy`、`InvocationHandler` 和 Spring Framework **7.0.8** 官方文档为事实基线，核对日期为 **2026-08-31**。

## 一、代理模式包含哪些角色

一个最小代理结构有三个角色：

| 角色 | 职责 | 工程边界 |
| --- | --- | --- |
| Subject | 定义调用方依赖的稳定契约 | 不放基础设施细节 |
| Real Subject | 实现真实业务 | 不感知代理链 |
| Proxy | 持有或定位真实对象，附加横切逻辑 | 不篡改业务语义 |

调用链可以概括为：

```text
调用方 -> 代理入口 -> 前置逻辑 -> 真实对象 -> 后置逻辑 -> 返回结果
                           \-> 异常转换 / 审计 / 指标
```

代理与装饰器都通过包装对象扩展行为，但侧重点不同：代理强调访问边界和间接控制，装饰器强调按组合顺序叠加职责。工程实现可能相似，设计意图决定命名与生命周期。

## 二、静态代理：最显式，也最容易控制

静态代理直接实现相同接口，并在代码中持有真实对象：

```java
public interface PaymentService {
    PaymentResult pay(PaymentCommand command);
}

public final class RealPaymentService implements PaymentService {
    @Override
    public PaymentResult pay(PaymentCommand command) {
        // 这里只处理支付业务，不混入日志和计时。
        return new PaymentResult(command.orderId(), "SUCCESS");
    }
}

public final class AuditedPaymentService implements PaymentService {
    private final PaymentService target;

    public AuditedPaymentService(PaymentService target) {
        this.target = target;
    }

    @Override
    public PaymentResult pay(PaymentCommand command) {
        long startedAt = System.nanoTime();
        try {
            // 所有调用显式经过代理入口。
            return target.pay(command);
        } finally {
            long elapsed = System.nanoTime() - startedAt;
            System.out.println("payment elapsedNanos=" + elapsed);
        }
    }
}
```

静态代理的优点是类型清楚、调试直接、构造关系可见，不依赖运行时字节码生成。缺点是每增加一个接口或方法，都可能需要同步修改代理类；大量重复横切逻辑会造成类膨胀。

它适合少量稳定接口、明确生命周期或需要定制协议转换的边界。若只是给几十个 Service 统一加监控，动态代理更合适。

## 三、JDK 动态代理：以接口作为边界

JDK 动态代理由 `Proxy.newProxyInstance` 在运行时创建代理实例。代理类实现指定接口，每次接口方法调用都会编码为 `Method + args` 并交给 `InvocationHandler.invoke`。

```java
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;

public final class TimingProxy {
    private TimingProxy() {
    }

    public static <T> T create(Class<T> contract, T target) {
        InvocationHandler handler = (proxy, method, args) -> {
            if (method.getDeclaringClass() == Object.class) {
                // equals、hashCode、toString 也会进入处理器，必须定义一致语义。
                return invokeTarget(target, method, args);
            }

            long startedAt = System.nanoTime();
            try {
                return invokeTarget(target, method, args);
            } finally {
                System.out.println(method.getName()
                        + " elapsedNanos=" + (System.nanoTime() - startedAt));
            }
        };

        Object proxy = Proxy.newProxyInstance(
                contract.getClassLoader(),
                new Class<?>[]{contract},
                handler);
        return contract.cast(proxy);
    }

    private static Object invokeTarget(Object target, Method method, Object[] args)
            throws Throwable {
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException ex) {
            // 解包真实业务异常，避免把反射包装异常泄露给调用方。
            throw ex.getCause();
        }
    }
}
```

使用时只能按代理实现的接口接收：

```java
PaymentService service = TimingProxy.create(
        PaymentService.class,
        new RealPaymentService());
service.pay(new PaymentCommand("ORDER-1001", 1000));
```

### 1、接口、类型与异常边界

JDK 代理实例是接口类型，不是目标实现类。把它强转为 `RealPaymentService` 会得到 `ClassCastException`。依赖注入和公开 API 应面向接口，不能一边选择接口代理，一边要求具体实现类型。

处理器抛出的受检异常还必须兼容接口方法的 `throws` 声明，否则调用方可能收到 `UndeclaredThrowableException`。反射调用应解包 `InvocationTargetException`，日志则记录原始异常类型和业务上下文。

### 2、默认方法与 Object 方法

Java SE 25 中，接口默认方法同样先进入 `InvocationHandler`。需要执行接口默认实现时，可在 `method.isDefault()` 分支调用 `InvocationHandler.invokeDefault(proxy, method, args)`。

`equals`、`hashCode`、`toString` 也会进入处理器。不要对 `equals` 再调用 `proxy.equals(...)`，否则会递归进入处理器；应为代理身份、目标身份或业务键选择一种稳定策略。

## 四、CGLIB：通过子类代理具体类

**CGLIB 代理**（Code Generation Library Proxy）为目标类生成运行时子类，并覆写可代理方法。Spring 已将 CGLIB 重新打包进 `spring-core`，普通 Spring AOP 使用不需要额外声明 CGLIB 依赖。

```java
import org.aopalliance.intercept.MethodInterceptor;
import org.springframework.aop.framework.ProxyFactory;

PaymentFacade target = new PaymentFacade();

ProxyFactory factory = new ProxyFactory(target);
factory.setProxyTargetClass(true); // 强制使用目标类子类代理。
factory.addAdvice((MethodInterceptor) invocation -> {
    long startedAt = System.nanoTime();
    try {
        return invocation.proceed();
    } finally {
        System.out.println(invocation.getMethod().getName()
                + " elapsedNanos=" + (System.nanoTime() - startedAt));
    }
});

PaymentFacade proxy = (PaymentFacade) factory.getProxy();
proxy.pay();
```

子类代理的边界来自 Java 继承规则：

- `final` 类不能被继承，因此不能创建 CGLIB 子类代理；
- `final` 方法不能覆写，因此不会被增强；
- `private` 方法不能覆写，因此不会被增强；
- 跨包不可见的父类包级方法等同于不可覆写；
- Java 模块系统可能限制为特定包生成或定义子类。

CGLIB 解决的是“没有业务接口也要代理”的问题，不是绕过 Java 访问控制的万能工具。

## 五、Spring 到底怎样选择代理

Spring AOP 使用 JDK 动态代理或 CGLIB。Spring Framework 核心的常规规则是：目标实现至少一个接口时使用 JDK 代理；没有接口时使用 CGLIB。具体应用还可能被 Spring Boot 属性、`proxyTargetClass` 或 Spring 7 的 `@Proxyable` 改写，因此不能只凭“类有接口”猜线上类型。

| 需求 | 优先选择 | 原因 |
| --- | --- | --- |
| 对外已有稳定业务接口 | JDK 动态代理 | 类型边界明确，依赖倒置 |
| 旧类没有接口 | CGLIB | 可直接代理具体类的可覆写方法 |
| 代理逻辑少且高度定制 | 静态代理 | 调试简单，控制最直接 |
| 需要拦截字段或构造器 | AspectJ 等字节码织入 | Spring AOP 只支持方法执行连接点 |

代理类型不应按微基准的微小差异决定。更重要的是接口契约、可代理方法范围、容器配置与团队可诊断性。

## 六、自调用为什么绕过增强

```java
public class OrderService {
    public void createOrder() {
        // this 指向目标对象，不会重新经过外层代理。
        this.reserveInventory();
    }

    public void reserveInventory() {
        // 例如这里声明了 @Transactional 或 @Retryable。
    }
}
```

外部调用 `proxy.createOrder()` 时，代理只拦截第一次入口。进入目标对象后，`this.reserveInventory()` 是普通 Java 方法调用，不会回到代理，因此对应 Advice 没有执行机会。

优先把 `reserveInventory` 拆到另一个职责清晰的 Bean，通过依赖调用让请求自然经过代理。自注入会增加循环关系，`AopContext.currentProxy()` 还会把业务代码绑定到 Spring AOP，通常只作为最后手段。

AspectJ 编译期或加载期织入修改的是字节码调用点，不依赖外层代理入口，因此没有同样的自调用问题，但构建、部署和诊断成本也更高。

## 七、真实项目最容易踩的五个坑

### 1、代理方法里无界重试

代理能统一重试，不代表所有调用都可重试。写操作超时可能已经产生副作用，必须具备稳定幂等键、结果查询、总超时和有限次数。

### 2、切面顺序没有契约

事务、重试、缓存、权限和指标的顺序会改变语义。例如“事务包住重试”与“每次重试创建新事务”完全不同。应显式定义顺序，并在日志中记录实际代理链。

### 3、处理器吞掉真实异常

把所有异常转换成统一 `RuntimeException` 会破坏上层重试、事务回滚和 HTTP 映射。代理只转换边界异常，业务异常保持原语义。

### 4、把代理当安全边界

代码可以直接持有目标对象、通过自调用绕过代理，代理配置也可能被关闭。鉴权必须同时落在可信入口和业务数据边界，不能只依赖一条易绕过的 Advice。

### 5、日志泄露参数

通用代理最容易把密码、令牌、身份证号和完整请求体写进日志。只记录白名单字段、参数摘要、耗时、结果码与追踪 ID，敏感值必须脱敏。

## 八、上线前检查清单

1. 调用方依赖接口还是具体类，是否与代理类型一致；
2. 所有需要增强的方法是否确实经过代理入口；
3. CGLIB 目标是否存在 `final`、`private` 或不可见方法；
4. JDK 处理器是否正确处理默认方法、Object 方法和受检异常；
5. 多个 Advice 的顺序、事务与重试边界是否明确；
6. 代理实例和目标实例由谁创建、缓存与销毁；
7. 日志、指标和追踪是否避免记录敏感参数；
8. 运行时能否输出代理类型、目标类型和 Advisor 链用于排障。

## 九、总结

静态代理、JDK 动态代理和 CGLIB 都在解决同一个问题：让调用先经过受控入口，再把请求交给真实对象。静态代理用代码换透明度，JDK 代理用接口换通用性，CGLIB 用继承换具体类兼容性。

**一句话可记：代理能增强的永远是“经过代理入口且可被代理”的方法调用。**

**关联知识点**：装饰器模式关注职责叠加；适配器模式关注接口转换；Spring AOP 用代理实现方法级 Advice；AspectJ 通过字节码织入覆盖更多连接点；事务与重试顺序决定失败语义。

**面试常问**：JDK 代理为什么需要接口？因为运行时代理类实现的是指定接口；CGLIB 为什么不能代理 `final` 方法？因为子类无法覆写；Spring 事务自调用为什么失效？因为 `this` 调用没有再次经过代理。

**参考资料**：

- [Java SE 25：Proxy](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/Proxy.html)
- [Java SE 25：InvocationHandler](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/InvocationHandler.html)
- [Spring Framework：Proxying Mechanisms](https://docs.spring.io/spring-framework/reference/core/aop/proxying.html)
- [Spring Framework：Spring AOP Capabilities and Goals](https://docs.spring.io/spring-framework/reference/core/aop/introduction-spring-defn.html)
