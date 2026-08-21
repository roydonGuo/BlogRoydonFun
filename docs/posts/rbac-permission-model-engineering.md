---
title: RBAC 权限模型工程实践：角色继承、数据权限与高性能鉴权
date: 2026-08-21
category: 后端开发
cover: /images/posts/rbac-permission-model-engineering-knowledge-map.webp
tags: [rbac, authorization, spring-security, data-permission, java, security]
excerpt: RBAC 的核心不是给用户堆权限字符串，而是通过用户、角色、权限、会话和约束建立可治理的授权关系。本文讲清标准模型、表结构、请求鉴权、数据权限、缓存失效与 Spring Security 落地边界。
---

# RBAC 权限模型工程实践：角色继承、数据权限与高性能鉴权

<img src="/images/posts/rbac-permission-model-engineering-knowledge-map.webp" alt="RBAC 权限模型工程实践：角色继承、数据权限与高性能鉴权知识串联图" style="border-radius: 10px;" />

RBAC 的核心不是给用户堆权限字符串，而是通过用户、角色、权限、会话和约束建立可治理的授权关系。本文讲清标准模型、表结构、请求鉴权、数据权限、缓存失效与 Spring Security 落地边界。

## 先说结论：角色负责治理，权限负责判定

一次授权判断最终应回答：

```text
主体在当前租户和会话中，是否可以对这个对象执行这个操作？
```

角色只是连接用户与权限的管理层。业务代码应判断稳定、细粒度的权限，例如 `order:refund`，不要到处判断 `ROLE_FINANCE_MANAGER`。否则角色名称一改，或两个组织对同一角色的职责定义不同，业务代码就必须跟着修改。

一个可落地的 RBAC 系统至少需要做到：

- 用户通过角色获得权限，不直接散落大量用户—权限关系；
- 权限表达“资源 + 操作”，角色表达岗位职责；
- 每次请求重新执行服务端授权，前端隐藏按钮不是安全控制；
- 功能权限通过后，还要校验租户、归属人、部门或资源状态；
- 权限变更能及时使缓存和既有会话失效；
- 所有拒绝和高风险授权变更都可以审计。

本文以 NIST RBAC 标准、OWASP Authorization Cheat Sheet 与 Spring Security 7.0 文档为事实基线，核对日期为 2026-08-21。

## 标准 RBAC 不只有用户、角色、权限三张表

NIST RBAC 参考模型包含四个组件。存在公认分类时，应把它们完整区分：

| 组件 | 新增能力 | 工程用途 |
|---|---|---|
| Core RBAC | 用户—角色、角色—权限、会话激活角色 | 构成最小可用模型 |
| Hierarchical RBAC | 角色之间的偏序继承 | 复用公共职责，减少重复授权 |
| Static Separation of Duty | 用户不能同时被分配冲突角色 | 阻止同一人同时拥有申请与审批资格 |
| Dynamic Separation of Duty | 同一会话不能同时激活冲突角色 | 允许一人兼岗，但一次操作链只能选择一侧职责 |

Core RBAC 的关键集合与关系可以写成：

```text
U：用户集合
R：角色集合
P：权限集合，权限由 operation + object 构成
S：会话集合

UA ⊆ U × R：用户分配角色
PA ⊆ P × R：权限分配角色
```

会话不是可有可无的登录记录。一个用户可能拥有多个角色，但只在当前会话激活完成工作所需的子集。这个边界为最小权限和动态职责分离提供了落点。

### 角色继承要受控

`finance_manager` 继承 `finance_reader` 很自然，但继承关系应满足偏序：至少避免自环和环形继承。写入 `role_inherit` 前应做环检测，并限制继承深度。否则权限展开可能无限递归，也难以解释某项权限究竟从哪里获得。

不要把组织架构原样复制成角色树。部门上下级是管理关系，不必然代表权限继承；“华东区负责人”也不应自动获得华东区所有数据。角色层级解决权限复用，数据范围由另一套策略表达。

### 职责分离是约束，不是命名规范

