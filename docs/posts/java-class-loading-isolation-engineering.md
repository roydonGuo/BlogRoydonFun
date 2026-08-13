---
title: Java 类加载工程实践：生命周期、双亲委派与类隔离
date: 2026-08-13
category: 后端开发
cover: /covers/backend.svg
tags: [java, jvm, classloader, spi, plugin]
excerpt: 从 Java SE 21 的类加载规范出发，讲清加载、链接、初始化的完整生命周期，双亲委派与类身份，并用可卸载插件示例串起 SPI、类隔离、故障诊断和资源治理。
---

# Java 类加载工程实践：生命周期、双亲委派与类隔离

<img src="/images/posts/java-class-loading-isolation-engineering-knowledge-map.png" alt="Java 类加载工程实践：生命周期、双亲委派与类隔离知识串联图" style="border-radius: 10px;" />

从 Java SE 21 的类加载规范出发，讲清加载、链接、初始化的完整生命周期，双亲委派与类身份，并用可卸载插件示例串起 SPI、类隔离、故障诊断和资源治理。

## 先说结论：类名相同，不代表是同一个类型

Java 类加载最容易被背诵成“加载、验证、准备、解析、初始化”五个词，却在插件冲突、热部署泄漏和 `ClassCastException` 出现时失去解释力。工程上更重要的结论有六条：

1. JVM 规范的主流程是 **加载（Loading）→ 链接（Linking）→ 初始化（Initialization）**，链接内部再分验证、准备和解析；
2. 一个类型的运行时身份由 **二进制类名 + 定义它的类加载器** 共同决定；
3. 双亲委派是 `ClassLoader` 的常规搜索策略，不是 JVM 强制所有自定义加载器遵守的唯一拓扑；
4. 准备阶段只给静态字段设置默认值，显式赋值和静态代码块通常在初始化阶段执行；
5. Java 9 之后内置层次应表述为 Bootstrap、Platform、System/Application，不再把 Extension ClassLoader 当成当前模型；
6. 类隔离不只要解决“能否加载”，还要治理线程上下文加载器、SPI 缓存、线程、资源句柄和卸载生命周期。

本文以 Java SE 21、JVMS 21 为基线，事实核对时间为 2026-08-13。生命周期以 [JVMS 21 第 5 章](https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-5.html) 为准，类加载器契约以 [Java SE 21 `ClassLoader`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/ClassLoader.html) 和 [`ServiceLoader`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/ServiceLoader.html) API 为准。

## 一、完整生命周期不是简单的五步串行

### 1. 加载：找到二进制表示并创建类型

加载阶段根据二进制类名寻找类或接口的二进制表示，交给 JVM 创建内部表示。字节码不一定来自本地 `.class` 文件，也可以来自 JAR、网络、加密存储或运行时生成结果。

需要区分两个角色：

- **定义加载器（defining loader）**：最终调用 `defineClass` 定义类型；
- **发起加载器（initiating loader）**：向 JVM 发起或参与委派加载请求。

发生委派时，两者可能不是同一个。数组类也比较特殊：它由 JVM 按需创建，引用类型数组的加载器与其元素类型相同，基本类型数组没有类加载器。

### 2. 链接：让类型进入可执行的运行时状态

链接包括三个部分：

| 阶段 | 做什么 | 典型失败 |
|---|---|---|
| 验证 Verification | 检查 Class 文件结构、字节码和类型约束是否成立 | `VerifyError`、其他 `LinkageError` |
| 准备 Preparation | 创建静态字段并赋 JVM 默认值，同时建立必要约束 | `OutOfMemoryError`、`LinkageError` |
| 解析 Resolution | 把运行时常量池中的符号引用解析为具体类、字段、方法等 | `NoClassDefFoundError`、`IllegalAccessError`、`NoSuchMethodError` 等 |

解析不保证在初始化前一次性完成。JVMS 允许实现采用延迟解析，也允许更积极地提前解析，只要错误在程序实际需要相关引用的位置抛出。因此，“类已经初始化”并不等于它引用的每个类型和方法都已经成功解析。

### 3. 准备与初始化最容易混淆

看下面的类：

```java
public final class PricingRules {

    private static int timeoutSeconds = 30;
    private static final int MAX_RETRY = 3;

    static {
        // 初始化阶段执行，真实项目不应在这里发远程请求
        timeoutSeconds = loadTimeoutFromLocalConfig();
    }
}
```

