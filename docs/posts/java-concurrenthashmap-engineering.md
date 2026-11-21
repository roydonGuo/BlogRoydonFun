---
title: ConcurrentHashMap 工程实践：桶级锁、分散计数与协助扩容
date: 2026-11-21
category: 后端开发
cover: /covers/backend.svg
tags: [java, concurrenthashmap, concurrency, juc, 并发容器]
excerpt: 以 OpenJDK 21 为基线，拆解 ConcurrentHashMap 的桶级 synchronized、CAS 空桶插入、ForwardingNode 协助扩容与 CounterCell 分散计数，并给出可直接落地的幂等去重、本地缓存与计数写法。
---

# ConcurrentHashMap 工程实践：桶级锁、分散计数与协助扩容

<img src="/images/posts/java-concurrenthashmap-engineering-knowledge-map.png" alt="ConcurrentHashMap 工程实践：桶级锁、分散计数与协助扩容知识串联图" style="border-radius: 10px;" />

以 OpenJDK 21 为基线，拆解 ConcurrentHashMap 的桶级 synchronized、CAS 空桶插入、ForwardingNode 协助扩容与 CounterCell 分散计数，并给出可直接落地的幂等去重、本地缓存与计数写法。

`ConcurrentHashMap` 的工程结论可以浓缩成四句话：它把锁粒度压到一个桶，而不是整张表；空桶写入用 CAS，不进入任何监视器；扩容由多个写线程分片协助搬迁；计数被拆到多个 `CounterCell`，避免所有线程争抢同一个字段。

业务代码里它常出现在本地缓存、请求幂等去重、接口调用计数、按 ID 聚合中间结果这些位置。真正出问题的往往不是 API 不会用，而是把 `get` + `put` 当成原子操作、在 `computeIfAbsent` 回调里改同一个 Map、把 `size()` 当精确值做对账，或者依赖遍历顺序。

