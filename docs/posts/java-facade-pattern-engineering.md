---
title: 外观模式工程实践：子系统收敛、门面边界与分层治理
date: 2026-11-28
category: 后端开发
cover: /covers/backend.svg
tags: [java, 设计模式, 外观模式, 分层架构, 防腐层]
excerpt: 外观模式不是"多包一层"，而是把一组子系统收敛成一个稳定入口：调用方只认识门面，门面负责编排顺序、翻译异常、兜住失败。它的价值在边界治理，风险在退化成上帝类。
---

# 外观模式工程实践：子系统收敛、门面边界与分层治理

<img src="/images/posts/java-facade-pattern-engineering-knowledge-map.png" alt="外观模式工程实践：子系统收敛、门面边界与分层治理知识串联图" style="border-radius: 10px;" />

外观模式不是"多包一层"，而是把一组子系统收敛成一个稳定入口：调用方只认识门面，门面负责编排顺序、翻译异常、兜住失败。它的价值在边界治理，风险在退化成上帝类。

## 先说结论：门面只收敛入口，不增值业务

**外观模式**（Facade Pattern）的经典定义是：为子系统中的一组接口提供一个一致的界面，定义一个高层接口，使子系统更容易使用。GoF 原话强调的是"统一"（unified）和"更高层"（higher-level），而不是"简化"本身。

落到工程上只有三条硬约束：

- **调用方只依赖门面**：业务代码里不出现 `InventoryClient`、`PaymentGateway`、`LedgerRepository` 这类子系统类型；
- **门面只做编排**：排序调用顺序、合并参数、翻译异常、决定重试与回滚，不写业务规则；
- **子系统不认识门面**：门面是单向依赖，子系统内部仍可互调，不需要为了配合门面改结构。

违反第一条，门面就是摆设；违反第二条，门面会变成"什么都往里塞"的上帝类（God Object）；违反第三条，门面与子系统互相引用，循环依赖迟早出现。

本文以 GoF《Design Patterns》（1994）对 Facade 的定义、以及 Java 17 语言特性为事实基线，核对日期 **2026-11-28**。文中 Spring 相关描述仅涉及构造器注入、单例 Bean 等长期稳定的行为，不绑定具体小版本。

## 一、结构里有四个角色，不是两个

很多人只记住"客户端 + 门面"，实际结构是四个角色：

| 角色 | 职责 | 工程上的边界要求 |
| --- | --- | --- |
| Client（客户端） | 发起一次业务意图 | 只依赖门面接口，不 new 子系统对象 |
| Facade（门面） | 把意图翻译成子系统调用序列，对结果做收敛 | 无状态、可重入，不缓存业务数据 |
| Additional Facade（附加门面） | 门面拆细后的第二个入口，避免单个门面膨胀 | 门面之间可互相调用，但不能形成环 |
| Subsystem（子系统） | 真正干活的一组类 | 不感知门面存在，也不该为门面而改 |

门面不是"中间层"，因为它**不新增功能**，也不改变子系统之间的调用关系。它加的只是一个**稳定前缀**：调用方看到的接口形状，从此和子系统内部结构解耦。

## 二、完整分类：五种落地形态

外观模式在不同层次上有不同名字，但结构一致。以下五种是工程中最常见的形态，逐项说明。

### 1、经典门面：一次意图 → 一串调用

最标准的形态。比如"下单"这一个动作，内部要扣库存、锁优惠券、创建支付单、写流水。客户端只调 `placeOrder(command)`，顺序、补偿、异常都留在门面里。

判断标准：**如果调用方需要知道"先做什么再做什么"，这段编排就该下沉到门面。**

### 2、分层门面：每一层只暴露一个入口

把子系统按层切开，每层一个门面，层与层之间只通过门面通信。典型是 `Controller → ApplicationService（门面）→ DomainService/Repository`。

它和"每层一个 Service"的区别在于**约束强度**：分层门面要求跨层调用必须经过门面，禁止 Controller 直接注入 Repository。这一条约束能直接消灭"业务逻辑散落在 Controller"的常见腐败。

