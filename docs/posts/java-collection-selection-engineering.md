---
title: Java 集合选型：List、Set、Map 的实现差异与复杂度取舍
date: 2026-10-14
category: 后端开发
cover: /covers/backend.svg
tags: [java, 集合, 数据结构, 复杂度, 性能]
excerpt: 集合选型不是背八股，而是三个问题的答案：要不要有序、要不要按 key 查、读多还是写多。ArrayList 与 LinkedList 的差距来自随机访问，HashSet 就是 HashMap 的键视图，ConcurrentHashMap 用分段无锁读换掉了全表锁。
---

# Java 集合选型：List、Set、Map 的实现差异与复杂度取舍

<img src="/images/posts/java-collection-selection-engineering-knowledge-map.png" alt="Java 集合选型：List、Set、Map 的实现差异与复杂度取舍知识串联图" style="border-radius: 10px;" />

集合选型不是背八股，而是三个问题的答案：要不要有序、要不要按 key 查、读多还是写多。ArrayList 与 LinkedList 的差距来自随机访问，HashSet 就是 HashMap 的键视图，ConcurrentHashMap 用分段无锁读换掉了全表锁。

## 先说结论：三问定结构

1. **是否按键查找？** 是 → `Map`；否 → `Collection`。
2. **是否允许重复、是否需要去重？** 需要去重 → `Set`；允许重复且有顺序 → `List`。
3. **并发还是单线程？** 多线程写 → 并发容器；读多写极少 → 写时复制。

剩下的是细节优化：要不要保持插入顺序、要不要排序、是否要限制容量。

## 一、完整分类：三大族与各自实现

### 1. List：有序、可重复、按索引访问

| 实现 | 底层 | 随机访问 | 头部插入 | 适用 |
|---|---|---|---|---|
| `ArrayList` | 动态数组 | O(1) | O(n) | 绝大多数场景的默认选择 |
| `LinkedList` | 双向链表 | O(n) | O(1) | 频繁头尾操作、当作双端队列 |
| `CopyOnWriteArrayList` | 数组 + 写时复制 | O(1) | O(n)，且复制整表 | 读远多于写的监听器列表 |
| `Vector` | 数组 + 全表锁 | O(1) | O(n) | 遗留类，不应在新代码使用 |

关键点：`ArrayList` 扩容为原容量的 1.5 倍并复制数组，已知规模时用 `new ArrayList<>(n)` 预分配；`LinkedList` 内存开销是每元素一个节点对象（含前后指针），缓存局部性差，**遍历性能通常不如 ArrayList**，不要因为"插入快"就默认选它。

### 2. Set：去重

| 实现 | 底层 | 顺序 | 复杂度 |
|---|---|---|---|
| `HashSet` | `HashMap` 的键视图 | 无序 | 增删查平均 O(1) |
| `LinkedHashSet` | `LinkedHashMap` | 插入顺序 | 平均 O(1)，多一条链表开销 |
| `TreeSet` | 红黑树 | 排序 | O(log n) |
| `CopyOnWriteArraySet` | 数组线性扫描 | 插入顺序 | 写 O(n)，读 O(n) 比较但无锁 |

`HashSet` 的 `add` 返回值表示"是否真的新增"，可直接用于去重判断，比 `contains` + `add` 两次查找更省。

### 3. Map：键值映射

| 实现 | 底层 | 顺序 | 并发 |
|---|---|---|---|
| `HashMap` | 数组 + 链表 + 红黑树 | 无序 | 不安全 |
| `LinkedHashMap` | HashMap + 双向链表 | 插入/访问顺序 | 不安全 |
| `TreeMap` | 红黑树 | 按 key 排序 | 不安全 |
| `ConcurrentHashMap` | 数组 + 链表/红黑树 + CAS/synchronized 桶 | 无序 | 安全 |
| `Hashtable` | 数组 + 全表锁 | 无序 | 安全但性能差，遗留类 |

`HashMap` 的关键参数：默认容量 16、负载因子 0.75、链表长度达 8 且容量 ≥ 64 时树化、退化阈值为 6。`LinkedHashMap` 构造参数 `accessOrder=true` 时按访问顺序排列，重写 `removeEldestEntry` 即可实现 LRU。

## 二、适用场景：把需求翻译成结构

| 需求 | 选择 |
|---|---|
| 存一批元素、按顺序遍历 | `ArrayList` |
| 频繁在两端增删（队列/栈） | `ArrayDeque`（优于 `LinkedList`） |
| 去重且不关心顺序 | `HashSet` |
| 去重且要保留插入顺序 | `LinkedHashSet` |
| 按 key 快速查找 | `HashMap` |
| 需要按 key 排序或范围查询 | `TreeMap` |
| 实现 LRU 缓存 | `LinkedHashMap(accessOrder=true)` |
| 多线程高并发读写 | `ConcurrentHashMap` |
| 多线程读多写极少 | `CopyOnWriteArrayList` |

## 三、真实示例：三种典型用法

