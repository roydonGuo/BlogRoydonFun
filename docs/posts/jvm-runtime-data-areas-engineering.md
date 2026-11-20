---
title: JVM 运行时数据区工程实践：内存结构、溢出边界与诊断工具
date: 2026-11-20
category: 后端开发
cover: /covers/backend.svg
tags: [jvm, 内存模型, metaspace, oom, 诊断]
excerpt: "JVM 运行时数据区按“线程私有 / 线程共享”一分为二：程序计数器、虚拟机栈、本地方法栈属于单个线程，堆和方法区（HotSpot 8 起由元空间在本地内存实现）全进程共享。读懂这张地图，才能在 StackOverflowError、堆空间 OOM、元空间溢出和容器被 OOM Kill 之间走对排查路径。"
---

# JVM 运行时数据区工程实践：内存结构、溢出边界与诊断工具

<img src="/images/posts/jvm-runtime-data-areas-engineering-knowledge-map.png" alt="JVM 运行时数据区工程实践：内存结构、溢出边界与诊断工具知识串联图" style="border-radius: 10px;" />

JVM 运行时数据区按"线程私有 / 线程共享"一分为二：程序计数器、虚拟机栈、本地方法栈属于单个线程，堆和方法区（HotSpot 8 起由元空间在本地内存实现）全进程共享。读懂这张地图，才能在 StackOverflowError、OutOfMemoryError: Java heap space、Metaspace 溢出和容器被 OOM Kill 之间走对排查路径。

## 先说结论：按"线程私有 / 线程共享"记地图

排查 JVM 内存问题最容易犯的错，是把所有内存当成一个整体。正确做法是先把 `java` 进程的总内存拆开：`-Xmx` 只管堆；线程栈按 `-Xss` × 线程数算；元空间在本地内存里，默认不设上限；还有 JIT 编译后的代码缓存、直接内存等堆外部分。每一块都有自己的错误信号和排查工具。

Java 虚拟机规范定义了五个运行时数据区，前三个线程私有、后两个线程共享，这是本文的分类骨架。本文以 **Java SE 25 / HotSpot** 为基线，核对日期为 **2026-11-20**；涉及版本差异处（JDK 7、8、21）会在正文单独标注。

## 一、完整分类：五个规范区域 + HotSpot 补充

### 1. 程序计数器（PC Register）

- 线程私有，每个线程都有独立一份；字节码解释器通过改变它的值来选取下一条要执行的指令。
- Java 方法执行时记录当前字节码指令地址；执行 Native 方法时值为 `undefined`。
- 它是五个区域中**唯一不会抛出 `OutOfMemoryError`** 的区域，内存占用可忽略不计。

### 2. Java 虚拟机栈（Java Virtual Machine Stack）

- 线程私有，生命周期与线程相同：线程创建时分配，线程结束时回收。
- 每次方法调用会创建一个**栈帧（Frame）**，包含四部分：
  - **局部变量表**：存放方法参数和局部变量，基本类型直接存值，对象类型存引用；
  - **操作数栈**：字节码执行时的工作区；
  - **动态链接**：指向运行时常量池中该方法的引用；
  - **方法返回地址**：方法正常或异常退出后应回到的位置。
- 每个线程任意时刻只有一个正在执行的"活动栈帧"。
- 大小由 `-Xss` 控制（64 位 Linux 默认约 1 MB，随平台和版本变化）。深度递归、过大的局部变量都可能触发 `StackOverflowError`；极端情况下（线程数过多导致栈内存总量耗尽本地内存）也可能抛 `OutOfMemoryError`。
- 注意：给每个线程都调大 `-Xss` 是全局放大——1000 个线程 × 1 MB ≈ 1 GB 本地内存预算，与堆无关。

### 3. 本地方法栈（Native Method Stack）

- 线程私有，服务对象是 Native 方法（`native` 修饰、由 C/C++ 等实现的方法）。
- 虚拟机规范允许它与 Java 虚拟机栈分别实现，也可以合并；HotSpot 直接用同一条栈同时服务两种方法，不再单独区分。

