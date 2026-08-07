---
title: JFR 持续录制工程实践：环形留存、故障转储与 Java 服务诊断
date: 2026-08-07
category: 后端开发
cover: /covers/backend.svg
tags: [java, jvm, jfr, observability, performance]
excerpt: 以 JDK 21 为基线，把 JFR 从临时性能分析工具改造成生产环境持续录制的“黑匣子”，并建立留存、转储、分析与安全治理闭环。
---

# JFR 持续录制工程实践：环形留存、故障转储与 Java 服务诊断

<img src="/images/posts/jfr-continuous-recording-engineering-knowledge-map.png" alt="JFR 持续录制工程实践：环形留存、故障转储与 Java 服务诊断知识串联图" style="border-radius: 10px;" />

以 JDK 21 为基线，把 JFR 从临时性能分析工具改造成生产环境持续录制的“黑匣子”，并建立留存、转储、分析与安全治理闭环。

Java 服务最难排查的故障，常常不是持续发生的故障，而是只出现几十秒的尖峰：接口 P99 突然升高、线程短暂阻塞、GC 抖动、容器 CPU 被打满，告警触发后又恢复正常。等工程师登录机器再执行线程转储时，现场已经消失。

Java Flight Recorder（JFR）的工程价值，正是持续保留一段时间窗口内的 JVM、JDK、操作系统和应用事件。当故障发生时，可以把“最近 15 分钟”固化为 `.jfr` 文件，再从 CPU 采样、锁竞争、GC、线程、Socket I/O 与自定义业务事件之间建立时间关联。

但“打开 JFR”不等于“具备诊断能力”。如果没有设置留存上限，磁盘仓库可能持续增长；如果长期使用高开销配置，观测本身会影响业务；如果故障时才启动录制，就会丢失故障之前最关键的因果链。

> 本文以 **OpenJDK / Oracle JDK 21** 的 JFR、`jcmd` 与 `jfr` 工具契约为基线，事实核对时间为 **2026-08-07**。JFR 在 JDK 11 通过 JEP 328 进入 OpenJDK；不同 JDK 发行版、后续版本和容器运行时可能增加事件或工具子命令，生产使用前应以目标 JDK 的 `java -version`、`jcmd <pid> help JFR.start` 和 `jfr --help` 为准。

## 一、先把 JFR 理解成事件流水线

JFR 不是定时生成的一张性能快照，而是一条从事件产生到归档分析的流水线：

```text
JVM / JDK / 应用事件
        ↓ 线程本地缓冲，尽量降低写入竞争
全局内存缓冲
        ↓ disk=true 时持续形成磁盘 Chunk
受 maxage / maxsize 约束的磁盘仓库
        ↓ 故障触发 JFR.dump，不停止原录制
独立 .jfr 证据文件
        ↓ JMC 或 jfr summary / view / print
时间线关联与根因定位
```

JEP 328 描述的核心机制是：业务线程先把事件写入线程本地缓冲，缓冲区填满后再进入全局内存缓冲系统；根据录制配置，旧数据会被丢弃，或持续写入磁盘并按留存策略淘汰。这个设计让 JFR 适合记录高频运行时事件，而不是让每个事件都同步写一个日志文件。

一条 JFR 事件通常可以归入以下四类语义，理解它们有助于分析时间线：

| 事件语义 | 记录什么 | 典型例子 | 分析方式 |
|---|---|---|---|
| 瞬时事件 | 某个时间点发生的事实 | 类加载、线程启动、异常抛出 | 对齐故障时刻和事件密度 |
| 持续事件 | 有明确开始与结束的操作 | GC Pause、Monitor Enter、Socket Read | 关注时长、阈值和调用栈 |
| 周期事件 | JVM 按周期采集的状态 | CPU Load、堆摘要、线程统计 | 观察趋势和资源饱和 |
| 采样事件 | 按频率抽取正在执行的栈 | Execution Sample、Native Method Sample | 聚合热点，而非还原每次调用 |

JFR 不是分布式追踪的替代品。它擅长解释“这个 JVM 在某个时间段为什么慢”，但默认不知道一次请求跨越了哪些服务。工程上可以用请求 ID、订单号的哈希或业务阶段写入自定义事件，把 JVM 时间线与日志、Trace 和指标关联起来。

## 二、持续录制的三个容量边界

生产持续录制必须同时设计时间、空间和事件开销三个边界。

### 1. `maxage`：保留多长的历史窗口

`maxage=30m` 表示磁盘仓库只保留最近约 30 分钟的数据。它适合回答“告警前发生了什么”，窗口至少应覆盖告警评估、通知和人工响应的总延迟。

