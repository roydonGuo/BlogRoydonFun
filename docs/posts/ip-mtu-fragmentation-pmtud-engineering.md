---
title: IP MTU 与分片工程实践：PMTUD、MSS 与黑洞排障
date: 2026-08-26
category: 后端开发
cover: /images/posts/ip-mtu-fragmentation-pmtud-engineering-knowledge-map.webp
tags: [network, ip, mtu, pmtud, tcp, linux]
excerpt: MTU 问题往往表现为“小包正常、大包卡住”。理解链路 MTU、路径 MTU、IPv4/IPv6 分片、TCP MSS 与 PMTUD 的边界，才能从超时表象定位隧道、负载均衡或防火墙造成的黑洞。
---

# IP MTU 与分片工程实践：PMTUD、MSS 与黑洞排障

<img src="/images/posts/ip-mtu-fragmentation-pmtud-engineering-knowledge-map.webp" alt="IP MTU 与分片工程实践：PMTUD、MSS 与黑洞排障知识串联图" style="border-radius: 10px;" />

MTU 问题往往表现为“小包正常、大包卡住”。理解链路 MTU、路径 MTU、IPv4/IPv6 分片、TCP MSS 与 PMTUD 的边界，才能从超时表象定位隧道、负载均衡或防火墙造成的黑洞。

## 先说结论：不要把“调小 MTU”当成第一诊断结论

MTU 是网络层边界，不是 HTTP 请求体大小限制。生产排障应先回答四个问题：

1. 包从哪张网卡、哪条路由出去，首跳 MTU 是多少；
2. 整条路径中最小的链路 MTU，也就是 PMTU，是多少；
3. 超大报文由谁处理：IPv4 路由器分片、源端分片，还是直接丢弃并返回 ICMP；
4. TCP 是否根据 PMTU 收缩分段，UDP/QUIC 应用是否自己控制报文大小。

经典 PMTUD 依赖 ICMP 错误反馈。若中间设备丢弃超大包，又过滤了 ICMP，发送端无法学习更小的 PMTU，就会出现“握手成功、小响应正常、大响应或上传超时”的 PMTU 黑洞。正确修复通常是放通必要 ICMP、修正隧道 MTU 或在边界做合理的 MSS 调整；全局盲目降低 MTU 只是在绕过症状。

