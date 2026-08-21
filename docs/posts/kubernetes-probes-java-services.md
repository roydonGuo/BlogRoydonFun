---
title: Kubernetes 探针工程实践：启动、存活、就绪与 Java 服务治理
date: 2026-08-07
category: 后端开发
cover: /covers/backend.svg
tags: [kubernetes, java, spring-boot, observability, devops]
excerpt: 从 kubelet 的三类探针状态机出发，厘清启动保护、故障重启与流量摘除边界，并用 Spring Boot Actuator 落地可观测、可演练的健康检查。
---

# Kubernetes 探针工程实践：启动、存活、就绪与 Java 服务治理

<img src="/images/posts/kubernetes-probes-java-services-knowledge-map.webp" alt="Kubernetes 探针工程实践：启动、存活、就绪与 Java 服务治理知识串联图" style="border-radius: 10px;" />

从 kubelet 的三类探针状态机出发，厘清启动保护、故障重启与流量摘除边界，并用 Spring Boot Actuator 落地可观测、可演练的健康检查。

Kubernetes 中最危险的健康检查配置，往往不是“没有探针”，而是三个探针都请求同一个 `/health`，并把数据库、Redis、MQ 和所有下游一起纳入判断。数据库短暂抖动时，所有 Pod 的存活检查同时失败，kubelet 批量重启容器，剩余实例承受更多流量，最终把一次依赖故障放大成重启风暴。

探针不是普通监控告警。它会直接驱动容器重启或 Service 流量路由，因此每个失败条件都必须回答一个问题：**重启本容器能解决吗，还是只需要暂时停止接收流量？**

> 本文以 **Kubernetes 当前官方文档（页面更新于 2026-04-17）与 Spring Boot 4.1.0** 为事实依据，核对时间为 **2026-08-07**。gRPC 探针从 Kubernetes v1.27 起稳定，探针级 `terminationGracePeriodSeconds` 从 v1.28 起稳定；集群版本较旧或由云平台托管时，应以目标集群 API 与发行说明为准。

## 一、先理解 kubelet 的三种处置动作

探针由节点上的 kubelet 周期执行，诊断对象是 Pod 中的具体容器。三类探针使用相似的检测方式和时间参数，但失败后的动作完全不同。

| 探针 | 核心问题 | 执行阶段 | 失败后的直接动作 | 适合检查什么 |
|---|---|---|---|---|
| `startupProbe` | 应用是否已经完成启动 | 仅启动阶段，成功一次后退出 | 达到失败阈值后重启容器 | 慢启动、首次缓存加载、历史数据恢复 |
| `livenessProbe` | 进程是否陷入无法自愈的状态 | 启动保护结束后持续执行 | 达到失败阈值后重启容器 | 死锁、事件循环永久卡死、核心线程不可恢复 |
| `readinessProbe` | 当前实例是否应该接收新流量 | 容器整个生命周期持续执行 | 将 Pod 标记为未就绪并移出 Service 常规流量端点，不重启容器 | 过载、短暂初始化、局部资源不可用、主动摘流 |

如果配置了 `startupProbe`，kubelet 在它成功前不会执行 liveness 和 readiness。它相当于一个启动阶段的保护门：允许应用拥有较长的冷启动窗口，同时保留运行期较敏感的存活检查。

三者可以简化为一条状态流：

```text
容器启动
  ↓
startupProbe：启动窗口内持续失败可以等待，超过阈值才重启
  ↓ 首次成功后永久退出
livenessProbe：判断是否需要重启恢复
  ├─ 失败达到阈值 → 终止并按 restartPolicy 重启容器
  └─ 成功
readinessProbe：判断是否接收新流量
  ├─ 失败 → Ready=false，停止常规 Service 流量
  └─ 恢复成功 → Ready=true，重新加入流量
```

需要特别注意：liveness 和 readiness 彼此不等待。没有 `startupProbe` 时，不能假设 readiness 未成功就不会执行 liveness；慢启动服务应显式配置启动探针，而不是把 liveness 的失败阈值无限放大。

## 二、四种检测方式如何选择

三类探针都可以使用相同的检测机制。选择机制时，应检查它能否穿过真实服务栈，并控制检查本身的资源成本。