静态职责分离可以禁止一个用户同时拥有 `PAYMENT_APPLICANT` 与 `PAYMENT_APPROVER`。动态职责分离则允许用户同时具备两个岗位资格，但在同一会话或同一业务实例中不能同时激活。

高风险业务还应增加基数约束，例如“一笔付款必须由两个不同主体完成提交与复核”。这已经超出单纯的角色判断，需要把操作者和审批状态写入业务数据。

## 权限命名：稳定到可以进入代码

权限建议使用 `resource:action`，必要时再增加限定动作：

| 权限码 | 含义 |
|---|---|
| `order:read` | 查看订单 |
| `order:create` | 创建订单 |
| `order:update` | 修改订单 |
| `order:cancel` | 取消订单 |
| `order:refund:apply` | 发起退款 |
| `order:refund:approve` | 审批退款 |

不要用 URL 直接充当权限。URL、HTTP 方法、消息消费者和定时任务都是入口，权限是稳定的业务能力。同一 `order:read` 可以同时保护 REST 查询、导出任务和内部服务方法。

也不要使用 `order:*` 作为数据库中的模糊授权规则，除非系统明确定义通配符语法、优先级和冲突处理。显式权限更容易审计；后台可以在选中角色模板时展开权限集合，而不是在运行时猜测通配符。

## 表结构：把关系、范围和版本拆开

最小关系模型通常包含：

| 表 | 关键字段 | 约束 |
|---|---|---|
| `user` | `id`、`tenant_id`、`status` | 用户状态参与认证与授权 |
| `role` | `id`、`tenant_id`、`code`、`status` | `(tenant_id, code)` 唯一 |
| `permission` | `id`、`code`、`resource`、`action` | `code` 全局稳定且唯一 |
| `user_role` | `user_id`、`role_id`、有效期 | 联合唯一，分配时检查职责分离 |
| `role_permission` | `role_id`、`permission_id` | 联合唯一 |
| `role_inherit` | `senior_role_id`、`junior_role_id` | 禁止自环与继承环 |
| `role_data_scope` | `role_id`、`resource`、`scope_type`、`scope_value` | 只保存结构化范围，不保存任意 SQL |
| `authz_subject_version` | `user_id`、`version` | 权限变更时递增，用于缓存失效 |

菜单可以绑定权限，但菜单不是权限。按钮可见性属于前端体验，服务端 `permission` 才是安全边界。删除菜单不能顺手删除权限，否则 API 可能在没有任何界面入口时失去保护。

多租户系统还必须明确角色归属。平台级角色和租户级角色最好使用不同命名空间或类型，禁止租户管理员把平台权限分配给自己的角色。

## 一次请求应该怎样完成鉴权

<img src="/images/posts/rbac-permission-model-engineering-authorization-chain.webp" alt="RBAC 请求鉴权链路图" style="border-radius: 10px;" />

推荐把判定拆成五步，任何一步失败都默认拒绝：

1. **认证主体**：验证 Token 或会话，得到可信 `userId`，不相信请求体自报身份；
2. **绑定上下文**：从受信来源确定 `tenantId`、会话激活角色和权限版本；
3. **检查功能权限**：判断是否拥有 `order:read` 等稳定权限；
4. **检查对象条件**：校验数据所属租户、归属人、部门、状态和业务约束；
5. **记录决策**：写入允许或拒绝、权限码、资源标识、规则版本和 traceId。

网关适合做 Token 验证、粗粒度路由保护和限流，但不能独占授权。下游服务知道真实业务对象与事务状态，必须在自己的信任边界再次校验。否则绕过网关的内部调用、消息消费或错误路由都可能成为越权入口。

OWASP 建议默认拒绝并在每次请求验证权限。不要因为前一请求已通过，就在本地变量或前端状态中永久复用结果。

## Spring Security：入口和服务方法做双层保护

Spring Security 的 `@EnableMethodSecurity` 可启用 `@PreAuthorize` 等方法级授权。业务权限使用 `hasAuthority`，避免 `hasRole` 默认前缀和岗位名称渗入领域代码：

