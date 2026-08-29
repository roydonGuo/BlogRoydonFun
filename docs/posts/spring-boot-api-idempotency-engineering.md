---
title: Spring Boot 接口幂等性工程实践：幂等键、状态机与结果重放
date: 2026-08-29
category: 后端开发
cover: /images/posts/spring-boot-api-idempotency-engineering-knowledge-map.webp
tags: [java, spring-boot, idempotency, mysql, distributed-systems]
excerpt: 接口幂等不是“先查再写”，而是用租户隔离的幂等键、请求指纹、数据库唯一约束和执行状态机，把重复请求原子收敛到同一次业务结果；跨服务副作用还要补上结果查询、租约恢复与有界重试。
---

# Spring Boot 接口幂等性工程实践：幂等键、状态机与结果重放

<img src="/images/posts/spring-boot-api-idempotency-engineering-knowledge-map.webp" alt="Spring Boot 接口幂等性工程实践：幂等键、状态机与结果重放知识串联图" style="border-radius: 10px;" />

接口幂等不是“先查再写”，而是用租户隔离的幂等键、请求指纹、数据库唯一约束和执行状态机，把重复请求原子收敛到同一次业务结果；跨服务副作用还要补上结果查询、租约恢复与有界重试。

## 一、先把目标说清：重复请求只能产生一次业务效果

网络超时只说明客户端没有收到响应，不代表服务端没有完成。用户双击、网关重试、客户端重连和消息重复投递，都可能让同一业务意图到达多次。幂等层必须保证：

1. 同一主体、同一操作、同一幂等键和相同请求内容，只执行一次，并重放第一次的确定结果；
2. 同一幂等键携带不同内容时拒绝执行，不能把两个业务意图误合并；
3. 并发重复请求由数据库原子裁决，不能依赖 JVM 锁或“先查询、后插入”；
4. 进程在任意断点崩溃后，系统能判断应重放结果、继续等待、查询下游还是人工介入。

[RFC 9110 第 9.2.2 节](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2)把 HTTP 方法的幂等定义为：多次相同请求对服务端的预期效果与执行一次相同。规范定义的安全方法、`PUT` 和 `DELETE` 具有幂等语义；`POST` 并不会因使用某个路径或返回相同状态码就自动幂等。

常见的 `Idempotency-Key` 仍应视为应用协议。IETF 对应文档截至 **2026-08-29** 的状态是[已过期且归档的 Internet-Draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)，不是已发布 RFC。因此团队要自己明确键的生成方、作用域、有效期、冲突响应和重放规则。

## 二、完整方案由五个要素组成

| 要素 | 作用 | 错误做法 |
|---|---|---|
| 幂等键 | 标识一次业务意图 | 每次重试重新生成 UUID |
| 作用域 | 隔离租户、用户和操作 | 全站只按一个短 Key 去重 |
| 请求指纹 | 防止同键不同参 | 只比较 URL，不比较有效载荷 |
| 原子占位 | 决定唯一执行者 | `SELECT` 不存在后再 `INSERT` |
| 状态与结果 | 支持等待、重放和恢复 | 只存“处理过=true” |

一个可用的逻辑唯一键通常是：

```text
tenantId + operation + idempotencyKey
```

不要把用户可伪造的租户 ID 直接从请求头拼入作用域；租户和用户身份应来自认证上下文。幂等键本身也不能替代鉴权，攻击者不能靠猜中 Key 读取别人的响应。

请求指纹只覆盖会影响业务效果的稳定字段。JSON 属性顺序、空白、Trace ID 和客户端时间戳不应造成不同指纹；商品、数量、收货地址等业务参数则必须参与。最稳妥的方式是先映射为明确的 Java 命令对象，再按固定字段顺序序列化并计算 SHA-256。

## 三、用数据库唯一约束做最终裁决

下面以 MySQL 8.4 + InnoDB 为例。MySQL 8.4 官方文档明确说明，违反主键或唯一键的数据变更会报错，InnoDB 会回滚该语句。唯一约束正是并发竞争时的最终裁决点，而不是应用层的一次提前查询。