| 机制 | kubelet 做什么 | 优点 | 局限与适用边界 |
|---|---|---|---|
| `httpGet` | 从节点向 Pod IP 的指定端口和路径发 HTTP 请求 | 能验证监听端口、HTTP 解析和应用状态，最适合 Web 服务 | 端点必须轻量；200 至 399 才算成功；不要返回大响应体 |
| `tcpSocket` | 从节点尝试连接 Pod IP 的端口 | 配置简单，适合没有 HTTP 健康端点的 TCP 服务 | 只能证明端口能建立连接，不能证明业务线程和依赖可用 |
| `exec` | 在容器内执行命令，根据退出码判断 | 可检查进程内文件、Unix Socket 或遗留程序 | 每次执行都会创建进程；脚本泄漏、超时或依赖 shell 都会反噬容器 |
| `grpc` | 调用标准 gRPC Health Checking Protocol | 语义明确，无需额外 HTTP 服务 | Kubernetes v1.27+ 稳定；端口不能用名称，不支持认证参数，所有协议错误都算失败 |

HTTP 与 TCP 探针可引用命名端口，gRPC 探针必须填写数值端口。TCP 检测发生在节点网络侧，`host` 不能填写只有 Pod 内才能解析的 Service 名称。若主进程只监听 `127.0.0.1`，节点发往 Pod IP 的网络探针也会失败。

对典型 Spring Boot HTTP 服务，优先选择 `httpGet`，并让探针走主业务端口。若 Actuator 单独使用管理端口，管理连接池正常并不代表业务端口还能接收请求，容易出现“探针全绿、用户请求全挂”的假健康。

## 三、时间参数是一套容错预算

所有探针都围绕以下参数工作：

- `initialDelaySeconds`：容器启动后首次探测前的延迟，默认 0；配置 startup 后，liveness/readiness 的延迟从 startup 成功后开始计算；
- `periodSeconds`：常规探测间隔，默认 10 秒，最小 1 秒；未就绪时 readiness 可能比配置间隔更频繁地执行，以便更快恢复；
- `timeoutSeconds`：单次探测超时，默认 1 秒，最小 1 秒；
- `failureThreshold`：连续失败多少次才判定整体失败，默认 3；
- `successThreshold`：失败后需要连续成功多少次才恢复，默认 1；liveness 与 startup 必须为 1；
- `terminationGracePeriodSeconds`：startup 或 liveness 触发终止后允许容器优雅退出的时间；readiness 不支持探针级配置。

可以用两个近似公式理解预算：

```text
启动最大保护窗口 ≈ initialDelaySeconds
                 + failureThreshold × periodSeconds

运行期故障发现时间 ≈ failureThreshold × periodSeconds
                  + 最多一次 timeoutSeconds 的边界误差
```

公式适合估算，不应当作精确调度承诺。节点繁忙、探针执行耗时、连续成功/失败状态和 readiness 加速探测都会影响实际时间。

参数应来自启动耗时和故障恢复目标，而不是复制网上的固定值。例如某 Java 服务冷启动 P99 为 55 秒，极端情况下为 80 秒，可以给 startup 约 90 至 120 秒保护窗口；运行期 liveness 则保持更短的检测窗口。这样既不会让正常冷启动被误杀，也不会让真正死锁长时间占位。

## 四、Spring Boot Actuator 的正确边界

Spring Boot 4.1.0 会通过 `ApplicationAvailability` 管理存活与就绪状态，并把它们暴露为两个健康组：

```text
/actuator/health/liveness
/actuator/health/readiness
```

二者的默认语义不是“检查所有 HealthIndicator”。Spring Boot 官方文档明确说明：liveness 不应依赖数据库、外部 API 或缓存等外部系统；readiness 默认也不自动加入其他健康检查，是否加入应由应用根据降级能力决定。

如果管理端口与业务端口分离，可以把轻量探针附加到主端口：

```yaml
# application.yml，适用于 Spring Boot 4.1.0 当前配置契约
management:
  endpoint:
    health:
      probes:
        # 在主业务端口额外暴露 /livez 与 /readyz，避免只验证独立管理端口
        add-additional-paths: true
      group:
        readiness:
          # 仅加入“本实例独有且确实阻止服务”的检查
          include: readinessState,localWarmup
```

自定义 readiness 指标应快速、无副作用，并设置严格的内部超时。下面示例只判断本实例的本地预热状态，不在每次探针请求中查询数据库：

```java
import java.util.concurrent.atomic.AtomicBoolean;

import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

@Component("localWarmup")
public final class LocalWarmupHealthIndicator implements HealthIndicator {

    private final AtomicBoolean warmedUp = new AtomicBoolean(false);

    public void markReady() {
        // 预热任务完成后只切换内存状态，探针调用不重复执行昂贵任务
        warmedUp.set(true);
    }

    @Override
    public Health health() {
        if (warmedUp.get()) {
            return Health.up().build();
        }
        // OUT_OF_SERVICE 默认映射为 HTTP 503，使 readiness 暂时摘流
        return Health.outOfService()
                .withDetail("phase", "warming-up")
                .build();
    }
}
```

