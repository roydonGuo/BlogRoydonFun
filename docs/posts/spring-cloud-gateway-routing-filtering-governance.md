---
title: Spring Cloud Gateway 工程实践：路由、过滤器与流量治理
date: 2026-08-19
category: 后端开发
cover: /images/posts/spring-cloud-gateway-routing-filtering-governance-knowledge-map.webp
tags: [gateway, spring-cloud, webflux]
excerpt: 网关不是简单的反向代理，而是由路由断言、过滤器链和下游转发组成的流量控制面。本文以 Spring Cloud Gateway 5.0.2 为基线，讲清路由匹配、过滤器顺序、JWT 鉴权、限流、灰度、熔断与可观测性。
---

# Spring Cloud Gateway 工程实践：路由、过滤器与流量治理

<img src="/images/posts/spring-cloud-gateway-routing-filtering-governance-knowledge-map.webp" alt="Spring Cloud Gateway 工程实践：路由、过滤器与流量治理知识串联图" style="border-radius: 10px;" />

网关不是简单的反向代理，而是由路由断言、过滤器链和下游转发组成的流量控制面。本文以 Spring Cloud Gateway 5.0.2 为基线，讲清路由匹配、过滤器顺序、JWT 鉴权、限流、灰度、熔断与可观测性。

## 先说结论：网关只做入口治理，不承载业务真相

Spring Cloud Gateway 最适合放置所有请求都需要、又与具体业务无关的横切能力：路由、身份认证、粗粒度授权、限流、流量标记、协议头治理、超时、熔断和观测。订单能否退款、优惠券能否领取这类业务规则仍应留在领域服务中。

工程上先记住五点：

1. **Route = ID + URI + Predicates + Filters**：断言决定“是否命中”，过滤器决定“命中后做什么”；
2. **一次请求只形成一条有序过滤器链**：全局过滤器与路由过滤器合并排序，pre 阶段顺序执行，post 阶段反向返回；
3. **WebFlux 网关不能阻塞事件循环**：JDBC、`Thread.sleep`、同步 HTTP SDK 都不该直接出现在过滤器里；
4. **鉴权不等于业务授权**：网关验证令牌与通用 scope，服务仍要校验资源归属和业务状态；
5. **网关是共享故障域**：任何全局过滤器、动态路由或限流配置都必须可观测、可回滚、可灰度。