### 4. 堆（Heap）

- **线程共享**，是虚拟机启动时创建的最大一块内存，几乎所有对象实例和数组都在这里分配。
- 是垃圾回收器管理的主战场。分代（新生代 / 老年代）只是主流收集器的设计选择，不是规范要求；Java SE 25 以 G1 为默认收集器（可参考本站 JVM GC 一文的完整讨论）。
- 大小由 `-Xms`（初始）与 `-Xmx`（最大）控制；`-XX:+HeapDumpOnOutOfMemoryError` 让 JVM 在堆溢出时自动生成转储快照，`-XX:HeapDumpPath=/path` 指定落盘目录，这是生产环境默认应该打开的两个参数。
- 溢出信号：`OutOfMemoryError: Java heap space`；另有变体 `Requested array size exceeds VM limit`（数组长度超出虚拟机支持上限），它和真正的堆不足是两回事。

### 5. 方法区（Method Area）与元空间（Metaspace）

- 方法区是规范定义的**概念**：存储每个类的结构信息、运行时常量池、字段与方法数据、方法和构造器的代码。它逻辑上是堆的一部分，但规范不强制位置。
- HotSpot 的实现经历了明确的版本演进：
  - **JDK 7 及之前**：永久代（PermGen），占用堆空间，受 `-XX:MaxPermSize` 限制；
  - **JDK 8 起（JEP 122）**：改用**元空间（Metaspace）**实现，位于**本地内存**，默认**不设上限**；旧参数 `-XX:MaxPermSize` 已被移除，传入会导致 JVM 拒绝启动（`Unrecognized VM option`）。
- 关键参数：
  - `-XX:MaxMetaspaceSize`：类元数据可用的本地内存上限。不设置时，类加载器泄漏只会表现为进程 RSS 缓慢增长，设置后溢出会以 `OutOfMemoryError: Metaspace` 明确暴露；
  - `-XX:MetaspaceSize`：首次触发元空间相关 GC 的水位阈值（不是初始大小，也不是上限，JDK 25 上默认约 21 MB）；
  - `-XX:CompressedClassSpaceSize`：元空间中压缩类指针寻址部分的上限，默认 1 GB。
- 两个容易混淆的"池"：
  - **运行时常量池**：Class 文件常量池的运行时形态，属于方法区的一部分；
  - **字符串池（StringTable）**：自 JDK 7 起已移入**堆**中，由 HashTable 实现，可用 `-XX:StringTableSize` 调整桶数；`intern()` 方法把首次出现的字符串引用放入串池。

### 6. HotSpot 补充区域（规范之外）

- **代码缓存（Code Cache）**：存放 JIT 编译后的本地机器码，属本地内存；
- **直接内存（Direct Buffer）**：NIO `ByteBuffer.allocateDirect` 分配的堆外内存，受 `-XX:MaxDirectMemorySize` 约束，Netty、Kafka 客户端等重度使用；
- 这些区域不计入 `-Xmx`，是"容器内存预算"事故的高发区。

### 7. JDK 21 之后：虚拟线程的栈在堆上

虚拟线程自 JDK 21（JEP 444）成为正式特性。平台线程的栈由操作系统预留固定大小（默认约 1 MB）；**虚拟线程的栈帧则作为对象存放在 Java 堆上**，按调用深度动态增长收缩，运行时才挂载到载体线程的栈上。因此"百万虚拟线程"的成本是堆内存随调用深度伸缩，而不是百万份固定栈内存；反过来，大量虚拟线程也会把压力从本地内存转移到 GC 侧。

## 二、适用场景：这张地图什么时候用

- **OOM 现场分诊**：拿到错误信号第一步就是归类——`StackOverflowError` 走栈路径，`Java heap space` 走堆路径，`Metaspace` 走类加载路径，`direct buffer` 走堆外路径。
- **容器内存预算**：容器只按 `-Xmx` 一项配置内存，元空间、线程栈、代码缓存、直接内存全部吃同一个 cgroup 限额，超限即被容器运行时杀掉，JVM 不会抛任何 Java 异常。
- **容量与线程规划**：估算线程池容量时，必须把每线程栈内存计入总成本。

