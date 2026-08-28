---
title: Spring Boot 启动流程：从 main 方法到 Web 应用就绪
date: 2026-08-27
category: 后端开发
cover: /images/posts/spring-boot-startup-lifecycle-knowledge-map.webp
tags: [java, spring-boot]
excerpt: Spring Boot 启动不是简单地扫描 Bean 再启动 Tomcat，而是由 SpringApplication 串联环境准备、上下文创建、配置类解析、自动配置、容器刷新、Web 服务器初始化、Runner 和就绪事件。抓住这条主线，就能解释启动扩展点与常见失败位置。
---

# Spring Boot 启动流程：从 main 方法到 Web 应用就绪

<img src="/images/posts/spring-boot-startup-lifecycle-knowledge-map.webp" alt="Spring Boot 启动流程：从 main 方法到 Web 应用就绪知识串联图" style="border-radius: 10px;" />

Spring Boot 启动不是简单地扫描 Bean 再启动 Tomcat，而是由 SpringApplication 串联环境准备、上下文创建、配置类解析、自动配置、容器刷新、Web 服务器初始化、Runner 和就绪事件。抓住这条主线，就能解释启动扩展点与常见失败位置。

## 一、先把启动想成组装一辆智能汽车

一个最小启动类只有几行：

```java
@SpringBootApplication
public class MallApplication {

    public static void main(String[] args) {
        // 把启动类和命令行参数交给 Spring Boot
        SpringApplication.run(MallApplication.class, args);
    }
}
```

它背后可以类比为智能汽车总装：

1. **找到总装图**：`@SpringBootApplication` 声明配置入口、扫描范围和自动配置能力。
2. **确认车型与路况**：判断应用是 Servlet、Reactive 还是非 Web，并合并外部配置。
3. **准备装配车间**：创建合适的 **应用上下文**（ApplicationContext），装入环境和启动类。
4. **筛选并组装零件**：解析配置、扫描组件、评估自动配置条件，再创建 Bean。
5. **点火并宣布就绪**：容器刷新期间创建内嵌服务器，刷新完成后执行 Runner，最后发布就绪事件。

这个比喻只负责建立直觉。源码里的关键不是“五个孤立步骤”，而是 `SpringApplication.run()` 驱动的一条生命周期，并用事件把扩展点串起来。

## 二、总览：run 方法到底串了什么

主路径可以压缩成一张图：

:::mermaid
flowchart TD
    A[调用 run] --> B[准备环境]
    B --> C[创建上下文]
    C --> D[加载 Bean 定义]
    D --> E[刷新容器]
    E --> F[启动 Web 服务器]
    F --> G[执行 Runner]
    G --> H[应用就绪]
:::

以 2026-08-27 的 Spring Boot 4.1.1 官方文档为事实基线。Spring Boot 3.x 的核心主线相同，但内部类名、模块路径和部分扩展机制可能不同，排查时应对照项目实际版本源码。

**最容易记错的顺序是：Web 服务器属于容器刷新阶段，Runner 在刷新完成之后执行。** 它不是等所有 Runner 执行完才创建 Tomcat。

## 三、第一阶段：SpringApplication 先确定怎么启动

### 1、构造阶段推断应用类型

`SpringApplication.run(MallApplication.class, args)` 是静态便捷入口，内部会先创建 `SpringApplication`，再调用实例的 `run(args)`。

构造阶段会保存主配置源，并根据 classpath 推断 **Web 应用类型**（WebApplicationType）：

| 类型 | 典型条件 | 上下文方向 |
|---|---|---|
| `SERVLET` | 存在 Servlet Web 技术栈 | Servlet Web 上下文 |
| `REACTIVE` | 存在响应式 Web 技术栈且不满足 Servlet 优先条件 | Reactive Web 上下文 |
| `NONE` | 不满足 Web 条件，或被显式指定 | 普通应用上下文 |

推断依据主要来自 classpath，不是看到某个 `@Controller` 才决定。也可以显式覆盖：

```java
SpringApplication application = new SpringApplication(MallApplication.class);
// 明确作为批处理程序运行，不创建 Web 服务器
application.setWebApplicationType(WebApplicationType.NONE);
application.run(args);
```

### 2、加载早期扩展点

启动初期需要一些还不能注册为 Bean 的扩展点，例如 `SpringApplicationRunListener`、`ApplicationContextInitializer` 和部分 `ApplicationListener`。原因很简单：此时 `ApplicationContext` 还没有创建。

