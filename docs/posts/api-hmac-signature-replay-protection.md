---
title: API 请求签名与防重放：HMAC、规范化与 Nonce 状态机
date: 2026-08-05
category: 后端开发
cover: /covers/backend.svg
tags: [api-security, hmac, replay-protection, java, redis]
excerpt: 从签名原文规范化、正文摘要和 HMAC-SHA256 出发，设计带时间窗、Nonce 原子去重与密钥轮换能力的 API 防重放链路。
---

# API 请求签名与防重放：HMAC、规范化与 Nonce 状态机

<img src="/images/posts/api-hmac-signature-replay-protection-knowledge-map.webp" alt="API 请求签名与防重放：HMAC、规范化与 Nonce 状态机知识串联图" style="border-radius: 10px;" />

从签名原文规范化、正文摘要和 HMAC-SHA256 出发，设计带时间窗、Nonce 原子去重与密钥轮换能力的 API 防重放链路。

开放平台、支付回调、IoT 设备上报和服务间调用经常需要回答两个问题：请求是否来自持有合法密钥的一方，以及请求在传输途中是否被修改。给请求加一个 HMAC 签名可以回答这两个问题，却不能自动阻止攻击者把捕获到的合法请求原样重放。

真正可用的方案是一条完整验证链：先固定待签名内容，再验证正文摘要与 HMAC，随后用时间窗限制凭据寿命，用 Nonce 状态拒绝窗口内的重复请求，最后才进入业务逻辑。任何一层定义含糊，都可能出现“客户端算得出、服务端验不过”或“签名正确但资金操作执行两次”。