```java
/**
 * 集合选型的三个典型场景：去重、LRU 缓存、并发计数。
 */
public class CollectionPatterns {

    /**
     * 去重并保序：LinkedHashSet 的 add 返回 false 表示已存在，
     * 一次操作同时完成"判断 + 插入"，比 contains + add 少一次查找。
     */
    public static List<String> distinct(List<String> input) {
        Set<String> seen = new LinkedHashSet<>(input.size());
        for (String item : input) {
            seen.add(item);
        }
        return new ArrayList<>(seen);
    }

    /**
     * 定长 LRU 缓存：LinkedHashMap 按访问顺序排列，
     * 超出容量时自动淘汰最久未访问的条目。
     */
    public static final class LruCache<K, V> extends LinkedHashMap<K, V> {

        private final int capacity;

        public LruCache(int capacity) {
            // initialCapacity 按容量换算，0.75 负载因子，accessOrder=true 走访问顺序
            super((int) Math.ceil(capacity / 0.75f) + 1, 0.75f, true);
            this.capacity = capacity;
        }

        /** 返回 true 时删除最老的条目；注意此方法在 put 过程中被调用 */
        @Override
        protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
            return size() > capacity;
        }
    }

    /**
     * 并发计数：用 computeIfAbsent + merge 保证原子性，
     * 不要用 containsKey 判断后再 put（中间存在竞态窗口）。
     */
    public static Map<String, Long> countByWord(List<String> words) {
        Map<String, Long> counter = new java.util.concurrent.ConcurrentHashMap<>();
        for (String word : words) {
            counter.merge(word, 1L, Long::sum);
        }
        return counter;
    }
}
```

注意 `LruCache` 本身不是线程安全的：作为单机缓存使用时要加锁或换 Caffeine；`Collections.synchronizedMap` 只是包一层 `synchronized`，高并发下会退化为串行。

## 四、常见追问

**问：`ArrayList` 和 `LinkedList` 到底怎么选？**
默认 `ArrayList`。只有在明确需要双端队列语义时才考虑 `ArrayDeque`；`LinkedList` 在随机访问、遍历、内存占用三项上都劣于数组结构，唯一优势是已知节点位置的头尾插删。

**问：`HashMap` 为什么容量是 2 的幂？**
索引用 `(n - 1) & hash` 取模，2 的幂能让位运算等价于取模，且扩容时元素要么留在原位、要么移动 2 的幂偏移，避免全量重算。

**问：`HashMap` 线程不安全的表现是什么？**
并发 `put` 可能丢数据、`size` 不准，JDK 8 之后不再出现成环死循环，但依然会丢更新。并发场景用 `ConcurrentHashMap`。

**问：`ConcurrentHashMap` 为什么不允许 null 键值？**
并发环境下无法区分"不存在"与"值为 null"，`get` 返回 null 会有二义性；这也是它不支持 `computeIfAbsent` 返回 null 的原因之一。

**问：`fail-fast` 是什么？**
集合的迭代器在检测到结构性修改（`modCount` 变化）时抛 `ConcurrentModificationException`，属于"尽早暴露 bug"的保护，不是并发安全机制。遍历中删除请用 `Iterator.remove` 或 `removeIf`。

**问：`TreeMap` 的 key 必须可比较吗？**
必须实现 `Comparable`，或构造时传入 `Comparator`；否则运行时抛 `ClassCastException`。

## 五、踩坑记录

- **用 `LinkedList` 做大量随机访问**：`get(i)` 变成 O(n)，循环里退化 O(n²)。
- **`ArrayList` 未预分配容量**：百万级元素反复扩容复制，启动耗时明显上升。
- **在 `foreach` 中 `remove`**：抛 `ConcurrentModificationException`，应改 `removeIf`。
- **`HashMap` 用可变对象作 key**：修改字段后 `hashCode` 变化，再也查不到。
- **`HashSet` 存可变对象**：去重失效或内存泄漏。
- **`Collections.synchronizedMap` 当高并发方案**：全表锁，吞吐随线程数下降。
- **`Arrays.asList` 返回定长列表**：`add`/`remove` 抛 `UnsupportedOperationException`。

## 六、选择建议

- **默认清单**：`ArrayList`、`HashMap`、`HashSet`、`ArrayDeque` 覆盖 90% 场景；
- **需要顺序**：`LinkedHashMap` / `LinkedHashSet`；
- **需要排序或范围查询**：`TreeMap` / `TreeSet`；
- **并发**：`ConcurrentHashMap` 优先，读多写极少再考虑 `CopyOnWriteArrayList`；
- **缓存**：`LinkedHashMap` 仅用于单机小规模演示，生产用 Caffeine（有容量、过期、统计）。

## 七、最佳实践清单

1. 已知规模时预分配 `ArrayList` 与 `HashMap` 容量；
2. 集合接口作为参数与返回值类型，实现作为局部细节；
3. 不在 `foreach` 中修改集合，用 `removeIf` 或迭代器；
4. 作 key 的对象保持不可变，或至少不修改参与 `hashCode` 的字段；
5. 并发场景禁止"先查后写"，改用 `computeIfAbsent`、`merge` 等原子方法；
6. 优先 `ArrayDeque` 而非 `LinkedList` 实现栈与队列；
7. 集合遍历性能敏感时用数组下标循环，避免迭代器与装箱开销。

## 总结

集合选型是需求与数据结构的映射：有序可重复用 `List`，去重用 `Set`，按键查用 `Map`；再叠加"是否保序、是否排序、是否并发"三个维度确定实现。真正的性能差异来自随机访问模式、扩容策略与锁粒度——记住这三点，比背复杂度表更有用。