```sql
CREATE TABLE api_idempotency_record (
    tenant_id       VARCHAR(64)  NOT NULL COMMENT '可信认证上下文中的租户',
    operation       VARCHAR(64)  NOT NULL COMMENT '稳定的业务操作名',
    idempotency_key VARCHAR(128) NOT NULL COMMENT '客户端重试时保持不变',
    request_hash    CHAR(64)     NOT NULL COMMENT '规范化命令的 SHA-256',
    status          VARCHAR(16)  NOT NULL COMMENT 'PROCESSING/SUCCEEDED/FAILED',
    http_status     SMALLINT     NULL COMMENT '可重放的 HTTP 状态码',
    response_body   JSON         NULL COMMENT '可重放的最小响应快照',
    resource_id     VARCHAR(64)  NULL COMMENT '订单号等最终业务标识',
    lease_until     DATETIME(3)  NULL COMMENT '跨服务执行租约',
    created_at      DATETIME(3)  NOT NULL,
    updated_at      DATETIME(3)  NOT NULL,
    expires_at      DATETIME(3)  NOT NULL COMMENT '去重记录保留截止时间',
    PRIMARY KEY (tenant_id, operation, idempotency_key),
    KEY idx_idempotency_expire (expires_at)
) ENGINE=InnoDB COMMENT='API 幂等执行记录';
```

`response_body` 不应保存令牌、完整银行卡号等敏感信息。更推荐保存稳定的 `resource_id`，重放时按当前权限重新查询资源；只有响应必须保持原样时才保存经过脱敏和大小限制的快照。

## 四、本地数据库副作用：一个事务内完成占位、业务和结果

先定义数据结构和依赖，再看控制流：

```java
public record CreateOrderCommand(
        String skuId,
        int quantity,
        String addressId
) {}

public record IdempotencyScope(
        String tenantId,
        String operation,
        String key
) {}

public enum ExecutionStatus {
    PROCESSING, SUCCEEDED, FAILED
}

public record StoredExecution(
        String requestHash,
        ExecutionStatus status,
        int httpStatus,
        String responseBody,
        String resourceId
) {}

public sealed interface IdempotentResult<T>
        permits IdempotentResult.Completed,
                IdempotentResult.InProgress,
                IdempotentResult.Conflict {

    record Completed<T>(T body, int httpStatus, boolean replayed)
            implements IdempotentResult<T> {}

    record InProgress<T>(java.time.Duration retryAfter)
            implements IdempotentResult<T> {}

    record Conflict<T>(String message)
            implements IdempotentResult<T> {}
}
```

持久层接口必须让“尝试插入”暴露唯一键冲突，不能悄悄改成覆盖写：

```java
public interface IdempotencyRepository {

    void insertProcessing(
            IdempotencyScope scope,
            String requestHash,
            java.time.Instant expiresAt
    );

    java.util.Optional<StoredExecution> find(IdempotencyScope scope);

    void markSucceeded(
            IdempotencyScope scope,
            int httpStatus,
            String responseBody,
            String resourceId
    );
}

public interface OrderRepository {
    String create(String tenantId, CreateOrderCommand command);
}

public interface RequestFingerprint {
    String sha256(CreateOrderCommand command);
}

public interface ResponseCodec {
    String encode(CreateOrderResponse response);
    CreateOrderResponse decode(String json);
}

public final class DuplicateIdempotencyKeyException extends RuntimeException {
    public DuplicateIdempotencyKeyException(Throwable cause) {
        super(cause);
    }
}
```

`IdempotencyRepository` 只把 `api_idempotency_record` 主键冲突翻译为 `DuplicateIdempotencyKeyException`；订单号等其他约束异常必须原样抛出，不能误判成幂等命中。

本地订单创建与幂等结果可以共享一个数据库事务。下面用 `TransactionTemplate` 把事务边界显式放在编排层，避免同类自调用绕过 Spring 事务代理：