### 3、防腐门面：隔离外部 SDK

对接第三方（支付、物流、短信、对象存储）时，外部 SDK 的类型、异常、字段命名会污染整个工程。做法是建一个门面把 SDK 完全包住：

- 入参出参都换成自己的领域模型；
- SDK 异常统一翻译成自己的业务异常；
- 版本升级只改门面内部。

这种形态在领域驱动设计里叫**防腐层**（Anti-Corruption Layer, ACL），本质就是外观模式加上模型转换。它比"直接在 Service 里调 SDK"多一层，但这层是**唯一**会随第三方变更的地方。

### 4、聚合门面：BFF 与接口编排

前端一个页面要 5 个后端接口的数据，如果让前端并发调 5 次，再各自处理降级，前端会被迫承担编排逻辑。此时在中间加一个聚合门面（常见叫 BFF，Backend For Frontend），一次请求内部并发 5 个子调用，统一超时、统一降级、统一裁剪字段。

注意它的边界：聚合门面**只做并行与裁剪**，不复制下游的业务规则。一旦门面里出现"如果用户等级是 VIP 则……"，说明业务逻辑正在往门面里漏。

### 5、门面 + 工厂：门面实例不是配置项

门面自身通常无状态，交给容器做单例即可。但当门面需要按参数选择子系统实现（比如按渠道选择 SDK）时，会配合工厂返回对应的门面实例。这时门面负责"怎么调"，工厂负责"造哪个"，两者职责不能混。

### 6、变体说明：门面不要求"隐藏全部能力"

GoF 与常见资料都强调一点：门面可以提供**受限但够用**的接口。子系统的全部能力不必都暴露，也不需要禁止高级调用方绕过门面直接使用子系统——只要这类绕过是**显式且有理由**的（比如运维脚本、数据修复任务），并且被记录在架构文档里。

真正危险的是"静默绕过"：新同事不知道门面存在，直接在 Controller 里注入子系统，于是同一段编排逻辑出现两份。

## 三、真实示例：支付编排门面

场景：商城下单后需要完成支付单创建、库存预占、优惠券核销、流水记账、结果通知。子系统各管一件事，编排放在门面里。

先看子系统（这里只保留接口签名，实现省略）：

```java
/**
 * 库存子系统：只负责预占与释放，不知道支付与优惠券的存在。
 */
public interface InventoryService {
    /** 预占库存，返回预占单号；库存不足抛 InsufficientStockException */
    String reserve(String skuId, int quantity);

    /** 释放预占（幂等），用于支付失败或超时补偿 */
    void release(String reservationId);
}

/**
 * 优惠券子系统：核销与回滚成对出现。
 */
public interface CouponService {
    /** 核销优惠券，返回核销流水号 */
    String consume(String couponId, String orderNo);

    /** 回滚核销（幂等） */
    void rollback(String consumeNo);
}

/**
 * 外部支付 SDK 的防腐包装：门面只认这三个方法，不认 SDK 类型。
 */
public interface PaymentGateway {
    /** 创建支付单，返回渠道支付单号 */
    String createPayment(String orderNo, long amountFen, String channel);

    /** 查询支付结果，用于对账与超时补偿 */
    PaymentStatus query(String paymentNo);
}

/**
 * 记账子系统：写支付流水，独立事务，失败不回滚支付。
 */
public interface LedgerService {
    /** 记账（幂等键为 orderNo） */
    void record(String orderNo, long amountFen);
}
```

门面本体：