对共享数据库要做业务判断：如果所有实例都依赖同一个数据库且没有降级能力，把数据库加入 readiness 会在数据库抖动时同时摘掉全部 Pod；不加入则请求仍会进入应用并失败。更稳妥的办法通常是保留实例就绪，通过客户端超时、熔断、缓存降级和入口限流处理依赖故障，并把数据库状态交给监控告警，而不是让探针替代服务治理。

## 五、一份可落地的 Deployment 探针配置

下面示例让 startup 与 liveness 使用同一个“进程能否工作”端点，让 readiness 使用流量接入端点。所有数值仅演示配置关系，生产环境必须按真实启动分布和恢复目标调整。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
    spec:
      # 包含 preStop 执行和应用处理在途请求的总时间预算
      terminationGracePeriodSeconds: 45
      containers:
        - name: order-service
          image: example/order-service:2026.08.07
          ports:
            - name: http
              containerPort: 8080

          startupProbe:
            httpGet:
              path: /livez
              port: http
            # 最多提供 120 秒启动保护窗口：40 × 3 秒
            periodSeconds: 3
            timeoutSeconds: 1
            failureThreshold: 40

          livenessProbe:
            httpGet:
              path: /livez
              port: http
            # 只判断重启能够修复的进程内故障
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3

          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            # readiness 可以连续成功两次后再恢复流量，减少状态抖动
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 2
            successThreshold: 2

          lifecycle:
            preStop:
              exec:
                command:
                  - /bin/sh
                  - -c
                  # 这里只演示给端点传播留出缓冲；更可靠的方案是应用主动切换 readiness
                  - sleep 5
```

这里有四个关键点：

1. startup 保护最慢启动，成功后才让另外两个探针接管；
2. liveness 只验证进程内不可恢复故障，不检查共享依赖；
3. readiness 允许暂时摘流并自动恢复，不触发重启；
4. 停止预算覆盖 `preStop` 与应用优雅关闭，不能只给 sleep 留时间。

在 Java 镜像中使用 `exec` 类型的 `preStop` 前，还要确认镜像确实包含 `/bin/sh`。distroless 镜像没有 shell 时应使用 HTTP 生命周期钩子、应用信号处理或其他无需 shell 的方式，不能照搬示例。

## 六、探针与滚动发布、优雅停机的关系

readiness 解决的是运行期流量资格，不等于完整的下线协议。Pod 被删除时，控制面会把终止中的 EndpointSlice 端点标记为 `ready=false`；与此同时，kubelet 在节点侧开始执行 `preStop` 并发送 TERM。端点状态向各层负载均衡传播存在时间差，应用仍需处理已经建立的连接和少量迟到请求。

一个稳妥的 Java 服务下线顺序是：

```text
收到终止信号
  → 应用切换为 REFUSING_TRAFFIC
  → EndpointSlice / Ingress / LB 逐步停止新流量
  → 主服务拒绝新请求并处理在途请求
  → 关闭消费者、线程池和连接池
  → 在 terminationGracePeriodSeconds 内退出
```

Kubernetes 默认 Pod 终止宽限期是 30 秒。`preStop` 消耗的时间包含在这段总预算内；如果钩子本身就 sleep 30 秒，应用几乎没有时间完成优雅关闭。探针失败触发的容器终止可以为 startup/liveness 单独设置宽限期，但 readiness 不支持该字段。

Spring Boot 在启动和停止阶段会更新 `ApplicationAvailability`。启用优雅关闭后，应用进入 `REFUSING_TRAFFIC` 并处理在途请求；仍需结合 Service、Ingress、Sidecar 和云负载均衡的实际传播速度做故障演练，不能只凭进程日志判断已完成摘流。

## 七、常见误区与故障放大路径

### 误区 1：三个探针共用一个聚合健康接口

startup、liveness、readiness 的动作不同，共用一个包含所有依赖的接口会让“暂时不能服务”错误升级为“必须重启”。至少要分开存活与就绪语义，慢启动再增加 startup。

### 误区 2：liveness 检查数据库和 Redis

共享依赖故障不会因为重启某个 Pod 而恢复。所有实例同时失败时，滚动重启会制造连接风暴、缓存冷启动和更高负载。liveness 只应包含重启本进程可修复的状态。

### 误区 3：TCP 端口可连就代表服务健康

Acceptor 仍能接受连接时，业务线程池可能已经卡死。TCP 探针适合基础端口检查；需要感知应用状态时，应使用轻量 HTTP 或标准 gRPC 健康协议。

### 误区 4：探测越频繁，恢复越快

一秒一次的探针会在节点和应用过载时增加请求、日志和线程竞争。故障检测速度应与误判成本、重启耗时和副本数量平衡，不能只追求最短时间。

### 误区 5：探针接口调用真实业务链路越完整越好

健康端点不是端到端巡检。它必须低成本、无副作用、响应体小、超时严格。登录、下单、写数据库等完整链路应由独立合成监控执行，不能让 kubelet 周期制造业务数据。

### 误区 6：Pod 变为 Unready 后立刻没有任何请求

EndpointSlice、kube-proxy、Ingress、Sidecar 和外部负载均衡的状态传播不是同一个原子操作，已有 Keep-Alive 连接也可能继续发送请求。应用必须能够在下线窗口内安全拒绝或完成请求。

## 八、用事件、指标和演练验证配置

探针上线后至少观察四类信号：

```bash
# 查看最近的探针失败、容器终止原因与重启事件
kubectl describe pod <pod-name>

