---
title: 组合模式工程实践：树形结构的统一处理、递归边界与性能治理
date: 2026-11-28
category: 后端开发
cover: /covers/backend.svg
tags: [java, 设计模式, 组合模式, 树形结构, 递归]
excerpt: 组合模式的本质是把“部分—整体”的层级结构收敛成一个统一接口，让调用方不必区分叶子和容器。真正难的不是写出递归，而是递归的边界：深度、环、共享节点、脏数据，以及树从数据库怎么来。
---

# 组合模式工程实践：树形结构的统一处理、递归边界与性能治理

<img src="/images/posts/java-composite-pattern-engineering-knowledge-map.png" alt="组合模式工程实践：树形结构的统一处理、递归边界与性能治理知识串联图" style="border-radius: 10px;" />

组合模式的本质是把“部分—整体”的层级结构收敛成一个统一接口，让调用方不必区分叶子和容器。真正难的不是写出递归，而是递归的边界：深度、环、共享节点、脏数据，以及树从数据库怎么来。

## 先说结论：组合模式解决的是“递归同构”，不是“树工具”

GoF 在 1994 年的定义是：将对象组合成树形结构来表示“部分—整体”的层次结构，使客户端对单个对象和组合对象的使用具有一致性（compose objects into tree structures to represent part-whole hierarchies；let clients treat individual objects and compositions of objects uniformly）。

这句话里有两个关键词，缺一不可：

- **树形结构**：业务模型本身就能表达成树，比如组织架构、商品套餐、菜单权限、审批链路、规则组；
- **一致性**：调用方只依赖一个接口，不需要 `instanceof` 判断“这是叶子还是容器”。

只有树、没有一致性，那只是普通的递归工具类；有一致性、但不是树，那是装饰器或责任链。**组合模式的价值不在“能递归”，而在于把递归的判断权从调用方转移到对象自己身上**——容器收到请求后自己往下转发，调用方永远只看到一层。

反过来，判断一个场景该不该用组合模式，只需问一句：**调用方是否真的需要“不区分地”处理单个节点和整棵子树？** 如果每个接口都明确知道自己在操作 SKU 还是套餐，那用普通的分层 Service 更清楚，硬套模式只会多一层抽象。

本文以 GoF《Design Patterns》（1994）对 Composite 的定义、Java 17 语言特性为事实基线，核对日期 **2026-11-28**。文中 Spring 相关内容只涉及构造器注入、单例 Bean 这类长期稳定行为，不绑定具体小版本。

## 一、四个角色，三条硬约束

很多人只记住“接口 + 叶子 + 容器”，实际结构是四个角色：

| 角色 | 职责 | 工程上的边界要求 |
| --- | --- | --- |
| Component（组件） | 声明叶子与容器的公共操作 | 只放“两者都说得通”的方法，不放容器专属方法 |
| Leaf（叶子） | 真正干活的最小单元，没有子节点 | 不实现 `add/remove`，也不假装实现 |
| Container（容器，即 Composite） | 持有子节点列表，把请求转发下去并汇总结果 | 只认 Component 类型，不认识具体子类 |
| Client（客户端） | 通过 Component 接口操作整棵树 | 不出现叶子或容器的具体类型 |

由此得到三条硬约束：

1. **子节点列表的元素类型必须是 Component**：写成 `List<Leaf>` 或 `List<Container>` 的那一刻，模式就退化成两套代码。
2. **容器只转发与汇总，不替子节点做业务判断**：容器里出现“如果子节点是促销品则……”，说明具体类型判断漏进了容器。
3. **叶子不感知父节点**：父引用只在需要“向上冒泡”时才加，且必须防止双向引用导致的环。

## 二、公认的两种实现：透明式与安全式

组合模式只有两种被广泛认可的实现方式，区别在于 `add`/`remove` 这些**结构操作方法声明在哪里**。

### 1、透明式：结构方法放在 Component

`Component` 里同时声明 `quote()` 和 `add()/remove()/getChild()`，叶子对这些方法给空实现或抛异常。

```java
/** 透明式组件：叶子与容器拥有完全相同的接口 */
public interface Node {
    /** 计算报价，叶子返回自身价格，容器递归汇总 */
    BigDecimal quote();

    /** 增加子节点：叶子没有子节点，只能抛异常 */
    default void add(Node child) {
        throw new UnsupportedOperationException("叶子节点不支持 add");
    }

    /** 移除子节点：同上 */
    default void remove(Node child) {
        throw new UnsupportedOperationException("叶子节点不支持 remove");
    }
}
```

