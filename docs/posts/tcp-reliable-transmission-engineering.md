---
title: TCP 可靠传输工程实践：序列号、重传、滑动窗口与拥塞控制
date: 2026-08-21
category: 后端开发
cover: /images/posts/tcp-reliable-transmission-engineering-knowledge-map.png
tags: [tcp, networking, retransmission, flow-control, congestion-control, java]
excerpt: TCP 的可靠性不是“绝不丢包”，而是用序列号、确认、校验和与重传把不可靠 IP 交付修复成有序字节流，再由接收窗口和拥塞窗口共同约束发送速度。本文从协议机制、Java 边界和 Linux 诊断讲清完整链路。
---

# TCP 可靠传输工程实践：序列号、重传、滑动窗口与拥塞控制

<img src="/images/posts/tcp-reliable-transmission-engineering-knowledge-map.png" alt="TCP 可靠传输工程实践：序列号、重传、滑动窗口与拥塞控制知识串联图" style="border-radius: 10px;" />

TCP 的可靠性不是“绝不丢包”，而是用序列号、确认、校验和与重传把不可靠 IP 交付修复成有序字节流，再由接收窗口和拥塞窗口共同约束发送速度。本文从协议机制、Java 边界和 Linux 诊断讲清完整链路。

## 先说结论：可靠的是字节流，不是业务结果

RFC 9293 将 TCP 定义为可靠、有序的字节流服务。网络仍然会丢包、乱序、重复和损坏，TCP 只是在端系统之间检测并修复这些问题。它不保证一次 `write()` 对应对端一次 `read()`，也不保证 ACK 到达时业务已经落库。

可以把发送约束压缩成一个公式：

```text
可发送未确认数据量 <= min(rwnd, cwnd)
```

- `rwnd` 是接收方通告的窗口，防止发送方压垮接收缓冲区；
- `cwnd` 是发送方维护的拥塞窗口，防止单条连接压垮网络路径；
- 数据丢失后，通过超时重传、快速重传和 SACK 修复；
- 应用仍要自己定义消息边界、请求超时、幂等和最终业务结果。

本文以 TCP 基础规范 RFC 9293、经典拥塞控制 RFC 5681、RTO 算法 RFC 6298、SACK RFC 2018 和窗口扩展 RFC 7323 为事实基线，核对日期为 2026-08-21。

## 序列号把字节流变成可核对的账本

TCP 序列号标记的是字节位置，不是“第几个包”。一个报文段的 `Sequence Number` 指向其中第一个数据字节；ACK 中的确认号表示接收方下一步期望的序列号。

假设发送方依次发送：

```text
Seq=1000, Len=500  → 字节 1000..1499
Seq=1500, Len=500  → 字节 1500..1999
Seq=2000, Len=500  → 字节 2000..2499
```

接收方完整获得前两段后返回 `ACK=2000`，表示 2000 之前的字节都已连续收到。若第二段丢失、第三段先到，接收方通常仍重复返回 `ACK=1500`：它可以暂存乱序数据，但累计确认号不能跨过缺口。

序列号由四个机制共同发挥作用：

| 机制 | 解决的问题 |
|---|---|
| 累计 ACK | 确认一段连续字节范围，减少确认开销 |
| 乱序重组 | 把路径中乱序到达的报文恢复为有序字节流 |
| 重复消除 | 按序列空间识别重传或网络复制产生的重复数据 |
| TCP 校验和 | 检测首部与数据的传输错误，错误报文不交给应用 |

TCP 校验和是错误检测，不是安全校验。它不能证明发送者身份，也不能阻止内容被恶意修改；机密性、完整性和身份认证应由 TLS 等安全协议提供。

## 丢包如何触发重传

### 超时重传：没有足够反馈时的兜底

发送方为未确认数据维护重传计时器。RTO 不是固定的“网络超时时间”，而是根据平滑 RTT（`SRTT`）和 RTT 波动（`RTTVAR`）动态计算：

```text
RTO = SRTT + max(G, 4 × RTTVAR)
```

其中 `G` 是时钟粒度。发生重传超时后，发送方重发最早未确认的数据，并对后续 RTO 做指数退避。RTO 必须容纳链路波动：设得过小会制造伪重传，过大则延长真实丢包恢复时间。

RFC 6298 规定的是 TCP 实现的重传计时器算法。应用层的 HTTP 读取超时、RPC deadline 和业务任务超时是另一层边界，不能直接拿 RTO 数值代替。

### 快速重传：从重复 ACK 提前识别缺口

若后续报文持续到达，而某段形成缺口，接收方会重复确认同一个序列号。RFC 5681 的经典快速重传在发送方收到 3 个重复 ACK 后，不等 RTO 到期就重传看似丢失的报文。