```java
@Configuration
@EnableMethodSecurity
public class MethodSecurityConfig {
    // 注解启用即可，具体认证方式仍由项目的 SecurityFilterChain 配置
}

@Service
public class OrderService {

    private final OrderRepository orderRepository;
    private final OrderAuthorization orderAuthorization;

    public OrderService(OrderRepository orderRepository,
                        OrderAuthorization orderAuthorization) {
        this.orderRepository = orderRepository;
        this.orderAuthorization = orderAuthorization;
    }

    @PreAuthorize("hasAuthority('order:read')"
            + " and @orderAuthorization.canRead(authentication, #orderId)")
    public OrderDetail getOrder(long orderId) {
        // 服务层保护可以覆盖 HTTP、消息和内部调用等多个入口
        return orderRepository.findDetailById(orderId)
                .orElseThrow(() -> new OrderNotFoundException(orderId));
    }
}
```

对象级判断不要先查出订单再在控制器里比较租户。更稳妥的做法是让查询本身带上授权范围：

```java
@Component("orderAuthorization")
public class OrderAuthorization {

    private final OrderRepository orderRepository;

    public OrderAuthorization(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    public boolean canRead(Authentication authentication, long orderId) {
        RbacPrincipal principal = (RbacPrincipal) authentication.getPrincipal();
        // 查询条件同时绑定资源 ID、租户和主体范围，避免只按可猜测 ID 查询
        return orderRepository.existsReadableOrder(
                orderId,
                principal.tenantId(),
                principal.userId(),
                principal.departmentIds()
        );
    }
}
```

`@PostAuthorize` 能根据返回对象做所有者校验，但不适合先执行数据库写入再拒绝：拒绝发生时副作用可能已经产生。写操作应在修改前完成授权，并把授权查询与更新放进一致的事务边界。

## 数据权限：有功能权限，不等于能看所有行

<img src="/images/posts/rbac-permission-model-engineering-data-scope.webp" alt="RBAC 数据权限边界图" style="border-radius: 10px;" />

经典 RBAC 擅长回答“能不能执行某类操作”，不天然表达“能操作哪些对象”。工程系统通常在 RBAC 之上叠加数据范围：

| 范围 | 典型条件 | 注意点 |
|---|---|---|
| 本人 | `owner_id = currentUserId` | 创建人、负责人、归属人要明确 |
| 本部门 | `department_id IN currentDepartments` | 用户多部门、部门变更要有规则 |
| 本部门及下级 | 命中部门闭包表 | 不要每次递归整棵组织树 |
| 指定范围 | 角色关联部门、项目或区域 | 需要结构化关联表 |
| 本租户全部 | `tenant_id = currentTenantId` | 仍不能跨租户 |
| 平台全部 | 平台级受控主体 | 高风险，单独审计和强认证 |

数据范围不能由前端传一段 SQL，也不要把未经约束的 SpEL 或脚本存入数据库执行。应把范围建模成枚举与结构化参数，由后端编译成参数化查询条件。

列表查询必须在数据库层过滤，不能先查全量再用 Java `filter`；分页总数会错误，敏感数据也已经进入进程内存。详情、修改、删除和导出同样要带数据范围，避免只保护列表页。

如果一个用户通过多个角色获得不同范围，合并规则必须明确。常见做法是同一权限下取范围并集，但“平台全部”不能被普通租户角色意外授予；显式拒绝、敏感字段脱敏等规则还需要单独定义优先级。规则复杂到依赖资源属性、环境、时间和风险时，应考虑 RBAC + ABAC，而不是无限制造角色。

## 缓存：快不难，及时撤权才难

一次请求如果联表展开所有角色、继承和权限，成本和复杂度都会升高。常用做法是缓存主体的授权快照：

```text
authz:{tenantId}:{userId}:{version}
  -> activeRoles
  -> authorities
  -> dataScopes
```