优点是客户端完全不区分类型，`node.add(x)` 对任何节点都能编译通过；缺点是**违反了接口隔离原则**——叶子被迫携带自己用不上的方法，而且错误只能在运行时暴露。

### 2、安全式：结构方法只放在 Container

`Component` 只保留业务方法，`add/remove` 是容器自己的 API。

```java
/** 安全式组件：只声明叶子与容器都真正支持的业务方法 */
public interface PricedNode {
    /** 节点唯一标识，用于环检测与去重 */
    String nodeId();

    /** 计算该节点报价，容器内部递归汇总子节点 */
    BigDecimal quote(QuoteContext context);

    /** 子节点视图：叶子返回空列表，容器返回真实子节点 */
    default List<PricedNode> children() {
        return List.of();
    }
}
```

优点是编译期就能挡住“给叶子加子节点”；缺点是客户端要构造树时必须持有容器类型，无法完全统一。

### 3、怎么选

| 维度 | 透明式 | 安全式 |
| --- | --- | --- |
| 类型安全 | 差，错误推迟到运行时 | 好，编译期即拦截 |
| 客户端统一性 | 完全统一 | 构建阶段需区分容器 |
| 接口隔离 | 违反（叶子有空方法） | 遵守 |
| 适合场景 | 树结构由框架统一装配、客户端只做遍历 | 业务代码自己建树、强调可读性 |

工程上的常用折中是：**业务方法放 Component，结构方法放 Container，同时给 Component 一个 `children()` 默认返回空列表**。这样遍历代码依然可以只依赖 Component（统一性拿到了），而 `add/remove` 仍然是容器的专属能力（安全性也拿到了）。后文示例采用这个折中。

## 三、别把“组合模式”和“组合复用原则”混为一谈

这两个词在中文里都叫“组合”，但完全是两件事：

- **组合模式（Composite Pattern）**：结构型模式，讲的是树形结构与统一接口；
- **组合复用原则（Composition Over Inheritance）**：设计原则，讲的是优先用组合/聚合代替继承。

面试里被问到“组合模式是不是就是多用组合少用继承”，可以直接纠正：前者是对象结构问题，后者是复用方式问题，二者没有替代关系。组合模式内部当然也用了组合复用（容器持有 `List<Component>`），但那是实现手段，不是模式目的。

## 四、完整链路示例：电商套餐报价

业务背景：商品支持“单品”和“套餐”两种形态，套餐可以嵌套套餐（比如“家庭影音套装”里含“音响套装”）。运营需要看到每个套餐的原价、包装成本，以及整棵树的最终报价。

### 1、领域模型

- 叶子：单品 SKU，有自己的价格；
- 容器：套餐，有包装成本，报价 = 子节点报价之和 + 包装成本；
- 客户端：只调 `root.quote(context)`，拿到整棵树的总价。

### 2、Component 与递归上下文

```java
/** 递归上下文：一次报价过程中共享的巡视状态 */
public record QuoteContext(int maxDepth, Deque<String> path, Set<String> countedLeafIds) {

    /** 创建上下文：maxDepth 是业务允许的最大嵌套层级 */
    public static QuoteContext create(int maxDepth) {
        return new QuoteContext(maxDepth, new ArrayDeque<>(), new HashSet<>());
    }

    /** 当前路径上的深度，等于栈内节点数 */
    public int currentDepth() {
        return path.size();
    }
}
```

把 `path` 放进上下文而不是用方法参数层层传递，是为了让叶子也能参与环检测；`countedLeafIds` 用于处理“同一个 SKU 被挂到多个套餐下”的共享节点问题。

### 3、叶子：单品

```java
/** 叶子节点：单品 SKU，没有子节点，报价就是自身价格 */
public final class SkuNode implements PricedNode {

    private final String skuId;
    private final String name;
    private final BigDecimal price;

    public SkuNode(String skuId, String name, BigDecimal price) {
        this.skuId = skuId;
        this.name = name;
        this.price = price;
    }

    @Override
    public String nodeId() {
        return skuId;
    }

    @Override
    public BigDecimal quote(QuoteContext context) {
        // 叶子不做转发，直接返回自身价格；金额统一使用 BigDecimal
        return price;
    }

    @Override
    public String toString() {
        return "SkuNode{" + name + ", " + price + "}";
    }
}
```

### 4、容器：套餐