例如告警需要连续 5 分钟异常才触发，从通知到值班人员执行转储通常需要 10 分钟，那么只保留 10 分钟就可能丢掉故障起点。更合理的起点是 30 至 60 分钟，再根据真实响应时间调整。

### 2. `maxsize`：允许占用多少磁盘

`maxsize=512m` 表示仓库达到容量上限后，JVM 会删除最旧的 Chunk，为新数据腾出空间。JDK 21 要求该值不能小于 JFR 的 `maxchunksize`；默认 Chunk 上限由 `JFR.configure` 管理，不能靠拍脑袋设置一个过小值。

`maxage` 与 `maxsize` 可以同时设置，实际历史窗口由先达到的约束决定。高并发、异常风暴或开启更多带栈事件时，单位时间产生的数据会增加，同样的 512 MB 可能从一小时历史缩短为十几分钟。因此必须监控仓库增长速度，而不是只配置一次就不再观察。

### 3. `settings`：每个事件采集到什么程度

JDK 21 自带两套常用配置：

| 配置 | 定位 | 典型用法 | 边界 |
|---|---|---|---|
| `default.jfc` | 持续、低开销的常态观测 | 生产服务长期录制 | 部分高成本事件关闭或阈值较高，细节可能不足 |
| `profile.jfc` | 更丰富的短时性能分析 | 故障复现、压测或限定时间的深挖 | 事件量和性能影响更高，不应未经评估长期全量开启 |
| 自定义 `.jfc` | 从已有配置复制后按目标裁剪 | 固定采集某类业务或 JVM 事件 | 需要版本管理、压测和事件字段安全评审 |

Oracle JDK 21 文档把 `default.jfc` 推荐用于持续录制，并给出典型开销低于 1% 的描述。这个数字是官方配置的典型结果，不是对任何业务和自定义事件的性能承诺；是否可接受仍要在真实负载、目标 JDK 和目标容器配额下验证。

## 三、一份可落地的启动配置

对部署在 Linux 或 Kubernetes 中的 Java 服务，可以从下面的 JVM 参数开始：

```bash
java \
  -XX:StartFlightRecording=name=continuous,settings=default,disk=true,maxage=30m,maxsize=512m,dumponexit=true,filename=/var/log/jfr/order-service-%p-%t.jfr \
  -XX:FlightRecorderOptions=repository=/var/log/jfr/repository \
  -jar order-service.jar
```

参数职责要分清：

- `name=continuous`：给录制一个稳定名称，后续 `JFR.check` 和 `JFR.dump` 不依赖自动生成 ID；
- `settings=default`：使用 JDK 自带的持续录制配置；
- `disk=true`：把数据持续刷新到磁盘仓库，`maxage` 和 `maxsize` 才有意义；
- `maxage=30m,maxsize=512m`：同时限制历史时间和磁盘空间；
- `dumponexit=true`：JVM 正常退出时把录制写入目标文件；
- `filename=...`：指定停止或退出时的最终文件，不是仓库目录；`%p` 与 `%t` 分别展开为 PID 和时间戳；
- `repository=...`：指定运行期 Chunk 仓库。该目录必须可写，并与最终归档目录分别治理。

这里最容易混淆的是 `filename` 与 `repository`。前者是一次转储或停止后得到的 `.jfr` 文件；后者是 JVM 持续录制期间维护的临时 Chunk 集合。只给 `filename` 并不代表每个事件会直接追加到那个文件。

在容器中还要补齐四项基础设施：

1. 给仓库和转储目录挂载有容量限制的持久卷或节点盘，不能写入镜像层；
2. 让运行 Java 的用户拥有目录写权限，诊断工具也使用相同有效用户和组；
3. 为转储文件设置采集、加密、保留和删除策略；
4. 把磁盘剩余空间与 JFR 转储失败纳入告警，避免诊断系统反过来挤占业务磁盘。

## 四、故障发生时先固化现场

JDK 21 的 `JFR.dump` 会在录制仍然运行时把数据写入文件，原录制不会停止。这使值班人员可以先保存现场，再决定是否开启更详细的短时录制。

```bash
# 1. 确认录制名称、状态、持续时间和留存边界
jcmd 12345 JFR.check name=continuous

# 2. 只固化最近 15 分钟，避免复制整段历史
jcmd 12345 JFR.dump \
  name=continuous \
  maxage=15m \
  filename=/var/log/jfr/incidents/order-service-%p-%t.jfr

# 3. 原录制继续运行；再次检查状态，确认没有误停
jcmd 12345 JFR.check name=continuous
```