准备阶段会为 `timeoutSeconds` 创建存储并设置默认值 `0`；`timeoutSeconds = 30` 与静态代码块会被编译进类初始化方法 `<clinit>`，在初始化阶段按文本顺序执行。带 `ConstantValue` 属性的编译期常量有特殊处理，不能用“所有 `static final` 都到初始化阶段才赋值”概括。

### 4. 初始化：执行 `<clinit>`，而且有并发语义

常见的主动使用触发包括：

- `new` 创建实例；
- 读取或写入声明在该类中的非常量静态字段；
- 调用声明在该类中的静态方法；
- 某些反射和方法句柄操作；
- 初始化一个类时，先初始化它尚未初始化的父类；
- JVM 启动时初始化入口类。

`Class.forName("com.example.Plugin")` 默认会初始化类，而 `ClassLoader.loadClass(...)` 通常只保证加载，不能用它假设静态代码已经执行。需要精确控制时，可使用 `Class.forName(name, initialize, loader)` 明确是否初始化。

JVM 会为每个类或接口维护唯一的初始化锁。同一时刻一个线程执行初始化，其他线程等待；同一线程递归请求当前类初始化可以正常返回。如果 `<clinit>` 首次失败，该类型会进入错误状态，后续主动使用通常看到 `NoClassDefFoundError`，根因则可能藏在首次失败的 `ExceptionInInitializerError` 中。

因此，静态初始化应保持短小、确定、无外部副作用。不要在其中访问数据库、注册无限期线程或依赖尚未建立的 Spring 容器状态。

## 二、Java 21 的内置类加载器

Java SE 21 API 列出三类运行时内置加载器：

| 加载器 | Java 层表现 | 主要职责 |
|---|---|---|
| Bootstrap Class Loader | 通常以 `null` 表示 | JVM 内建，加载核心基础类 |
| Platform Class Loader | `ClassLoader.getPlatformClassLoader()` | 加载 Java SE 平台 API、实现类和部分 JDK 运行时类 |
| System/Application Class Loader | `ClassLoader.getSystemClassLoader()` | 通常加载应用 class path、module path 与 JDK 工具类 |

Java 8 常见资料里的 Extension ClassLoader 对应旧扩展机制。Java 9 引入模块系统后，当前 API 使用 Platform Class Loader 描述平台层；排查 Java 17、21 服务时不要继续按 `lib/ext` 的旧模型推断。

可以用一段诊断代码观察实际归属：

```java
public final class LoaderProbe {

    public static void main(String[] args) {
        print(String.class);       // 通常为 bootstrap，因此 getClassLoader() 返回 null
        print(java.sql.Driver.class);
        print(LoaderProbe.class);  // 通常由 system/application loader 定义
    }

    private static void print(Class<?> type) {
        ClassLoader loader = type.getClassLoader();
        System.out.printf("class=%s, module=%s, loader=%s%n",
                type.getName(),
                type.getModule().getName(),
                loader == null ? "bootstrap" : loader);
    }
}
```

这里的“父加载器”也不等同于 Java 对象继承关系。它表示委派搜索链；Bootstrap 甚至通常没有一个可直接取得的 Java 对象。

## 三、双亲委派到底委派了什么

`ClassLoader.loadClass` 的常规顺序可以概括为：

```text
检查当前加载器是否已经加载
        ↓ 未命中
委派父加载器（直到 Bootstrap）
        ↓ 父加载失败
当前加载器执行 findClass
        ↓
按需 resolveClass
```

它带来三类直接收益：

1. **核心类型优先**：应用依赖不会轻易覆盖 `java.lang.String` 等平台类；
2. **共享类型一致**：父层已定义的 API 能被多个子加载器共同使用；
3. **减少重复定义**：同一委派树中的公共依赖通常只由上层定义一次。

但必须修正两个常见误解。

第一，委派不是“父加载器主动向下加载”，而是当前加载器先请求父级；父级找不到时，当前加载器才尝试自己的来源。

第二，JVM 规范允许用户自定义加载器采取其他行为。`ClassLoader` 文档说的是通常使用 delegation model，而不是要求所有容器都只能 parent-first。应用服务器、插件框架、OSGi 等会按隔离目标设计不同拓扑。

## 四、类身份解释了最诡异的 ClassCastException