```java
/** 容器节点：套餐，可嵌套套餐，报价 = 子节点之和 + 自身包装成本 */
public final class BundleNode implements PricedNode {

    private final String bundleId;
    private final String name;
    /** 子节点只声明为 Component 接口，不认识具体是 SKU 还是套餐 */
    private final List<PricedNode> children = new ArrayList<>();
    /** 套餐自身的成本项，例如礼盒包装费 */
    private final BigDecimal packagingFee;

    public BundleNode(String bundleId, String name, BigDecimal packagingFee) {
        this.bundleId = bundleId;
        this.name = name;
        this.packagingFee = packagingFee;
    }

    /** 结构操作只暴露在容器上，叶子没有这个方法 */
    public BundleNode add(PricedNode child) {
        children.add(child);
        return this;
    }

    @Override
    public String nodeId() {
        return bundleId;
    }

    @Override
    public List<PricedNode> children() {
        return Collections.unmodifiableList(children);
    }

    @Override
    public BigDecimal quote(QuoteContext context) {
        // 1. 入栈前做环检测：同一路径上重复出现，说明数据里存在环形引用
        if (context.path().contains(bundleId)) {
            throw new IllegalStateException("套餐存在环形引用，节点=" + bundleId + "，路径=" + context.path());
        }
        // 2. 深度保护：脏数据可能造出极深的树，先挡住再谈性能
        if (context.currentDepth() >= context.maxDepth()) {
            throw new IllegalStateException("套餐嵌套超过上限 " + context.maxDepth() + "，节点=" + bundleId);
        }

        context.path().push(bundleId);
        try {
            BigDecimal total = BigDecimal.ZERO;
            for (PricedNode child : children) {
                // 容器只负责转发与累加，不判断子节点的具体类型
                total = total.add(child.quote(context));
            }
            return total.add(packagingFee);
        } finally {
            // 必须出栈，否则兄弟节点会被误判成环
            context.path().pop();
        }
    }

    @Override
    public String toString() {
        return "BundleNode{" + name + ", children=" + children.size() + "}";
    }
}
```

### 5、客户端：一次调用拿到整棵树的结果

```java
public class QuoteService {

    public BigDecimal quoteAll(PricedNode root) {
        // 单次调用即可遍历整棵树，客户端不关心层级与节点类型
        return root.quote(QuoteContext.create(8));
    }

    public static void main(String[] args) {
        BundleNode root = new BundleNode("B-ROOT", "家庭影音套装", new BigDecimal("20.00"));
        BundleNode audio = new BundleNode("B-AUDIO", "音响套装", new BigDecimal("10.00"));

        audio.add(new SkuNode("S-1", "回音壁", new BigDecimal("1999.00")));
        audio.add(new SkuNode("S-2", "低音炮", new BigDecimal("899.00")));

        root.add(new SkuNode("S-3", "投影仪", new BigDecimal("3299.00")));
        root.add(audio);

        BigDecimal total = new QuoteService().quoteAll(root);
        // 期望结果：3299 + 1999 + 899 + 10 + 20 = 6227.00
        System.out.println(total);
    }
}
```

注意 `QuoteService` 里没有出现任何 `instanceof`，也没有手写两层循环。嵌套层级增加时，这段客户端代码一行都不用改——这才是组合模式省下的维护成本。

## 五、树从数据库怎么来：一次查全量，内存建树

组合模式的示例代码总是从 `new BundleNode(...)` 开始，但真实项目里树是存库的，最常见的是邻接表（`id`、`parent_id`）。这里最容易踩的坑是**递归查库**：

```java
// 反例：每层递归都发一次 SQL，深度为 N 就是 N 次往返，宽树直接打爆连接池
List<Row> children = mapper.selectByParentId(nodeId);
```

正确做法是**一次查全量，内存建树**：

```java
/** 把扁平列表一次性组装成树，避免递归查库带来的 N+1 */
public static List<PricedNode> buildForest(List<PackageRow> rows, int maxDepth) {
    Map<String, PricedNode> nodeById = new HashMap<>();
    Map<String, String> parentOf = new HashMap<>();

    // 第一遍：创建所有节点，先不建立关系
    for (PackageRow row : rows) {
        PricedNode node = row.isBundle()
                ? new BundleNode(row.id(), row.name(), row.packagingFee())
                : new SkuNode(row.id(), row.name(), row.price());
        nodeById.put(row.id(), node);
        if (row.parentId() != null) {
            parentOf.put(row.id(), row.parentId());
        }
    }

    // 第二遍：挂接父子关系，父节点不存在的孤儿节点直接丢弃并记录告警
    List<PricedNode> roots = new ArrayList<>();
    for (PackageRow row : rows) {
        String parentId = parentOf.get(row.id());
        PricedNode self = nodeById.get(row.id());
        if (parentId == null) {
            roots.add(self);
            continue;
        }
        PricedNode parent = nodeById.get(parentId);
        if (!(parent instanceof BundleNode bundle)) {
            // 父节点不是套餐，或父节点已被删除：这是脏数据，不能静默挂到根上
            // 实际项目里此处用 Slf4j 打 warn 日志并上报监控，避免数据问题被掩盖
            continue;
        }
        bundle.add(self);
    }
    return roots;
}
```