`SpringApplicationRunListener` 仍可通过 `META-INF/spring.factories` 被 Spring Boot 基础设施发现。它负责观察 `run()` 的关键节点，默认实现会把这些节点转成 Spring Boot 启动事件。

注意区分：

- `spring.factories` 仍承载部分框架级扩展点；
- **自动配置候选类不再以旧教程中的 `spring.factories` 为主，而是从 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` 定位。**

把两者混成同一套“SPI 加载”描述，会掩盖当前版本的真实边界。

## 四、第二阶段：准备 Environment

### 1、配置不是只按三层覆盖

`run()` 会包装命令行参数、创建或获取 `Environment`，再通过 Config Data 机制加载 `application.properties`、`application.yaml`、Profile 文件和 `spring.config.import` 指定的数据。

常见来源的覆盖关系可以简化为：

```text
命令行参数
  > Java 系统属性
  > 操作系统环境变量
  > 外部配置文件
  > jar 内配置文件
  > SpringApplication 默认属性
```

完整优先级还包括 `SPRING_APPLICATION_JSON`、JNDI、Servlet 初始化参数、测试属性和 Devtools 配置，不能把“命令行 > 系统属性 > application.yml”当成全部规则。

### 2、环境准备完成后才创建上下文

此时会发布 `ApplicationEnvironmentPreparedEvent`。它适合检查或修改已准备的 Environment，但上下文仍不存在，不能依赖普通 Bean。

若要观察配置加载细节，可临时启用：

```properties
# 输出 Config Data 查找、导入与覆盖过程
logging.level.org.springframework.boot.context.config=TRACE
```

配置问题应先查属性来源，而不是看到绑定结果不对就直接怀疑自动配置。

## 五、第三阶段：创建并准备 ApplicationContext

### 1、按应用类型创建车间

`ApplicationContextFactory` 根据 Web 应用类型创建上下文。Servlet 应用通常得到注解驱动的 Servlet Web 上下文；Reactive 与非 Web 应用使用各自实现。

随后会完成这些准备工作：

- 关联前面准备好的 `Environment`；
- 应用所有 `ApplicationContextInitializer`；
- 注册必要的单例和 BeanFactory 属性；
- 把启动参数包装为 `ApplicationArguments`；
- 将主配置源加载为 BeanDefinition。

Initializer 的位置是“上下文已创建、Bean 定义尚未完整加载或尚未刷新”。它适合做上下文级准备，不适合执行依赖完整 Bean 图的业务初始化。

### 2、事件给出了准确边界

| 事件 | 此时已经完成 | 此时还没有完成 |
|---|---|---|
| `ApplicationStartingEvent` | 监听器、初始化器已确定 | Environment 与上下文 |
| `ApplicationEnvironmentPreparedEvent` | Environment 可用 | ApplicationContext |
| `ApplicationContextInitializedEvent` | 上下文已创建，Initializer 已执行 | Bean 定义完整加载 |
| `ApplicationPreparedEvent` | Bean 定义已加载 | `refresh()` |

启动事件默认同步执行。早期监听器若做远程调用或长时间阻塞，会直接拉长启动时间，甚至让应用卡在健康检查之前。

## 六、第四阶段：扫描与自动配置变成 BeanDefinition

### 1、SpringBootApplication 是三个核心注解的组合

`@SpringBootApplication` 主要组合了：

- `@SpringBootConfiguration`：声明主配置类，本质上具备 `@Configuration` 语义；
- `@ComponentScan`：从启动类所在包向下扫描组件；
- `@EnableAutoConfiguration`：导入满足条件的自动配置。

因此启动类应放在业务根包。若它位于过深的包，兄弟包里的 Controller、Service 和 Repository 不会自动进入扫描范围。

### 2、扫描只负责发现业务组件

`@ComponentScan` 会把 `@Component`、`@Service`、`@Repository`、`@Controller` 等候选类注册为 **Bean 定义**（BeanDefinition）。此时多数 Bean 还没有实例化。

“扫描完成”等于容器知道未来要创建哪些对象，不等于对象已经全部可用。真正的大规模实例化发生在后面的 `refresh()`。

### 3、自动配置是有条件的候选配置

`@EnableAutoConfiguration` 通过导入选择器找到 `AutoConfiguration.imports` 中声明的自动配置类，再根据条件决定是否注册相关 Bean。

常见条件可以理解为装配检查单：

| 条件 | 检查内容 | 常见用途 |
|---|---|---|
| `@ConditionalOnClass` | classpath 是否存在指定类 | 依赖是否已引入 |
| `@ConditionalOnMissingBean` | 用户是否尚未提供同类 Bean | 默认配置让位于自定义配置 |
| `@ConditionalOnProperty` | 配置属性是否存在或匹配 | 功能开关 |
| `@ConditionalOnWebApplication` | 是否为指定 Web 类型 | 限定 Web 配置 |

例如，引入 JDBC 相关模块只是提供自动配置的必要条件之一。能否创建 `DataSource` 还取决于驱动、连接信息、已有 Bean 和具体自动配置条件。**“引入 starter 就必然创建某个 Bean”并不准确。**

需要查看条件判断时，可以使用：

```bash
# 输出条件评估报告，定位哪些自动配置命中或未命中
java -jar mall.jar --debug
```

## 七、第五阶段：refresh 才是真正的总装

### 1、refresh 做了哪些关键工作

`ApplicationContext.refresh()` 是 Spring 容器初始化的核心。主线包括：

1. 准备 BeanFactory；
2. 执行 `BeanFactoryPostProcessor`，包括解析配置类；
3. 注册 `BeanPostProcessor`；
4. 初始化事件广播器等上下文基础设施；
5. 创建非懒加载单例 Bean；
6. 启动生命周期组件并发布 `ContextRefreshedEvent`。

`BeanPostProcessor` 可以在 Bean 初始化前后干预对象，AOP 自动代理创建器也属于这类基础设施。更准确地说，AOP 代理通常在 Bean 初始化后的后处理阶段产生，而不是 `refresh()` 到最后统一包一遍。

### 2、Web 服务器在 refresh 期间创建

Servlet Web 上下文会在刷新回调中寻找 `ServletWebServerFactory`，据此创建内嵌服务器。使用相应 Tomcat 模块时，自动配置提供 Tomcat 工厂；替换依赖和工厂 Bean 后，也可以使用其他受支持服务器。

Web 服务器与 Spring MVC 各司其职：

- Web 服务器负责监听端口、接收连接并执行 Servlet；
- `DispatcherServlet` 负责把请求交给 Spring MVC；
- `RequestMappingHandlerMapping` 在容器初始化时发现 Controller 上的映射方法；
- Tomcat 不负责扫描 `@Controller`，也不直接注册业务接口。

端口冲突、缺少 `ServletWebServerFactory`、Servlet 初始化失败等异常，都会让 `refresh()` 失败并触发上下文关闭。

## 八、第六阶段：Runner 执行后才宣布就绪

### 1、刷新完成不等于已经 Ready

容器刷新成功后，Spring Boot 发布 `ApplicationStartedEvent`，随后将 Liveness 标记为 `CORRECT`，再按顺序调用 `ApplicationRunner` 和 `CommandLineRunner`。

Runner 适合执行必须发生在启动期的初始化：

```java
@Component
@Order(10)
public class DictionaryWarmupRunner implements ApplicationRunner {