```java
@Service
public class IdempotentOrderService {

    private final TransactionTemplate transactionTemplate;
    private final IdempotencyRepository idempotencyRepository;
    private final OrderRepository orderRepository;
    private final RequestFingerprint fingerprint;
    private final ResponseCodec responseCodec;

    public IdempotentOrderService(
            PlatformTransactionManager transactionManager,
            IdempotencyRepository idempotencyRepository,
            OrderRepository orderRepository,
            RequestFingerprint fingerprint,
            ResponseCodec responseCodec
    ) {
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.idempotencyRepository = idempotencyRepository;
        this.orderRepository = orderRepository;
        this.fingerprint = fingerprint;
        this.responseCodec = responseCodec;
    }

    public IdempotentResult<CreateOrderResponse> create(
            String tenantId,
            String idempotencyKey,
            CreateOrderCommand command
    ) {
        IdempotencyScope scope = new IdempotencyScope(
                tenantId, "CREATE_ORDER", idempotencyKey);
        String requestHash = fingerprint.sha256(command);

        try {
            return transactionTemplate.execute(status -> {
                // 唯一约束决定谁是唯一执行者；并发重复插入会失败。
                idempotencyRepository.insertProcessing(
                        scope,
                        requestHash,
                        java.time.Instant.now().plus(java.time.Duration.ofHours(24)));

                String orderId = orderRepository.create(tenantId, command);
                CreateOrderResponse response = new CreateOrderResponse(orderId, "CREATED");
                String responseJson = responseCodec.encode(response);

                // 与订单创建在同一事务提交，不留下“订单成功但结果未记录”的窗口。
                idempotencyRepository.markSucceeded(
                        scope, 201, responseJson, orderId);
                return new IdempotentResult.Completed<>(response, 201, false);
            });
        } catch (DuplicateIdempotencyKeyException duplicate) {
            // 冲突事务已经结束后再读取，不能在 rollback-only 事务里继续查询。
            StoredExecution stored = idempotencyRepository.find(scope)
                    .orElseThrow(() -> new IllegalStateException("幂等记录竞争后不可见", duplicate));
            return replayOrReject(stored, requestHash);
        }
    }

    private IdempotentResult<CreateOrderResponse> replayOrReject(
            StoredExecution stored,
            String requestHash
    ) {
        if (!stored.requestHash().equals(requestHash)) {
            return new IdempotentResult.Conflict<>("同一幂等键不能对应不同请求内容");
        }
        if (stored.status() == ExecutionStatus.SUCCEEDED) {
            CreateOrderResponse body = responseCodec.decode(stored.responseBody());
            return new IdempotentResult.Completed<>(body, stored.httpStatus(), true);
        }
        return new IdempotentResult.InProgress<>(java.time.Duration.ofSeconds(1));
    }
}

public record CreateOrderResponse(String orderId, String status) {}
```

Spring 官方文档说明，声明式 `@Transactional` 默认通过代理拦截，类内部本地调用不会经过代理。无论使用 `TransactionTemplate` 还是拆分为独立事务 Bean，都要让“插入幂等记录、写业务数据、保存成功结果”真正位于同一个本地事务。

## 五、Controller 只负责协议映射

```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final IdempotentOrderService service;

    public OrderController(IdempotentOrderService service) {
        this.service = service;
    }

    @PostMapping
    public ResponseEntity<?> create(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @AuthenticationPrincipal LoginUser user,
            @RequestBody @Valid CreateOrderCommand command
    ) {
        // tenantId 来自认证主体，不能信任客户端自行声明的租户头。
        IdempotentResult<CreateOrderResponse> result =
                service.create(user.tenantId(), idempotencyKey, command);

        if (result instanceof IdempotentResult.Completed<?> completed) {
            return ResponseEntity.status(completed.httpStatus())
                    .header("Idempotent-Replayed", Boolean.toString(completed.replayed()))
                    .body(completed.body());
        }
        if (result instanceof IdempotentResult.InProgress<?> inProgress) {
            return ResponseEntity.accepted()
                    .header("Retry-After", Long.toString(inProgress.retryAfter().toSeconds()))
                    .body(java.util.Map.of("code", "REQUEST_IN_PROGRESS"));
        }

        IdempotentResult.Conflict<?> conflict = (IdempotentResult.Conflict<?>) result;
        return ResponseEntity.status(409)
                .body(java.util.Map.of(
                        "code", "IDEMPOTENCY_KEY_REUSED",
                        "message", conflict.message()));
    }
}
```

这里选择 `202 Accepted` 表示相同请求仍在处理中，选择 `409 Conflict` 表示同键不同参。这是应用契约，不是 RFC 9110 强制的固定映射；客户端 SDK、OpenAPI 文档和服务端必须采用同一规则。

## 六、跨服务副作用：不要把远程调用塞进数据库事务

支付、退款、短信等远程副作用无法被本地 `@Transactional` 回滚。若在数据库事务中调用下游，会长时间占用连接和行锁；若下游成功后本地提交失败，仍会出现结果未知。

跨服务场景应把记录升级为可恢复状态机：