`jcmd` 必须在同一台机器上运行，并使用与目标 JVM 相同的有效用户和组。容器环境还要解决 PID 命名空间和工具镜像问题：如果运行镜像只包含 JRE 或 distroless 文件系统，可以准备受控诊断容器或旁路工具，但不能为了方便把 Attach 能力、宿主机 PID 和写权限开放给所有工作负载。

如果常态录制信息不足，可以额外启动一个有限时长的 `profile` 录制，而不是修改或停止 `continuous`：

```bash
# 仅录制 2 分钟的详细事件，到期后写出文件
jcmd 12345 JFR.start \
  name=incident-profile \
  settings=profile \
  duration=2m \
  filename=/var/log/jfr/incidents/profile-%p-%t.jfr
```

这种“双录制”策略保留了故障前的低开销历史，又能补充故障后的高密度细节。不要同时启动多个无期限 `profile` 录制；它们会增加事件量、磁盘压力和分析噪声。

`path-to-gc-root=true` 也不应加入日常模板。JDK 21 文档明确说明，收集 GC Root 路径耗时，转储时还可能让应用短暂停顿。只有在确实怀疑内存泄漏、已评估影响并设置维护窗口时再启用。

## 五、从 `.jfr` 文件建立诊断顺序

拿到文件后，不要一上来就搜索某个类名。先验证文件，再按“资源饱和 → JVM 活动 → 线程与锁 → I/O → 业务事件”的顺序缩小范围。

```bash
# 先查看事件类型、数量和文件占用，确认录制是否覆盖故障窗口
jfr summary order-service-12345.jfr

# JDK 21 可用聚合视图快速检查热点；先列出当前文件支持的视图
jfr view types order-service-12345.jfr

# 按事件或类别过滤原始内容；必要时增加栈深度
jfr print \
  --events CPULoad,GarbageCollection,JavaMonitorEnter,SocketRead \
  --stack-depth 20 \
  order-service-12345.jfr
```

实际分析可以遵循以下证据链：

| 现象 | 优先关联的 JFR 证据 | 下一步判断 |
|---|---|---|
| CPU 持续接近配额 | CPU Load、Execution Sample、线程状态 | 是业务热点、忙等、编译活动还是容器限流 |
| 请求延迟尖峰 | Socket Read/Write、Thread Park、Monitor Enter、自定义请求事件 | 是下游等待、锁竞争、线程池排队还是本地计算 |
| GC 停顿或分配过快 | GC、Heap Summary、Allocation Sample | 是分配速率突增、晋升压力还是堆容量问题 |
| 线程数快速上涨 | Thread Start/End、Thread Dump、锁事件 | 是否存在无界线程创建、阻塞扩散或线程泄漏 |
| 偶发异常风暴 | Exception Statistics、Error/Exception 事件 | 异常是根因还是下游故障的结果 |

JFR 中的采样栈只能说明某段时间“经常在哪里执行”，不能精确还原每一次调用；持续事件的阈值也可能让短事件不被记录。分析结论必须与应用指标、GC 日志、分布式 Trace、变更时间和容器指标交叉验证。

## 六、用自定义事件补齐业务语义

只有 CPU、GC 和锁事件时，工程师可能知道“某线程阻塞了 800 ms”，却不知道它正在处理支付确认还是库存预占。可以为关键业务阶段定义低基数字段的自定义事件。

```java
package com.example.order.observability;

import jdk.jfr.Category;
import jdk.jfr.Description;
import jdk.jfr.Event;
import jdk.jfr.Label;
import jdk.jfr.Name;
import jdk.jfr.StackTrace;
import jdk.jfr.Threshold;

@Name("com.example.OrderPayment")
@Label("订单支付阶段")
@Category({"Business", "Order"})
@Description("记录订单支付关键阶段，用于关联 JVM 与业务延迟")
@Threshold("100 ms")
@StackTrace(false)
public final class OrderPaymentEvent extends Event {

    @Label("订单标识哈希")
    public String orderIdHash;

    @Label("支付阶段")
    public String phase;

    @Label("结果")
    public String result;
}
```

业务代码只包围需要观测的关键阶段：

```java
OrderPaymentEvent event = new OrderPaymentEvent();
event.orderIdHash = hashForDiagnostics(orderId);
event.phase = "confirm";

event.begin();
try {
    paymentGateway.confirm(orderId);
    event.result = "success";
} catch (RuntimeException ex) {
    event.result = "failure";
    throw ex;
} finally {
    // commit() 会遵循 JFR 配置和 Threshold；未启用时无需另写分支
    event.commit();
}
```