`version` 是权限版本。以下变更发生时递增：

- 用户新增、移除或禁用角色；
- 角色新增、移除权限；
- 角色继承关系变化；
- 数据范围、租户归属或用户状态变化；
- 职责分离规则导致既有分配失效。

Token 中可以携带 `subjectVersion`，服务端把它与当前版本比较。版本不一致时拒绝或重新加载权限，避免长有效期 JWT 在撤权后继续使用。高风险系统还应使用短 Token、撤销列表或会话存储，而不是只等待过期。

不要只靠固定 TTL。十分钟缓存意味着最坏十分钟的越权窗口；发布权限变更事件也不能完全替代版本校验，因为消息可能延迟或丢失。事件用于主动清缓存，版本用于最终兜底。

为防止缓存击穿，可以按用户维度做单飞加载；缓存内容只保存权限码和结构化范围，不保存完整用户、菜单树或任意表达式。

## 管理端比鉴权代码更容易出事故

授权管理至少要有这些保护：

- 角色创建、权限分配、继承变更和用户授权全部审计；
- 高风险权限采用双人复核或审批流；
- 管理员只能分配自己可管理范围内的权限，不能越权授权；
- 展示权限来源：直接角色、继承角色、数据范围和有效期；
- 删除角色前检查用户、子角色和业务策略引用；
- 批量授权设置数量上限、幂等键和失败明细；
- 定期找出空角色、孤儿权限、长期未使用权限和冲突角色。

审计日志应记录操作者、被授权主体、变更前后、理由、请求来源和关联工单。只记录“修改角色成功”无法回答事后追责需要的“谁把哪个危险权限给了谁”。

## 常见失败设计

### 超级管理员写死为 userId = 1

用户 ID 是数据标识，不是权限。迁移、导入或多租户后这个假设会失效。平台管理员也应是受控角色，并经过强认证、审计和最小化授权。

### 只在网关鉴权

网关看不到订单归属和当前状态，也覆盖不了内部调用与消息入口。网关只能承担通用前置检查，资源级授权必须留在服务内。

### JWT 放入完整权限且长期有效

这样读取很快，但撤权困难、Token 体积膨胀，还会把内部权限结构暴露给客户端。Token 适合保存主体、租户、会话和权限版本，细粒度授权由服务端快照决定。

### 角色越建越细

“华东销售只读”“华东销售可导出”“华南销售只读”会形成角色爆炸。岗位职责放角色，地域、部门、对象状态等上下文放数据范围或 ABAC 条件。

### 返回 404 就等于修复越权

对无权资源返回 404 可以减少资源存在性泄露，但前提仍是执行了真实授权判断。只改变响应码不会阻止 IDOR。

## 落地检查清单

上线前至少确认：

1. 权限码稳定且服务端默认拒绝；
2. Core、继承、静态与动态职责分离的采用范围有文档；
3. 角色继承无环，冲突角色在分配和会话激活时受控；
4. 列表、详情、写入、导出都绑定租户与数据范围；
5. 网关、服务方法、异步入口没有只保护其中一条链路；
6. 撤权能通过版本或会话机制及时生效；
7. 管理员不能授予自己无权管理的权限；
8. 拒绝决策和高风险授权变更可审计、可追溯。

## 总结

RBAC 的价值是把“谁能做什么”从用户级配置提升为可治理的岗位模型。完整模型不止用户、角色和权限，还包括会话激活、角色继承、静态职责分离与动态职责分离。

工程落地时，角色用于组织权限，稳定权限码用于代码判定，数据范围限制对象集合，版本号解决缓存和撤权。网关做粗粒度保护，服务层结合真实资源再次判断；默认拒绝、每次校验和完整审计是不可省略的底线。

## 参考资料

- [NIST：Role Based Access Control](https://csrc.nist.gov/projects/role-based-access-control)
- [NIST：RBAC FAQ](https://csrc.nist.gov/Projects/role-based-access-control/faqs)
- [OWASP：Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [Spring Security 7.0：Method Security](https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html)
