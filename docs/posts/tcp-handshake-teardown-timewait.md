---
title: TCP 连接建立与关闭：三次握手、四次挥手与 TIME_WAIT
date: 2026-10-12
category: 后端开发
cover: /covers/backend.svg
tags: [tcp, 网络, time_wait, 握手, 排障]
excerpt: 三次握手交换的是双方的初始序列号并确认双向可达，四次挥手是因为 TCP 全双工、两个方向要各自关闭。TIME_WAIT 不是 bug，而是保证旧连接的迟到报文不污染新连接；服务端端口耗尽要靠在途连接治理和连接复用，而不是关掉这个状态。
---

# TCP 连接建立与关闭：三次握手、四次挥手与 TIME_WAIT

<img src="/images/posts/tcp-handshake-teardown-timewait-knowledge-map.png" alt="TCP 连接建立与关闭：三次握手、四次挥手与 TIME_WAIT知识串联图" style="border-radius: 10px;" />

三次握手交换的是双方的初始序列号并确认双向可达，四次挥手是因为 TCP 全双工、两个方向要各自关闭。TIME_WAIT 不是 bug，而是保证旧连接的迟到报文不污染新连接；服务端端口耗尽要靠在途连接治理和连接复用，而不是关掉这个状态。

## 先说结论

| 阶段 | 报文 | 目的 |
|---|---|---|
| 建连 | SYN → SYN+ACK → ACK | 交换初始序列号（ISN），确认双向可达，协商 MSS/窗口缩放等选项 |
| 断连 | FIN → ACK → FIN → ACK | 两个方向独立关闭，各自发送 FIN 并等待对端确认 |
| 主动关闭方 | 进入 TIME_WAIT，等 2MSL | 保证最后一个 ACK 可靠送达、旧连接的重复报文在网络中消亡 |

"三次"不是仪式：两次无法让被动方确认自己的序列号被对方收到；"四次"也不是浪费：收到 FIN 只代表对方没数据要发，本端仍可能有数据要发，所以 ACK 与 FIN 通常分开。

## 一、握手细节：每个字段都在解决一个问题

- **SYN + 序列号**：客户端给出初始序列号 `seq=x`，同时携带 MSS、窗口缩放、SACK 许可等选项；
- **SYN+ACK**：服务端回 `seq=y, ack=x+1`，确认收到并给出自己的 ISN；
- **ACK**：客户端回 `ack=y+1`，连接进入 ESTABLISHED；
- **SYN 队列与 accept 队列**：服务端收到 SYN 后放入半连接队列（SYN queue），完成握手后进入全连接队列（accept queue）等待应用 `accept()`。队列满了之后的处理由 `tcp_abort_on_overflow` 决定：默认丢弃（客户端重传），开启则回 RST（客户端看到连接重置）。这是"服务明明启动了却连不上"的常见原因。

SYN flood 攻击正是打半连接队列：伪造源地址只发 SYN 不回 ACK，占满队列。防御手段包括 SYN cookie（`net.ipv4.tcp_syncookies`）与缩短 `tcp_syn_retries`。

## 二、挥手细节：为什么 TIME_WAIT 落在主动关闭方

```text
主动关闭方                        被动关闭方
FIN  --------------------------->  FIN_WAIT_1
     <---------------------------  ACK（被动方进入 CLOSE_WAIT）
                                    （被动方继续发剩余数据）
     <---------------------------  FIN（被动方进入 LAST_ACK）
ACK  --------------------------->  CLOSED
TIME_WAIT（等 2MSL）→ CLOSED
```

TIME_WAIT 的两个作用：

1. **保证最后的 ACK 能到达**：若 ACK 丢失，对端会重传 FIN，此时本端还能重发 ACK；若直接关闭，对端将收到 RST，异常终止；
2. **让旧连接的迷路报文过期**：2MSL 内同一四元组的新连接不会被上一个连接的延迟报文干扰。

因此大量 TIME_WAIT 通常意味着**本端是主动关闭方**（常见于 HTTP 客户端、短连接、代理层）。它占的是本地端口与少量内存，不等同于故障；真正的问题是端口耗尽或在途连接占满。

**CLOSE_WAIT 堆积**则是另一回事：对端已发 FIN，本端应用没有 `close()`。这几乎总是应用缺陷——连接泄漏、忘记释放、线程池耗尽导致无法处理关闭事件。

## 三、真实示例：连接复用与超时配置