本文以 [Spring Cloud Gateway 5.0.2](https://docs.spring.io/spring-cloud-gateway/reference/) 的 **Server WebFlux** 形态为基线，事实核对日期为 2026-08-19。5.0.x 基于 Spring Framework 7、Spring Boot 4 与 Project Reactor；当前官方还维护 4.3.x、4.2.x 和 4.1.x 稳定线。升级时要按所选 Release Train 核对依赖和配置前缀，不要直接把 5.0 示例复制到旧项目。

## 一、请求到底怎样穿过网关

官方的处理模型可以压缩为六步：

```text
客户端请求
  → Gateway Handler Mapping 查找 Route
  → Predicates 判断是否匹配
  → GlobalFilter + GatewayFilter 合并并排序
  → 执行 pre 逻辑
  → Netty 向下游服务发起代理请求
  → 执行 post 逻辑并返回响应
```

关键组件如下：

| 组件 | 职责 | 常见用途 |
|---|---|---|
| `RouteDefinitionLocator` | 提供路由定义 | YAML、Java DSL、外部配置源 |
| Route Predicate | 判断当前请求是否命中路由 | Path、Host、Method、Header、Weight |
| `GatewayFilter` | 只作用于指定路由 | 改写路径、加头、限流、熔断 |
| `GlobalFilter` | 条件性作用于全部路由 | 请求 ID、统一日志、公共安全校验 |
| Routing Filter | 把最终 URI 转发到下游 | HTTP、WebSocket、`lb://` 服务实例 |

路由 URI 使用 `lb://order-service` 时，需要 Spring Cloud LoadBalancer 从服务发现结果中选择实例；没有可用实例时默认返回 503。Gateway 并不等于注册中心，二者是组合关系。

## 二、路由断言：把请求准确送到目标服务

内置断言按匹配依据可分为六类，理解分类比背名字更重要：

1. **路径与主机**：`Path`、`Host`；适合按 URL 前缀或域名拆分服务；
2. **HTTP 语义**：`Method`、`Header`、`Cookie`、`Query`；适合接口版本和调用方标记；
3. **时间窗口**：`After`、`Before`、`Between`；适合定时活动切换，但要统一时区；
4. **来源网络**：`RemoteAddr`、`XForwardedRemoteAddr`；必须先确定可信代理边界；
5. **流量分组**：`Weight`；适合按同组权重分流；
6. **组合逻辑**：同一路由的多个断言是 AND；需要 OR 时通常定义多条路由。

下面把商城 API、管理后台和灰度流量拆成三条路由：

```yaml
spring:
  cloud:
    gateway:
      server:
        webflux:
          routes:
            - id: order-api
              uri: lb://order-service
              predicates:
                - Path=/api/orders/**
                - Method=GET,POST,PUT
              filters:
                - StripPrefix=1 # 去掉 /api，再转发给订单服务

            - id: admin-api
              uri: lb://admin-service
              predicates:
                - Host=admin.example.com
                - Path=/api/admin/**
              filters:
                - StripPrefix=1

            - id: order-canary
              uri: lb://order-service-canary
              order: -10 # 比普通订单路由更早参与匹配
              predicates:
                - Path=/api/orders/**
                - Header=X-Canary, true
              filters:
                - StripPrefix=1
```

### 路由顺序的坑

路由不是“越具体就自动优先”。当多条路由都能匹配时，应显式设置 `order`，数值越小优先级越高。灰度路由若排在普通路由之后，请求会先被普通路由吃掉，灰度配置看起来正确却永远不生效。

不要信任公网客户端直接传入的 `X-Canary`、`X-User-Id`。这类内部头应由可信边缘层删除后重建，或由网关根据已验证身份生成，否则就是可伪造的路由开关。

## 三、过滤器体系：局部、默认与全局三层

过滤能力主要分为三层：

| 层级 | 作用范围 | 适合能力 |
|---|---|---|
| 路由 `GatewayFilter` | 单条 Route | 路径改写、特定服务熔断、单接口限流 |
| `default-filters` | 所有配置路由 | 公共响应头、去重 CORS 响应头 |
| `GlobalFilter` | 全局过滤链 | 请求 ID、日志、统一审计、内部头清洗 |

常用内置过滤器也可以按职责分类：

- **请求改写**：`AddRequestHeader`、`SetRequestHeader`、`RemoveRequestHeader`、`RewritePath`、`StripPrefix`、`RequestHeaderSize`、`RequestSize`；
- **响应改写**：`AddResponseHeader`、`SetResponseHeader`、`RemoveResponseHeader`、`DedupeResponseHeader`、`SetStatus`；
- **安全与会话**：`TokenRelay`、`SaveSession`、`SecureHeaders`；
- **韧性治理**：`RequestRateLimiter`、`CircuitBreaker`、`Retry`；
- **协议与缓存**：`LocalResponseCache`、`CacheRequestBody`、WebSocket 路由等。

### pre / post 顺序为什么容易写反

全局过滤器和路由过滤器会合并后按 `Ordered` 排序。优先级最高的过滤器最先执行 pre，却最后执行 post：

```text
Filter A pre（order=-100）
  Filter B pre（order=0）
    下游请求
  Filter B post
Filter A post
```

这像嵌套的 `try/finally`。计时器应在调用 `chain.filter(exchange)` 前记录开始时间，再用 `doFinally` 或 `then` 写响应阶段逻辑，不能只在 pre 阶段打印一条“请求完成”。

## 四、真实示例：请求 ID、内部头清洗与访问日志

下面的全局过滤器只做三件稳定且非阻塞的事：生成/校验请求 ID、删除客户端伪造的内部身份头、记录响应状态与耗时。

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.util.UUID;

@Component
public class RequestGovernanceFilter implements GlobalFilter, Ordered {

    private static final Logger log = LoggerFactory.getLogger(RequestGovernanceFilter.class);
    private static final String REQUEST_ID = "X-Request-Id";

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        long startNanos = System.nanoTime();
        String requestId = normalizeRequestId(
                exchange.getRequest().getHeaders().getFirst(REQUEST_ID));

        ServerHttpRequest request = exchange.getRequest().mutate()
                .headers(headers -> {
                    // 客户端不能决定内部身份，先删除再由认证链路重建
                    headers.remove("X-User-Id");
                    headers.remove("X-User-Roles");
                    headers.set(REQUEST_ID, requestId);
                })
                .build();

        exchange.getResponse().getHeaders().set(REQUEST_ID, requestId);

        return chain.filter(exchange.mutate().request(request).build())
                .doFinally(signalType -> {
                    long elapsedMs = (System.nanoTime() - startNanos) / 1_000_000;
                    // 生产环境应写结构化字段，并对路径、用户标识做脱敏和基数控制
                    log.info("gateway requestId={} method={} path={} status={} costMs={} signal={}",
                            requestId,
                            request.getMethod(),
                            request.getPath().value(),
                            exchange.getResponse().getStatusCode(),
                            elapsedMs,
                            signalType);
                });
    }

    private String normalizeRequestId(String candidate) {
        // 只接受受控格式，避免日志注入和超长请求头
        if (candidate != null && candidate.matches("[A-Za-z0-9_-]{8,64}")) {
            return candidate;
        }
        return UUID.randomUUID().toString();
    }

    @Override
    public int getOrder() {
        // 尽早清洗内部头，并覆盖整个后续链路的计时
        return -100;
    }
}
```

注意：`GlobalFilter` 的接口与用法在官方文档中仍标注可能随里程碑版本变化。跨大版本升级前，应重新核对过滤器 SPI，而不是把它当作永久不变的扩展点。

## 五、鉴权边界：网关验证身份，服务验证业务权限

Reactive Gateway 应使用 Spring Security 的响应式资源服务器能力验证 JWT：签名、`iss`、`exp`、`nbf` 等由 `ReactiveJwtDecoder` 处理，不要在过滤器里手写 Base64 解码后就信任 Claims。

```java
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.web.server.SecurityWebFilterChain;