```text
首次请求
  → 原子创建 PROCESSING + lease_until
  → 提交本地事务
  → 使用同一个下游幂等键调用远程服务
  → 短事务写入 SUCCEEDED + resource_id + 响应快照

重复请求
  → request_hash 不同：409
  → SUCCEEDED：重放结果
  → PROCESSING 且租约未到期：202
  → PROCESSING 且租约已过期：先按下游幂等键查结果，再决定接管或告警
```

最危险的错误是：远程调用超时后换一个 Key 直接重试。超时意味着结果未知；恢复任务必须先用原 Key 查询下游。如果下游既不支持幂等键，也没有结果查询接口，就无法仅靠本地表承诺“外部副作用恰好一次”，只能通过业务唯一号、对账和人工补偿收敛。

`FAILED` 也要区分两类：参数非法、余额不足等确定性失败可以缓存并重放；连接超时、进程崩溃等不确定失败不能伪装成最终失败。后者应保留 `PROCESSING/UNKNOWN` 语义，进入查询和恢复流程。

## 七、不同方案分别解决什么

| 方案 | 适用场景 | 主要边界 |
|---|---|---|
| 数据库唯一约束 | 创建订单、领取权益、消费去重 | 只能约束同一数据库可见的事实 |
| 条件更新 / 状态机 | 支付回调、订单流转 | 必须定义合法前态与终态 |
| 幂等记录 + 结果重放 | 通用 POST、长任务提交 | 需要处理同键不同参、过期和响应存储 |
| Redis `SET NX` | 短时削峰、低风险重复抑制 | 锁过期不等于业务完成，不能单独承诺强幂等 |
| 分布式锁 | 限制并发进入临界区 | 锁释放后重复请求仍可能再次执行 |
| 消息去重表 | At-least-once 消费 | 去重记录必须与业务写入同事务 |

幂等不是所有请求都返回 `200`。权限拒绝仍是 `403`，参数错误仍是 `400`，同键不同参是协议冲突，首次成功可以是 `201`，重放时通常保持原业务状态和响应体。不要用统一成功码掩盖真实结果。

## 八、过期、安全与可观测性

有效期应覆盖客户端最大重试窗口、网关重试、离线任务恢复和人工补偿周期。到期清理用索引分批删除，避免一次删除大量历史记录造成锁与日志压力。Key 过期后再次出现是“新请求”还是“拒绝过期重放”，必须由业务契约决定；支付类操作通常还需要永久业务唯一号兜底。

至少记录以下指标：

- `idempotency_first_total`：首次执行次数；
- `idempotency_replay_total`：成功结果重放次数；
- `idempotency_conflict_total`：同键不同参冲突次数；
- `idempotency_in_progress_total`：并发重复命中次数；
- `idempotency_recovery_total`：租约超时后恢复次数；
- 按操作聚合的执行耗时、记录大小、过期清理延迟和未知状态数量。

日志中记录 Key 的哈希或截断值，不直接打印完整请求体和响应快照。告警重点不是“重复很多”，因为重试本来就会重复；真正异常的是冲突率升高、`PROCESSING` 长时间不收敛、恢复任务持续接管失败，以及同一主体生成大量高基数 Key。

## 九、上线检查清单

1. 幂等键是否由一次业务意图生成，并在所有重试中保持不变；
2. 唯一作用域是否包含可信租户、稳定操作名和 Key；
3. 请求指纹是否规范化，并覆盖所有影响副作用的字段；
4. 并发裁决是否依靠唯一约束或原子状态迁移；
5. 本地副作用是否与幂等成功结果位于同一事务；
6. 同键不同参、处理中、成功重放和确定性失败是否有明确协议；
7. 远程超时是否按“结果未知”处理，并支持同 Key 查询与恢复；
8. 记录是否有保留期、分批清理、敏感数据限制和容量预算；
9. 是否演练响应丢失、并发双击、进程崩溃、数据库提交失败和下游超时；
10. 是否能通过指标和审计记录回答“谁首次执行、谁命中重放、最终资源是什么”。

接口幂等的核心不是挡住第二个 HTTP 请求，而是建立一条可恢复的执行契约：稳定 Key 标识业务意图，请求指纹防止误合并，唯一约束选出唯一执行者，状态机记录真实进度，结果重放让客户端安全重试。只要链路跨出本地数据库，还必须把下游查询、租约恢复、对账和人工补偿纳入设计。