本文以 [RFC 1191](https://www.rfc-editor.org/rfc/rfc1191.html)、[RFC 8200](https://www.rfc-editor.org/rfc/rfc8200.html)、[RFC 8201](https://www.rfc-editor.org/rfc/rfc8201.html)、[RFC 9293](https://www.rfc-editor.org/rfc/rfc9293.html) 与 Linux 内核当前文档为事实基线，核对日期为 2026-08-26。

## 先分清四个容易混用的量

| 名称 | 含义 | 常见误区 |
|---|---|---|
| 链路 MTU | 一条链路一次可承载的最大 IP 包大小 | 以太网常见 1500，不代表端到端一定是 1500 |
| 路径 MTU（PMTU） | 源到目的路径上所有链路 MTU 的最小值 | 路由变化后可能改变，也可能上下行不对称 |
| TCP MSS | 一个 TCP 段中可接收的数据上限，通过 SYN 选项通告 | MSS 不含 IP/TCP 固定头，不等于 MTU |
| 应用载荷 | HTTP、RPC、UDP 消息等业务数据 | TCP 会分段，单次写入大小不等于单个 IP 包大小 |

以无 IP/TCP 选项的常见 IPv4/TCP 为例，链路 MTU 为 1500 时，MSS 常见为 `1500 - 20 - 20 = 1460`。IPv6 固定头为 40 字节，对应常见值为 `1500 - 40 - 20 = 1440`。真实报文若携带 TCP 选项、IPv4 选项、IPv6 扩展头、IPsec 或隧道封装，可用载荷还会减少，不能把 1460 或 1440 写死成普遍真理。

TCP MSS 只表达接收端能接收的 TCP 数据上限；发送端实际使用的有效 MSS 还要受本地 IP 层允许发送的大小约束。也就是说，MSS 协商不能替代 PMTU 探测。

## IPv4 与 IPv6 的分片边界不同

### IPv4：路由器可能分片，DF 决定能否分片

IPv4 报文头包含 Identification、Flags 和 Fragment Offset。若报文超过下一跳 MTU：

- `DF=0`：中间路由器可以把报文拆成多个分片；
- `DF=1`：路由器丢弃报文，并应返回 ICMP Destination Unreachable，Code 4，告知需要分片及下一跳 MTU；
- 接收端按标识、偏移量和 More Fragments 标志重组。

分片不是免费的。一个分片丢失会导致整个原始报文无法重组；每个分片都有额外 IP 头；防火墙、NAT 与负载均衡还要正确处理非首片。因此工程上更希望源端根据 PMTU 选择合适大小，避免路径中分片。

### IPv6：路由器不分片，只返回 Packet Too Big

IPv6 中间路由器不会替发送端分片。转发链路容纳不下报文时，路由器丢弃它并发送 ICMPv6 Packet Too Big；需要分片时，只能由源节点添加 Fragment Header。IPv6 最小链路 MTU 是 1280 字节，无法实施 PMTUD 的最小实现不得发送超过该值的包。

这意味着 ICMPv6 Packet Too Big 不是“可有可无的 ping 流量”，而是 IPv6 正常传输机制的一部分。粗暴屏蔽 ICMPv6 很容易制造只在特定包长出现的连接故障。

## 三类路径 MTU 发现机制

### 1. 经典 IPv4 PMTUD

发送端设置 DF，按当前估计的 PMTU 发包。中间路由器无法转发时返回 ICMP “fragmentation needed”，发送端据此降低 PMTU 并重新分段。它简单有效，但依赖 ICMP 能返回且能被正确关联到原连接。

### 2. IPv6 PMTUD

发送端收到 ICMPv6 Packet Too Big 后降低 PMTU。路径可能动态变化，因此 PMTU 缓存不能永久有效；实现需要处理下降、重新探测和伪造 ICMP 带来的安全风险。

### 3. PLPMTUD / DPLPMTUD

[RFC 4821](https://www.rfc-editor.org/rfc/rfc4821.html) 定义的 PLPMTUD 由 TCP 等分包层发送不同大小的探测包，根据确认与丢失逐步逼近可用大小，不把 ICMP 作为唯一依据。[RFC 8899](https://www.rfc-editor.org/rfc/rfc8899.html) 将这一思路系统化到 UDP、QUIC 等数据报传输。

| 机制 | 主要反馈 | 优点 | 边界 |
|---|---|---|---|
| IPv4 PMTUD | ICMP 需要分片 | 收敛直接、可获得建议 MTU | ICMP 被过滤时可能黑洞 |
| IPv6 PMTUD | ICMPv6 Packet Too Big | 符合 IPv6 路由器不分片模型 | 同样依赖 PTB 可达与校验 |
| PLPMTUD | 分包层探测与确认 | 可在 ICMP 不可靠时继续工作 | 需要协议有确认或探测机制 |
| DPLPMTUD | 数据报探测状态机 | 适合 UDP、QUIC 等传输 | 必须由协议或应用实现确认语义 |

Linux 的 `tcp_mtu_probing` 控制 TCP PLPMTUD：`0` 禁用，`1` 在检测到 ICMP 黑洞时启用，`2` 始终启用并从 `tcp_base_mss` 开始。具体默认值可能随内核或发行版改变，上线前应读取目标机器的实际 sysctl，而不是照抄配置。

```bash
# 读取当前主机的 TCP MTU 探测策略；先观察，不要直接改全局参数
sysctl net.ipv4.tcp_mtu_probing

# 查看内核为目标地址选择的路由、出口网卡和源地址
ip route get 203.0.113.10

# 查看网卡 MTU；隧道、Pod veth 与物理网卡要分别检查
ip -details link show
```

## 黑洞为什么常在 Java 服务里伪装成超时

典型链路是：Java 服务 → Pod veth → CNI 隧道 → 节点网卡 → 云负载均衡 → 对端。物理网卡可能是 1500，但 VXLAN、WireGuard、GRE 或 IPsec 会增加外层头。如果内层仍发送 1500 字节 IP 包，而隧道出口没有足够空间，就需要分片或返回 ICMP。

当 ICMP 被安全组、防火墙或错误的 ACL 丢弃时，应用层常见表象包括：

- TCP 三次握手成功，但传输较大 TLS 记录后停滞；
- 健康检查与小 JSON 正常，文件上传、批量响应或 gRPC 大消息超时；
- 同一接口在内网正常，跨 VPN、跨云或经过特定负载均衡后失败；
- 重试偶尔成功，日志只看到 `read timeout`、`connection reset` 或请求取消；
- 把请求体压小、关闭某段封装或更换网络路径后恢复。

这些现象只能形成 MTU 假设，不能单凭“请求大”就下结论。拥塞、丢包、代理缓冲、TLS、应用背压也会产生相似症状，必须用路由、探测与抓包闭环验证。

## 一套从现象到证据的排障顺序

### 1. 固定五元组与真实路径

记录源/目的 IP、端口、协议、命名空间、出口网卡和是否经过 VPN、Service Mesh、NAT 或负载均衡。不要只在宿主机探测 Pod 内问题，也不要拿 ICMP Echo 路径替代真实 TCP/UDP 路径后直接下结论。

### 2. 用 DF/PTB 探测可通过的包长

Linux `ping -M` 可以选择 PMTU 策略。IPv4 的 `-s` 是 ICMP 数据长度，计算完整 IP 包时还要加 IPv4 头与 ICMP 头；不同 IP 版本的头部长度不同。

```bash
# IPv4：1472 数据 + 20 字节 IPv4 头 + 8 字节 ICMP 头 = 1500
ping -4 -M do -s 1472 203.0.113.10

# 若失败，逐步减小载荷，寻找可稳定通过的边界
ping -4 -M do -s 1400 203.0.113.10

# 绕过内核已有 PMTU 检查主动探测；通常需要相应权限
ping -4 -M probe -s 1472 203.0.113.10
```

对端可能禁用 Echo Reply，所以 ping 失败不等于 PMTU 一定异常。此时应结合真实业务流量、TCP SYN 中的 MSS、ICMP/PTB 和重传证据。

### 3. 两端同时抓包

```bash
# 观察 TCP 握手 MSS、重传，以及 IPv4 需要分片或 IPv6 PTB
tcpdump -ni any 'host 203.0.113.10 and (tcp or icmp or icmp6)'

# 只检查 TCP SYN 及其选项，确认两端各自通告的 MSS
tcpdump -ni any 'host 203.0.113.10 and tcp[tcpflags] & tcp-syn != 0'
```

若发送端反复重传相同的大段、对端完全收不到，同时路径上没有可见 ICMP/PTB，黑洞嫌疑很高。还要注意 TSO/GSO/GRO：在主机抓包中看到的“超大包”可能是网卡卸载前后的聚合视图，不一定真的以该大小上网线。必要时在更接近隧道出口的位置抓包交叉验证。

### 4. 核对内核路径状态

```bash
# 查看到目标的路由缓存信息；不同内核/iproute2 输出字段可能不同
ip route get 203.0.113.10

# 查看 TCP 连接的 MSS、重传、拥塞窗口等内核状态
ss -tin dst 203.0.113.10

# 读取而不是猜测 PLPMTUD、基础 MSS 等当前值
sysctl net.ipv4.tcp_mtu_probing net.ipv4.tcp_base_mss
```

## 修复顺序：让协议反馈恢复，而不是只把包变小

优先级通常如下：

1. **放通必要 ICMP/ICMPv6**：允许与现有连接相关的 “fragmentation needed” 和 Packet Too Big 返回；
2. **统一隧道与工作负载 MTU**：按封装开销给 CNI、VPN、veth 与节点网卡设置一致边界；
3. **边界设备调整 TCP MSS**：只解决穿过该边界的 TCP，不能修复 UDP，也不能替代正确的 PMTUD；
4. **启用 TCP PLPMTUD**：作为 ICMP 不可靠环境的鲁棒性补充，先在目标主机和业务流量上灰度；
5. **应用层限制数据报大小**：UDP/QUIC 或自定义协议要实现分包、确认、重试和 DPLPMTUD，不要依赖 IPv4 路由器分片；
6. **临时降低接口 MTU**：可用于验证假设或应急止血，但必须记录影响范围并回到根因修复。

MSS Clamping 只在 SYN 阶段改写 TCP 通告。它对已建立连接无效，对 UDP 无效，也无法解决反向路径或其他出口的 MTU 不一致。把所有服务器 MSS 固定得很小会增加包数和协议开销，并掩盖网络配置漂移。

## 监控应把应用超时与网络证据关联起来

应用侧至少记录目标主机、请求阶段、已发送/接收字节、超时类型、重试次数和连接复用情况；网络侧关注 TCP 重传、ICMP/PTB、接口丢包、隧道丢弃与路由变化。推荐围绕同一时间窗关联：

```text
大响应超时上升
  → 指定出口 TCP 重传上升
  → ICMP/PTB 缺失或隧道丢弃增加
  → 最近网络策略、CNI、VPN 或负载均衡配置变更
```

PMTU 具有路径属性。按“整台机器一个固定值”聚合指标，容易把某个租户、可用区、出口或对端的局部故障稀释掉。

## 发布前检查清单

- 应用、Pod、隧道、节点和云网络的 MTU 是否逐层核对；
- IPv4 “需要分片”与 ICMPv6 Packet Too Big 是否能返回发送端；
- TCP SYN MSS 是否符合真实路径，而不是机械固定为 1460；
- UDP/QUIC 是否有应用层分包、确认与探测机制；
- 是否在真实命名空间、真实出口与双向路径抓包；
- 是否排除了 TSO/GSO/GRO 对抓包大小的影响；
- 临时调小 MTU、MSS Clamping 或 sysctl 是否有灰度、监控和回滚；
- Java 超时日志是否能关联到目标地址、传输阶段与网络指标。

归根结底，MTU 治理不是寻找一个“万能包长”，而是让发送端持续知道真实路径能承载多大的 IP 包，并让路径变化、错误反馈与协议重试形成闭环。