> 本文以 **OpenJDK 21.0.10** 为基线，事实核对时间为 **2026-11-21**。公开行为来自 [Java SE 21 `ConcurrentHashMap` 文档](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html)；`sizeCtl` 编码、树化阈值、`transfer` 分片步长等属于 [OpenJDK 21u 的具体实现](https://github.com/openjdk/jdk21u/blob/master/src/java.base/share/classes/java/util/concurrent/ConcurrentHashMap.java)，不是 `ConcurrentMap` 接口对所有实现的长期承诺。

## 一、先说结论

| 问题 | 结论 |
|---|---|
| 锁在哪里 | 每个桶的头节点上，用 `synchronized` 锁住首节点对象，粒度是单个桶 |
| 空桶怎么插 | CAS 直接把新节点写进数组槽位，不加锁 |
| 读要加锁吗 | 不加锁，靠 `volatile` 读数组元素、`val`、`next` |
| 扩容谁做 | 触发扩容的线程先搬一部分，后续写入线程通过 `ForwardingNode` 加入协助 |
| 计数怎么算 | `baseCount` 加 `CounterCell[]` 数组，按线程探针分散累加，`sumCount()` 汇总 |
| `size()` 准吗 | 单线程或静止时准确；并发更新期间是估计值，官方文档明确说明 |
| 迭代会抛 `ConcurrentModificationException` 吗 | 不会，迭代器是弱一致快照语义 |
| 允许 `null` 吗 | Key 和 Value 都不允许，会直接抛 `NullPointerException` |

先记住一句话：`ConcurrentHashMap` 不是"给 `HashMap` 加一把大锁"，而是把"桶内结构变更"和"整表扩容"这两种冲突拆开处理。

## 二、整体结构与三类特殊节点

JDK 21 的 `ConcurrentHashMap` 主体是一个 `Node<K,V>[] table` 数组，数组下标仍由 `(n - 1) & spread(hash)` 决定，`spread` 把高 16 位异或到低位，容量保持 2 的幂。

普通节点与 `HashMap` 类似，但字段修饰不同：

```java
static class Node<K, V> implements Map.Entry<K, V> {
    final int hash;              // 定位用哈希，构造后不变
    final K key;                 // Key 不允许为 null，因此可以放心参与哈希
    volatile V val;              // 值用 volatile，保证读线程能看到最新写入
    volatile Node<K, V> next;    // 链表指针也用 volatile，支持无锁遍历
    // ...
}
```

`val` 和 `next` 的 `volatile` 是读路径无锁的前提：数组元素发布之后，读线程沿 `next` 一路走下去，能观察到已经发生的修改。

除了普通 `Node`，还有三类节点用**负数哈希**做类型标记，读路径靠这个标记快速分支：

| 节点 | 哈希标记 | 出现时机 | 作用 |
|---|---|---|---|
| `ForwardingNode` | `MOVED = -1` | 扩容搬迁时放在旧表的已完成槽位 | 指向 `nextTable`，让读写线程改去新表或加入搬迁 |
| `TreeBin` | `TREEBIN = -2` | 桶内节点数达到树化阈值 | 持有一棵红黑树的根和读写锁状态 |
| `ReservationNode` | `RESERVED = -3` | `computeIfAbsent` / `compute` 计算期间占位 | 让计算期间的空桶不被别的写线程抢插 |
| `Node` | 非负数 | 常规键值 | 链表节点 |

`TreeBin` 之所以不直接暴露树根，是因为树的旋转会改变根节点引用，锁不住"根"。把整棵树的入口固定成一个不变的 `TreeBin` 对象，桶锁才有稳定的加锁目标。

### 1. 常量边界

| 常量 | 值 | 含义 |
|---|---|---|
| `MAXIMUM_CAPACITY` | `1 << 30` | 数组长度上限 |
| `DEFAULT_CAPACITY` | `16` | 首次初始化容量 |
| `TREEIFY_THRESHOLD` | `8` | 链表长度达到该值尝试树化 |
| `UNTREEIFY_THRESHOLD` | `6` | 树节点数降到该值退回链表 |
| `MIN_TREEIFY_CAPACITY` | `64` | 表长度不足该值时优先扩容而不是树化 |
| `MIN_TRANSFER_STRIDE` | `16` | 扩容时每个线程至少领取的桶区间 |

树化阈值 8 和反树化阈值 6 之间留了缓冲区，避免长度在 7 附近抖动时反复在链表与树之间切换。

### 2. `sizeCtl`：一个字段承担四种含义

`sizeCtl` 是理解这张表的关键字段，它用正负号编码了不同状态：

| `sizeCtl` 取值 | 含义 |
|---|---|
| `0` | 尚未初始化，使用默认容量 |
| 正数，表已初始化 | 下一次扩容的元素数阈值，约为 `0.75 × 当前容量` |
| `-1` | 正在初始化表，其它线程需要让出 |
| 负数且小于 `-1` | 正在扩容，值为 `-(1 + 参与扩容的线程数)` |

因此你会看到 `if (sc < 0)` 就代表"别的线程正在扩容"，此时写线程不是傻等，而是先确认有没有空闲区间可以帮忙搬。

## 三、一次 `put` 的完整路径

`put` / `putIfAbsent` 最终都走 `putVal`。它的结构可以用"三种快路径 + 一种慢路径"概括：

```java
final V putVal(K key, V value, boolean onlyIfAbsent) {
    if (key == null || value == null) {
        throw new NullPointerException();      // 不允许 null，避免并发下 null 语义歧义
    }
    int hash = spread(key.hashCode());
    int binCount = 0;
    for (Node<K, V>[] tab = table;;) {         // 自旋直到写入成功
        Node<K, V> f; int n, i, fh; K fk; V fv;
        if (tab == null || (n = tab.length) == 0) {
            tab = initTable();                 // 懒初始化，sizeCtl 保证只有一个线程真正建表
        } else if ((f = tabAt(tab, i = (n - 1) & hash)) == null) {
            if (casTabAt(tab, i, null, new Node<K, V>(hash, key, value))) {
                break;                         // 空桶：CAS 直接放入，没有锁
            }
        } else if ((fh = f.hash) == MOVED) {
            tab = helpTransfer(tab, f);        // 正在扩容：加入搬迁，搬迁完回到新表继续
        } else {
            // 桶非空：锁住首节点，在桶内完成查找或插入
            synchronized (f) { /* ... */ }
        }
    }
    addCount(1L, binCount);                    // 计数与扩容检查
    return null;
}
```

拆开看有四条分支：

1. **表未初始化**：`initTable` 用 CAS 把 `sizeCtl` 从 0 改成 `-1`，抢到的线程按当前 CPU 规模决定初始容量，其它线程让出 CPU 后重试；
2. **目标桶为空**：一次 CAS 完成插入，这是并发写最常见的路径，也是它比"整表加锁"快的主要原因；
3. **桶头是 `ForwardingNode`**：说明这张表正在扩容，当前线程先去帮忙搬迁一段，再回到循环；
4. **桶内有普通节点或树**：`synchronized` 锁住头节点，在桶内做"先找后插"，命中相同 Key 就按 `onlyIfAbsent` 决定是否覆盖。

第 4 条分支里还有一个不进入锁的快路径：`onlyIfAbsent` 场景下，如果头节点就是要找的 Key 且值非空，直接返回旧值。这把"已存在就返回"的最热路径从锁里拿了出来。

### 1. 桶内结构变更的加锁范围

进入 `synchronized (f)` 之后会再确认一次 `tabAt(tab, i) == f`，因为等锁期间头节点可能已被替换（例如刚被树化或刚被搬走）。确认通过后才按节点类型分派：普通节点走链表，`TreeBin` 走 `putTreeVal`，`ReservationNode` 说明有线程正在计算同一个桶，此时抛出 `IllegalStateException("Recursive update")`。

### 2. 树化的两个前置条件

```java
if (binCount >= TREEIFY_THRESHOLD) {
    treeifyBin(tab, i);      // 内部再判断表长度
}
```

`treeifyBin` 会先看表长度：

```java
if ((n = tab.length) < MIN_TREEIFY_CAPACITY) {
    tryPresize(n << 1);      // 表太小，扩容比树化更划算
} else {
    // 真正把链表转成 TreeBin
}
```

结论是：**长度 8 只是"考虑树化"，真正树化还要求表长度不小于 64**。小表里频繁冲突，更可能是容量不足，扩容一次就能把冲突摊开。

## 四、扩容：多线程分片搬迁

扩容是这个类最值得读的一段。它要同时满足三件事：搬迁期间仍可读写、多个线程可以并行搬、搬完能平滑切换。

### 1. 触发条件与任务发布

`addCount` 累加计数后比较阈值，超过就进入 `transfer`：

```java
while (s >= (long) (sc = sizeCtl) && (tab = table) != null
        && (n = tab.length) < MAXIMUM_CAPACITY) {
    int rs = resizeStamp(n) << RESIZE_STAMP_SHIFT;
    if (sc < 0) {
        // 已在扩容：把 sizeCtl 减一，表示"我也加入"，然后一起搬
        if (sc == rs + MAX_RESIZERS || sc == rs + 1
                || (nt = nextTable) == null || transferIndex <= 0) {
            break;                    // 人满或没活了，退出
        }
        if (U.compareAndSetInt(this, SIZECTL, sc, sc + 1)) {
            transfer(tab, nt);
        }
    } else if (U.compareAndSetInt(this, SIZECTL, sc, rs + 2)) {
        transfer(tab, null);          // 第一个触发者：建新表并开始搬迁
    }
    s = sumCount();
}
```

`sizeCtl` 里的低位就是"参与线程数"的编码，`rs + 2` 表示 1 个线程（`rs` 是版本戳，`rs + 1` 留给"已建表但未开始"），后续每次 `sc + 1` 表示新增一个协作者，`MAX_RESIZERS` 限制协作上限。

### 2. 分片步长与 `transferIndex`

```java
int n = tab.length, stride;
if ((stride = (NCPU > 1) ? (n >>> 3) / NCPU : n) < MIN_TRANSFER_STRIDE) {
    stride = MIN_TRANSFER_STRIDE;     // 每个线程至少领 16 个桶，避免任务过碎
}
```

`transferIndex` 是一个从 `n` 递减到 0 的"任务指针"，每个线程用 CAS 抢走一段 `[transferIndex - stride, transferIndex)` 的区间。这样搬迁任务天然无锁分配，线程多了也不会撞车。

### 3. `ForwardingNode` 与搬迁标记

一个桶搬完后，旧表对应槽位会被替换成 `ForwardingNode`：

```java
ForwardingNode<K, V> fwd = new ForwardingNode<K, V>(nextTab);
boolean advance = true;
// ...
setTabAt(tab, i, fwd);   // 打上"已搬迁"标记，读线程看到它会转去新表
```

`ForwardingNode` 同时承担三个职责：告诉读线程去新表找、告诉写线程这个桶已搬完、告诉后来的扩容线程这里不用再搬。它的 `find` 方法直接在新表里查找，所以搬迁期间读操作不需要停。

### 4. 高低位拆分

容量翻倍后，一个旧桶的节点只会分到新表的两个位置：`i` 或 `i + n`。判断依据是哈希值与旧容量做按位与：

```java
if ((ph & n) == 0) {
    // 低位链：留在原下标 i
} else {
    // 高位链：搬到 i + n
}
```

这个拆分不重新计算哈希，只是把一条链切成两条，顺序保持不变。JDK 8 之后不再对节点重新哈希，比 JDK 7 的 `rehash` 更省 CPU，也避免了并发下重排导致的环。

## 五、读路径为什么完全无锁

`get` 的代码极短，但每一步都在回答"为什么不需要锁"：

```java
public V get(Object key) {
    Node<K, V>[] tab; Node<K, V> e, p; int n, eh; K ek;
    int h = spread(key.hashCode());
    if ((tab = table) != null && (n = tab.length) > 0
            && (e = tabAt(tab, (n - 1) & h)) != null) {     // volatile 读槽位
        if ((eh = e.hash) == h) {
            if ((ek = e.key) == key || (ek != null && key.equals(ek))) {
                return e.val;                              // 头节点命中，一次读就返回
            }
        } else if (eh < 0) {
            return (p = e.find(h, key)) != null ? p.val : null;  // 转发节点或树节点自行处理
        }
        while ((e = e.next) != null) {                     // 沿 volatile next 遍历链表
            if (e.hash == h && ((ek = e.key) == key || (ek != null && key.equals(ek)))) {
                return e.val;
            }
        }
    }
    return null;
}
```

三个关键点：

1. `tabAt` 用 `volatile` 语义读数组元素，能看到其它线程已经发布的桶；
2. `Node.val` 是 `volatile`，覆盖写入对读线程立即可见；
3. 遇到负数哈希就交给节点自己的 `find`：`ForwardingNode` 转去新表，`TreeBin` 尝试加读锁走树查找，**拿不到读锁时退化为沿 `next` 链表遍历**，因此绝不会阻塞。

这也解释了一个常见误解：树化之后读操作并不是"必须拿锁"，只是有机会走 O(log n) 的树查找。

## 六、计数为什么不用 `AtomicLong`

如果所有写线程都对同一个 `AtomicLong` 做 CAS，高并发下失败重试会形成热点，这和"桶级锁"的初衷矛盾。JDK 8 之后的计数方案是 `baseCount` + `CounterCell[]`：

```java
private transient volatile long baseCount;                 // 无竞争时的快路径
private transient volatile int cellsBusy;                  // 建/扩 cells 数组的自旋锁
private transient volatile CounterCell[] counterCells;     // 竞争时按线程分散累加

private final void addCount(long x, int check) {
    CounterCell[] cs; long b, s;
    if ((cs = counterCells) != null
            || !U.compareAndSetLong(this, BASECOUNT, b = baseCount, s = b + x)) {
        // 没竞争时一次 CAS 就完成；有竞争则转入分散累加
        CounterCell c; long v; int m;
        boolean uncontended = true;
        if (cs == null || (m = cs.length - 1) < 0
                || (c = cs[ThreadLocalRandom.getProbe() & m]) == null
                || !(uncontended = U.compareAndSetLong(c, CELLVALUE, v = c.value, v + x))) {
            fullAddCount(x, uncontended);                  // 槽位冲突或数组未初始化，走完整路径
            return;
        }
    }
    // check >= 0 时顺便检查是否需要扩容
}
```

思路和 `LongAdder` 一致：线程按探针落到不同的 `CounterCell`，各自 CAS，最后 `sumCount()` 把所有格子加起来。

后果有两个必须记住的工程含义：

- `size()` 与 `mappingCount()` 在并发更新时只是**估计值**，官方文档用词是 estimate，不能拿它做资金对账或严格限流；
- `size()` 有 `int` 上限保护（超过 `Integer.MAX_VALUE` 截断），大表要用 `mappingCount()` 返回 `long`。

## 七、从 JDK 7 到 JDK 8+：分段锁到桶级锁

老资料里常见的"分段锁"描述的是 JDK 7 的结构：

| 维度 | JDK 7 | JDK 8 及以后（含 21） |
|---|---|---|
| 并发单元 | `Segment[]`，每个 `Segment` 继承 `ReentrantLock` | 每个桶的头节点，用 `synchronized` |
| 锁粒度 | 一个 Segment 管若干桶（默认 16 段） | 一个桶一把锁 |
| 哈希定位 | 先定位段，再段内定位桶（两次哈希） | 一次哈希直接定位桶 |
| 扩容 | 段内独立扩容，段间不协作 | 全表扩容，多线程分片协作 |
| 计数 | 段内 `count` 求和 | `baseCount` + `CounterCell[]` |
| 冲突结构 | 链表 | 链表 + 红黑树 |

JDK 8 之后 `concurrencyLevel` 参数仍然保留，但语义已经变成"容量估计提示"：构造时会取 `max(initialCapacity, concurrencyLevel)` 参与容量计算，不再决定段数。这一点是常见八股误区。

另外，构造时的容量换算也不是简单的 1.5 倍：

```java
long size = (long) (1.0 + (long) initialCapacity / loadFactor);
int cap = tableSizeFor((int) size);
```

按默认 `loadFactor = 0.75` 计算，传入 100 会得到 `tableSizeFor(134)` 即 256，而不是 128。要精确控制桶数，可以自己按这个公式估算，或者干脆依赖 `new ConcurrentHashMap<>(expectedSize)` 的内部换算。

## 八、原子复合操作与递归更新陷阱

`ConcurrentHashMap` 保证**单个方法**原子，不保证"你写的多个方法组合"原子。下面这段是典型错误：

```java
// 错误：get 与 put 之间存在竞态窗口
if (cache.get(key) == null) {
    cache.put(key, load(key));   // 两个线程可能都判定为空，后写覆盖先写
}
```

正确做法是使用 JDK 8 起提供的原子复合方法：

| 方法 | 语义 | 典型用途 |
|---|---|---|
| `putIfAbsent` | 不存在才放，返回旧值 | 幂等去重、单例式初始化 |
| `computeIfAbsent` | 不存在才计算并放入，回调内不持锁但占位 | 本地缓存加载 |
| `compute` | 基于旧值计算新值，返回 `null` 表示删除 | 带过期的刷新、状态机迁移 |
| `merge` | 旧值存在则按函数合并，否则放入给定值 | 计数、累加、分组聚合 |
| `replace(k, old, new)` | 旧值匹配才替换 | CAS 风格的乐观更新 |
| `remove(k, v)` | 键值都匹配才删除 | 安全释放占用标记 |

### 1. `computeIfAbsent` 的内部约定

官方文档写得很直接：**计算期间，其它线程对同一个桶的更新可能被阻塞，所以计算必须短小**；同时 **mapping function 不得在计算期间修改这个 Map**。

实现上是用 `ReservationNode` 占住空桶：

```java
Node<K, V> r = new ReservationNode<K, V>();
synchronized (r) {
    if (casTabAt(tab, i, null, r)) {      // CAS 占位，别的写线程看到 RESERVED 就知道有人在算
        Node<K, V> node = null;
        try {
            if ((val = mappingFunction.apply(key)) != null) {
                node = new Node<K, V>(h, key, val);
            }
        } finally {
            setTabAt(tab, i, node);       // 无论成功失败都要把占位替换掉，异常也不能留坑
        }
    }
}
```

如果在 `mappingFunction` 里再往同一个 Map 写数据，命中同一个桶就会抛 `IllegalStateException("Recursive update")`；没命中也可能死锁或被阻塞。要写多个键，先把结果算出来，出了回调再写。

### 2. `merge` 的返回值陷阱

```java
// 累加成功返回合并后的新值；但如果 value 为 null 且旧值不存在，返回 null
Long merged = counters.merge(api, 1L, Long::sum);
```

`merge` 的 `value` 不允许为 `null`（会抛 NPE），而 `compute` 的返回值允许为 `null`（表示删除映射）。这两个差异决定了"删除"语义该用哪个方法。

## 九、一致性语义：弱一致、快照与顺序

| 语义 | 具体表现 | 工程含义 |
|---|---|---|
| 迭代器 | 弱一致，不抛 `ConcurrentModificationException` | 遍历期间可以有并发写入，看到的不一定是同一时刻的全集 |
| `size()` / `mappingCount()` | 并发更新期间是估计值 | 监控指标可以，业务判定不行 |
| `forEach` / `search` / `reduce` | 批量操作，接受 `parallelismThreshold` 参数 | 适合汇总统计，函数应无副作用且不依赖顺序 |
| 批量操作的 `Map.Entry` | 不支持 `setValue` | 想改值必须回到 Map 接口方法 |
| 遍历顺序 | 没有任何顺序保证 | 需要顺序用 `ConcurrentSkipListMap` 或额外排序 |

注意"弱一致"不等于"脏读"。单个 Key 的 `get` 看到的一定是某次完整写入的值，不会看到半个节点，因为节点发布通过 CAS 或 `volatile` 完成。弱一致说的是**跨 Key 的整体视图**不保证是同一时刻的快照。

## 十、并发容器选型

| 容器 | 并发模型 | 读 | 写 | 适用场景 |
|---|---|---|---|---|
| `HashMap` | 无并发保证 | 快 | 快 | 单线程或方法内局部变量 |
| `Collections.synchronizedMap` | 整表一把锁 | 需要锁 | 需要锁 | 并发极低、改造存量代码 |
| `Hashtable` | 方法级 `synchronized` | 需要锁 | 需要锁 | 遗留代码，新项目不建议 |
| `ConcurrentHashMap` | 桶级锁 + CAS | 无锁 | 桶级锁 | 高频读写共享映射、本地缓存、去重 |
| `ConcurrentSkipListMap` | 跳表 + CAS | 无锁 | 无锁（局部） | 需要按 Key 有序、范围查询 |
| `CopyOnWriteArrayList` | 写时复制 | 无锁 | 全量复制 | 读多写极少，如监听器列表 |
| `ConcurrentLinkedQueue` | CAS 链表 | 无锁 | 无锁 | 无界并发队列，如任务缓冲 |

选型的判断顺序应该是：**要不要顺序 → 要不要并发 → 读写比例 → 数据规模**，而不是"并发就用 ConcurrentHashMap"。

## 十一、真实工程示例

### 1. 请求幂等去重

```java
import java.util.concurrent.ConcurrentHashMap;

/**
 * 请求幂等守卫：同一 requestId 只允许一个线程拿到处理权。
 * 适用于单机内的快速去重，跨节点请配合 Redis SETNX 等分布式方案。
 */
public final class RequestIdempotentGuard {

    // key 为 requestId，value 为首次到达时间，用于后续过期清理
    private final ConcurrentHashMap<String, Long> processed = new ConcurrentHashMap<>();
    private final long ttlMillis;

    public RequestIdempotentGuard(long ttlMillis) {
        this.ttlMillis = ttlMillis;
    }

    /**
     * 尝试获取处理权。
     *
     * @return true 表示首次到达，由当前线程处理；false 表示已被处理或正在处理
     */
    public boolean tryAcquire(String requestId) {
        long now = System.currentTimeMillis();
        // putIfAbsent 的判空与写入在同一个桶锁内完成，无需外层再加锁
        return processed.putIfAbsent(requestId, now) == null;
    }

    /**
     * 处理失败时释放占位，允许重试；用 remove(k, v) 避免误删别人的记录。
     */
    public void release(String requestId, long acquiredAt) {
        processed.remove(requestId, acquiredAt);
    }

    /**
     * 清理过期记录。实际项目里应由定时任务低频调用，避免遍历成本堆在请求线程。
     */
    public void evictExpired() {
        long deadline = System.currentTimeMillis() - ttlMillis;
        // 弱一致遍历：并发写入不会抛异常，也不需要额外加锁
        processed.entrySet().removeIf(entry -> entry.getValue() < deadline);
    }
}
```

要点：`putIfAbsent` 返回 `null` 才是抢到；`remove(k, v)` 带值比较，避免"我的记录已被别人替换却删掉了别人的"。

### 2. 接口维度计数

```java
import java.util.concurrent.ConcurrentHashMap;

/**
 * 接口调用计数器：单机内存计数，供监控埋点或本地限流参考。
 */
public final class ApiCounter {

    private final ConcurrentHashMap<String, Long> counters = new ConcurrentHashMap<>();

    /**
     * 记录一次调用。merge 在桶锁内完成累加，不会出现丢失更新。
     */
    public void hit(String api) {
        // 旧值存在则累加，不存在则以 1L 初始化
        counters.merge(api, 1L, Long::sum);
    }

    /**
     * 读取当前计数，返回的是瞬时值，不作为精确对账依据。
     */
    public long snapshot(String api) {
        Long value = counters.get(api);
        return value == null ? 0L : value;
    }
}
```

如果这里换成 `counters.put(api, counters.getOrDefault(api, 0L) + 1)`，高并发下必然丢计数：两个线程读到同一个旧值，后写的覆盖前写的。

### 3. 带过期的本地缓存

```java
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

/**
 * 带 TTL 的本地缓存示例：演示 compute 的锁内二次检查与 null 语义。
 */
public final class TtlLocalCache<K, V> {

    // 缓存条目：值 + 绝对过期时间戳
    private record CacheEntry<V>(V value, long expireAt) {
    }

    private final ConcurrentHashMap<K, CacheEntry<V>> store = new ConcurrentHashMap<>();
    private final long ttlMillis;

    public TtlLocalCache(long ttlMillis) {
        this.ttlMillis = ttlMillis;
    }

    /**
     * 读取缓存，未命中或已过期时通过 loader 回源。
     * 注意：loader 内部不能修改 store，否则可能触发 Recursive update。
     */
    public V get(K key, Function<K, V> loader) {
        CacheEntry<V> current = store.get(key);
        if (current != null && current.expireAt() > System.currentTimeMillis()) {
            return current.value();      // 命中且未过期，直接返回，不进入任何锁
        }
        // compute 在桶锁内执行，可安全做"再次检查 + 回源"；返回 null 表示不缓存该结果
        CacheEntry<V> updated = store.compute(key, (k, old) -> {
            long now = System.currentTimeMillis();
            if (old != null && old.expireAt() > now) {
                return old;              // 其它线程刚好刷新完成，直接复用
            }
            V loaded = loader.apply(k);
            return loaded == null ? null : new CacheEntry<>(loaded, now + ttlMillis);
        });
        return updated == null ? null : updated.value();
    }

    /**
     * 主动失效，用于配置变更后清空某个 Key。
     */
    public void invalidate(K key) {
        store.remove(key);
    }
}
```

`compute` 的锁内二次检查是关键：多个线程同时未命中时，只有第一个会真正回源，后面的直接复用刚写入的结果，避免缓存击穿。

### 4. 分组合并结果

```java
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.LongAdder;

/**
 * 商品销量聚合：演示 computeIfAbsent 只负责"缺失时创建容器"。
 */
public final class SkuSalesCounter {

    // 容器本身必须线程安全，否则 computeIfAbsent 之后的 add 仍然是竞态
    private final ConcurrentHashMap<Long, LongAdder> skuSales = new ConcurrentHashMap<>();

    /**
     * 累加某个 SKU 的销量。
     *
     * @param skuId 商品 ID
     * @param qty   本次数量
     */
    public void add(long skuId, long qty) {
        // lambda 里只创建自己的累加器，绝不回头修改 skuSales
        skuSales.computeIfAbsent(skuId, k -> new LongAdder()).add(qty);
    }

    /**
     * 读取某个 SKU 的累计销量，不存在时返回 0。
     */
    public long get(long skuId) {
        LongAdder adder = skuSales.get(skuId);
        return adder == null ? 0L : adder.sum();
    }
}
```

这里有个容易忽略的点：`computeIfAbsent` 只保证"创建容器"这一步原子，**容器内部的修改要靠容器自己保证线程安全**。把 `ArrayList` 塞进 `computeIfAbsent` 是常见错误，因为后续 `add` 依然是竞态。也可以用 `merge` 配合 `Long::sum`，效果等价且更短。

## 十二、常见坑

| 坑 | 现象 | 正解 |
|---|---|---|
| 先 `get` 再 `put` | 并发下覆盖别人写入 | 用 `putIfAbsent` / `compute` / `merge` |
| 在 `computeIfAbsent` 里改同一个 Map | `IllegalStateException: Recursive update`，或线程卡住 | 回调只做纯计算，写完再操作 Map |
| 用 `size()` 做精确判断 | 并发下数量漂移，限流误判 | 用 `LongAdder` 或 `mappingCount()` 并接受估计值 |
| 依赖遍历顺序 | 输出顺序随机，测试偶发失败 | 需要顺序用 `ConcurrentSkipListMap` 或排序后输出 |
| 用可变对象当 Key | 哈希变化后 `get` 不到 | Key 必须不可变，`equals` / `hashCode` 一起审查 |
| 以为迭代器有快照 | 遍历期间数据变化导致业务异常 | 需要一致视图就复制一份 `new ArrayList<>(map.values())` |
| 缓存无限增长 | 内存持续上涨直至 OOM | 设置 TTL 清理、容量上限或换成 Caffeine |
| 用 `null` 表示"不存在" | 直接抛 `NullPointerException` | 用 `Optional`、哨兵对象或 `containsKey` 区分 |

最后一条要展开说：`ConcurrentHashMap` 禁止 `null`，正是为了避免"`get` 返回 `null` 到底是不存在还是存了 `null`"这种在并发下无法区分的歧义。`HashMap` 允许 `null`，所以从 `HashMap` 迁移过来时最容易踩这个坑。

## 十三、最佳实践

1. **能用原子复合方法就不要手写 `get` + `put`**，`compute` / `merge` / `putIfAbsent` 已经把"判空 + 写入"放进同一个桶锁；
2. **回源逻辑放在 `compute` 外面准备数据，`compute` 内只做二次检查与赋值**，避免长耗时计算阻塞同桶写入；
3. **Key 用不可变对象**，record 或 `final` 字段类，`equals` 与 `hashCode` 同步维护；
4. **容量预估用 `new ConcurrentHashMap<>(expectedSize)`**，让它按 `1 + size / 0.75` 换算，减少运行期扩容；
5. **不要把 `size()` 当精确值**，做监控指标可以，做业务判断需要额外机制；
6. **本地缓存必须有淘汰策略**，TTL、容量上限或成熟库（Caffeine），不要指望 GC 帮你兜底；
7. **跨节点一致性交给 Redis 等外部组件**，`ConcurrentHashMap` 只能保证单 JVM 内；
8. **升级 JDK 时重新核对实现细节**，8、6、64、16 这些数字是 OpenJDK 21 的取值，不是接口契约。

## 十四、常见追问

**Q：为什么读不加锁还能保证可见性？**
`table` 数组元素通过 `volatile` 语义的 `tabAt` 读取，`Node.val` 与 `Node.next` 都是 `volatile` 字段。写线程把节点挂上链或替换槽位后，读线程下一次读取就能看到。读到正在搬迁的桶时，`ForwardingNode` 会把查询转去新表。

**Q：`sizeCtl` 为什么要编码成负数？**
一个 `int` 同时表达"是否初始化""是否扩容""多少个线程在搬""下次扩容阈值"，省掉了额外状态字段，也让 CAS 一次就能完成状态迁移。

**Q：扩容时新写入的节点会被丢掉吗？**
不会。扩容期间写线程要么发现桶头是 `ForwardingNode` 而去新表写，要么在当前桶完成写入后由搬迁逻辑一并搬走。`transfer` 对每个桶都加了 `synchronized (f)`，保证"搬迁"和"桶内写入"互斥。

**Q：`computeIfAbsent` 会不会阻塞其它线程？**
会，但范围限于同一个桶。计算期间别的线程写同一个桶会被阻塞或抛 `IllegalStateException`，所以官方要求计算短小。这也是"回源慢查询不要直接放 `computeIfAbsent`"的原因。

**Q：既然有 `ConcurrentHashMap`，还需要 `synchronized` 吗？**
需要。复合业务逻辑（例如"扣库存 + 写流水"）依然要事务或锁保护，`ConcurrentHashMap` 只保证单个 Map 操作的原子性。

## 十五、总结

`ConcurrentHashMap` 的设计可以归纳成四个解耦：

- **锁粒度解耦**：桶级 `synchronized` 替代整表锁，空桶插入走 CAS 完全不进锁；
- **读写解耦**：读路径只依赖 `volatile`，搬迁期间通过 `ForwardingNode` 转向新表；
- **扩容与线程解耦**：`transferIndex` + 分片步长让多个写线程并行搬迁，谁触发谁先干；
- **计数与竞争解耦**：`baseCount` 快路径加 `CounterCell[]` 分散，避免单点 CAS 热点。

工程上真正要守的是边界：单方法原子不等于业务原子、`size()` 是估计值、迭代器是弱一致、`null` 不允许、回调里不许改自己。把这些边界写进代码审查清单，比背下阈值数字更有价值。