```yaml
# Spring Boot 3 + Tomcat：服务端连接与超时治理
server:
  port: 8080
  tomcat:
    accept-count: 200            # 全连接队列长度，队列满后新连接被拒或丢弃
    max-connections: 8192        # 最大连接数
    threads:
      max: 200                   # 工作线程，超过后请求排队
    connection-timeout: 5s       # 建连后读取请求头的超时
  # 关闭时等待在途请求完成，避免直接 RST
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

```java
/**
 * HTTP 客户端连接池：复用连接，避免短连接造成大量 TIME_WAIT。
 * 使用 JDK 11+ HttpClient，keep-alive 由连接池自行维护。
 */
public final class HttpClientFactory {

    /**
     * 构建共享客户端：全局单例，禁止每次请求 new 一个（会退化为短连接）。
     */
    public static HttpClient build() {
        return HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)        // 明确协议版本，避免协商歧义
                .connectTimeout(Duration.ofSeconds(2))       // 建连超时，覆盖 SYN 重传窗口
                .followRedirects(HttpClient.Redirect.NORMAL)
                .executor(Executors.newFixedThreadPool(8))   // 有界线程池，防回调堆积
                .build();
    }
}
```

排障命令：

```bash
# 各 TCP 状态计数：TIME_WAIT 高看主动关闭，CLOSE_WAIT 高看应用未 close
ss -s
ss -tan state time-wait | wc -l
ss -tan state close-wait | head

# 端口范围与可复用参数
sysctl net.ipv4.ip_local_port_range net.ipv4.tcp_tw_reuse net.ipv4.tcp_fin_timeout
```

## 四、常见追问

**问：TIME_WAIT 会让端口耗尽吗？**
会。主动关闭方在 2MSL 内占用四元组，高并发短连接会把本地端口吃光。解法是连接复用（keep-alive/连接池）、扩大端口范围、`tcp_tw_reuse` 允许复用处于 TIME_WAIT 的连接（受时间戳条件约束）。

**问：`tcp_tw_recycle` 还能用吗？**
不能。它在 NAT 环境下会丢弃正常连接，Linux 4.12 起已被移除。看到旧文章推荐它，直接跳过。

**问：CLOSE_WAIT 很多怎么办？**
查应用是否漏 `close()`：连接池泄漏、异常分支未释放、线程池被打满无法消费关闭事件。这是代码问题，不是内核参数问题。

**问：SYN 队列满和 accept 队列满表现一样吗？**
不一样。SYN 队列满时客户端重传 SYN（连不上）；accept 队列满时握手已完成但应用不 accept，客户端表现为"已连接但不响应"或收到 RST。

**问：为什么 HTTP/2 或长连接能显著降低 TIME_WAIT？**
连接被复用后，关闭次数大幅下降，2MSL 占用随之减少。这也是网关层普遍启用 keep-alive 的原因。

## 五、踩坑记录

- **压测机端口耗尽**：短连接压测未开复用，客户端报 `Cannot assign requested address`。
- **服务端优雅停机缺失**：直接 kill 进程，客户端收到大量 RST，重试风暴。
- **把 `tcp_tw_recycle` 当优化项**：NAT 后客户端被随机拒绝。
- **只看 TIME_WAIT 数量告警**：真正该监控的是端口使用率、accept 队列溢出、CLOSE_WAIT 增长趋势。
- **`connection-timeout` 当成整体超时**：它只覆盖读取请求头阶段，业务慢仍会拖住线程。
- **keep-alive 超时与服务端不一致**：客户端复用了服务端已关闭的连接，偶发 `Connection reset`。

## 六、选择建议

| 现象 | 优先动作 |
|---|---|
| TIME_WAIT 高 | 连接复用、扩端口范围，必要时 `tcp_tw_reuse` |
| CLOSE_WAIT 高 | 查应用连接释放逻辑 |
| 建连慢/超时 | 查 SYN 重传、SYN 队列、防火墙与 backlog |
| 已连接无响应 | 查 accept 队列与工作线程是否打满 |
| 偶发连接重置 | 对齐 keep-alive 与空闲回收时间 |

## 七、最佳实践清单

1. 客户端一律用连接池，禁止每请求新建连接；
2. 服务端开启优雅停机，关闭前等待在途请求；
3. 监控 accept 队列溢出与 CLOSE_WAIT 趋势，而非只盯 TIME_WAIT 绝对值；
4. 内核参数只调有明确依据的项，禁用已移除的 `tcp_tw_recycle`；
5. 内外网链路的 keep-alive 与空闲超时对齐（客户端略短于服务端）；
6. 压测环境与生产一致，压测机端口范围要提前评估。

## 总结

三次握手的核心是交换序列号并确认双向可达，四次挥手源于全双工的两个方向独立关闭，TIME_WAIT 是主动关闭方为保证可靠性付出的 2MSL 押金。把 TIME_WAIT 当故障去"消灭"是方向性错误；真正的工程动作是连接复用、队列治理与超时对齐，让连接生命周期可控。