## 三、真实示例：Spring Boot 容器化服务的内存配置骨架

一个典型的生产启动脚本，目标容器内存 2 GB：

```bash
# JVM 启动参数示例：容器限额 2GB，预算拆分为堆 + 非堆
java -Xms1024m -Xmx1024m \                    # 堆：固定 1GB，占容器限额的一半
     -XX:MaxMetaspaceSize=256m \              # 元空间上限：给类加载泄漏一个明确报错边界
     -XX:MetaspaceSize=64m \                  # 提高首次元空间 GC 阈值，减少启动期抖动
     -XX:MaxDirectMemorySize=256m \           # 直接内存上限：Netty 等堆外分配的封顶
     -Xss1m \                                 # 单线程栈上限，1000 线程 ≈ 1GB 本地内存预算
     -XX:+HeapDumpOnOutOfMemoryError \        # OOM 时自动转储堆快照
     -XX:HeapDumpPath=/dumps/ \               # 快照落盘目录（需保证存在且可写）
     -jar app.jar
```

剩余的约 512 MB 留给线程栈总量、代码缓存、Native 库与操作系统页缓存——**不是**可以再塞给堆的余量。

对应的日常诊断命令：

```bash
# 查看进程内所有 Java 进程
jps -l
# 查看堆各分代用量与元空间、代码缓存当前水位
jcmd <pid> VM.metaspace
jcmd <pid> GC.heap_info
# 输出线程栈：直接看到线程数与调用深度，估栈内存总量
jcmd <pid> Thread.print | grep -c '^"'
# 统计堆内对象直方图（谨慎：会触发一次 Full GC）
jmap -histo:live <pid> | head -20
```

一个演示栈溢出边界的最小示例，以及按需给单线程更大栈的写法：

```java
/**
 * 演示虚拟机栈的两种治理方式：调大栈或消除递归深度。
 */
public class StackDemo {

    /** 朴素递归：栈帧深度随 n 线性增长，超过 -Xss 预算即抛 StackOverflowError */
    static long fact(long n) {
        return n <= 1 ? 1 : n * fact(n - 1);
    }

    public static void main(String[] args) {
        // 仅给这一个解析线程请求 4MB 栈，避免全局调大 -Xss
        Thread parser = Thread.ofPlatform().stackSize(4L * 1024 * 1024)
                .unstarted(() -> System.out.println(fact(50_000)));
        parser.start();
    }
}
```

`stackSize()` 只是"请求"，JVM 在某些平台上可能忽略该值，落地前要在目标环境实测；更彻底的做法是把递归改写成显式的 `ArrayDeque` 迭代，让深度不再依赖栈。

## 四、常见追问

**问：`String s = new String("abc")` 创建了几个对象？都存在哪？**
"abc" 的对象（自 JDK 7 起）在堆中，`s` 这个引用本身在栈的局部变量表里。字符串字面量首次使用时会把引用放入堆中的字符串池。经典面试答案是"最多两个对象、一个引用"，但更值钱的是这个变体：**对象在堆、引用在栈，字面量还可能进串池**——这正是"按区域拆分"思维的日常应用。

**问：`-Xmx` 限制的是整个进程吗？**
不是。`-Xmx` 只限制堆。元空间（默认无上限）、线程栈、代码缓存、直接内存都在它之外。容器里设了 `-Xmx` 仍被 OOM Kill，多数是这些非堆部分超了 cgroup 限额。

**问：`MetaspaceSize` 和 `MaxMetaspaceSize` 什么关系？**
前者是触发 GC 的水位阈值，后者是硬上限。大量动态类生成（反射代理、Groovy 脚本、ORM）场景必须设后者，否则类加载器泄漏只会表现为进程 RSS 无声增长。