三个要点：

1. **必须有“第二遍”**：先建节点再挂关系，顺序无关，最坏 O(n)；
2. **孤儿节点不能静默处理**：父 ID 不存在、父节点不是套餐，都属于数据问题，要打日志而不是默默塞到根上；
3. **全量查询要加范围**：`WHERE tenant_id = ? AND status = 'ENABLED'`，不要 `select *` 全表，树越大越危险。

## 六、递归的四个边界

递归写出来只要三行，但线上出问题几乎都在这四个边界上。

### 1、深度上限

JVM 的调用栈有限，树深到几百层就可能 `StackOverflowError`。业务上合理的套餐嵌套不会超过 3~5 层，所以**深度上限应该由业务规则给出**，并且和数据库的层级校验保持一致，而不是等异常发生。

### 2、环形引用

`A 包含 B，B 包含 A` 在邻接表里完全存得下，递归时就是死循环。用“当前路径”判断环（上文 `context.path().contains()`），比全局 `visited` 更准确：**全局 visited 会把合法的共享节点误判成环**。

### 3、共享节点

同一个 SKU 同时挂在“音响套装”和“家庭影音套装”下，是业务允许的。这时要明确报价语义：

- **按挂载次数计价**（组合商品常见）：不做去重，叶子被访问几次就算几次；
- **按唯一 SKU 计价**（去重促销常见）：用 `countedLeafIds` 做幂等，第二次访问返回 0。

两种都合理，但必须写进接口注释和产品文档。**最容易出事的是“以为去重了，其实没去重”**，报价多算一遍，对账时才发现。

### 4、空容器与脏数据

空套餐（没有任何子节点）应该返回 `packagingFee` 还是 0？这是业务决定，不是技术决定。工程上要做的是：为空容器单独打点，靠监控发现“创建了套餐却没配子商品”的运营问题，而不是让它在报价里安静地贡献 20 块包装费。

## 七、真实项目里的性能与一致性

组合模式是**结构**模式，它不解决性能，但会放大性能问题：一次 `quote()` 调用可能触碰成百上千个节点。

### 1、宽树比深树更危险

深度影响栈，宽度影响时间。一个 5000 个子节点的套餐，`quote()` 内部就是 5000 次方法调用加 5000 次 `BigDecimal.add`。如果每个叶子还要查一次库存或价格，就必须改成批量预取：**先在容器层收集所有叶子 ID，再一次性批量查询，最后回填**，而不是让叶子在自己的 `quote()` 里发远程调用。

### 2、缓存按根节点，失效按子树

整棵树的报价适合按根节点 ID 缓存，但失效不能只删根：任一子节点价格变动都会影响祖先链。两种做法：

- 缓存 key 里带上子树版本号（`rootId:version`），任一子节点变更时递增根版本；
- 或者只缓存叶子价格，树的汇总每次现算——汇总本身是内存计算，通常比缓存一致性更便宜。

### 3、金额一律 `BigDecimal`

`double` 在累加时会产生精度误差，树越深误差越明显。统一用 `BigDecimal`，并且明确 `setScale(2, RoundingMode.HALF_UP)` 的时机：**只在最终输出时舍入，中间过程保留完整精度**。

### 4、可变树与只读树分开

能 `add/remove` 的树适合运营后台，报价、导出、对账这类高频只读场景应该拿到不可变视图（`Collections.unmodifiableList` 或一次性快照），避免并发修改导致 `ConcurrentModificationException`。

## 八、常见追问

### 组合模式与装饰器模式有什么区别

结构图几乎一样，都是“持有同类型引用 + 递归”。区别在语义：**装饰器只有一个子节点，且是给子节点增加职责**；**组合模式有多个子节点，只做汇总，不改变子节点行为**。两者可以配合：给组合树里的某个节点套一层装饰器做埋点。

### 组合模式与责任链模式怎么配合