```java
/**
 * 支付编排门面：调用方唯一入口。
 *
 * 职责边界：
 * 1. 编排子系统调用顺序（预占 → 核销 → 创建支付单 → 记账 → 通知）；
 * 2. 把子系统异常统一翻译成领域异常，禁止 SDK 异常穿透；
 * 3. 失败时按相反顺序补偿，补偿失败写入待修复队列而不是吞掉。
 *
 * 明确不做：不计算价格、不判断营销规则、不缓存订单状态。
 */
@Service
public class CheckoutFacade {

    private static final Logger log = LoggerFactory.getLogger(CheckoutFacade.class);

    private final InventoryService inventoryService;
    private final CouponService couponService;
    private final PaymentGateway paymentGateway;
    private final LedgerService ledgerService;
    private final CompensationQueue compensationQueue;

    /** 构造器注入：门面依赖全部显式声明，不用字段注入，便于单测替换 */
    public CheckoutFacade(InventoryService inventoryService,
                          CouponService couponService,
                          PaymentGateway paymentGateway,
                          LedgerService ledgerService,
                          CompensationQueue compensationQueue) {
        this.inventoryService = inventoryService;
        this.couponService = couponService;
        this.paymentGateway = paymentGateway;
        this.ledgerService = ledgerService;
        this.compensationQueue = compensationQueue;
    }

    /**
     * 下单支付入口。
     * 注意：这里不开启本地事务。子系统各自管自己的事务，
     * 门面用补偿代替跨库强一致，避免长事务持有数据库连接。
     */
    public CheckoutResult checkout(CheckoutCommand command) {
        // 已完成的补偿动作，失败时按逆序回放
        Deque<Runnable> compensations = new ArrayDeque<>();
        String reservationId = null;
        String consumeNo = null;

        try {
            // 1. 预占库存：最早执行，最早可补偿
            reservationId = inventoryService.reserve(command.skuId(), command.quantity());
            String finalReservationId = reservationId;
            compensations.push(() -> inventoryService.release(finalReservationId));

            // 2. 核销优惠券：金额为 0 的订单不存在优惠券，跳过
            if (command.couponId() != null) {
                consumeNo = couponService.consume(command.couponId(), command.orderNo());
                String finalConsumeNo = consumeNo;
                compensations.push(() -> couponService.rollback(finalConsumeNo));
            }

            // 3. 调外部渠道：最容易超时的一步，放在补偿链末端之前
            String paymentNo = paymentGateway.createPayment(
                    command.orderNo(), command.payableFen(), command.channel());

            // 4. 记账：独立事务，失败也不阻塞支付结果返回
            try {
                ledgerService.record(command.orderNo(), command.payableFen());
            } catch (RuntimeException e) {
                // 记账失败不进补偿链：钱已经出去了，回滚库存只会让状态更乱
                log.error("记账失败，转对账修复, orderNo={}", command.orderNo(), e);
                compensationQueue.enqueueLedgerRepair(command.orderNo());
            }

            return CheckoutResult.pending(command.orderNo(), paymentNo);

        } catch (InsufficientStockException e) {
            // 业务可预期失败：直接回滚已完成的步骤，返回明确错误码
            rollback(compensations, command.orderNo());
            throw new CheckoutException(CheckoutErrorCode.STOCK_SHORTAGE, "库存不足", e);

        } catch (PaymentGatewayException e) {
            // 外部异常必须翻译，不能让渠道 SDK 异常穿透到 Controller
            rollback(compensations, command.orderNo());
            throw new CheckoutException(CheckoutErrorCode.PAYMENT_UNAVAILABLE, "支付通道暂时不可用", e);

        } catch (RuntimeException e) {
            rollback(compensations, command.orderNo());
            throw new CheckoutException(CheckoutErrorCode.CHECKOUT_FAILED, "下单失败", e);
        }
    }

    /** 逆序补偿：任何一步补偿失败都落队列，交给定时任务重试，绝不静默吞掉 */
    private void rollback(Deque<Runnable> compensations, String orderNo) {
        while (!compensations.isEmpty()) {
            Runnable action = compensations.pop();
            try {
                action.run();
            } catch (RuntimeException e) {
                log.error("补偿失败，转人工修复, orderNo={}", orderNo, e);
                compensationQueue.enqueueManualRepair(orderNo);
            }
        }
    }
}
```

调用方（Controller）长这样，注意它**一个子系统类型都没出现**：

