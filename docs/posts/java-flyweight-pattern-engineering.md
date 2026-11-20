---
title: 享元模式工程实践：内在状态共享与对象池边界
date: 2026-11-19
category: 后端开发
cover: /covers/backend.svg
tags: [java, 设计模式, 享元, 内存优化, 缓存]
excerpt: "享元模式把可共享的内在状态抽出来复用，把随场景变化的外在状态交给调用方传入，用查找开销换内存占用。它成立的前提是对象足够多且状态可分离；与对象池、单例的边界一旦搞混，就会变成串数据或内存泄漏。"
---

# 享元模式工程实践：内在状态共享与对象池边界

<img src="/images/posts/java-flyweight-pattern-engineering-knowledge-map.png" alt="享元模式工程实践：内在状态共享与对象池边界知识串联图" style="border-radius: 10px;" />

享元模式把可共享的内在状态抽出来复用，把随场景变化的外在状态交给调用方传入，用查找开销换内存占用。它成立的前提是对象足够多且状态可分离；与对象池、单例的边界一旦搞混，就会变成串数据或内存泄漏。

## 先说结论：拆分状态，共享不可变部分

享元（Flyweight）的核心动作只有一个：**把一个对象的"可共享部分"和"不可共享部分"拆开**。

- **内在状态（intrinsic）**：与上下文无关、可重复使用，存在享元对象里，必须**不可变**；
- **外在状态（extrinsic）**：随调用变化，由调用方在每次使用时传入，不进享元对象。

收益来自"实例数量从 N 降到 M（M ≪ N）"；成本是每次使用多做一次查找，以及一套缓存的生命周期管理。如果对象数量本来就不多，或者状态无法干净拆分，用享元只会增加复杂度。

## 一、完整分类：三种落地形态

### 1. 工厂 + 缓存池（经典形态）

用工厂方法按内在状态作为键查缓存，命中则复用，未命中才创建。缓存通常用 `ConcurrentHashMap` + `computeIfAbsent`，保证并发下只创建一次。

### 2. 预分配常量 / 枚举

把有限集合的内在状态做成常量或枚举实例，天然单例、零查找开销。适合"取值域已知且有限"的场景，例如订单状态、商品类目模板。

### 3. 语言/框架内置的享元

理解这些内置例子，比背定义有用得多：

| 内置例子 | 共享的是什么 | 注意点 |
|---|---|---|
| `Integer` 缓存（-128~127） | 小整数对象 | 超出范围 `==` 比较失效，必须用 `equals` |
| `String` 常量池 / `intern()` | 字符串实例 | `intern()` 会占用堆内串池，滥用会拖慢 |
| `Boolean.TRUE/FALSE` | 两个布尔实例 | 恒等比较安全 |
| 类元数据（元空间） | 每个类一份结构信息 | 由类加载器卸载时才释放 |
| `SimpleDateFormat` 复用 | **反例**：可变、非线程安全 | 共享可变对象是享元的典型误用 |

### 4. 与相邻模式的区别

| 模式 | 对象是否被独占 | 是否可变 | 目的 |
|---|---|---|---|
| 享元 | 多方共享同一实例 | 不可变 | 省内存 |
| 对象池（连接池、线程池） | 借出期间独占 | 可变 | 省创建/销毁成本 |
| 单例 | 全局唯一 | 通常无状态 | 全局访问点 |

数据库连接池不是享元：连接在借出期间被独占使用，状态（事务、会话）随使用变化。把连接池当享元理解，会得出"连接可以并发共用"的错误结论。

## 二、适用场景

- **同一结构被海量实例引用**：文档里重复的字符样式、地图瓦片元数据、棋盘棋子类型；
- **大对象、字段重复率高**：商品模板（标题模板、富文本骨架）被几十万个 SKU 引用；
- **渲染/导出类批处理**：单元格样式、字体度量对象；
- **反例**：对象少、生命周期短、状态几乎全随上下文变化——直接 new 更清晰。

## 三、真实示例：商品模板共享 + 外在状态外部化