组合树里，叶子处理不了请求时可以沿父链向上传递，这正是责任链的形态。实现时给节点加 `parent` 引用即可，但要格外小心双向引用：**建树完成后才允许向上冒泡**，否则环检测会被父链干扰。

### 组合模式和迭代器、访问者是什么关系

组合负责“结构”，迭代器负责“怎么遍历”，访问者负责“在同一棵树上叠加新操作”。当树上要加第五种统计维度时，往 Component 里继续加方法会让所有叶子、容器都改一遍；此时用访问者把操作外置更合适。

### 递归一定会栈溢出吗

不一定，但**不能假设不会**。业务层级受控（≤5 层）时递归最直观；如果树的深度来自用户输入或外部数据，就应该改成显式栈遍历。

```java
/** 显式栈遍历：深树场景下不依赖 JVM 调用栈 */
public static List<String> collectLeafIds(PricedNode root) {
    List<String> leafIds = new ArrayList<>();
    Deque<PricedNode> stack = new ArrayDeque<>();
    stack.push(root);
    while (!stack.isEmpty()) {
        PricedNode current = stack.pop();
        if (current.children().isEmpty()) {
            // 没有子节点即视为叶子
            leafIds.add(current.nodeId());
            continue;
        }
        for (PricedNode child : current.children()) {
            stack.push(child);
        }
    }
    return leafIds;
}
```

注意这段代码没有处理环，因为它的前提是“树已经在建树阶段校验过”。**边界校验只做一次，放在建树入口**，遍历代码才能保持简单。

### 能不能直接用数据库的递归 CTE 代替

可以，而且数据量大时更合适：`WITH RECURSIVE` 在库内完成展开，避免把整棵树拉到应用内存。代价是 SQL 可移植性差、逻辑难测试、每次调整口径都要改 SQL。工程上的常见分工是：**结构简单的汇总走 CTE，需要复杂业务规则的报价走内存树**。

## 九、常见踩坑

1. **叶子强转容器**：客户端写 `((BundleNode) node).add(...)`，一旦传入单品就 `ClassCastException`，模式白用。
2. **透明式把 `add` 写成空实现**：调用方以为加成功了，实际数据被静默丢弃，比抛异常更难排查。
3. **共享子树被重复汇总**：同一棵子树挂到两个父节点下，报价翻倍，且很难从日志看出来。
4. **递归里查库**：树深 5 层、每层一次查询，接口 P99 直接翻倍。
5. **没有深度限制**：运营配置出错造出环或超深树，接口直接 500。
6. **用 `double` 算钱**：`0.1 + 0.2 != 0.3`，在多层汇总里误差被放大。
7. **只判一层做权限**：菜单树只校验当前节点、不校验祖先，越权访问就这样产生。

## 十、选择建议与最佳实践

- **先确认是树**：模型能自然表达成“部分—整体”再上组合模式，扁平列表硬造树只会增加复杂度。
- **接口只放共性方法**：结构操作方法留在容器，遍历入口用 `children()` 默认空实现兜住统一性。
- **边界校验前置**：深度、环、孤儿节点在建树阶段一次性校验，遍历与计算阶段假设数据合法。
- **一次查全量建树**：禁止递归查库；全量查询必须带租户与状态条件。
- **金额用 `BigDecimal`**：中间不舍入，输出时统一 `setScale`。
- **给树加可观测性**：节点数、最大深度、空容器数量、报价耗时，这四项能覆盖绝大多数线上问题。
- **结构变更留审计**：谁能改树、改了什么，比“树长什么样”更容易出事故。

## 十一、总结

组合模式只有一句话：**用统一接口把“一个”和“一堆”变成同一种东西**。它的代码量很小，价值全在边界上——

- 结构上，`Component` 统一接口、`Leaf` 干活、`Container` 转发；
- 实现上，透明式换统一性、安全式换类型安全，工程里通常各取一半；
- 落地时，真正的难点是树怎么来（一次查全量）、递归怎么停（深度与环）、结果怎么算对（共享节点与精度）。

把这三件事写清楚，组合模式才不是一个“背下来的设计模式”，而是能扛住运营乱配、数据脏乱的树形结构底座。

## 参考资料

- GoF《Design Patterns: Elements of Reusable Object-Oriented Software》，1994，Composite 章节
- refactoring.guru，Composite 模式的结构、适用性与模式关系：https://refactoring.guru/design-patterns/composite
- Java 17 API 文档：`java.util.ArrayDeque`、`java.util.Collections`、`java.math.BigDecimal`