假设两个插件 JAR 都包含 `com.example.payment.PayCommand`，分别由 `loaderA` 和 `loaderB` 定义：

```java
Class<?> a = loaderA.loadClass("com.example.payment.PayCommand");
Class<?> b = loaderB.loadClass("com.example.payment.PayCommand");

System.out.println(a.getName().equals(b.getName())); // true：二进制类名相同
System.out.println(a == b);                          // false：定义加载器不同
System.out.println(a.isAssignableFrom(b));           // false：运行时类型不同
```

即使字节码完全相同，`a` 和 `b` 也不是同一个类型。于是会出现“`PayCommand cannot be cast to PayCommand`”这种表面矛盾的错误。

稳妥的插件边界应把共享 API 放在父加载器中：

```text
Application ClassLoader
└── plugin-api.jar：PaymentPlugin、PaymentRequest、PaymentResult
    ├── PluginClassLoader A：alipay-plugin.jar + 私有依赖
    └── PluginClassLoader B：card-plugin.jar + 私有依赖
```

插件实现由各自子加载器定义，但接口与跨边界 DTO 只由父加载器定义。跨边界不要传插件私有实现类、第三方库对象或动态代理生成类；优先传父层 API、JDK 类型和稳定的序列化数据。

## 五、真实示例：用 ServiceLoader 装载隔离插件

先在父加载器可见的 `plugin-api.jar` 中声明稳定接口：

```java
public interface PricingPlugin {

    String code();

    Money calculate(PricingRequest request);

    default void close() {
        // 插件可覆盖，用于关闭线程池、连接和其他资源
    }
}
```

每个插件 JAR 在 `META-INF/services/com.example.api.PricingPlugin` 中写入实现类名。宿主按插件目录创建独立加载器：

```java
import java.io.IOException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.ServiceLoader;

public final class PluginHandle implements AutoCloseable {

    private final URLClassLoader classLoader;
    private final List<PricingPlugin> plugins;

    private PluginHandle(URLClassLoader classLoader,
                         List<PricingPlugin> plugins) {
        this.classLoader = classLoader;
        // Handle 内部保留可清理副本，避免关闭时修改调用方集合
        this.plugins = new ArrayList<>(plugins);
    }

    public static PluginHandle load(Path pluginJar) throws IOException {
        URL jarUrl = pluginJar.toUri().toURL();

        // 共享 API 由宿主加载器定义，确保插件实现可转换为 PricingPlugin
        ClassLoader apiLoader = PricingPlugin.class.getClassLoader();
        URLClassLoader pluginLoader =
                new URLClassLoader(new URL[]{jarUrl}, apiLoader);

        try {
            // 显式指定插件加载器，避免错误依赖调用线程的上下文加载器
            ServiceLoader<PricingPlugin> serviceLoader =
                    ServiceLoader.load(PricingPlugin.class, pluginLoader);

            List<PricingPlugin> instances = new ArrayList<>();
            for (PricingPlugin plugin : serviceLoader) {
                instances.add(plugin);
            }

            if (instances.isEmpty()) {
                throw new IllegalStateException("插件未声明 PricingPlugin 实现");
            }
            return new PluginHandle(pluginLoader, List.copyOf(instances));
        } catch (RuntimeException | Error ex) {
            // 加载失败也要释放 URLClassLoader 持有的 JAR 文件资源
            pluginLoader.close();
            throw ex;
        }
    }

    public List<PricingPlugin> plugins() {
        // 不暴露内部可变集合，防止宿主绕过生命周期管理
        return List.copyOf(plugins);
    }

    @Override
    public void close() throws IOException {
        for (PricingPlugin plugin : plugins) {
            try {
                // 先让插件停止线程、任务和连接，解除对自身类的强引用
                plugin.close();
            } catch (RuntimeException ex) {
                // 真实项目应记录插件 code 与异常，继续关闭其他插件
            }
        }
        plugins.clear();
        classLoader.close();
    }
}
```

这个示例采用 parent-first，适合插件只需要隔离自己的实现和私有依赖。如果插件必须携带与宿主不同版本的第三方库，可以定制 child-first，但要设置明确的 parent-first 白名单：

- `java.*` 等平台包；
- 宿主的插件 API 包；
- 日志门面、监控桥接等必须共享类型的包；
- 不能出现多份实例的基础协议和 DTO。

不要简单重写 `loadClass` 后对所有包一律 child-first。这样很容易复制接口类型、日志门面或框架注解，最终得到类型转换失败、重复单例和资源泄漏。