> 本文示例采用 **Java 8 可用的 JCA API** 与自定义 `v1` 内部协议，事实核对时间为 **2026-08-05**。它不是 RFC 9421 的兼容实现；跨组织或通用基础设施应优先评估成熟的 [RFC 9421 HTTP Message Signatures](https://www.rfc-editor.org/rfc/rfc9421.html) 实现，不要只复制本文字段名便宣称符合该标准。

## 一、先明确安全目标和非目标

请求签名通常承担四项职责。

| 目标 | 依靠什么实现 | 仍然存在的边界 |
|---|---|---|
| 身份认证 | `keyId` 找到共享密钥，HMAC 证明调用方持有密钥 | 共享密钥泄露后攻击者也能签名 |
| 完整性 | 方法、目标、关键头、正文摘要共同进入签名原文 | 未纳入签名的字段仍可被修改 |
| 新鲜度 | 服务端检查客户端时间戳与允许偏差 | 只能缩短重放窗口，不能识别窗口内重复 |
| 防重放 | `(keyId, nonce)` 在窗口内只能成功占用一次 | 需要所有验签节点共享一致的去重状态 |

它不替代 TLS。HMAC 不会隐藏 URL、请求头或正文，HTTPS 仍负责机密性、服务端身份和传输层防篡改。它也不等于业务幂等：Nonce 的目标是拒绝同一个签名请求再次出现，而幂等键允许客户端在超时后安全重试同一个业务操作，两者的接受策略正好不同。

还要先定义威胁模型。本文主要防御链路日志、代理或客户端环境中泄露的合法请求被再次发送，以及请求方法、资源目标和正文被篡改。若攻击者已经取得调用方密钥，时间戳和 Nonce 都无法阻止其生成全新的合法请求，此时必须依赖密钥吊销、权限最小化、风控和审计。

## 二、协议至少需要哪些组成

一个便于轮换和排障的内部协议可以使用以下字段：

```http
POST /openapi/orders?tenantId=42&currency=CNY HTTP/1.1
Host: api.example.com
Content-Type: application/json
X-Key-Id: partner-a-v3
X-Timestamp: 1785888000
X-Nonce: 71f456ef-4c8a-4e62-bd16-2b51d9ec6b73
X-Content-SHA256: qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+V7WREsBP6k=
X-Signature: JfYV...Base64...

{"orderNo":"O202608050001","amount":19900}
```

| 字段 | 含义 | 校验要求 |
|---|---|---|
| `X-Key-Id` | 密钥版本标识，不是秘密 | 必须绑定调用方、算法、状态和权限 |
| `X-Timestamp` | UTC Unix 秒 | 必须处于服务端允许的时间窗口内 |
| `X-Nonce` | 本次签名的高熵唯一值 | 格式、长度受限，验签成功后原子占用 |
| `X-Content-SHA256` | 实际消息正文的 SHA-256 | 服务端从收到的原始字节重新计算 |
| `X-Signature` | 对规范化原文计算的 HMAC-SHA256 | Base64 解码后使用常量时间比较 |

`keyId` 不能直接充当访问控制结果。服务端应先通过它找到密钥记录，验签成功后再把记录中的主体、租户和权限放入安全上下文；不能相信客户端额外传入的 `tenantId` 就是其所属租户。

## 三、规范化才是签名协议的核心

HMAC 的计算很直接，真正困难的是让签名方与验签方对同一个请求生成完全相同的字节。JSON 空格、查询参数顺序、重复参数、路径编码、头名称大小写和换行符差异，都会得到不同结果。

本文的 `v1` 协议把签名原文固定为 UTF-8、LF 换行且末尾不追加换行：

```text
v1
POST
/openapi/orders
currency=CNY&tenantId=42
content-type:application/json
x-key-id:partner-a-v3
x-timestamp:1785888000
x-nonce:71f456ef-4c8a-4e62-bd16-2b51d9ec6b73
sha256:qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+V7WREsBP6k=
```

每一行都要写进协议文档，而不是依赖某个 SDK 的“默认行为”：

1. 方法转换为大写，签入服务端实际执行的方法；
2. 路径使用双方约定的规范化 URI Path，不能一端取代理改写前路径、另一端取改写后路径；
3. 查询参数按名称、再按值排序，保留重复参数，按 UTF-8 与 RFC 3986 未保留字符规则编码，空格写成 `%20` 而不是 `+`；
4. 只签协议明确列出的头，头名小写，值执行约定的空白处理；
5. 正文摘要基于收到或发送的**原始字节**，不能把 JSON 反序列化后重新序列化；
6. 所有字段都用固定顺序，协议版本也进入原文，便于未来迁移。

不要使用简单的字符串拼接而没有字段边界，例如 `method + path + timestamp` 可能产生歧义。固定行序、字段名前缀和严格的换行约定，可以让失败请求输出逐行诊断信息，同时避免不同字段组合映射到相同原文。

RFC 9421 解决的也不只是“选择一种签名算法”。它定义了被覆盖 HTTP 组件、签名参数、`Signature-Input`、`Signature` 和严格的签名基串构造规则，并允许 `created`、`expires`、`nonce`、`keyid` 等元数据。自定义协议的维护成本主要就来自重新定义这些边界。

## 四、正文摘要必须绑定实际传输字节

正文摘要先用普通 SHA-256 计算，再作为一行进入 HMAC 原文：

```text
bodyDigest = Base64(SHA-256(rawBodyBytes))
signature  = Base64(HMAC-SHA256(secret, canonicalRequest))
```

摘要不是签名，任何人都能修改正文后重算 SHA-256。只有当摘要被 HMAC 覆盖后，它才成为不可替换的正文承诺。2024 年发布的 [RFC 9530](https://www.rfc-editor.org/rfc/rfc9530.html) 定义了标准 `Content-Digest` 字段，并明确摘要针对实际 HTTP 消息内容；若选择标准字段，应遵循其 Structured Fields 编码，不要把本文自定义的 Base64 值直接冒充标准字段值。

网关和应用还应在哈希前限制请求体大小，避免攻击者用超大正文消耗 CPU、内存和临时磁盘。Spring MVC 中如果在 Filter 里读取正文，必须使用可重复读取的请求包装，并让后续 JSON 解析消费同一份已缓存字节；只使用 `ContentCachingRequestWrapper` 包装后立刻在调用链前取缓存，往往会得到空内容，因为该包装通常在下游读取时才填充缓存。

## 五、Java 8 计算摘要和 HMAC

JCA 已提供 `MessageDigest` 与 `Mac`，不需要手写 HMAC 内部填充逻辑。共享密钥应是随机二进制数据，以 Base64 存储和传输到密钥管理系统，而不是把可读密码直接当密钥。

```java
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Base64;

public final class ApiSignatureSupport {

    private static final String HMAC_ALGORITHM = "HmacSHA256";

    private ApiSignatureSupport() {
    }

    public static String sha256Base64(byte[] body) {
        try {
            // 摘要基于原始请求体字节，不能对反序列化后的对象重新编码
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(body);
            return Base64.getEncoder().encodeToString(digest);
        } catch (GeneralSecurityException ex) {
            throw new IllegalStateException("当前 JRE 不支持 SHA-256", ex);
        }
    }

    public static String hmacBase64(String secretBase64, String canonicalRequest) {
        try {
            byte[] secret = Base64.getDecoder().decode(secretBase64);
            Mac mac = Mac.getInstance(HMAC_ALGORITHM);
            mac.init(new SecretKeySpec(secret, HMAC_ALGORITHM));

            // 协议固定使用 UTF-8，禁止依赖操作系统默认字符集
            byte[] signature = mac.doFinal(
                    canonicalRequest.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(signature);
        } catch (GeneralSecurityException | IllegalArgumentException ex) {
            throw new IllegalStateException("HMAC-SHA256 计算失败", ex);
        }
    }

    public static boolean constantTimeBase64Equals(String expected, String actual) {
        try {
            // 比较解码后的字节，避免使用 String.equals 处理秘密相关值
            return MessageDigest.isEqual(
                    Base64.getDecoder().decode(expected),
                    Base64.getDecoder().decode(actual));
        } catch (IllegalArgumentException ex) {
            return false;
        }
    }
}
```

`Mac` 实例不是用来跨线程共享的。高吞吐服务可以在每次请求创建实例，或使用隔离良好的对象池/线程本地实例并确保每次都重新 `init`；不要为了减少一次对象创建而引入并发污染。

## 六、服务端验签顺序是一条状态机

推荐把验证顺序固定下来：

```text
请求大小与字段格式
        ↓
时间窗与 keyId 状态
        ↓
正文摘要与 HMAC
        ↓
Nonce 原子占用
        ↓
主体授权与业务处理
```

这个顺序兼顾安全和资源成本：先拒绝明显非法或过期请求，但只有在 HMAC 通过后才写入 Nonce 存储，避免未持有密钥的攻击者用随机 Nonce 污染 Redis。伪代码如下：

```java
public VerifiedPrincipal verify(SignedRequest request) {
    // 1. 限制字段长度、Base64 格式、请求体大小，拒绝畸形输入
    request.validateShape();

    long now = clock.instant().getEpochSecond();
    if (Math.abs(now - request.getTimestamp()) > 300) {
        throw new SignatureExpiredException();
    }

    // 2. keyId 只用于查找服务端密钥记录，不能由客户端直接声明权限
    ApiKeyMaterial key = keyRepository.findActive(request.getKeyId());

    String actualDigest = ApiSignatureSupport.sha256Base64(request.getBody());
    if (!ApiSignatureSupport.constantTimeBase64Equals(
            actualDigest, request.getContentSha256())) {
        throw new BodyDigestMismatchException();
    }

    String canonicalRequest = canonicalizer.build(request, actualDigest);
    String expectedSignature = ApiSignatureSupport.hmacBase64(
            key.getSecretBase64(), canonicalRequest);
    if (!ApiSignatureSupport.constantTimeBase64Equals(
            expectedSignature, request.getSignature())) {
        throw new InvalidSignatureException();
    }

    // 3. 只有合法签名才能占用 Nonce；NX 失败表示窗口内已经使用过
    if (!nonceStore.tryAcquire(key.getKeyId(), request.getNonce(), 330)) {
        throw new ReplayDetectedException();
    }

    return new VerifiedPrincipal(key.getSubjectId(), key.getPermissions());
}
```

示例使用 300 秒时间窗、330 秒 Nonce TTL，只用于说明“去重状态略长于接受窗口”。真实值应基于调用方时钟同步、网络 P99 延迟、故障恢复时间和业务风险确定，不能把五分钟当作行业固定答案。

还应区分客户端时间过快和过慢。简单的 `abs(now - timestamp)` 能双向限制偏差，但日志与指标要分别记录 future skew 和 stale request，才能判断是攻击、客户端 NTP 故障还是服务端时间异常。

## 七、Nonce 去重必须是原子且全局可见的

单机 `ConcurrentHashMap` 只能保护一个进程。负载均衡把同一个请求发到另一个实例时，重放仍会成功。Redis 可以用一个原子命令完成占用：

```text
SET api:nonce:{partner-a-v3}:71f456ef-4c8a-4e62-bd16-2b51d9ec6b73 1 NX EX 330
```

返回成功表示第一次使用，返回空表示已存在。这里不能先 `EXISTS` 再 `SET`，两个请求可能同时通过检查。Key 中应包含 `keyId` 或调用方主体，避免不同调用方碰巧使用相同 Nonce 时互相拒绝；同时限制 Nonce 长度和字符集，防止构造超长 Key。

多地域主动写入架构还要回答一致性问题。如果两个地域各自使用异步复制的 Redis，攻击者可以在复制完成前分别重放一次。高风险写操作应把同一调用方路由到单一验签域、使用具备所需一致性的全局存储，或采用服务端挑战值。无法提供全局唯一占用时，就不能对外承诺全局防重放。

Redis 故障时也要按接口风险选择策略：查询类接口可以降级为“只验签与时间窗”并告警；支付、退款、改价等写操作通常应 fail closed，返回可重试错误而不是绕过 Nonce 校验。

## 八、防重放不等于业务幂等

假设客户端提交订单后没有收到响应，它会面临两种选择：

- 复用原时间戳、Nonce 和签名：防重放层应拒绝；
- 生成新 Nonce 和签名：安全层会接受，但业务可能创建第二笔订单。

因此写接口还需要独立的 `Idempotency-Key`。它进入签名原文，并由业务层按“调用方 + 幂等键”保存请求摘要和最终结果。相同幂等键、相同请求摘要返回第一次结果；相同幂等键、不同请求摘要必须报冲突。

```text
Nonce                 → 一次签名凭据只能使用一次，短生命周期
Idempotency-Key       → 一个业务意图只能产生一次效果，生命周期由业务决定
orderNo/paymentNo     → 领域唯一约束，作为数据库最终防线
```

只实现 Nonce 而不实现业务幂等，会把网络重试变成调用方的两难；只实现业务幂等而没有 Nonce，则其他非幂等接口和不同业务键仍可能遭到重放。

## 九、密钥生命周期与权限边界

共享密钥应按调用方隔离，并通过 `keyId` 支持版本轮换：

1. 先创建新版本并允许新旧密钥同时验签；
2. 调用方切换签名密钥，监控旧 `keyId` 的最后使用时间；
3. 超过最长请求窗口和回滚观察期后禁用旧密钥；
4. 保留不含秘密的审计记录，不在日志输出密钥或完整签名原文中的敏感正文。

密钥记录至少应包含主体、算法、密文或密钥管理引用、状态、生效/失效时间和权限集合。不要让一个全局共享密钥覆盖所有合作方，也不要把密钥写进 Git、镜像层或普通 `application.yml`。服务启动时从 KMS、Vault 或受控环境注入，运行期只给验签组件最小读取权限。

如果服务端也能代表调用方生成同样的 HMAC，就无法向第三方证明究竟是谁签了请求。需要不可抵赖、客户端不能让服务端持有私钥或跨组织审计时，应改用非对称签名，并优先采用标准协议和成熟库。

## 十、代理、网关与框架最容易制造验签差异

签名验证必须明确发生在哪一层：

- 网关验签时，应签网关实际看到的外部 Authority、Path 和 Query，并把已认证主体通过受保护的内部凭据传给后端；
- 应用验签时，网关不能在验签前改写已覆盖组件，或者必须保留可信的原始目标；
- 不能直接信任来自公网的 `X-Forwarded-*`，只有受信代理写入并清洗后的值才能进入安全上下文；
- 压缩、分块传输、字符集转换和 JSON 重写都可能改变正文，签名协议必须说明摘要针对哪个阶段的字节。

RFC 9421 允许应用选择真正有意义的 HTTP 组件，并提醒某些组件会被中间人合法转换。自定义方案也必须做同样的部署分析，不能在本地 SDK 和 Controller 之间验通一次就认为代理链路一定正确。

## 十一、错误响应与可观测性

对外错误不应泄露“是 keyId 存在但签名错误”这类可枚举信息，可以统一返回认证失败；内部日志和指标则应保留明确原因码：

| 内部原因 | 建议指标 | 常见根因 |
|---|---|---|
| `MALFORMED_SIGNATURE` | 非法 Base64、超长字段数 | 扫描、SDK Bug |
| `TIMESTAMP_EXPIRED` | 过期与未来偏差分别计数 | 时钟未同步、队列积压、重放 |
| `BODY_DIGEST_MISMATCH` | 按客户端版本聚合 | 编码、代理改写、摘要对象错误 |
| `SIGNATURE_MISMATCH` | 按 `keyId` 与协议版本聚合 | 密钥错误、规范化不一致、篡改 |
| `NONCE_REPLAYED` | 按主体、来源和接口聚合 | 网络重试复用旧签名、主动重放 |
| `NONCE_STORE_UNAVAILABLE` | Redis 延迟与失败率 | 基础设施故障 |

日志可以记录请求 ID、主体、`keyId`、协议版本、时间偏差、Nonce 的不可逆哈希、规范化步骤编号和失败原因，但不要记录共享密钥、完整 Authorization 信息或敏感正文。排查规范化差异时，优先在安全环境中比较每行的摘要，而不是把整个签名原文写入生产日志。

## 十二、常见误区与最佳实践

### 误区 1：只签正文

攻击者仍可能把合法正文从 `POST /quotes` 搬到 `POST /orders`，或修改查询参数。方法、目标、关键头和正文摘要都应被覆盖。

### 误区 2：有时间戳就能防重放

时间戳只把攻击窗口缩短到数分钟，窗口内可以无限重放。还需要服务端维护一次性 Nonce 状态。

### 误区 3：先写 Nonce，再验签

攻击者无需密钥就能制造大量随机 Nonce，占满缓存并干扰合法请求。应在格式、大小、时间窗和 HMAC 验证通过后原子占用。

### 误区 4：把整个 JSON 排序后再签名

这会引入数字、Unicode、数组顺序和重复键等新的规范化问题。没有采用明确的 JSON Canonicalization 标准时，直接对传输字节计算摘要更稳妥。

### 误区 5：用普通字符串相等比较签名

签名应先严格解码，再用常量时间字节比较。虽然网络噪声可能掩盖微小时序差异，但安全边界不应依赖这种偶然条件。

### 误区 6：忽略协议版本和密钥轮换

一旦规范化规则需要升级，没有版本字段就只能让所有调用方同时切换。协议版本进入签名原文，`keyId` 标识密钥版本，才能安全灰度。

落地时建议按以下顺序推进：

1. 写出逐字节的协议规范和固定测试向量，覆盖空正文、重复查询参数、中文与特殊字符；
2. 先实现一个共享的签名 SDK，避免每个业务团队自行拼接；
3. 在网关或应用入口限制大小、字段格式与时间偏差；
4. 验证正文摘要和 HMAC 后，再原子占用 Nonce；
5. 将验签主体传给授权层，写接口另外实现业务幂等；
6. 演练时钟漂移、Redis 故障、密钥轮换、代理改写与跨地域重放；
7. 若协议需要跨公司长期演进，迁移到 RFC 9421 兼容实现而不是继续扩展私有字段。

## 十三、总结

API 请求签名的核心不是调用一次 `HmacSHA256`，而是建立一个没有歧义、能够跨节点执行的验证状态机。规范化规则决定双方签的是不是同一组字节，正文摘要把实际负载绑定进签名，时间窗缩短凭据寿命，Nonce 原子去重关闭窗口内重放，密钥版本和权限记录则负责长期运维。

当接口还需要安全重试时，继续增加独立的业务幂等键和数据库唯一约束。把防重放、幂等、TLS、授权和密钥管理各自放在正确边界，才能让这套机制既挡住攻击，也不会破坏正常的故障恢复。

## 参考资料

- [RFC 2104：HMAC: Keyed-Hashing for Message Authentication](https://www.rfc-editor.org/rfc/rfc2104.html)
- [RFC 9421：HTTP Message Signatures](https://www.rfc-editor.org/rfc/rfc9421.html)
- [RFC 9530：Digest Fields](https://www.rfc-editor.org/rfc/rfc9530.html)
- [RFC 3986：Uniform Resource Identifier](https://www.rfc-editor.org/rfc/rfc3986.html)
- [Oracle Java 8：Java Cryptography Architecture Reference Guide](https://docs.oracle.com/javase/8/docs/technotes/guides/security/crypto/CryptoSpec.html)
