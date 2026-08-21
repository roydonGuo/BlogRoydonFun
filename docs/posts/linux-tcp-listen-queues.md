---
title: Linux TCP 监听队列：SYN Queue、Accept Queue 与连接洪峰治理
date: 2026-08-06
category: 后端开发
cover: /images/posts/linux-tcp-listen-queues-knowledge-map.webp
tags: [linux, tcp, networking, java, observability]
excerpt: 从三次握手、两级监听队列和 listen backlog 出发，定位 Java 服务连接洪峰中的握手积压、Accept 溢出与过载边界。
---

# Linux TCP 监听队列：SYN Queue、Accept Queue 与连接洪峰治理

<img src="/images/posts/linux-tcp-listen-queues-knowledge-map.webp" alt="Linux TCP 监听队列：SYN Queue、Accept Queue 与连接洪峰治理知识串联图" style="border-radius: 10px;" />

从三次握手、两级监听队列和 listen backlog 出发，定位 Java 服务连接洪峰中的握手积压、Accept 溢出与过载边界。

流量突增时，Java 服务可能仍有空闲 CPU，却出现新连接超时、负载均衡健康检查抖动和客户端偶发重试。此时把业务线程池扩大一倍，往往没有效果，因为请求可能还没进入 HTTP 解析，更没有到达 Controller，而是堵在内核的 TCP 监听队列中。

排查这类问题的关键，是把“连接还在三次握手中”“握手完成但应用尚未 `accept()`”和“连接已交给应用但处理太慢”分开。Linux 为前两种状态维护不同的队列和上限；`listen(backlog)` 只直接约束其中一段，不能代表整个入口容量。

> 本文以 **Linux 4.10 及以上内核的主流行为、Linux man-pages 6.18、当前 Linux 内核网络文档与 JDK 17 `ServerSocket` API** 为适用范围，事实核对时间为 **2026-08-06**。发行版内核、容器网络命名空间、代理层和具体 Java 网络框架可能调整默认值或参数映射，生产变更应以目标机器的 `uname -r`、`sysctl`、`ss` 和框架版本为准。

## 一、TCP 监听端不是只有一个 backlog

服务端执行 `socket()`、`bind()`、`listen()` 后，监听 Socket 才能接收连接。对一个普通 TCP 监听端，可以把连接建立过程简化为：

```text
客户端发送 SYN
      ↓
SYN Queue：连接处于 SYN_RECV，等待客户端最终 ACK
      ↓ 三次握手完成
Accept Queue：连接已是 ESTABLISHED，等待应用 accept()
      ↓ accept() 取走
Java 连接处理层：协议解析、业务线程池、下游调用
```

两级队列解决的是不同问题。

| 阶段 | 典型状态 | 保存什么 | 主要上限 | 饱和后的直接风险 |
|---|---|---|---|---|
| SYN Queue | `SYN_RECV` | 尚未完成三次握手的连接请求 | `net.ipv4.tcp_max_syn_backlog` | SYN/SYN-ACK 重传、SYN Cookie 或握手失败 |
| Accept Queue | `ESTABLISHED`，尚未被应用取走 | 已完成握手、等待 `accept()` 的连接 | 应用 `backlog`，并受 `net.core.somaxconn` 截断 | `ListenOverflows`、连接建立延迟或失败 |
| 应用连接层 | 已被 `accept()` | Socket、协议状态、任务和业务上下文 | 连接数、文件描述符、事件循环与线程池容量 | 排队、拒绝、超时和下游雪崩 |

因此，“TCP 握手成功”不等于“应用已经接收连接”，“Accept Queue 没满”也不等于“业务层健康”。必须沿着这三段分别观察，才能知道连接究竟丢在哪一层。

## 二、`listen(backlog)` 控制的是哪一段