重复 ACK 不等价于绝对丢包：网络乱序也可能产生重复 ACK。因此，发送方还要结合拥塞控制与更先进的丢包恢复算法处理，不能把每个重复 ACK 都立即当作丢失。

### SACK：告诉发送方“哪些块已经到了”

累计 ACK 只能说明第一个缺口在哪里。一个窗口内丢失多段时，SACK 允许接收方报告已经收到的非连续字节块，发送方就能只重传真正缺失的数据。

SACK 需要在握手阶段通过 `SACK Permitted` 选项协商。它优化的是丢包恢复效率，不改变 TCP 对应用提供的有序字节流语义。

## 流量控制：别把接收方撑爆

接收方通过 TCP 首部的 Window 字段通告 `rwnd`，表示从 ACK 指向的位置开始还能接收多少字节。应用读取慢、接收缓冲区逐渐填满时，`rwnd` 会缩小；窗口降为 0 时，发送方暂停普通数据并通过窗口探测等待恢复。

基础 Window 字段只有 16 位。RFC 7323 的 Window Scale 选项把窗口扩展到更大范围；缩放因子只在 SYN 阶段协商，连接建立后每个方向固定。高带宽、高 RTT 路径需要足够大的窗口填满带宽时延积：

```text
BDP = 带宽 × RTT
```

例如链路带宽很高但 RTT 也很大，窗口过小会让发送方每轮很快发满，然后空等 ACK。盲目放大 Socket 缓冲区也不是万能优化：它会增加单连接内存，并可能把应用消费过慢隐藏成更长排队。

## 拥塞控制：别把网络撑爆

`rwnd` 反映接收端容量，`cwnd` 反映发送方对路径容量的估计。经典 RFC 5681 完整定义四个相互配合的算法：

1. **慢启动**：连接开始或 RTO 恢复后，从较小窗口探测路径；每收到确认新数据的 ACK，`cwnd` 快速增长；
2. **拥塞避免**：当 `cwnd` 到达慢启动阈值 `ssthresh` 后，改为更温和的加性增长，经典目标约为每 RTT 增加一个完整报文段；
3. **快速重传**：3 个重复 ACK 暗示中间存在缺口，立即重传，不等计时器到期；
4. **快速恢复**：快速重传后降低拥塞窗口，但利用仍在到达的重复 ACK 保持 ACK 时钟，避免直接退回完整慢启动。

丢包常被当作拥塞信号，所以 TCP 会在恢复数据的同时降速。现代操作系统可能使用 CUBIC、BBR 或其他拥塞控制算法，具体增长曲线不同，但应用看到的核心边界仍不变：可发送量受 `cwnd` 约束，重传次数增加通常意味着吞吐下降和尾延迟上升。

## TCP 可靠性到不了业务语义

最容易出错的是把传输层成功等同于业务成功：

```text
客户端 write() 成功
    ≠ 数据已离开本机
    ≠ 服务端应用已 read()
    ≠ 请求已解析
    ≠ 数据库事务已提交
    ≠ 响应已返回客户端
```

服务端事务提交后，响应可能在回程丢失。客户端只看到超时，无法判断“请求没执行”还是“执行成功但响应丢了”。如果直接重试支付、下单或退款，就可能重复执行。

因此业务协议至少需要：

- 稳定的 `requestId` 或业务幂等键；
- 明确的连接、读取和整体 deadline；
- 只对可重试错误重试，并使用指数退避与随机抖动；
- 结果未知时先查询状态，不把超时当作失败；
- 服务端将幂等记录与业务变更放在同一事务边界。

TCP 负责“连接内字节的可靠、有序交付”，应用负责“跨连接、跨重试的业务恰好一次效果”。

## Java Socket：超时和消息边界必须显式配置

下面示例用长度前缀解决 TCP 没有消息边界的问题，并分别设置连接超时和读取超时：

```java
public byte[] exchange(InetSocketAddress server, byte[] request) throws IOException {
    try (Socket socket = new Socket()) {
        // 连接超时只覆盖建立连接，不能替代读取超时或整个请求 deadline
        socket.connect(server, 2_000);
        socket.setSoTimeout(3_000);

        // 开启 KeepAlive 只能帮助发现长期失活连接，不是单次请求超时
        socket.setKeepAlive(true);
        // 小请求低延迟场景可关闭 Nagle；是否开启应通过压测决定
        socket.setTcpNoDelay(true);

        DataOutputStream output = new DataOutputStream(socket.getOutputStream());
        output.writeInt(request.length);
        output.write(request);
        output.flush();

        DataInputStream input = new DataInputStream(socket.getInputStream());
        int length = input.readInt();
        if (length < 0 || length > 1024 * 1024) {
            // 限制响应帧大小，避免异常对端诱发内存分配
            throw new IOException("非法响应长度: " + length);
        }

        byte[] response = input.readNBytes(length);
        if (response.length != length) {
            throw new EOFException("响应未完整到达");
        }
        return response;
    }
}
```