```java
@RestController
@RequestMapping("/api/checkout")
public class CheckoutController {

    private final CheckoutFacade checkoutFacade;

    public CheckoutController(CheckoutFacade checkoutFacade) {
        this.checkoutFacade = checkoutFacade;
    }

    /** 下单：Controller 只做协议转换与参数校验，编排全部在门面里 */
    @PostMapping
    public ApiResponse<CheckoutResponse> checkout(@RequestBody @Valid CheckoutRequest request) {
        CheckoutResult result = checkoutFacade.checkout(request.toCommand());
        return ApiResponse.ok(CheckoutResponse.from(result));
    }
}
```

这段代码里，门面承担了四件"编排才该管"的事：**顺序**（先预占再调渠道）、**补偿**（逆序回放）、**异常翻译**（三种异常映射三个错误码）、**失败兜底**（记账失败转对账而不是回滚）。它没有做的是：算钱、判断能不能用券、缓存订单——这些属于领域逻辑，塞进门面就会让门面变成不可测的大类。

## 四、适用场景与不适用场景

**适用：**

- 一个业务意图需要调用 3 个以上子系统，且顺序有语义；
- 对接外部 SDK，需要隔离类型与异常；
- 分层架构中需要强制"跨层必须走入口"；
- 聚合多接口给前端，统一降级与裁剪；
- 遗留系统改造，先加门面收口，再逐步替换内部实现。

**不适用：**

- 只有一个子系统、一次调用——包装纯属多余；
- 子系统之间本就有清晰的事件/消息边界，调用方无需编排；
- 门面里开始出现大量 `if/else` 分支判断业务规则——该用策略或状态机；
- 用门面掩盖设计问题（比如两个子系统本不该耦合，却靠门面强行粘住）。

## 五、与相邻模式的边界

外观模式最容易被混用，区别集中在"接口形状"和"是否新增职责"两点：

| 模式 | 接口关系 | 是否新增能力 | 典型用途 |
| --- | --- | --- | --- |
| 外观 Facade | 提供**新的**简化接口，面向一组对象 | 不新增功能，只做编排 | 下单编排、SDK 隔离、分层入口 |
| 适配器 Adapter | 把**已有**接口转成调用方期望形状 | 不新增功能 | 老接口复用、协议转换，通常包一个对象 |
| 代理 Proxy | 与目标**同接口**，可替换 | 可附加访问控制、懒加载 | 权限、远程调用、延迟初始化 |
| 装饰器 Decorator | 与目标**同接口**，可叠加多层 | 叠加职责 | 缓存、压缩、重试 |
| 中介者 Mediator | 组件之间不再互调，只认识中介者 | 集中通信逻辑 | 复杂 UI 联动、多组件协同 |
| 抽象工厂 | 隐藏对象的创建过程 | 只管造对象 | 一族相关对象的创建 |

一句话记法：**适配器改形状，代理同形状，装饰器叠形状，外观统一形状；中介者管通信，工厂管创建。**

外观与中介者最像，差别在方向：外观是"外部调用方 → 子系统"的**单向简化**，子系统之间仍可直接通信；中介者是"组件之间"的**双向中枢**，组件只认识中介者。

## 六、常见追问

**问：门面和 Service 有什么区别？**
Service 是实现业务能力的对象，门面是编排业务能力的对象。一个类如果只做"调 A、调 B、合并结果"，它是门面；如果它有业务规则与状态，它是 Service。实际项目里两者常同名，靠职责而不是命名区分。

**问：门面会让性能变差吗？**
门面本身只增加一次方法调用，开销可忽略。真正的性能问题来自门面内部：串行调用本可并行的子调用、门面里加了阻塞式远程日志、门面缓存了不该缓存的数据。

**问：门面里能不能开事务？**
可以，但要清楚代价。跨多个子系统（尤其是含远程调用）时，本地事务只能保护数据库部分，远程调用失败仍需要补偿。更常见的做法是：子系统各自管事务，门面用状态机 + 补偿队列兜底，避免长事务持有连接。

**问：门面越来越大怎么办？**
按**业务意图**拆成多个附加门面（比如 `CheckoutFacade`、`RefundFacade`、`QueryFacade`），而不是按子系统拆。拆完的门面之间可以互相调用，但不能形成环——一旦成环，说明业务边界没切干净。

