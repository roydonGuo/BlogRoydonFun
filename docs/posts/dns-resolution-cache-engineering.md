---
title: DNS 解析工程实践：递归查询、缓存与故障治理
date: 2026-08-12
category: 后端开发
cover: /covers/backend.svg
tags: [dns, network, java, cache, reliability]
excerpt: 从一次域名查询出发，讲清 Stub Resolver、递归与迭代查询、权威数据、正负缓存和 Java 地址缓存，并给出超时隔离、切流发布与可观测性实践。
---

# DNS 解析工程实践：递归查询、缓存与故障治理

<img src="/images/posts/dns-resolution-cache-engineering-knowledge-map.png" alt="DNS 解析工程实践：递归查询、缓存与故障治理知识串联图" style="border-radius: 10px;" />

从一次域名查询出发，讲清 Stub Resolver、递归与迭代查询、权威数据、正负缓存和 Java 地址缓存，并给出超时隔离、切流发布与可观测性实践。

## 先说结论：DNS 是带缓存的分布式查询链路

应用代码调用 `InetAddress.getAllByName("api.example.com")` 时，看起来只是“域名换 IP”，真实链路却可能经过进程缓存、操作系统 Stub Resolver、递归解析器，以及根、顶级域和权威服务器。任何一层的缓存、超时或错误都会改变应用看到的结果。

工程上最重要的不是背诵八步解析流程，而是先建立五个边界：

1. **应用通常发起递归查询，不是自己逐级询问根服务器**；
2. **递归解析器通常通过迭代查询追踪委派，并共享缓存**；
3. **TTL 限制的是 DNS RRset 缓存寿命，不等于连接、HTTP 客户端或 JVM 一定同步刷新**；
4. **NXDOMAIN、NODATA、SERVFAIL、REFUSED 和超时含义不同，不能统一归为“域名不存在”**；
5. **DNS 切流是最终一致的发布过程，必须同时治理旧连接、各层缓存与失败回退**。