```java
/**
 * 商品模板享元：内在状态（模板结构）不可变并全局共享，
 * 外在状态（SKU 的价格、库存）由调用方在渲染时传入。
 */
public final class ProductTemplate {

    /** 模板标识，作为享元缓存的键（内在状态的一部分） */
    private final String templateId;
    /** 模板骨架：不可变，所有引用该模板的 SKU 共用 */
    private final String skeleton;
    /** 默认类目路径，不可变 */
    private final String categoryPath;

    private ProductTemplate(String templateId, String skeleton, String categoryPath) {
        this.templateId = templateId;
        this.skeleton = skeleton;
        this.categoryPath = categoryPath;
    }

    /**
     * 渲染：外在状态全部通过参数传入，享元对象自身不保存任何 SKU 维度数据。
     */
    public String render(SkuView view) {
        return skeleton
                .replace("${title}", view.title())
                .replace("${price}", view.price())
                .replace("${stock}", view.stock())
                .replace("${category}", categoryPath);
    }

    public String templateId() {
        return templateId;
    }

    /** 外在状态载体：只读记录类，随每次渲染创建，不进入享元缓存 */
    public record SkuView(String title, String price, String stock) { }

    /**
     * 享元工厂：按 templateId 缓存模板实例，并发下只创建一次。
     * 生产实现应给缓存加容量上限或使用 Caffeine，避免无限增长。
     */
    public static final class Factory {

        private static final Map<String, ProductTemplate> POOL = new ConcurrentHashMap<>();

        private Factory() {
        }

        /** 按模板 ID 获取共享实例；loader 只在未命中时执行 */
        public static ProductTemplate of(String templateId,
                                         Function<String, ProductTemplate> loader) {
            return POOL.computeIfAbsent(templateId, loader);
        }

        /** 创建模板实例的推荐入口，集中校验，避免外部绕过不可变约束 */
        public static ProductTemplate create(String templateId, String skeleton, String categoryPath) {
            return new ProductTemplate(templateId, skeleton, categoryPath);
        }
    }
}
```

使用侧：

```java
// 同一个 templateId 拿到的是同一个实例，SKU 维度的数据只在 render 时传入
ProductTemplate template = ProductTemplate.Factory.of("phone-standard",
        id -> ProductTemplate.Factory.create(id, "<h1>${title}</h1><p>${price}</p>", "数码/手机"));
String html = template.render(new ProductTemplate.SkuView("某手机", "3999", "有货"));
```

如果模板骨架需要按租户动态生成，就不该进全局享元池：内在状态会随上下文变化，共享等于串数据。

## 四、常见追问

**问：享元和单例有什么区别？**
单例强调"全局唯一一个实例"，享元强调"同一种内在状态只有一个实例，但可以有多种状态、多个实例"。享元池里通常有很多个享元，每个都是一个"按状态区分的单例"。

**问：享元对象可以是可变的吗？**
不可以。共享可变对象意味着一个调用方的修改会影响其他调用方，这是最危险的一类并发缺陷。必须配套不可变设计（`final` 字段、防御性拷贝、`record`）。

**问：`Integer a = 127, b = 127; a == b` 为什么为 true？**
因为 `Integer` 缓存了 -128~127 的实例，自动装箱命中缓存返回同一对象。超出范围就是不同对象，所以比较值永远用 `equals`。这个例子说明享元对使用者的语义有可见影响。

**问：缓存池会不会反而更占内存？**
会。键的基数不可控时（例如按用户 ID 缓存模板），池会无限增长。必须给容量上限、TTL 或弱引用，并监控命中率。

**问：`String.intern()` 算享元吗？**
算，串池就是享元的经典实现。但 `intern()` 有成本：查表、可能的复制、串池本身占堆内存，且大量唯一字符串会让串池膨胀。只有重复率高的字符串才值得 `intern()`。

## 五、踩坑记录

- **共享对象里放了请求级字段**：两个请求互相覆盖数据，且很难复现。
- **缓存键用对象默认 `hashCode`**：每次都是新键，缓存永远不命中，还持续增长。
- **无上限缓存**：上线一周后堆内存缓慢上涨，最终 OOM。
- **把连接池/线程池当享元并发共用**：多个线程同时使用同一连接，事务互相污染。
- **共享 `SimpleDateFormat`**：格式化结果错乱或抛 `NumberFormatException`，是"共享可变对象"的经典事故。
- **用享元优化本来只有几百个实例的对象**：复杂度上升，收益为零。

## 六、选择建议

| 判断条件 | 结论 |
|---|---|
| 实例数万级、内在状态重复率高、完全不可变 | 适合享元 |
| 状态随上下文变化、需要独占（连接、事务） | 用对象池，不用享元 |
| 取值域有限且已知 | 用枚举/常量，比动态池更简单 |
| 需要回收、按访问热度淘汰 | 用 Caffeine 等缓存库，不要手写 `HashMap` 池 |

## 七、最佳实践清单

1. 享元对象设计成不可变：`final` 类、`final` 字段、`record`；
2. 外在状态通过方法参数传入，绝不写回享元对象；
3. 缓存键选稳定的业务标识，不用对象默认 `hashCode`；
4. 缓存必须有容量上限或过期策略，并监控命中率与池大小；
5. 并发创建用 `computeIfAbsent`，避免"检查-创建"竞态；
6. 共享前先问一句：这个状态会不会因调用方不同而不同？会就别共享；
7. 优化前后用堆直方图（`jmap -histo:live`）验证实例数真的下降了。

## 总结

享元模式的全部价值在于"把可共享的内在状态从海量实例中抽出来"，它要求对象不可变、状态可分离、基数可控。一旦跨到"借出期间独占"（连接池）或"共享可变状态"（`SimpleDateFormat`），得到的就是串数据与内存泄漏。用之前先算清实例数与重复率，用之后用堆直方图验证收益。