@Configuration
public class GatewaySecurityConfig {

    @Bean
    SecurityWebFilterChain gatewaySecurity(ServerHttpSecurity http) {
        return http
                .csrf(ServerHttpSecurity.CsrfSpec::disable) // 纯 Bearer Token API 才适合关闭
                .authorizeExchange(exchanges -> exchanges
                        .pathMatchers("/actuator/health/**").permitAll()
                        .pathMatchers("/api/admin/**").hasAuthority("SCOPE_admin")
                        .anyExchange().authenticated())
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(jwt -> {}))
                .build();
    }
}
```

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          # Resource Server 会发现 JWK，并校验令牌签名与 issuer
          issuer-uri: https://id.example.com/issuer
```

权限应分两层：

- 网关：令牌合法、租户头格式、通用 scope、黑白名单；
- 下游服务：订单是否属于当前用户、是否处于可退款状态、金额是否越权。

即使网关已经认证，下游也不应把任意可达网络当成可信。至少用网络策略、mTLS 或服务端再次验签建立纵深防御。

## 六、限流、熔断、重试：三种机制不能混用

### 限流：在进入下游前拒绝过量请求

`RequestRateLimiter` 默认拒绝时返回 HTTP 429。Redis 实现采用令牌桶，需要 `spring-boot-starter-data-redis-reactive`：

```yaml
spring:
  cloud:
    gateway:
      server:
        webflux:
          routes:
            - id: order-submit
              uri: lb://order-service
              predicates:
                - Path=/api/orders
                - Method=POST
              filters:
                - name: RequestRateLimiter
                  args:
                    key-resolver: "#{@userKeyResolver}"
                    redis-rate-limiter.replenishRate: 5  # 每秒补充 5 个令牌
                    redis-rate-limiter.burstCapacity: 10 # 最多允许短时突发 10 个
                    redis-rate-limiter.requestedTokens: 1
```

限流 Key 必须来自已认证且稳定的主体。直接用客户端传入的用户参数会被绕过；只用 IP 又会误伤 NAT 后的大量用户。通常采用“租户 + 用户 + 路由”组合，并控制 Key 的基数。

### 熔断：下游持续失败时快速失败

`CircuitBreaker` 需要 Reactor Resilience4J starter。它保护的是网关和下游连接资源，不会修复业务失败。`fallbackUri` 当前只支持 `forward:`，降级结果必须明确标记，不能把“库存服务不可用”伪装成“库存充足”。

### 重试：只重试可安全重复的操作

GET 等幂等读取可以对连接失败、部分 5xx 做有界重试；POST 下单、支付、扣库存若没有业务幂等键，不应在网关盲目重试。重试会放大故障流量，应同时限制次数、状态码、方法和总超时预算。

| 机制 | 解决的问题 | 常见返回 | 最大风险 |
|---|---|---|---|
| 限流 | 流量超过容量 | 429 | Key 设计错误导致绕过或误伤 |
| 熔断 | 下游持续故障 | 503/504 或明确降级 | 隐藏真实失败、错误兜底 |
| 重试 | 瞬时网络或服务错误 | 最终结果 | 重复副作用、故障放大 |

## 七、灰度发布与流量染色

网关适合做入口灰度，但灰度标记必须可验证：

1. 用户白名单：基于已认证用户或租户；
2. 请求头：只能信任由内部发布平台签名或由网关自行生成的头；
3. 权重分流：使用 `Weight` 断言做统计意义上的比例；
4. 一致性分流：同一用户需要稳定落到同一版本时，应使用稳定哈希或服务网格能力，不能仅依赖随机权重；
5. 全链路染色：网关写入版本标签，下游日志、指标和 Trace 都携带它，才能比较新旧版本。