    private final DictionaryService dictionaryService;

    public DictionaryWarmupRunner(DictionaryService dictionaryService) {
        this.dictionaryService = dictionaryService;
    }

    @Override
    public void run(ApplicationArguments args) {
        // 只加载启动必需的小型字典；大任务应异步化或独立调度
        dictionaryService.loadRequiredEntries();
    }
}
```

所有 Runner 成功后，才发布 `ApplicationReadyEvent`，随后把 Readiness 标记为 `ACCEPTING_TRAFFIC`。Runner 抛出异常会让整个启动失败。

注意：此时 Web 服务器通常已经在刷新阶段完成初始化。平台应依据 Readiness 决定是否导流；若直接访问端口而没有就绪门控，不能假设 Runner 执行期间一定收不到请求。

### 2、main 方法为什么看起来一直没结束

`SpringApplication.run()` 完成后会返回 `ApplicationContext`，`main` 方法随后可以结束。JVM 继续运行，是因为 Tomcat 工作线程等非守护线程仍然存活，而不是主线程永远停在 `run()` 内部。

Spring Boot 还会注册 JVM shutdown hook。收到正常退出信号时，它关闭上下文并触发 `@PreDestroy`、`DisposableBean` 等销毁回调。

## 九、用事件时间线定位启动卡在哪里

:::mermaid
sequenceDiagram
    participant M as main
    participant S as SpringApplication
    participant C as Context
    participant W as WebServer
    participant R as Runner
    M->>S: run(args)
    S->>S: 准备环境
    S->>C: 创建并准备
    S->>C: refresh
    C->>W: 创建并启动
    C-->>S: 刷新完成
    S->>R: 依次执行
    R-->>S: 执行成功
    S-->>M: 返回 Context
:::

排查时先确定最后出现的事件或日志：

- 环境准备前失败：检查启动参数、classpath 和早期 Listener；
- Environment 阶段失败：检查 Config Data、Profile、占位符和远程配置；
- BeanDefinition 阶段失败：检查扫描范围、配置类解析和自动配置条件；
- `refresh()` 失败：检查依赖注入、Bean 初始化、端口和服务器工厂；
- Runner 阶段失败：检查启动任务异常、超时和执行顺序；
- 已 Ready 但请求失败：问题已经不属于启动主链，应转向 MVC、网络和业务依赖。

需要量化启动耗时时，可以配置 `ApplicationStartup`，并结合 Actuator 的 `startup` 端点查看启动步骤。不要只凭一行 `Started ... in N seconds` 猜测慢点。

## 十、常见误区

1. **自动配置全部来自 `spring.factories`**：旧版本资料常这样描述；当前自动配置候选由 `AutoConfiguration.imports` 声明。
2. **扫描到类就已经创建 Bean**：扫描主要注册 BeanDefinition，非懒加载单例在刷新阶段集中创建。
3. **Runner 执行完才启动 Tomcat**：内嵌服务器属于刷新阶段，Runner 在刷新完成后执行。
4. **Tomcat 注册 Controller 接口**：Controller 映射由 Spring MVC 的 HandlerMapping 管理。
5. **命令行、系统属性、配置文件就是全部优先级**：真实 PropertySource 顺序更完整，测试和 Servlet 环境还有额外来源。
6. **main 线程一直阻塞等待请求**：`run()` 会返回，JVM 由仍存活的非守护线程维持。
7. **ApplicationReadyEvent 适合执行长任务**：同步监听器会拖慢就绪；必须阻塞启动的任务用 Runner，非必需任务应异步或外置。

## 十一、总结

Spring Boot 启动可以记成七个动作：

1. 推断应用类型并准备早期扩展点；
2. 合并参数和外部配置，形成 Environment；
3. 创建并初始化 ApplicationContext；
4. 加载启动类、组件扫描和自动配置 BeanDefinition；
5. 通过 `refresh()` 创建 Bean、代理和 Web 服务器；
6. 发布 Started 事件并执行 Runner；
7. 发布 Ready 事件，对外进入可接流量状态。

**一句话记忆：`SpringApplication` 负责导演，`ApplicationContext.refresh()` 负责总装，自动配置负责按条件补零件，WebServer 在刷新期点火，Runner 通过后应用才 Ready。**

### 1、关联知识点

- Spring Bean 生命周期：解释实例化、依赖注入、初始化与销毁的内部阶段。
- Spring Boot 自动配置：解释候选配置如何导入、排序和按条件生效。
- Spring MVC 请求链路：解释 Ready 之后 HTTP 请求如何到达 Controller。
- ApplicationContext 事件：解释启动扩展点、同步监听和失败传播。
- Kubernetes 探针：解释 Liveness 与 Readiness 如何参与发布和流量治理。

### 2、面试常问

**问：`@SpringBootApplication` 为什么通常放在根包？**

答：默认组件扫描从该类所在包向下进行，位置过深会漏掉兄弟包组件。

**问：自动配置与组件扫描有什么区别？**

答：组件扫描发现业务组件；自动配置从声明的候选配置中按 classpath、属性和现有 Bean 等条件补充基础设施。

**问：Tomcat 是在 Runner 前还是后启动？**

答：服务器在上下文刷新期间创建并启动；Runner 在刷新完成后执行，Runner 完成后才进入 Spring Boot 的 Ready 状态。

### 3、参考资料

- [Spring Boot 4.1.1：SpringApplication](https://docs.spring.io/spring-boot/reference/features/spring-application.html)
- [Spring Boot：外部化配置与 PropertySource 顺序](https://docs.spring.io/spring-boot/reference/features/external-config.html)
- [Spring Boot：使用 SpringBootApplication](https://docs.spring.io/spring-boot/reference/using/using-the-springbootapplication-annotation.html)
- [Spring Boot：自动配置](https://docs.spring.io/spring-boot/reference/using/auto-configuration.html)
- [Spring Boot：创建自动配置与 AutoConfiguration.imports](https://docs.spring.io/spring-boot/reference/features/developing-auto-configuration.html)
- [Spring Framework 7.0：ApplicationContext 与容器事件](https://docs.spring.io/spring-framework/reference/core/beans/context-introduction.html)