# 对比 READY、RESTARTS 与 Pod 生命周期
kubectl get pod <pod-name> -o wide

# 检查 Service 当前选中的 EndpointSlice 及其 ready/serving/terminating 条件
kubectl get endpointslice -l kubernetes.io/service-name=order-service -o yaml

# 读取上一次容器实例日志，定位 liveness 重启前发生了什么
kubectl logs <pod-name> -c order-service --previous
```

监控中应建立这些指标的时间关联：探针成功率与延迟、Pod Ready 状态变化、容器重启次数、退出原因、启动耗时分位数、请求错误率、在途请求、线程池/连接池饱和度，以及依赖故障率。

发布前做三类演练比只看 YAML 更可靠：

1. **慢启动演练**：人为延长预热，确认 startup 保护生效且未提前执行 liveness；
2. **局部过载演练**：让实例进入不可接流量状态，确认 readiness 摘流但容器不重启，并能自动恢复；
3. **不可恢复故障演练**：模拟核心线程永久卡死，确认 liveness 在预算内重启，同时其他副本没有被连带压垮。

如果出现重启循环，应先临时查看 Pod Events、`lastState.terminated` 和上一实例日志，再调整失败条件。直接提高阈值只能延迟问题，直接删除 liveness 则会失去自愈能力；关键是确认“失败状态是否真的能被重启修复”。

## 九、最佳实践清单

- 为三类探针分别写出失败语义和预期处置，不按接口复用方便程度设计；
- 慢启动使用 startup 保护，避免把运行期 liveness 调得迟钝；
- liveness 只检查进程内不可恢复状态，不绑定共享数据库、缓存和远程 API；
- readiness 只纳入会让本实例无法安全服务且无法降级的条件；
- Web 服务优先让探针经过主业务端口，避免独立管理端口制造假健康；
- 端点保持轻量、无副作用、无敏感详情，并限制日志量；
- 用启动耗时 P99、故障恢复目标和误判成本计算参数，不复制固定数值；
- 把 termination grace、`preStop`、应用优雅关闭和负载均衡传播作为一个总预算；
- 同时监控 Ready 变化、重启、错误率、饱和度与依赖状态，避免只看探针绿灯；
- 在压测或预发布环境演练慢启动、过载、死锁和滚动下线。

## 十、总结

Kubernetes 的 startup、liveness 与 readiness 不是同一个健康分数的三个别名，而是三套不同的状态机和处置动作：startup 保护启动窗口，liveness 决定是否重启容器，readiness 决定是否接收新流量。HTTP、TCP、exec 与 gRPC 只是执行诊断的方式，不能替代业务语义设计。

Java 服务落地时，可以使用 Spring Boot Actuator 的 liveness/readiness 健康组，但要保持边界清晰：存活检查不绑定共享依赖，就绪检查根据实例降级能力取舍，探针尽量走主业务端口。最后把时间阈值、滚动发布、EndpointSlice 传播、优雅关闭和可观测性放在同一条链路中验证。只有当每个失败都能解释“为什么重启”或“为什么摘流”，探针才是可靠的自愈机制，而不是故障放大器。

## 参考资料

- [Kubernetes：Liveness、Readiness 与 Startup Probes 概念](https://kubernetes.io/docs/concepts/workloads/pods/probes/)
- [Kubernetes：配置 Liveness、Readiness 与 Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Kubernetes：Pod 生命周期与终止流程](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [Kubernetes：Pod 终止与 EndpointSlice 流量摘除](https://kubernetes.io/docs/tutorials/services/pods-and-endpoint-termination-flow/)
- [Spring Boot 4.1.0：Actuator Kubernetes Probes](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html#actuator.endpoints.kubernetes-probes)