一次 `read()` 可能只返回部分数据，所以不能假定它会填满缓冲区。`DataInputStream.readNBytes()` 配合长度上限只是最小示例；生产协议还应包含版本、请求 ID、消息类型、校验策略和认证边界。

`SO_TIMEOUT` 只控制阻塞读取等待时间。若一次请求包含多次读，它可能在每次读到少量数据后重新计时，整体耗时仍可能超出业务目标；RPC 或 HTTP 客户端还需要端到端 deadline。

## Linux 现场诊断：把重传、窗口和 RTT 放在一起看

```bash
# 查看连接的内部 TCP 信息；不同内核和 iproute2 版本字段会有差异
ss -tinp '( dport = :443 or sport = :443 )'

# 查看 TCP 重传报文累计计数，监控系统应采集增量而非只看绝对值
nstat -az TcpRetransSegs
```

`ss -ti` 的常见输出会包含 `rtt`、`rto`、`cwnd`、重传与发送速率等字段。排查时不要只看一个“重传率”：

| 现象 | 可能方向 | 继续验证 |
|---|---|---|
| RTT 稳定，重传突增 | 局部丢包、队列溢出、网卡或中间设备异常 | 两端抓包、接口丢包、交换机/LB 指标 |
| RTT 与 RTO 同时升高 | 排队加重或路径变慢 | `cwnd`、发送队列、链路利用率 |
| `cwnd` 小且反复下降 | 持续拥塞或丢包恢复 | 拥塞算法、路径质量、跨地域链路 |
| 接收窗口长期很小或为 0 | 对端应用读取慢 | 对端 CPU、GC、线程池和接收缓冲区 |
| TCP 指标正常，业务仍超时 | 问题在应用排队或下游 | 请求 deadline、线程池、数据库与依赖 |

抓包时要区分“原始丢包”和“抓包点没看到”。网卡卸载、容器网络、Sidecar、NAT 和负载均衡都可能改变抓包视角。至少对齐连接两端的五元组、时间戳和序列号，再判断报文在哪里消失。

## 常见误区

### ACK 表示服务端处理成功

ACK 只说明对端 TCP 栈接收了连续字节，不代表应用读取，更不代表事务提交。

### TCP 会保持消息边界

TCP 只提供字节流。粘包与拆包不是 TCP 故障，而是应用没有正确做长度前缀、分隔符或固定长度 framing。

### 开启 KeepAlive 就不会请求超时

KeepAlive 面向长时间空闲连接的存活探测，默认参数通常远慢于一次 API 请求允许的时间。请求级 deadline 必须由应用单独设置。

### 应用重试能弥补所有网络错误

TCP 内核已经在重传，应用层立即重试会创建新的连接和流量，可能放大拥塞。只有在业务可幂等、错误可重试且退避受控时才能重试。

### 增大缓冲区一定提高吞吐

高 BDP 链路可能需要更大窗口，但缓冲区也会消耗内存并增加排队。先观察 RTT、窗口、吞吐与应用消费速度，再调整。

## 总结

TCP 用序列号、累计 ACK、校验和、乱序重组与重复消除识别传输问题，再通过 RTO、快速重传和 SACK 修复丢失。接收窗口 `rwnd` 保护接收方，拥塞窗口 `cwnd` 保护网络，真正允许发送的未确认数据量取两者较小值。

这套机制只把不可靠 IP 修复成连接内的可靠有序字节流。Java 服务仍要自己处理消息 framing、端到端 deadline、幂等键、未知结果查询和有界重试。排障时把 RTT、RTO、重传、`cwnd` 与接收窗口关联起来，才能分清是链路丢包、网络拥塞、对端读取慢，还是业务层自己在排队。

## 参考资料

- [RFC 9293：Transmission Control Protocol](https://www.rfc-editor.org/rfc/rfc9293.html)
- [RFC 5681：TCP Congestion Control](https://www.rfc-editor.org/rfc/rfc5681.html)
- [RFC 6298：Computing TCP's Retransmission Timer](https://www.rfc-editor.org/rfc/rfc6298.html)
- [RFC 2018：TCP Selective Acknowledgment Options](https://www.rfc-editor.org/rfc/rfc2018.html)
- [RFC 7323：TCP Extensions for High Performance](https://www.rfc-editor.org/rfc/rfc7323.html)
- [Oracle JDK 21：Socket API](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/net/Socket.html)
- [Linux tcp(7)](https://man7.org/linux/man-pages/man7/tcp.7.html)
- [iproute2 ss(8)](https://man7.org/linux/man-pages/man8/ss.8.html)