自定义事件应遵循四条边界：

- 不写身份证号、手机号、Token、完整请求体等敏感数据；需要关联时使用不可逆哈希或低敏业务阶段；
- 字段保持低基数，不把 SQL 全文、URL 查询参数和异常堆栈重复塞进每条事件；
- 用 `Threshold` 过滤短操作，用事件配置决定是否采集调用栈；
- 事件名和字段要版本化，避免分析脚本与服务升级后悄悄失配。

## 七、常见误区与踩坑

### 误区 1：故障发生后才启动 JFR

临时启动只能看到故障之后，无法解释异常如何形成。生产服务更适合长期运行 `default.jfc`，告警后立即转储最近窗口。

### 误区 2：设置 `maxage` 就一定不会写满磁盘

时间上限不等于空间上限。事件速率上升时，固定时间窗口可能产生大量数据。持续录制应同时设置 `maxage` 与 `maxsize`，并监控仓库和归档目录。

### 误区 3：把 `profile.jfc` 当成更好的默认配置

更多事件不一定更容易定位。长期高密度录制会增加开销、磁盘写入和噪声。常态使用 `default`，明确问题后再开启限时 `profile` 或经过压测的自定义配置。

### 误区 4：`JFR.dump` 会终止持续录制

在 JDK 21 中，`JFR.dump` 只是把当前数据复制到文件，原录制继续运行；真正停止录制的是 `JFR.stop`。故障手册应明确区分二者，避免误删后续证据。

### 误区 5：把 JFR 文件当普通日志上传

JFR 可能包含类名、线程名、文件路径、主机信息、Socket 地址和自定义字段。它应按诊断证据处理：最小权限访问、传输加密、保留期限、下载审计，必要时使用 JDK 21 `jfr scrub` 删除敏感事件或字段后再共享。

### 误区 6：只看火焰图就下结论

CPU 热点不能解释锁等待、I/O 阻塞和 GC 停顿。先在统一时间轴上确认资源与线程状态，再看热点栈，并与服务指标和 Trace 对齐。

## 八、生产落地检查清单

- 明确目标 JDK 版本和发行版，使用同版本工具分析；
- 常态录制使用 `default.jfc`，详细录制限定持续时间；
- 同时设置 `maxage`、`maxsize`，并确认 `maxsize` 不小于 Chunk 上限；
- 仓库目录与归档目录可写、有容量限制，并纳入磁盘告警；
- 故障手册固化 `JFR.check → JFR.dump → 文件校验 → 分析` 顺序；
- 默认不启用 `path-to-gc-root`，疑似泄漏时单独评估；
- 自定义事件只记录必要、低敏、低基数的业务语义；
- 用压测验证事件配置对 CPU、延迟、磁盘吞吐和文件增长速度的影响；
- 将录制名称、服务、实例、JDK 版本、故障时间窗和变更版本写入归档元数据；
- 定期做一次演练，确认容器内能执行转储、文件能带出并能被 JMC 或 `jfr` 工具打开。

## 九、总结

JFR 持续录制的核心不是“多收集一些 JVM 指标”，而是为偶发故障保留可回溯的时间线。`default.jfc` 控制常态事件成本，线程本地缓冲和磁盘 Chunk 承载事件流水，`maxage` 与 `maxsize` 形成环形留存边界，`JFR.dump` 在不停止原录制的前提下固化现场，JMC 与 `jfr` 工具再把 CPU、GC、锁、I/O 和业务事件串联起来。

一套可靠方案必须同时考虑观测开销、磁盘容量、容器权限、敏感数据和故障响应流程。常态低开销录制、故障窗口转储、限时详细采集、自定义业务事件与跨系统证据关联组合起来，JFR 才真正成为 Java 服务的生产“黑匣子”，而不是只在压测时临时打开的性能工具。

## 参考资料

- [OpenJDK JEP 328：Flight Recorder](https://openjdk.org/jeps/328)
- [Oracle JDK 21：Flight Recorder Configurations](https://docs.oracle.com/en/java/javase/21/jfapi/flight-recorder-configurations.html)
- [Oracle JDK 21：jcmd 命令与 JFR 子命令](https://docs.oracle.com/en/java/javase/21/docs/specs/man/jcmd.html)
- [Oracle JDK 21：jfr 文件分析工具](https://docs.oracle.com/en/java/javase/21/docs/specs/man/jfr.html)
- [Oracle JDK 21：Recording API](https://docs.oracle.com/en/java/javase/21/docs/api/jdk.jfr/jdk/jfr/Recording.html)