灰度发布至少观察成功率、P95/P99 延迟、429/5xx 比例、下游连接池和业务核心指标。只看网关 2xx 会漏掉“请求成功但业务结果错误”。

## 八、可观测性与 Actuator 安全

网关需要同时观察四类信号：

- **路由**：routeId、目标服务、命中量、未匹配请求；
- **流量**：请求率、并发、响应码、请求/响应大小；
- **性能**：端到端延迟、下游延迟、连接池等待、事件循环阻塞；
- **治理结果**：限流拒绝、熔断状态、重试次数、灰度版本。

加入 Actuator 后可查看路由数量和 Gateway 指标。`/actuator/gateway` 默认不开放；生产建议只读、仅管理网可达并单独鉴权：

```yaml
management:
  endpoint:
    gateway:
      access: read-only # 避免通过管理端动态新增、删除和刷新路由
  endpoints:
    web:
      exposure:
        include: health,prometheus,gateway
```

不要把完整 Query、Authorization、Cookie 或请求体写进日志。对 URL 模板化，用户 ID 做哈希或受控标签，避免敏感数据泄露和指标高基数。

## 九、常见追问与踩坑

### Gateway 和 Nginx 谁替代谁？

通常不替代。Nginx/云负载均衡擅长 TLS 终止、静态资源、四/七层入口和抗连接洪峰；Gateway 更贴近 Java 微服务的服务发现、身份、路由与应用级治理。常见链路是 CDN/WAF → LB/Nginx → Gateway → 微服务。

### 为什么过滤器里不能直接查数据库？

Server WebFlux 基于事件循环。同步 JDBC 会阻塞少量 Netty 线程，一次慢查询就可能拖住大量请求。更好的做法是把授权信息放进已验证令牌、响应式缓存，或调用专门的响应式授权服务并设置严格超时。

### 修改响应体为什么麻烦？

响应体是流式数据，可能已提交、压缩或很大。只有确实需要统一协议转换时才用 `ModifyResponseBody`，并限制媒体类型和大小。错误包装优先由下游服务完成，网关只处理自身产生的 401、403、429、502、503、504。

### 动态路由更新后为什么没生效？

先区分配置源是否真的支持动态刷新，再检查路由缓存与刷新事件。不要直接在生产开放可写 Actuator；路由变更应走带校验、审批、版本和回滚的发布流程。

### 为什么下游拿到的客户端 IP 不对？

经过多级代理后，Remote Address 常是上一跳地址。只有可信代理写入的 Forwarded/X-Forwarded-* 才能采用，并要限制可信代理网段和跳数，否则客户端可伪造来源 IP 绕过限制。

### Gateway 能保证接口幂等吗？

不能。它可以传递或生成请求 ID、限制重试，但业务幂等必须由下游用业务键、唯一约束、状态机或幂等记录实现。请求 ID 只是关联线索，不天然等于幂等键。

## 十、选择建议与最佳实践

1. **先画清信任边界**：哪些头来自公网、哪些由网关重建、哪些能被下游信任；
2. **路由配置显式化**：每条路由有稳定 ID、明确 order、所有者和回滚版本；
3. **优先内置过滤器**：自定义代码越少，共享故障面越小；
4. **全链路非阻塞**：过滤器不执行 JDBC、文件 IO、同步远程调用和长计算；
5. **超时优先于重试**：先定义总预算，再决定哪些幂等失败允许重试；
6. **限流 Key 来自可信身份**：拒绝为空时的行为也要明确；
7. **鉴权分层**：网关做通用认证，服务做资源级授权；
8. **管理面隔离**：Actuator 默认只读，仅管理网络访问，任何写操作都走审计；
9. **变更先灰度**：路由、过滤器和安全策略都要小流量验证，并关联业务指标；
10. **为网关预留失败方案**：多实例部署、跨可用区、容量压测、快速回滚，避免入口成为单点。

## 总结

Spring Cloud Gateway 的核心不是“把 URL 转发到另一个 URL”，而是建立一条可验证的流量决策链：**断言选路、过滤器治理、Netty 转发、post 阶段收尾、指标审计闭环**。

真正稳定的网关会主动克制：只承载跨服务的入口规则，不侵入业务真相；只信任经过验证的身份与内部标记；限流、熔断、重试各守边界；任何动态配置都能观测、灰度和回滚。把这些边界守住，Gateway 才是微服务的流量控制面，而不是新的业务单体。