## 六、SPI 与线程上下文类加载器

`ServiceLoader.load(Service.class)` 使用当前线程的上下文类加载器（Thread Context ClassLoader，TCCL）。它解决的典型问题是：父层框架代码需要发现只对子层应用可见的实现，单靠“定义框架类的加载器”无法向下查找。

但 TCCL 是隐式全局上下文，线程池复用会放大泄漏和串应用问题。需要临时切换时必须恢复：

```java
ClassLoader previous = Thread.currentThread().getContextClassLoader();
try {
    // 只在插件调用窗口内暴露插件类路径
    Thread.currentThread().setContextClassLoader(pluginLoader);
    invokePlugin();
} finally {
    // 线程池线程会被复用，不恢复可能让插件永远无法卸载
    Thread.currentThread().setContextClassLoader(previous);
}
```

优先选择 `ServiceLoader.load(service, loader)` 显式传入加载器；只有下层库确实通过 TCCL 查找资源或 SPI 时才临时切换。`ServiceLoader` 自身会缓存已经加载的 Provider，也不应作为全 JVM 单例跨多个应用缓存。

## 七、卸载不是调用 close 就立即发生

JVM 没有“卸载某一个 Class”的公共 API。工程上通常以一个可回收的 ClassLoader 作为卸载单元；只有加载器及其定义的类、实例等不再被可达强引用持有时，GC 才可能回收相关元数据。

常见泄漏链包括：

- 插件创建的非守护线程仍在运行；
- 线程池线程的 TCCL 指向插件加载器；
- 宿主静态 Map 缓存了插件类、实例、反射对象或动态代理；
- `ThreadLocal` 的值来自插件类型；
- JDBC Driver、日志 Appender、MBean、定时任务或监听器没有注销；
- `ServiceLoader`、序列化库、表达式引擎持有类型缓存；
- 未关闭 `URLClassLoader`，JAR 资源仍被占用。

正确下线顺序通常是：停止接收新任务 → 等待或取消在途调用 → 插件注销外部注册 → 关闭插件资源 → 清理宿主缓存 → 恢复 TCCL → 关闭加载器 → 移除最后引用。`URLClassLoader.close()` 主要关闭它打开的 JAR/文件资源，不等于强制卸载类。

## 八、四类常见故障怎样定位

### 1. `ClassNotFoundException`

这是受检异常，常见于应用主动调用 `loadClass` 或 `Class.forName`，但目标加载器的可见范围中没有该类。优先记录请求的类名、发起加载器、父链和实际 class path/module path。

### 2. `NoClassDefFoundError`

它表示 JVM 在使用类型时无法得到其定义，可能是运行期缺依赖，也可能是该类曾经找到过，但链接或初始化失败。遇到 `Could not initialize class` 时，应向前找第一次 `ExceptionInInitializerError`，而不是只补 JAR。

### 3. `ClassCastException`

先比较两侧类型的 `getName()`、`getClassLoader()`、`getModule()` 和代码来源。类名相同但加载器不同，通常是共享 API 被打进插件 JAR，或 child-first 白名单遗漏。

### 4. `NoSuchMethodError` / `NoSuchFieldError`

这类错误通常说明编译期与运行期解析到的依赖版本不同。代码能够编译，不代表部署时实际加载的 JAR 版本兼容。应查清类型最终由哪个加载器、哪个 JAR 定义。

Java 21 可使用统一日志观察加载行为：

```bash
# 先查看当前 JDK 支持的日志标签，避免照抄其他版本参数
java -Xlog:help

# 记录类加载与卸载；生产环境先评估日志量并配置滚动
java -Xlog:class+load=info,class+unload=info:file=class-loading.log:time,level,tags -jar app.jar
```

应用侧也可以输出最小诊断信息：

```java
private static void logTypeOrigin(Class<?> type) {
    var source = type.getProtectionDomain().getCodeSource();
    System.out.printf("type=%s, loader=%s, module=%s, source=%s%n",
            type.getName(),
            type.getClassLoader(),
            type.getModule().getName(),
            source == null ? "unknown" : source.getLocation());
}
```

注意 `CodeSource` 可能为空，容器、模块或动态生成类也不一定来自普通 JAR 路径。

## 九、选择建议：什么时候需要自定义加载器

### 适合直接使用默认应用加载器