本文以 DNS 基础协议、当前 IANA 注册表和 Java SE 21 为适用基线，事实核对时间为 2026-08-12。核心依据包括 [RFC 1034](https://www.rfc-editor.org/rfc/rfc1034.html)、[RFC 1035](https://www.rfc-editor.org/rfc/rfc1035.html)、[RFC 2308](https://www.rfc-editor.org/rfc/rfc2308.html)、[RFC 9520](https://www.rfc-editor.org/rfc/rfc9520.html)、[IANA DNS Parameters](https://www.iana.org/assignments/dns-parameters/dns-parameters.xhtml) 与 [Java SE 21 InetAddress](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/net/InetAddress.html) 文档。

## 一、一次解析里有哪些角色

### 1. 应用与 Stub Resolver

浏览器、Java 服务、数据库客户端首先把域名交给本机名称解析接口。Stub Resolver 只负责把请求转交给已配置的递归解析器，并接收最终答案或错误，通常不维护完整的 DNS 委派遍历逻辑。

应用调用 `InetAddress` 时，看到的是 Java 名称服务抽象。它可能受 JVM 地址缓存、操作系统配置、容器 DNS 配置和网络环境共同影响。仅凭一段 Java 代码，不能推断实际查询一定发往哪个公共 DNS 服务。

### 2. 递归解析器

递归解析器接收“请替我找出最终答案”的请求。它先查缓存；未命中时，再沿 DNS 树查找权威来源。企业内网 DNS、运营商 DNS、云解析服务和容器集群内的 DNS 服务都可能承担这一角色。

递归解析器的价值不只是代查：它集中缓存结果、合并相同并发请求、选择可用上游，并处理委派、别名、重试和失败缓存。它也是排障时最容易被忽略的一层。

### 3. 根、顶级域与权威服务器

- **根服务器**：保存顶级域的委派信息，不保存普通业务域名最终地址；
- **顶级域服务器**：例如 `.com` 的服务器，继续给出目标区域的权威服务器委派；
- **权威服务器**：维护某个 Zone 的权威数据，回答该区域内的 RRset；
- **主/辅助权威服务器**：描述区域数据维护和复制角色，不应与递归/权威职责混为一谈。

“权威”表示数据来自该 Zone 的管理边界，不表示每次查询都直达权威服务器。大部分正常流量会被递归缓存吸收。

## 二、递归查询与迭代查询不是同一件事

### 递归查询

客户端请求递归服务时，期望服务器返回最终答案或最终错误，而不是让客户端继续询问其他服务器。DNS 报文中的 `RD` 表示请求递归，响应中的 `RA` 表示服务器支持递归；两者不能简单等价为“这份数据是权威的”，权威性由 `AA` 等语义表达。

### 迭代查询

非递归查询的服务器可以返回：

- 本地已有的答案；
- 明确错误；
- 指向更接近目标 Zone 的服务器集合，即 referral。

典型递归解析器会迭代执行：根服务器 → 顶级域服务器 → 权威服务器。每次收到更具体的委派，就更新下一跳，直到获得答案、负面答案或解析失败。

### 标准解析流程

以查询 `api.shop.example` 的 A/AAAA 记录为例：

```text
Java 应用 / 浏览器
        ↓ 递归请求
Stub Resolver → 递归解析器
                    ↓ 缓存未命中，迭代询问
                 根服务器
                    ↓ 返回顶级域委派
               顶级域服务器
                    ↓ 返回 example 权威委派
                 权威服务器
                    ↓ 返回 A/AAAA、别名或负面答案
递归解析器缓存并返回 → Stub Resolver → 应用
```

这是逻辑主线，不代表每次都会发生全部网络访问。NS、地址、别名和最终 RRset 都可能已在缓存中，解析器也可能配置 Forwarder，把请求转给另一个递归服务。

## 三、DNS 报文与资源记录怎样组成

RFC 1035 定义的标准 DNS 消息由 Header 和四个 Section 组成：

| 区域 | 作用 |
|---|---|
| Question | 查询名 QNAME、查询类型 QTYPE、查询类 QCLASS |
| Answer | 直接回答问题的资源记录 |
| Authority | 权威来源、委派或负缓存所需的 SOA 等记录 |
| Additional | 与当前答案相关的辅助记录，例如某些 NS 的地址 |

资源记录 RR 的公共结构包括 NAME、TYPE、CLASS、TTL、RDLENGTH 和 RDATA。缓存通常围绕同名、同类型、同类的一组记录，即 RRset 运作，而不是任意挑一条记录永久保存。

IANA 的 RR TYPE 注册表是持续扩展的，不能把某份旧教程的列表当作完整全集。后端工程最常遇到的记录可按用途理解：

| 用途 | 常见类型 | 工程含义 |
|---|---|---|
| 地址 | A、AAAA | 分别提供 IPv4、IPv6 地址 |
| 别名 | CNAME | 将一个名称指向另一个规范名称，解析器继续追踪 |
| 委派与区域 | NS、SOA | 表达权威服务器和区域管理/负缓存信息 |
| 邮件 | MX | 指定邮件交换服务器及优先级 |
| 服务发现 | SRV | 表达服务目标、端口、优先级和权重 |
| 文本与验证 | TXT | 承载域名所有权验证、邮件策略等文本数据 |
| 反向解析 | PTR | 将反向命名空间中的地址映射回名称 |
| 安全扩展 | DS、DNSKEY、RRSIG、NSEC/NSEC3 | 构成 DNSSEC 委派、密钥、签名和不存在证明链路 |
| HTTPS 服务参数 | HTTPS、SVCB | 描述服务端点及可选连接参数，能力以当前注册表和客户端实现为准 |

不要把 CNAME 当作 HTTP 302。CNAME 发生在名称解析层；HTTP 重定向发生在应用协议层，浏览器地址栏、请求 Host 和 TLS 证书边界都不同。

## 四、缓存：TTL 只是第一层时钟

### 1. 正缓存

权威服务器为 RR 提供 TTL，递归解析器缓存后随时间递减，到期后不应继续把它当作有效缓存答案。较长 TTL 降低权威压力和解析延迟，但会拉长切流收敛；较短 TTL 提升变更灵活性，同时增加缓存未命中和上游查询压力。

TTL 不会主动通知所有客户端刷新。已经建立的 HTTP Keep-Alive、连接池、WebSocket、数据库连接和服务注册对象仍可能继续使用旧 IP。即使 DNS 缓存已过期，连接生命周期也可能让流量留在旧节点。

### 2. NXDOMAIN 与 NODATA 负缓存

这两个结果必须区分：

- **NXDOMAIN**：查询名称不存在；
- **NODATA**：名称存在，但没有所查询类型的记录，例如存在 A 却没有 AAAA。

RFC 2308 要求权威负面答案携带 SOA，以便解析器确定负缓存时间。负缓存 TTL 取 SOA RR 自身 TTL 与 SOA.MINIMUM 中较小者。刚修复一个误删记录后仍有用户持续失败，常见原因就是负缓存尚未到期。

### 3. 解析失败缓存

SERVFAIL、REFUSED、超时、服务器不可达、委派循环、别名循环和 DNSSEC 校验失败不是 NXDOMAIN。RFC 9520 要求解析器对解析失败做有界缓存，避免故障期间每个请求都放大成上游查询风暴；同时规定失败缓存至少 1 秒，且不得超过 5 分钟。

业务代码不应把所有异常吞掉后写入一个长 TTL 的“域名不存在”缓存。否则短暂网络故障会被应用层放大成长时间不可用。

### 4. 常见的多层缓存

```text
业务对象 / HTTP 连接池
        ↓
JVM InetAddress 地址缓存
        ↓
操作系统或本地缓存服务
        ↓
集群 / 企业递归解析器
        ↓
上游递归缓存与权威数据
```

排障时必须逐层问“谁缓存了什么、缓存多久、失败是否也缓存”，不能只在权威控制台确认新记录已经生效。

## 五、Java 21 的地址缓存边界

`InetAddress` 会缓存成功和失败的名称解析。Java SE 21 文档列出三个 security properties：

| 属性 | 含义 |
|---|---|
| `networkaddress.cache.ttl` | 成功解析结果缓存秒数；负值表示永久，0 表示不缓存 |
| `networkaddress.cache.negative.ttl` | 失败解析结果缓存秒数；JDK 21 文档给出的默认值为 10 秒 |
| `networkaddress.cache.stale.ttl` | 刷新失败时，允许保留过期成功结果的时间 |

这些是 **security properties**，不是普通 System Properties。Oracle 文档明确说明，不能把它们当作 `-Dnetworkaddress.cache.ttl=...` 或 `System.setProperty(...)` 来配置。更稳妥的部署方式是准备附加安全属性文件：

```properties
# dns-security.properties
# 成功结果保留 30 秒；实际值必须结合权威 TTL、切流目标和查询容量验证
networkaddress.cache.ttl=30

# 失败只保留 5 秒，避免短暂故障在单个 JVM 内被长时间放大
networkaddress.cache.negative.ttl=5

# 这里选择不使用过期结果；需要 stale-if-error 时必须评估旧地址安全性
networkaddress.cache.stale.ttl=0
```

启动时追加，而不是完全覆盖 JDK 主安全配置：

```bash
# 单个等号表示在主 java.security 后追加自定义属性文件
java -Djava.security.properties=/opt/app/dns-security.properties -jar app.jar
```

不要轻易使用双等号的完全覆盖模式，否则可能连同 JDK 的算法限制和安全 Provider 配置一起替换。生效值可以用 `-XshowSettings:security` 或 `-Djava.security.debug=properties` 辅助核对。

## 六、真实示例：给阻塞式 DNS 查询加隔离与观测

`InetAddress.getAllByName` 是阻塞调用，没有提供单次查询超时参数。下面的 Java 21 组件把解析放进专用有界线程池，向调用方提供总预算，并记录全部地址和耗时。超时后的取消不保证底层系统解析立即停止，因此线程池容量仍然必须有界。

```java
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public final class ObservedDnsResolver implements AutoCloseable {

    private final ExecutorService executor;

    public ObservedDnsResolver(int maxConcurrentLookups) {
        if (maxConcurrentLookups <= 0) {
            throw new IllegalArgumentException("maxConcurrentLookups 必须大于 0");
        }
        // 使用固定大小线程池隔离系统解析调用，避免故障时无限创建阻塞线程
        this.executor = Executors.newFixedThreadPool(maxConcurrentLookups);
    }

    public Resolution resolve(String host, Duration timeout) {
        long start = System.nanoTime();
        Callable<List<String>> task = () -> Arrays.stream(InetAddress.getAllByName(host))
                // 保留全部地址，不要默认只取第一条 A/AAAA 记录
                .map(InetAddress::getHostAddress)
                .distinct()
                .toList();

        Future<List<String>> future = executor.submit(task);
        try {
            List<String> addresses = future.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
            return new Resolution(host, addresses, elapsedSince(start), "SUCCESS");
        } catch (TimeoutException ex) {
            // 取消只表达调用方不再等待，底层 native lookup 仍可能继续占用线程
            future.cancel(true);
            throw new DnsLookupException(host, "TIMEOUT", elapsedSince(start), ex);
        } catch (ExecutionException ex) {
            Throwable cause = ex.getCause();
            String outcome = cause instanceof UnknownHostException
                    ? "UNKNOWN_HOST"
                    : "RESOLVER_ERROR";
            throw new DnsLookupException(host, outcome, elapsedSince(start), cause);
        } catch (InterruptedException ex) {
            // 恢复中断标记，让上层取消和停机逻辑仍然可见
            Thread.currentThread().interrupt();
            throw new DnsLookupException(host, "INTERRUPTED", elapsedSince(start), ex);
        }
    }

    private static Duration elapsedSince(long startNanos) {
        return Duration.ofNanos(System.nanoTime() - startNanos);
    }

    @Override
    public void close() {
        executor.shutdownNow();
    }

    public record Resolution(
            String host,
            List<String> addresses,
            Duration elapsed,
            String outcome) {
    }

    public static final class DnsLookupException extends RuntimeException {
        private final String host;
        private final String outcome;
        private final Duration elapsed;

        public DnsLookupException(
                String host,
                String outcome,
                Duration elapsed,
                Throwable cause) {
            super("DNS lookup failed: host=" + host + ", outcome=" + outcome, cause);
            this.host = host;
            this.outcome = outcome;
            this.elapsed = elapsed;
        }

        public String host() {
            return host;
        }

        public String outcome() {
            return outcome;
        }

        public Duration elapsed() {
            return elapsed;
        }
    }
}
```

这段代码解决的是调用隔离与观测，不是完整 DNS 客户端。`UnknownHostException` 本身不能稳定暴露原始 RCODE、权威 SOA、DNS TTL 或命中的缓存层。需要诊断协议细节时，应使用受控的 DNS 诊断工具或具备明确契约的 DNS 客户端库，并避免在每个业务请求里额外发一遍诊断查询。

## 七、DNS 切流应该怎样发布

假设要把 `api.example.com` 从旧地址切到新地址，推荐按 Expand-Contract 思路执行：

1. **新节点先扩容并完成健康检查**，证书、Host 路由、鉴权和依赖全部就绪；
2. **提前一个完整旧 TTL 周期降低 TTL**，不能在切流瞬间才修改；
3. **同时发布旧、新地址**，观察新节点错误率、延迟和连接分布；
4. **逐步减少旧地址权重或移除旧记录**，保留足够回滚窗口；
5. **等待 DNS 缓存与长连接共同收敛**，不要只等待一个 TTL；
6. **最后下线旧节点**，并恢复适合日常稳定性的 TTL。

若业务客户端只在进程启动时解析一次，或连接池长期不重建，降低 DNS TTL 也不会产生预期效果。上线前应使用真实客户端和真实连接池做切流演练。

## 八、常见故障怎样定位

### 1. 权威记录正确，但部分实例仍访问旧 IP

依次检查权威 TTL、递归缓存剩余 TTL、JVM 地址缓存、Sidecar/本地 DNS 缓存和连接池存量连接。不要通过重启全部实例掩盖缓存策略问题；先确定是哪一层没有按发布目标刷新。

### 2. 偶发 `UnknownHostException`

至少区分：名称确实不存在、所需记录类型不存在、递归服务器 SERVFAIL、策略 REFUSED、查询超时、上游不可达和应用线程池耗尽。只有前两者属于明确的负面答案，后面几类是解析失败或本地资源问题。

### 3. DNS 故障导致请求线程堆积

常见放大链路是：依赖域名无法解析 → 每个请求同步解析 → 线程长时间等待 → 重试再次解析 → 线程池和上游 DNS 同时过载。治理手段包括专用有界隔离、总超时、有限重试、同名请求合并、失败缓存和熔断；重试必须服从整体调用预算。

### 4. AAAA 可解析但 IPv6 路径不可用

不要用“禁用 IPv6”作为默认答案。应分别观测 A/AAAA 结果、地址选择、连接尝试和网络可达性。DNS 成功只说明获得了记录，不代表目标端口、路由、TLS 和应用协议都成功。

### 5. UDP 能查询，复杂答案却失败

现代 DNS 不应被理解为“永远只用 UDP 53”。响应可能因体积、截断或策略转用 TCP，DNSSEC 和扩展机制也会增加报文。防火墙只放行 UDP、丢弃分片或错误处理 EDNS 都可能形成间歇故障。具体传输能力应按递归服务和网络边界验证。

## 九、可观测性：把解析与连接分开看

建议至少记录以下指标，`host` 标签必须做白名单或归一化，避免用户输入造成高基数：

| 指标 | 用途 |
|---|---|
| DNS 查询次数、成功率、耗时分位数 | 判断解析链路是否变慢 |
| 结果分类：success/unknown/timeout/refused/servfail | 区分负面答案和解析失败 |
| 返回地址数量、地址族分布 | 发现 A/AAAA 与多地址异常 |
| 专用解析线程池活跃数、队列与拒绝数 | 判断本地隔离是否过载 |
| JVM 地址缓存配置快照 | 解释实例之间刷新差异 |
| TCP 建连、TLS、HTTP 首字节耗时 | 避免把解析后故障误判为 DNS |
| 旧/新地址实际连接占比 | 验证 DNS 切流是否真正收敛 |

日志不要直接记录任意客户域名、完整查询内容或内部拓扑。可观测性也要遵守隐私、租户隔离和访问控制边界。

## 十、常见追问与踩坑

### 1. TTL 设置得越短越好吗？

不是。短 TTL 会提高变更速度，也会增加缓存未命中、解析延迟和权威压力。合理值取决于切流频率、递归容量、客户端行为和故障恢复目标。高频变更更适合配合负载均衡、服务发现或代理层，而不是把 DNS 当作逐请求路由器。

### 2. 为什么修改记录后本机 `nslookup` 已更新，Java 仍是旧地址？

命令行工具和 JVM 可能走不同缓存路径。Java 的 `InetAddress` 有独立地址缓存，现存连接也不会因为 DNS 变化自动断开。应同时核对 JVM security properties 和客户端连接生命周期。

### 3. 多个 A/AAAA 地址会自动负载均衡吗？

DNS 只返回地址集合。客户端是否轮询、随机、固定取第一条、并行连接或长期复用单个地址，由客户端和网络栈决定。必须用目标运行时验证，不能把多记录直接当作均匀负载均衡承诺。

### 4. 可以在应用里再做一层长 TTL 缓存吗？

通常不应无条件增加。JVM、系统和递归解析器已经存在缓存，再叠加业务缓存会让失效边界更难解释。如果确有降低解析开销或容灾需求，必须定义缓存键、正负结果分类、最大陈旧时间、刷新并发控制和安全回退条件。

### 5. DNSSEC 解决了所有 DNS 故障吗？

DNSSEC主要提供来源认证和数据完整性验证，不保证权威服务器可达，也不替代应用层 TLS、超时、重试和容量治理。错误的签名链或时钟问题本身也可能导致校验失败，必须单独观测。

## 十一、选择建议与最佳实践

### 应用侧

1. 明确每个外部依赖域名的所有者、TTL、地址族和故障策略；
2. 为阻塞式解析设置专用有界隔离和整体超时，不在请求线程无限等待；
3. 保留全部返回地址，让成熟客户端处理连接尝试，不默认固定第一条；
4. 区分 NXDOMAIN、NODATA、SERVFAIL、REFUSED、超时和本地过载；
5. 让重试服从总预算，并通过请求合并、缓存或熔断避免 DNS 风暴；
6. 配置 JVM 地址缓存时使用 security properties，并核验真实生效值；
7. 对旧连接、连接池和 DNS 缓存一起设计切流收敛。

### DNS 与平台侧

1. 权威 Zone 至少使用冗余服务器，并监控可达性和序列更新；
2. 变更前提前降低 TTL，变更稳定后恢复日常值；
3. 为递归解析服务设置容量、失败缓存、请求合并和上游冗余；
4. 同时验证 UDP/TCP 与实际网络策略，不假设只有单一传输；
5. 对 DNSSEC、CNAME 链、委派和胶水记录做持续校验；
6. 保留受控诊断入口，但不要开放无访问控制的递归服务；
7. 用真实 JVM、容器、Sidecar 和客户端连接池做故障与切流演练。

## 总结

DNS 的核心链路可以概括为：应用把递归请求交给 Stub Resolver 和递归解析器；递归解析器优先查缓存，未命中时沿根、顶级域和权威服务器迭代查询；最终把答案、负面答案或解析失败返回应用。

真正的工程难点在协议之外的生命周期差异：RRset 有 TTL，负面答案和解析失败也会缓存，JVM 还有自己的地址缓存，而连接池可能继续使用旧 IP。把结果分类、缓存边界、超时隔离、连接生命周期、切流步骤和可观测性一起治理，DNS 才不会在故障时从“透明基础设施”变成难以解释的放大器。
