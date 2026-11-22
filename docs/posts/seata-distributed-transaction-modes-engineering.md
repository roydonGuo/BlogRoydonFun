---
title: Seata 分布式事务工程实践：四种模式、全局锁与失败边界
date: 2026-11-22
category: 后端开发
cover: /covers/backend.svg
tags: [java, seata, 分布式事务, spring-cloud, 微服务, at, tcc, xa, saga]
excerpt: "以 Apache Seata v2.6 官方文档为基线，拆解 AT、TCC、XA、Saga 四种分布式事务模式的前后镜像与全局锁、自定义三阶段、资源层 XA 阻塞与长事务补偿，并给出面向 Java 后端的选型、失败处理与可观测性建议。"
---

# Seata 分布式事务工程实践：四种模式、全局锁与失败边界

<img src="/images/posts/seata-distributed-transaction-modes-engineering-knowledge-map.png" alt="Seata 分布式事务工程实践：四种模式、全局锁与失败边界知识串联图" style="border-radius: 10px;" />

以 Apache Seata v2.6 官方文档为基线，拆解 AT、TCC、XA、Saga 四种分布式事务模式的前后镜像与全局锁、自定义三阶段、资源层 XA 阻塞与长事务补偿，并给出面向 Java 后端的选型、失败处理与可观测性建议。

`Seata` 的工程结论可以浓缩成一句话：**它用一个全局事务把多个分支事务串起来，但"怎么保证每个分支能回滚"这件事，四种模式给出了四套完全不同的答案**。AT 靠快照加反向 SQL，TCC 靠你自己写的三个方法，XA 把回滚能力交给数据库，Saga 则对长流程逐段补偿。选错模式，比不用分布式事务更糟。

业务里最容易踩的坑不是注解不会用，而是把 AT 默认全局隔离级别当成读已提交、把 TCC 的 `Try` 当成普通业务方法随便改、把 XA 的 `prepare` 后阻塞当成"性能应该差不多"，或者把 Saga 的补偿当成事务回滚来用。