- 普通 Spring Boot 单体或微服务；
- 依赖版本由构建工具统一收敛；
- 不需要运行时安装、卸载或隔离第三方扩展。

此时自定义加载器通常只会增加诊断成本。依赖冲突应优先通过 Maven/Gradle 依赖树、版本约束和打包检查解决。

### 适合使用独立 ClassLoader

- 可插拔规则、连接器、脚本引擎或租户扩展；
- 同一进程内必须容纳不同版本的私有依赖；
- 插件需要独立升级和回收；
- 宿主能定义稳定、最小的共享 API。

### 更适合模块层或独立进程

- 需要强模块可读性与服务绑定，可评估 JPMS `ModuleLayer`；
- 插件来源不可信、权限差异大或可能崩溃 JVM，应使用独立进程、容器或沙箱，而不是把 ClassLoader 当安全边界；
- 原生库、全局系统属性和进程级资源存在冲突时，类隔离本身也不够。

## 十、常见追问与踩坑

### 双亲委派能完全防止伪造核心类吗

不能把它当完整安全机制。父优先会保护常规加载路径中的平台类，但安全还依赖包名限制、模块边界、字节码验证、代码来源、最小权限和部署供应链。自定义加载器也不能赋予不可信代码可靠的进程内沙箱。

### `Class.forName` 与 `loadClass` 怎么选

只需要取得类型元数据且不想触发静态副作用时，使用 `Class.forName(name, false, loader)` 或合适的 `loadClass`；确实要立即使用静态状态时再初始化。框架扫描阶段尤其不要无意触发所有候选类的静态初始化。

### 为什么插件里能看到类，宿主却接收不了返回值

可见不等于类型身份一致。检查接口、DTO 和异常类型是否由父加载器统一定义；插件若把 `plugin-api.jar` 一起打包并 child-first 加载，就会复制边界类型。

### 能不能通过清空引用马上释放 Metaspace

不能保证“马上”。清空强引用只是满足可卸载条件之一，实际回收取决于 GC 和实现策略。更实用的验证是重复装载/卸载插件，观察加载器数量、类卸载日志和 Metaspace 趋势，而不是依赖一次 `System.gc()`。

### 热替换是否等于类加载器热升级

不等于。Instrumentation redefine/retransform、开发期 HotSwap、丢弃旧加载器后装载新版本是不同机制。插件升级通常是新建加载器、切换流量、清理旧实例，再等待旧加载器可回收。

## 十一、最佳实践清单

1. 明确 Java 版本和加载拓扑，Java 9+ 使用 Platform Class Loader 术语；
2. 将共享 API 与 DTO 放到父加载器，插件实现和私有依赖放到子加载器；
3. 默认 parent-first，确需 child-first 时维护最小、明确的包级例外；
4. 自定义加载器优先重写 `findClass`，谨慎改写 `loadClass` 的锁与委派语义；
5. 并发加载器按 API 要求评估 `registerAsParallelCapable()`，避免非层级委派中的加载锁死锁；
6. SPI 优先显式传加载器，临时设置 TCCL 时必须在 `finally` 中恢复；
7. 静态初始化不执行远程 I/O、不启动长期线程、不产生不可回滚副作用；
8. 插件加载前校验来源、哈希、兼容版本和允许的依赖边界；
9. 插件卸载协议必须覆盖线程、线程池、Driver、MBean、监听器、缓存和文件句柄；
10. 日志记录类型名、定义加载器、模块、代码来源与插件版本，但不要泄露敏感路径；
11. 用重复升级压测观察类数量、Metaspace、线程和句柄，而不是只验证首次加载成功；
12. 对不可信插件使用进程隔离，ClassLoader 只负责命名空间与依赖可见性。

## 总结

Java 类加载的主线不是五个孤立名词，而是一套运行时类型建立过程：加载器找到二进制表示，JVM 完成验证、准备和解析，主动使用再触发受同步保护的初始化。

双亲委派解决公共类型复用和平台类优先，类身份规则实现同名类型隔离；SPI 与 TCCL 则让父层框架可以发现子层实现。真正落地到插件系统时，要把共享 API、私有依赖、委派例外和卸载协议一起设计。只有同时管住类型边界、线程上下文、缓存与资源生命周期，类加载器才是可治理的扩展机制，而不是下一次线上 `ClassCastException` 和 Metaspace 泄漏的来源。