Linux 2.2 之后，TCP 的 `listen(fd, backlog)` 参数表示**已完成连接、等待 `accept()` 的队列长度**。未完成握手的连接由独立的 `tcp_max_syn_backlog` 控制。这个语义在 Linux 的 [`listen(2)`](https://man7.org/linux/man-pages/man2/listen.2.html) 中有明确说明。

应用请求的 `backlog` 也不是最终生效值。可以把 Accept Queue 的有效上限近似理解为：

```text
effectiveAcceptBacklog = min(applicationBacklog, net.core.somaxconn)
```

如果应用请求 `8192`，而主机的 `net.core.somaxconn` 是 `4096`，Linux 会静默截断为 `4096`。当前内核文档给出的 `somaxconn` 默认值是 `4096`，Linux 5.4 之前默认是 `128`；但真实环境可能被发行版、镜像或运维基线覆盖，不能把文档默认值当作现场值。

```bash
# 同时查看应用队列上限、半连接队列上限和溢出行为；不要只检查一个参数
sysctl net.core.somaxconn \
       net.ipv4.tcp_max_syn_backlog \
       net.ipv4.tcp_syncookies \
       net.ipv4.tcp_abort_on_overflow
```

`tcp_max_syn_backlog` 是每个监听端保存 `SYN_RECV` 请求的上限。启用 SYN Cookie 后，半连接队列溢出时内核可以不保存完整请求状态，而把必要信息编码进 SYN-ACK；这是一种抗 SYN Flood 的兜底机制，不是合法流量扩容手段。

## 三、三类“队列满”不能混为一谈

### 1. SYN Queue 满：握手压力或攻击流量

当大量客户端只发 SYN、不完成握手，或者网络抖动造成最终 ACK 迟迟不到，`SYN_RECV` 会积压。此时应同时检查 SYN 到达速率、源地址分布、SYN-ACK 重传和 `TcpExtSyncookiesSent`，而不是看到连接失败就扩大业务线程池。

Linux 内核文档明确把 `tcp_syncookies` 定位为 SYN backlog 溢出时的 fallback。若合法流量持续触发 Cookie，说明容量规划、入口限流或架构仍有问题；长期依赖它可能损失部分 TCP 扩展能力，也掩盖真实过载。

### 2. Accept Queue 满：应用来不及 `accept()`

握手完成后，连接先进入 Accept Queue。只要接收循环被长时间暂停、事件循环卡顿、Stop-The-World、CPU 调度延迟或进程资源耗尽，队列就可能填满。

Linux 4.10 及以上内核中，Accept Queue 溢出会体现在 `TcpExtListenOverflows`；`TcpExtListenDrops` 的范围更宽，除队列溢出外，监听状态下的内存分配失败等丢包也可能增加它。两者一起增长通常指向监听入口压力，只增长 `ListenDrops` 时还要继续排查内存与其他内核丢弃原因。

`tcp_abort_on_overflow=1` 会在监听服务接收过慢时主动复位连接。内核文档默认值为 `0`，并明确警告只有确信监听进程无法再优化时才考虑开启；贸然设为 `1` 只是把等待变成客户端立刻失败，并没有提升服务容量。

### 3. 应用队列满：过载已进入进程

如果 `accept()` 很快，但每个连接都被塞进无界线程池队列，内核指标可能很好看，JVM 却会积累任务、请求体和超时上下文。此时继续提高 Accept Queue 只会让更多连接进入一个已经饱和的进程。

正确的入口应该是有界的：Accept 循环快速取走连接，连接处理层设置并发与队列上限，超限时明确关闭连接或返回协议级过载响应。队列负责吸收短突发，限流和拒绝策略负责阻止持续过载。

## 四、Java 中 backlog 只是一个请求值

JDK 17 的 [`ServerSocket`](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/net/ServerSocket.html) 文档把 `backlog` 定义为“请求的最大待处理连接数”，并提醒具体语义由实现决定，操作系统可以施加上限或忽略该值。在 Linux 上，它最终仍受 `somaxconn` 限制。

下面的 Java NIO 示例强调两个边界：监听 backlog 显式配置，Accept 线程只接收连接；耗时处理交给有界线程池，线程池饱和时关闭新连接，避免把内核队列转移成 JVM 无界队列。

```java
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

public final class BoundedTcpServer implements AutoCloseable {

    private final int port;
    private final int backlog;
    private final ThreadPoolExecutor workers;
    private ServerSocketChannel listener;

    public BoundedTcpServer(int port, int backlog) {
        this.port = port;
        this.backlog = backlog;
        this.workers = new ThreadPoolExecutor(
                16,
                64,
                60,
                TimeUnit.SECONDS,
                // 使用有界队列，防止持续过载把任务无限堆在堆内存中
                new ArrayBlockingQueue<>(256));
    }

    public void start() throws IOException {
        listener = ServerSocketChannel.open();
        // backlog 是请求值；Linux 最终会用 somaxconn 对它做上限约束
        listener.bind(new InetSocketAddress("0.0.0.0", port), backlog);

        while (!Thread.currentThread().isInterrupted()) {
            SocketChannel client = listener.accept();
            try {
                // Accept 循环不做协议解析和业务调用，尽快回到下一次 accept()
                workers.execute(() -> handle(client));
            } catch (RejectedExecutionException ex) {
                // 处理层已经饱和，显式关闭新连接，避免进入无界等待
                closeQuietly(client);
            }
        }
    }

    private void handle(SocketChannel client) {
        try (SocketChannel channel = client) {
            ByteBuffer buffer = ByteBuffer.allocate(4096);
            // 真实项目还需要读取超时、最大报文、认证和协议级错误处理
            channel.read(buffer);
        } catch (IOException ex) {
            // 生产代码应按错误类型记录指标，避免把正常断连全部打印成错误堆栈
        }
    }

    private static void closeQuietly(SocketChannel channel) {
        try {
            channel.close();
        } catch (IOException ignored) {
            // 连接已经进入拒绝路径，关闭失败只记录聚合指标即可
        }
    }

    @Override
    public void close() throws IOException {
        workers.shutdown();
        if (listener != null) {
            listener.close();
        }
    }
}
```

这段代码只用于展示容量边界，不是完整网络框架。Netty、Tomcat、Jetty 和 Undertow 都有自己的 Acceptor、事件循环和队列模型；配置时应追踪框架参数最终是否进入底层 `listen()`，以及是否又被容器或宿主机的 `somaxconn` 截断。

## 五、用 `ss` 与 `nstat` 建立现场证据

连接问题不要只看应用 QPS。至少同时观察“当前队列水位”和“累计溢出计数”。

```bash
# 查看 8080 监听端；常见 iproute2 输出中，监听 Socket 的 Recv-Q/Send-Q
# 可用于观察当前 Accept Queue 水位与配置上限
ss -lnt '( sport = :8080 )'

# 统计仍处于 SYN_RECV 的连接；应结合时间序列和流量基线判断
ss -Hnt state syn-recv '( sport = :8080 )' | wc -l

# 读取绝对累计值并显示零值，便于监控系统按时间计算增量
nstat -az TcpExtListenOverflows \
          TcpExtListenDrops \
          TcpExtSyncookiesSent
```

`nstat` 默认显示相对上次运行的增量，`-a` 改为绝对值，`-z` 保留零值。生产采集器应保存单调计数器并计算速率，不能只在故障后手工执行一次命令。

可以按下面的证据链快速分层：

| 现场现象 | 更可能的瓶颈 | 下一步 |
|---|---|---|
| `SYN_RECV` 持续升高，`SyncookiesSent` 增长 | 半连接压力、SYN Flood、回程网络异常 | 检查源分布、SYN-ACK 重传、入口防护和 `tcp_max_syn_backlog` |
| 监听 `Recv-Q` 接近 `Send-Q`，`ListenOverflows` 增长 | Accept Queue 饱和 | 检查 Acceptor 停顿、CPU 调度、GC、文件描述符和事件循环 |
| 内核队列水位正常，但 JVM 任务队列和请求延迟升高 | 应用处理层或下游饱和 | 检查线程池、连接池、超时、限流和依赖延迟 |
| 服务端指标正常，客户端仍连接超时 | 问题可能在 LB、NAT、防火墙或链路 | 对齐两端抓包、负载均衡指标与网络命名空间 |

`ListenOverflows` 和 `ListenDrops` 是节点级内核计数，不直接告诉你哪个端口溢出。多服务共机时，要把它们与 `ss`、进程、端口、部署时间和流量变化关联；需要端口级长期归因时，再考虑 eBPF 或内核追踪，而不是看到一个全局计数就修改所有服务。

## 六、容量不能靠“把队列调大”解决

队列只能把短时间的到达速率波动转换为等待时间。一个简单的规划起点是：

```text
Accept Queue 需求 ≈ 峰值握手完成速率 × 可容忍的最长 Accept 停顿时间 + 突发余量
```

例如服务在发布抖动期间可能有短暂停顿，就需要根据压测得到的每秒新建连接数和实际停顿分布估算 backlog。这里不能给出一个适用于所有服务的固定数字，因为长连接比例、连接复用、TLS、负载均衡策略、CPU 调度和 Acceptor 数量都会改变结果。

调整时应遵循四个步骤：

1. **先确认瓶颈层。** 没有 `SYN_RECV`、队列水位和溢出增量，就不要先改 sysctl；
2. **同时对齐应用与内核。** 只提高框架 backlog 但不提高 `somaxconn` 会被静默截断，只提高内核上限但应用仍请求很小也不会生效；
3. **用压测验证突发而非只测稳定 QPS。** 关注每秒新建连接、连接建立 P99、队列峰值、溢出增量和 JVM 停顿；
4. **保留有界过载策略。** 队列扩大后仍需线程池上限、请求超时、入口限流、负载均衡摘除和下游隔离。

下面的 sysctl 片段只展示配置关系，不是推荐生产值：

```conf
# /etc/sysctl.d/99-tcp-listen.conf
# 数值必须由目标机器内存、峰值新建连接速率和压测结果决定
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 8192

# SYN Cookie 保留为攻击或异常压力下的兜底，不当作正常扩容手段
net.ipv4.tcp_syncookies = 1

# 默认不把短暂的 Accept 溢出直接变成客户端 RST
net.ipv4.tcp_abort_on_overflow = 0
```

容器环境还要确认参数属于宿主机还是 Pod 网络命名空间、平台是否允许设置，以及 Service、Ingress、Sidecar 和云负载均衡是否有更小的连接队列或并发上限。链路容量取决于最窄的一段，不取决于你改过的最大数字。

## 七、常见误区与最佳实践

### 误区 1：backlog 越大，吞吐量越高

backlog 增加的是等待空间，不会提高 `accept()`、协议解析或业务处理速度。持续到达速率大于处理速率时，任何有限队列最终都会填满，区别只是失败发生得更晚、尾延迟积累得更高。

### 误区 2：`SYN_RECV` 多就一定是攻击

合法流量突发、客户端到服务端的回程丢包、跨地域高延迟和服务端 SYN-ACK 重传也会增加半连接。应结合源地址分布、Cookie 计数、抓包和入口流量判断，不能只按一个状态数封禁客户端。

### 误区 3：开启 SYN Cookie 后不用管半连接队列

SYN Cookie 是状态耗尽时的防护机制。正常业务长期触发它，仍说明队列、网络或流量治理有缺口；内核文档也明确不建议用它承载合法高负载。

### 误区 4：把 `tcp_abort_on_overflow` 打开就能快速失败

快速失败只改变客户端看到的错误方式。若重试策略没有退避，RST 还可能诱发更猛烈的重连风暴。优先修复 Acceptor 停顿、线程调度和资源上限，并在负载均衡层做有界摘除与退避。

### 误区 5：健康检查成功就代表监听队列健康

健康检查频率低、连接被复用或走独立端口时，可能避开真实业务的连接洪峰。监控应同时覆盖新建连接速率、Accept Queue 水位、内核溢出增量、应用拒绝量与连接建立延迟。

生产治理建议形成一条闭环：

```text
流量基线与突发模型
      → 两级队列和应用边界配置
      → 新建连接压测
      → ss / nstat / JVM 联合观测
      → 有界拒绝与客户端退避
      → 发布摘流和容量复盘
```

发布与滚动重启也属于这条链路。先让负载均衡停止发送新连接，等待连接排空，再关闭监听端；否则监听 Socket 关闭时，握手中的请求和尚未被 `accept()` 的连接可能被中止，队列再大也无法替代优雅摘流。

## 八、总结

Linux TCP 监听入口至少包含 SYN Queue、Accept Queue 和应用处理层三段。`tcp_max_syn_backlog` 管理尚未完成握手的请求，`listen(backlog)` 管理已完成握手但尚未被应用接收的连接，并受 `somaxconn` 静默截断；连接被 `accept()` 后，容量问题才进入 JVM 的事件循环、线程池和下游资源。

排障时先用 `ss` 判断半连接与 Accept Queue 水位，再用 `nstat` 观察 `ListenOverflows`、`ListenDrops` 和 `SyncookiesSent` 的增量，最后关联 GC、Acceptor、线程池和依赖延迟。调参时同时对齐应用与内核，用突发连接压测验证，并保留有界拒绝、退避和发布摘流。只有把队列当作短暂缓冲而不是吞吐量来源，才能让连接洪峰既可观测，也可控制。

## 参考资料

- [Linux `listen(2)`：backlog 与两类连接队列](https://man7.org/linux/man-pages/man2/listen.2.html)
- [Linux Kernel：IP Sysctl 网络参数](https://docs.kernel.org/networking/ip-sysctl.html)
- [Linux Kernel：SNMP Counter 说明](https://docs.kernel.org/networking/snmp_counter.html)
- [iproute2 `ss(8)` 手册](https://man7.org/linux/man-pages/man8/ss.8.html)
- [iproute2 `nstat(8)` 手册](https://man7.org/linux/man-pages/man8/nstat.8.html)
- [Oracle JDK 17：ServerSocket API](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/net/ServerSocket.html)