> 本文以 **Apache Seata v2.6 官方文档**为基线，事实核对时间为 **2026-11-22**。模式定义与机制来自[《Seata 是什么？》](https://seata.apache.org/zh-cn/docs/overview/what-is-seata/)、[AT 模式](https://seata.apache.org/zh-cn/docs/user/mode/at/)、[XA 模式](https://seata.apache.org/zh-cn/docs/user/mode/xa/)与[API 支持](https://seata.apache.org/zh-cn/docs/user/api/)。注解属性只列官方文档中确认出现的字段，不推测未在文档中声明的参数。

## 一、先说结论

| 模式 | 回滚能力来自 | 业务侵入 | 一致性/隔离 | 典型场景 |
|---|---|---|---|---|
| **AT** | 框架自动生成前后镜像 + 反向 SQL | 低，一个 `@GlobalTransactional` + 数据源代理 | 默认全局读未提交，写靠全局锁防脏写 | 已有本地 ACID 事务、基于 JDBC 的关系库 |
| **TCC** | 开发者手写的 `Try / Confirm / Cancel` | 高，要写三个方法并处理幂等 | 阶段由业务语义定义，资源预占靠业务实现 | 跨非事务资源、需要业务级预占与确认 |
| **XA** | 数据库 XA 协议 | 低，替换数据源代理即可 | 资源层保障全局一致，隔离最强 | 老应用迁移、AT 未适配的数据库 |
| **Saga** | 开发者手写的正向服务 + 补偿服务 | 高，要写正向与反向两套 | **不保证隔离性**，一阶段直接提交本地事务 | 流程长、参与者多、含遗留/外部系统 |

先记住一句话：**AT 和 XA 是"框架/资源替你回滚"，TCC 和 Saga 是"你自己写回滚"，差别就在这一条分界线上**。

## 二、全局事务骨架：TC、TM、RM 与两阶段

四种模式共享同一套骨架，模式只决定"分支事务怎么实现两阶段"。

| 角色 | 全称 | 职责 |
|---|---|---|
| **TC** | Transaction Coordinator，事务协调器 | 维护全局事务状态，驱动分支提交或回滚，持有全局锁 |
| **TM** | Transaction Manager，事务管理器 | 定义全局事务边界，开启/提交/回滚全局事务 |
| **RM** | Resource Manager，资源管理器 | 管理分支事务，向 TC 注册分支、上报状态、执行分支提交/回滚 |

一次全局事务的完整链路是：

1. TM 向 TC 申请开启全局事务，TC 生成 **XID**（全局事务 ID）。
2. XID 通过调用链传播到各个服务，RM 把分支事务注册到该 XID 下。
3. TM 决定全局提交或回滚，TC 通知所有分支执行对应动作。
4. 分支全部完成后，TC 清理全局事务状态与全局锁。

XID 的上下文由 `RootContext` 维护，默认基于 `ThreadLocal`：

```java
// 获取当前全局事务 XID，非空即表示处于全局事务上下文
String xid = RootContext.getXID();
// 判断当前操作是否处于全局事务中
boolean inGlobal = RootContext.inGlobalTransaction();
```

跨线程/跨服务时，必须手动传播 XID，否则下游分支不会挂到同一个全局事务上：

```java
// 调用前解绑 XID，使这段逻辑脱离全局事务管辖（如发送通知、写审计日志）
String unbindXid = RootContext.unbind();
try {
    doSideEffect();   // 不希望被全局回滚影响的旁路操作
} finally {
    // 业务完成后恢复 XID，全局事务继续生效
    RootContext.bind(unbindXid);
}
```

官方 `TransactionalTemplate` 展示了这套边界控制的标准写法：获取或创建全局事务 → `begin(timeout, name)` → 执行业务 → 成功则 `commit`，异常则 `rollback`。它把失败分成四类，便于外层区分处理：

| 异常编码 | 含义 | 原始业务异常 |
|---|---|---|
| `BeginFailure` | 开启全局事务失败 | 无 |
| `CommitFailure` | 全局提交失败 | 无 |
| `RollbackFailure` | 全局回滚失败 | 有 |
| `RollbackDone` | 全局回滚成功 | 有 |

这四类中最危险的是 `RollbackFailure`：业务已经失败，回滚也没成功，数据处于不确定状态，必须靠**重试或人工介入**收口，不能被 `try-catch` 吞掉。

## 三、AT 模式：前后镜像 + 全局锁

AT 是 Seata 创新的一套**非侵入式**方案：框架在数据源层做代理，业务代码几乎不用改。

### 1. 前提与整体机制

- 前提一：基于**支持本地 ACID 事务**的关系型数据库。
- 前提二：Java 应用通过 **JDBC** 访问数据库，可使用框架的 `DataSourceProxy`。

机制是两阶段提交的演变：

- **一阶段**：业务数据和回滚日志记录在**同一个本地事务**中提交，随后释放本地锁和连接资源。
- **二阶段**：提交异步化、非常快速；回滚则通过一阶段的回滚日志做**反向补偿**。

### 2. 一阶段做了什么

以 `update product set name = 'GTS' where name = 'TXC'` 为例，数据源代理在背后做八件事：

1. 解析 SQL：得到类型（UPDATE）、表（`product`）、条件。
2. 查询**前镜像**：按条件查出将被修改的行。
3. 执行业务 SQL：真正更新数据。
4. 查询**后镜像**：按主键查出更新后的行。
5. 生成回滚日志：把前后镜像与 SQL 信息写入 `undo_log` 表。
6. 提交前向 TC 注册分支，申请该行的**全局锁**。
7. 本地事务提交：业务更新与 `undo_log` 一起提交。
8. 把本地提交结果上报 TC。

`undo_log` 表结构（MySQL）关键字段如下，注意 `context` 字段自 0.7.0+ 起增加：

| 字段 | 类型 | 作用 |
|---|---|---|
| `branch_id` / `xid` | bigint / varchar | 定位具体分支与全局事务 |
| `rollback_info` | longblob | 前后镜像与 SQL 元数据 |
| `log_status` | int | 日志状态 |
| `context` | varchar | 扩展上下文 |

### 3. 二阶段：提交与回滚

- **全局提交**：收到分支提交请求后，把请求丢进异步任务队列，**立即返回成功**；异步阶段批量删除 `undo_log`。
- **全局回滚**：开启本地事务，按 XID 与 Branch ID 查 `undo_log`，先用**后镜像与当前数据比对**做数据校验，再用前镜像生成并执行反向 SQL，最后提交并上报结果。

那个校验步骤不能省：如果后镜像与当前数据不一致，说明数据被当前全局事务之外的动作改过，此时要按配置策略处理，而不是无脑覆盖。

### 4. 全局锁：AT 防脏写的核心

一阶段本地提交前必须先拿到全局锁；拿不到就不能提交；重试超出范围就放弃并回滚本地事务。官方示例中的 tx1 / tx2 都改 `a.m`，tx1 持有全局锁直到二阶段结束，tx2 只能等待，因此不会出现两个全局事务交叉覆盖同一行的**脏写**。

一个容易被忽略的细节：如果 tx1 二阶段要回滚，而 tx2 正持有本地锁等待全局锁，tx1 的分支回滚会失败并持续重试，直到 tx2 等锁超时、放弃全局锁并释放本地锁，回滚才最终成功。这意味着**全局锁竞争会直接放大回滚延迟**。

### 5. 读隔离：默认全局读未提交

在数据库本地事务隔离级别为**读已提交（Read Committed）或以上**的基础上，AT 的默认全局隔离级别是**读未提交（Read Uncommitted）**——这是官方文档明确写出的结论，不要想当然认为它等于读已提交。

如果业务确实需要全局读已提交，Seata 提供的手段是代理 `SELECT ... FOR UPDATE`：执行时申请全局锁，锁被占用则释放本地锁并重试，查询被阻塞直到拿到锁、读到已提交数据。出于性能考虑，框架**只代理 `FOR UPDATE` 的 SELECT**，不会代理所有 SELECT。

### 6. 最小可用代码

```java
/**
 * 下单入口：用 AT 模式把「扣库存」与「扣余额」纳入同一个全局事务。
 * jdbcTemplateA / jdbcTemplateB 分别指向两个不同数据源，
 * 且都必须用 DataSourceProxy 包装，否则分支事务不会被 Seata 代理。
 */
@GlobalTransactional
public void purchase(String userId, String commodityCode, int count, int money) {
    // 分支一：扣减库存，本地事务提交时一并写入 undo_log
    jdbcTemplateA.update(
        "update stock_tbl set count = count - ? where commodity_code = ?",
        new Object[]{count, commodityCode});
    // 分支二：扣减账户余额，任一分支失败则全局回滚
    jdbcTemplateB.update(
        "update account_tbl set money = money - ? where user_id = ?",
        new Object[]{money, userId});
}
```

## 四、TCC 模式：自己写三阶段

TCC 的核心判断是：**分支事务不依赖底层数据资源的事务支持**，一阶段的 `prepare`、二阶段的 `commit` / `rollback` 都由业务代码自定义。

### 1. 三个阶段的语义

| 阶段 | 动作 | 官方语义 |
|---|---|---|
| **Try** | 预留资源 | 被 `@TwoPhaseBusinessAction` 修饰的方法，做业务级预占 |
| **Confirm** | 执行主业务 | 由 `commitMethod` 指向的方法，真正确认 |
| **Cancel** | 回滚 | 由 `rollbackMethod` 指向的方法，释放预占 |

### 2. 关键注解（仅列官方文档确认字段）

| 注解 | 修饰位置 | 关键属性 |
|---|---|---|
| `@LocalTCC` | TCC 接口**实现类**上 | 表示本地 TCC 接口；用 Dubbo 作为 RPC 组件时无须此注解 |
| `@TwoPhaseBusinessAction` | `prepare` 方法上 | `name`、`commitMethod`、`rollbackMethod`，以及参数类型相关属性 |
| `@BusinessActionContextParameter` | 需要跨阶段传递的参数上 | 把参数写入 `BusinessActionContext` |

`BusinessActionContext` 提供四个上下文属性：

| 属性 | 含义 |
|---|---|
| `xid` | 全局事务 ID |
| `branchId` | 分支事务 ID |
| `actionName` | 分支资源 ID |
| `actionContext` | 业务传递参数的 Map |

### 3. 一个完整 TCC 分支

```java
/**
 * 库存 TCC 分支：Try 冻结库存，Confirm 扣减冻结量，Cancel 释放冻结量。
 * 注意三个方法都必须自行保证幂等，TC 在异常恢复时可能重复调用二阶段。
 */
@LocalTCC
public class StockTccAction {

    /**
     * Try 阶段：冻结指定数量的库存，并把业务参数放入事务上下文。
     */
    @TwoPhaseBusinessAction(
        name = "stockTcc",
        commitMethod = "commit",
        rollbackMethod = "rollback")
    public boolean prepare(
            @BusinessActionContextParameter("orderNo") String orderNo,
            int count) {
        // 预占库存：真实项目应写成带幂等键的 UPDATE
        return stockMapper.freeze(orderNo, count) > 0;
    }

    /**
     * Confirm 阶段：从上下文取回订单号，把冻结量真正转为已扣减。
     */
    public boolean commit(BusinessActionContext context) {
        String orderNo = context.getActionContext("orderNo").toString();
        return stockMapper.confirmDeduct(orderNo) > 0;
    }

    /**
     * Cancel 阶段：释放冻结库存，同样依赖订单号做幂等。
     */
    public boolean rollback(BusinessActionContext context) {
        String orderNo = context.getActionContext("orderNo").toString();
        return stockMapper.releaseFreeze(orderNo) > 0;
    }
}
```

### 4. 使用 TCC 前必须接受的代价

- **空回滚**：Try 还没执行，Cancel 先到了（例如 Try 超时后被全局回滚），业务要识别并放行。
- **悬挂**：Cancel 执行完后，迟到的 Try 才到达，业务要拒绝它，否则资源永久预占。
- **幂等**：Confirm / Cancel 都可能被重复调用，三个方法都得设计幂等键。

这三类问题框架不会替你解决，它们是 TCC "高侵入"的真实含义。

## 五、XA 模式：把回滚交给数据库

XA 模式从 Seata 1.2 起支持，利用的是 X/Open 定义的 **XA 协议**（分布式事务处理 DTP 标准）。

### 1. 机制与用法

- **执行阶段**：业务 SQL 放在 XA 分支中，由资源保证可回滚；XA 分支完成后执行 `XA prepare`，由资源保证持久化。
- **完成阶段**：全局提交执行 XA 分支的 `commit`，全局回滚执行 `rollback`。

用法上与 AT 几乎一致，**唯一区别是数据源代理换成 `DataSourceProxyXA`**：

```java
/**
 * XA 模式数据源配置：用 DataSourceProxyXA 替代 AT 的 DataSourceProxy。
 * 这是 XA 与 AT 在使用方式上的唯一区别。
 */
@Bean("dataSourceProxy")
public DataSource dataSource(DruidDataSource druidDataSource) {
    // XA 模式：依赖数据库对 XA 协议的支持
    return new DataSourceProxyXA(druidDataSource);
    // AT 模式则使用：new DataSourceProxy(druidDataSource)
}
```

### 2. 优势、缺点与适用场景

| 维度 | 官方表述 |
|---|---|
| 优势 | **业务无侵入**；XA 协议被主流关系型数据库广泛支持，无须额外适配 |
| 优势 | 事务资源本身保障从任意视角访问数据的有效隔离，满足**全局数据一致性** |
| 缺点 | `XA prepare` 后分支进入阻塞阶段，资源长时间得不到释放，**锁定周期长、性能差**，且应用层无法干预 |
| 适用 | 迁移到 Seata 的 XA 协议老应用；AT 模式未适配的数据库应用 |

一句话：**XA 换来的是最强隔离和最低改造成本，付出的是锁持有时间**。并发高、事务长的链路不要盲目选它。

## 六、Saga 模式：长事务的逐段补偿

Saga 是 Seata 提供的**长事务解决方案**，理论基础是 Hector 与 Kenneth 在 1987 年发表的 Sagas 论文。

### 1. 机制

业务流程中每个参与者都提交本地事务；当某个参与者失败，就对前面已经成功的参与者逐个做补偿。正向服务与补偿服务**都由业务开发实现**。

### 2. 适用场景与优劣

| 维度 | 官方表述 |
|---|---|
| 适用 | 业务流程长、参与环节多 |
| 适用 | 参与者包含其他公司或遗留系统服务，无法提供 TCC 要求的三个接口 |
| 优势 | 一阶段提交本地事务、**无锁、高性能**；事件驱动、参与者可异步执行、高吞吐；补偿服务易于实现 |
| 缺点 | **不保证隔离性** |

"不保证隔离性"是 Saga 最需要写进设计文档的一句：中间状态对外可见，补偿是业务上的逆向操作，不是数据库层面的事务回滚。并发写同一资源时，需要业务自己加版本号、状态机或幂等控制。

## 七、四种模式怎么选

按"谁负责回滚"和"能忍多长的锁"两个维度做决策：

| 你的处境 | 建议模式 | 理由 |
|---|---|---|
| 全是 Spring + MySQL，改造成本优先 | **AT** | 注解 + 数据源代理即可，业务几乎不改 |
| 涉及 Redis、文件、第三方接口，需要业务级预占 | **TCC** | 不依赖底层资源事务，语义由业务定义 |
| 老系统已在用 XA，或数据库 AT 未适配 | **XA** | 迁移平滑、隔离性强 |
| 跨公司/遗留系统、流程长环节多、无法提供三个接口 | **Saga** | 一阶段即提交、无全局锁，靠补偿收口 |
| 对全局读一致性要求高，且用 AT | **AT + SELECT FOR UPDATE** | 官方提供的全局读已提交手段 |
| 链路并发高且事务很长 | 避开 **XA**；慎用 AT 全局锁 | 锁周期长会放大回滚与等待延迟 |

不要把"四种模式"理解成四个可随意替换的开关：它们对**业务代码侵入程度、锁生命周期、隔离性**的承诺完全不同，选型本质是这三项的取舍。

## 八、真实工程示例：下单链路的组合

一个典型商城下单链路可以这样组合：

| 环节 | 模式 | 原因 |
|---|---|---|
| 本库订单创建 + 本库库存扣减 | 本地事务 | 同一数据库，不需要分布式事务 |
| 跨库账户余额扣减 | AT | 两库都是 MySQL，改造成本低 |
| 优惠券核销（无本地事务资源） | TCC | 需要"冻结—确认—释放"业务语义 |
| 通知第三方物流 | Saga 或消息补偿 | 外部系统无法提供 TCC 三接口 |

```java
/**
 * 下单编排：本地事务处理同库操作，分布式事务只覆盖真正跨资源的部分。
 * 全局事务注解只打在编排入口，事务边界要尽量小。
 */
@GlobalTransactional
public OrderResult placeOrder(OrderCommand command) {
    // 1. 同库操作走本地事务，不必要地纳入全局事务只会放大锁竞争
    Order order = orderService.createLocal(command);

    // 2. 跨库余额扣减由 AT 分支代理，失败会触发全局回滚
    accountClient.debit(command.getUserId(), command.getAmount());

    // 3. 优惠券用 TCC：Try 阶段冻结，二阶段由全局事务驱动确认或释放
    couponTccAction.prepare(command.getCouponNo());

    return OrderResult.of(order.getId());
}
```

注意一个边界：如果第 2、3 步是**远程 HTTP 调用**，XID 不会自动传播，必须按前一节的 `RootContext` 方式在请求头里传递并在服务端绑定，否则远程分支根本不在这个全局事务里。

## 九、常见追问

**Q1：AT 会自动给所有 SELECT 加全局锁吗？**
不会。官方文档明确说明只代理 `SELECT ... FOR UPDATE`，这是性能取舍。

**Q2：`@GlobalTransactional` 和 `@Transactional` 冲突吗？**
不冲突，但职责不同：前者定义全局事务边界，后者定义本地事务边界。AT 的一阶段正是"业务数据与回滚日志在同一个本地事务中提交"。

**Q3：全局提交失败怎么办？**
它属于 `TransactionalTemplate` 的 `CommitFailure`，原始业务异常为空，但事务状态未知。可以用 `GlobalTransactionContext.reload(xid)` 重新载入实例、查询状态后再决定是否重试提交；官方说明该实例不允许再执行 `begin`。

**Q4：TCC 的 Try 失败，Cancel 还会执行吗？**
取决于 TC 判定的分支状态；正因可能出现"Try 未执行但 Cancel 到达"的空回滚，业务才必须自行识别并放行。

**Q5：Saga 能保证读已提交吗？**
不能，官方明确写"不保证隔离性"。需要强隔离就不要选 Saga。

**Q6：AT 的全局锁和数据库行锁是一回事吗？**
不是。行锁是数据库本地锁，一阶段提交后即释放；全局锁由 TC 维护，在全局事务结束前持有，用于防止跨事务的脏写。

## 十、踩坑清单

| 坑 | 后果 | 规避 |
|---|---|---|
| AT 数据源没被 `DataSourceProxy` 包装 | 分支未被代理，回滚失效 | 检查所有涉及分支的数据源配置 |
| 把 AT 默认隔离当作读已提交 | 读到其他全局事务未提交中间态 | 需要时用 `SELECT FOR UPDATE` |
| TCC 三个方法没做幂等 | 空回滚、悬挂、重复扣减 | 用业务唯一键做幂等控制 |
| XA 用在长事务高并发链路 | prepare 后长时间阻塞，吞吐骤降 | 缩短事务边界或改用 AT/TCC |
| 远程调用未传播 XID | 下游不进全局事务，出现数据不一致 | 显式传递并绑定 XID |
| 吞掉 `RollbackFailure` | 数据处于不确定状态却无告警 | 单独捕获、重试并告警 |
| Saga 中间态对外可见 | 状态机错乱、并发覆盖 | 业务层加版本号与状态约束 |
| `undo_log` 表未建或字段不全 | AT 一阶段写入失败 | 按官方 DDL 建表，含 `context` 字段 |

## 十一、最佳实践

1. **缩小全局事务边界**：只把真正跨资源的写操作纳入全局事务，旁路操作用 `RootContext.unbind()` 摘出去。
2. **显式记录 XID**：在日志 MDC 中带上 XID 与 Branch ID，出问题时可按全局事务串联调用链。
3. **二阶段幂等是硬要求**：TCC/Saga 的 Confirm、Cancel、补偿服务默认会被重复调用。
4. **给全局锁竞争设预算**：监控等锁时长与重试次数，超过阈值就缩短事务或拆分业务。
5. **失败分类处理**：按 `BeginFailure / CommitFailure / RollbackFailure / RollbackDone` 分流，只有 `RollbackDone` 可安全对外返回业务异常。
6. **区分"快照回滚"与"业务补偿"**：AT 的反向 SQL 是数据层回滚，Saga 的补偿是业务动作，语义不同，不要混用表述。
7. **版本对齐**：Seata 客户端与服务端版本、数据源代理模式（AT/XA）必须一致，升级前以对应版本官方文档为准。

## 十二、总结

- Seata 的四种模式共享 **TC/TM/RM + 两阶段 + XID** 的骨架，差别只在"分支怎么实现可回滚"。
- **AT**：前后镜像 + `undo_log` + 全局锁，低侵入；默认全局读未提交，写靠全局锁防脏写。
- **TCC**：`Try / Confirm / Cancel` 全靠手写，适合非事务资源与业务级预占；代价是空回滚、悬挂、幂等三座山。
- **XA**：数据库原生协议保障隔离，业务无侵入；代价是 `prepare` 后长阻塞、性能差。
- **Saga**：一阶段即提交、无锁高吞吐，适合长流程与外部系统；代价是**不保证隔离性**。
- 工程上真正决定成败的，是事务边界、XID 传播、二阶段幂等与失败分类处理——这些都与选哪种模式无关，但每种模式都绕不开。