**问：为什么元空间溢出总是"晚到"？**
类元数据的回收条件是其类加载器被 GC 卸载。应用服务器重新部署、动态代理、脚本引擎都会持续生成新加载器；只要旧加载器还活着（典型：被静态集合引用），元空间就只进不出。

**问：虚拟线程会 `StackOverflowError` 吗？**
虚拟线程的栈在堆上按需伸缩，通常深递归表现为堆压力而非立即 SOE；但挂载到载体线程上执行时仍占用载体栈，部分深层调用或 Native 边界仍可能触发。不能把它当作"无限深递归"的豁免。

## 五、踩坑记录

- **迁移脚本残留 PermGen 参数**：JDK 8 之前写的启动脚本带着 `-XX:MaxPermSize`，在新 JDK 上会直接拒绝启动；升级 JDK 后应同步清理启动参数。
- **把 RSS 当堆**：监控只看进程 RSS 会同时混入元空间、线程栈、代码缓存与直接内存。分项看 `jcmd GC.heap_info`、`VM.metaspace` 与操作系统的线程统计，才能定位是哪一块在涨。
- **线程栈预算漏算**：`-Xss` 默认 1 MB 乘以线程数，是 1000 线程 ≈ 1 GB 本地内存的成本；换成虚拟线程后，这部分预算大部分转移进堆。
- **大数组异常当堆不足**：`Requested array size exceeds VM limit` 是单次分配超出虚拟机上限，扩堆解决不了，要改数据结构。
- **堆快照没落盘**：`HeapDumpOnOutOfMemoryError` 打开但 `HeapDumpPath` 不可写，事故现场拿不到证据；该目录需在部署清单里保证存在且可写。
- **字符串池误判为元空间问题**：串池在堆中，`intern()` 导致的堆积反映在堆直方图（大量 `String`），不在 `VM.metaspace` 输出里。

## 六、选择建议

- **容器预算**：按"堆 + 元空间 + 直接内存 + 线程数 × Xss + 代码缓存 + 余量"逐项拆分并留出至少 20% 余量，不要把容器限额全给 `-Xmx`。
- **线程模型**：高并发 I/O 服务优先虚拟线程，把固定栈内存预算换成堆内存弹性；CPU 密集服务维持平台线程池。
- **类加载治理**：涉及动态类生成的服务，把 `MaxMetaspaceSize` 当作必配项而非可选项。
- **排查顺序**：先按错误信号定位区域，再用对应工具取证——堆用直方图与转储，栈用 `Thread.print`，元空间用 `VM.metaspace`，堆外看 `MaxDirectMemorySize` 与 Native 内存统计。

## 七、最佳实践清单

1. 生产环境固定 `-Xms = -Xmx`，避免堆伸缩抖动；
2. `-XX:+HeapDumpOnOutOfMemoryError` 与可写的 `HeapDumpPath` 作为默认配置；
3. 动态类生成场景显式设置 `MaxMetaspaceSize`，给泄漏一个明确报错；
4. 新 JDK 升级时清理 `MaxPermSize` 等已移除参数；
5. 容器内存预算逐项拆分并留余量，用压测验证 RSS 峰值；
6. 递归深度不可控的解析逻辑改显式栈迭代，而不是全局调大 `-Xss`；
7. 用 `jcmd`（`GC.heap_info`、`VM.metaspace`、`Thread.print`）替代过时的碎片化命令作为日常入口。

## 总结

JVM 运行时数据区是一张"线程私有 / 线程共享"二分地图：程序计数器、虚拟机栈、本地方法栈按线程隔离，堆与方法区全进程共享，HotSpot 又在规范之外补上代码缓存与直接内存。JDK 8 把方法区从堆内永久代移到本地内存元空间，JDK 21 把虚拟线程的栈搬上堆——两个演进共同把"内存预算"从单一堆参数变成逐项拆分的工程问题。记住每个区域的溢出信号与对应诊断命令，OOM 排查就从猜谜变成走查。