**问：能不能让调用方绕过门面？**
技术上可以，架构上要禁止。常见做法是把子系统实现类放在 `.internal` 包，用 ArchUnit 之类的规则禁止跨包直接依赖；或者把子系统接口设为包级可见。约束靠工具，不靠自觉。

**问：门面和 DDD 的应用服务是同一个东西吗？**
高度重合。应用服务本身就是"用例编排层"，天然扮演门面角色。区别在于 DDD 的应用服务通常还会承载事务边界、权限校验、领域事件发布，职责比"纯编排"更重一些。

## 七、踩坑记录

- **门面里写业务规则**：金额计算、营销判断漏进门面，导致子系统无法独立复用，门面也无法单测。
- **门面抛子系统异常**：`PaymentGatewayException` 一路穿透到 Controller，前端看到渠道内部错误码，接口契约形同虚设。
- **补偿没有幂等**：重试时重复释放库存，库存被放大；补偿动作必须可重入。
- **补偿异常被吞**：`catch (Exception ignored) {}` 让数据不一致变成静默事故。
- **门面持有请求状态**：单例门面里放了 `currentUser` 字段，多线程串数据。
- **门面里做远程调用的重试风暴**：无退避、无熔断的重试把下游打挂。
- **门面与子系统循环依赖**：子系统为了回调门面注入了门面，结构塌陷。
- **门面成为唯一测试点**：所有逻辑都挤在门面里，单元测试只能整链路起容器。

## 八、选择建议与最佳实践

**选择建议：**

| 判断信号 | 结论 |
| --- | --- |
| 一个意图要调 3 个以上子系统，且有顺序 | 上外观模式 |
| 只包装一个对象、只想换接口形状 | 适配器 |
| 想在不改调用方的前提下加权限/懒加载 | 代理 |
| 想给同一接口叠加多层职责 | 装饰器 |
| 组件之间互相调用形成网状 | 中介者，不是外观 |
| 子系统只有一个、调用只有一次 | 不要包装 |

**最佳实践清单：**

1. 门面接口用**业务意图**命名（`checkout`、`refund`），不要用技术动作（`callGateway`）；
2. 门面无状态、构造器注入、字段 `final`，保证可重入与可测试；
3. 入参出参用领域模型，禁止把子系统 DTO 暴露给调用方；
4. 外部异常统一翻译，保留 `cause` 便于排查，但不在响应里透出；
5. 补偿动作必须幂等，且补偿失败要落队列，不能只打日志；
6. 门面内不做远程调用的无限重试，退避 + 熔断 + 超时预算写清楚；
7. 门面超过 300 行就按意图拆分附加门面；
8. 用包可见性或架构测试把"禁止绕过门面"变成可执行约束；
9. 门面的每个分支都要有对应错误码，避免"下单失败"这种无信息量的返回。

## 九、总结

外观模式的全部价值是**把变化关在门内**：调用方依赖一个稳定的业务意图接口，子系统可以随便重构、替换、升级，只要门面契约不变，上层就不受影响。它不是"多一层封装"，而是明确了一条架构纪律——**跨边界的调用必须走入口**。

判断要不要用，只问两个问题：调用方现在是否被迫了解子系统细节？子系统未来是否可能被替换或重构？两个答案都是"是"，门面就该存在；有一个是"否"，包装就只是噪音。

**关联知识点**：适配器模式关注接口形状转换；代理模式在同接口上追加控制；装饰器模式叠加职责；中介者模式集中组件通信；防腐层是外观模式在外部依赖上的特化。

**参考资料**：

- Gamma, Helm, Johnson, Vlissides.《Design Patterns: Elements of Reusable Object-Oriented Software》. 1994，Facade 章节
- [Refactoring Guru：Facade](https://refactoring.guru/design-patterns/facade)（结构与模式关系，核对日期 2026-11-28）
- [Refactoring Guru：Adapter](https://refactoring.guru/design-patterns/adapter)、[Mediator](https://refactoring.guru/design-patterns/mediator)、[Proxy](https://refactoring.guru/design-patterns/proxy)（边界对比，核对日期 2026-11-28）
