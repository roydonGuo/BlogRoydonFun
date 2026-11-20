---
title: Redis Lua 脚本工程实践：原子执行、EVALSHA 与集群边界
date: 2026-11-17
category: 后端开发
cover: /covers/backend.svg
tags: [redis, lua, 原子性, 集群, spring-data-redis]
excerpt: "Redis 脚本在服务端一次执行到底，期间不处理任何其他客户端命令，因此能替代 MULTI/EXEC 完成读-判断-写；代价是慢脚本会阻塞整个实例，出错也不会回滚已写入的命令。上线前必须讲清缓存加载、集群同槽、确定性与超时边界。"
---

# Redis Lua 脚本工程实践：原子执行、EVALSHA 与集群边界

<img src="/images/posts/redis-lua-script-atomicity-engineering-knowledge-map.png" alt="Redis Lua 脚本工程实践：原子执行、EVALSHA 与集群边界知识串联图" style="border-radius: 10px;" />

Redis 脚本在服务端一次执行到底，期间不处理任何其他客户端命令，因此能替代 MULTI/EXEC 完成读-判断-写；代价是慢脚本会阻塞整个实例，出错也不会回滚已写入的命令。上线前必须讲清缓存加载、集群同槽、确定性与超时边界。

## 先说结论：脚本换到的是"一次往返内的原子判断"

Redis 保证脚本原子执行：执行期间阻塞所有服务器活动，其他客户端的命令排队等待。这让"读取-判断-写入"在一个原子单元内完成，替代了 `WATCH/MULTI/EXEC` 的乐观锁重试。但它与数据库事务有两点本质差异：

- **没有回滚**：脚本中途 `error` 时，之前已执行的写命令仍然生效；
- **阻塞代价是全局的**：脚本跑多久，整个实例（单节点）就停多久，不是只影响当前 key。

本文以 **Redis 7 及以上（含 Redis 8）** 为基线，核对日期 **2026-11-20**；脚本引擎为嵌入式 Lua 5.1。

## 一、完整分类：两种可编程形态与整套命令

### 1. Eval 脚本（Redis 2.6 起）

| 命令 | 作用 |
|---|---|
| `EVAL script numkeys key... arg...` | 直接执行脚本源码，每次都要传输全文 |
| `EVALSHA sha1 numkeys key... arg...` | 按 SHA1 执行已缓存脚本，省带宽 |
| `SCRIPT LOAD script` | 预加载脚本，返回 SHA1 |
| `SCRIPT EXISTS sha1...` | 检查脚本是否还在缓存 |
| `SCRIPT FLUSH` | 清空脚本缓存 |
| `SCRIPT KILL` | 终止超时脚本，**仅当脚本尚未执行写命令** |
| `EVAL_RO` / `EVALSHA_RO` | 只读变体，可在副本上执行、可被 `SCRIPT KILL` 终止 |

脚本缓存是**易失的**：实例重启、故障转移后缓存丢失，`EVALSHA` 会返回 `NOSCRIPT`。生产客户端必须实现"NOSCRIPT → `SCRIPT LOAD` → 重试"的兜底，Spring Data Redis 的 `DefaultRedisScript` 已内置该逻辑。

### 2. Redis Functions（Redis 7 起）

`FUNCTION LOAD` 把脚本作为数据库的一部分注册成函数库，用 `FCALL` 调用。区别在于：函数有名字、可持久化、随复制与 AOF 一起传播，脚本与应用的发布解耦。适合"多个服务共用同一段原子逻辑"的场景；临时性逻辑仍用 `EVAL` 更轻。

### 3. 客户端视角的调用链

`EVAL` → 服务端解析脚本 → 校验 `KEYS`/`ARGV` → 执行 `redis.call` → 返回值转 Redis 协议。注意 `KEYS` 与 `ARGV` 只是数组，参数个数由 `numkeys` 决定，写错 `numkeys` 会导致 key 被当成参数。

## 二、原子性的三道边界

**边界一：无回滚。** 脚本里先 `SET` 再 `error`，`SET` 已生效。因此原子脚本应把"校验"放在所有写命令之前，避免半完成状态。

**边界二：阻塞与超时。** 超过 `lua-time-limit`（默认 5 秒）后，Redis 不会自动杀掉脚本，而是对其他客户端返回 `BUSY`，直到脚本结束、`SCRIPT KILL`（脚本未写过数据时）或 `SHUTDOWN NOSAVE`。这就是"脚本里不要跑大循环"的原因：一个慢脚本能让整个实例不可用。

**边界三：确定性与复制。** Redis 7 起默认使用**效果复制**（把脚本产生的写命令传播给副本与 AOF），而非重放脚本本身，因此脚本中的随机、时间、系统调用不会导致主从分歧。但副作用是：脚本必须通过 `redis.call` 写数据才有意义，纯 Lua 计算的结果不会被复制。

## 三、集群边界：同槽 + 声明式 KEYS

- 脚本访问的所有 key **必须在同一个哈希槽**，即同一分片；
- 所有 key **必须通过 `KEYS` 传入**（`numkeys` 声明），不能在脚本内动态拼 key 名——Redis Cluster 只按声明的 key 做路由校验，动态拼 key 可能落到别的分片产生未定义行为；
- 需要把多个逻辑相关的 key 放进同槽，用 **hash tag**：`{user:1001}:profile` 与 `{user:1001}:quota` 共享 `user:1001` 的槽位；
- 只读脚本用 `EVAL_RO` 可以路由到副本，做读扩展。

## 四、真实示例：原子限流与安全释放锁

```java
/**
 * Redis 脚本集合：演示三个典型原子场景。
 * 使用 Spring Data Redis 的 DefaultRedisScript，内部优先 EVALSHA 并在 NOSCRIPT 时自动回退。
 */
@Configuration
public class RedisScriptConfig {

    /** 原子限流：窗口内计数 +1，首次计数时设置过期，返回当前计数 */
    @Bean
    public DefaultRedisScript<Long> rateLimitScript() {
        DefaultRedisScript<Long> script = new DefaultRedisScript<>();
        script.setResultType(Long.class);
        // KEYS[1]=计数键 ARGV[1]=窗口秒数
        script.setScriptText("""
                local current = redis.call('INCR', KEYS[1])
                if current == 1 then
                  redis.call('EXPIRE', KEYS[1], ARGV[1])
                end
                return current
                """);
        return script;
    }

    /** 安全释放锁：只有 value 与持有者一致才删除，避免误删他人锁 */
    @Bean
    public DefaultRedisScript<Long> releaseLockScript() {
        DefaultRedisScript<Long> script = new DefaultRedisScript<>();
        script.setResultType(Long.class);
        // KEYS[1]=锁键 ARGV[1]=持有者标识
        script.setScriptText("""
                if redis.call('GET', KEYS[1]) == ARGV[1] then
                  return redis.call('DEL', KEYS[1])
                end
                return 0
                """);
        return script;
    }
}
```

```java
/**
 * 限流器：脚本调用方，体现"key 数量必须显式声明"的契约。
 */
@Service
public class SlidingWindowLimiter {

    private final StringRedisTemplate redisTemplate;
    private final DefaultRedisScript<Long> rateLimitScript;

    public SlidingWindowLimiter(StringRedisTemplate redisTemplate,
                                DefaultRedisScript<Long> rateLimitScript) {
        this.redisTemplate = redisTemplate;
        this.rateLimitScript = rateLimitScript;
    }

    /**
     * @param key      限流维度键，集群下建议带 hash tag，如 {api:order}:user:1001
     * @param window   窗口秒数
     * @param threshold 阈值
     * @return true 表示放行
     */
    public boolean allow(String key, int window, long threshold) {
        Long count = redisTemplate.execute(
                rateLimitScript,
                List.of(key),                    // numkeys = 1，由框架自动填充
                String.valueOf(window));
        return count != null && count <= threshold;
    }
}
```

限流脚本只解决"计数原子性"，窗口边界仍有误差（固定窗口的临界双倍问题），需要精确滑动窗口时应换成 ZSET 方案并接受更大的内存开销。

## 五、常见追问

**问：脚本能回滚吗？**
不能。Redis 没有事务回滚，脚本中途失败时已执行的写命令保留。需要"全或无"只能靠前置校验，或改用业务补偿。

**问：为什么生产用 EVALSHA 而不是 EVAL？**
省去每次传输脚本全文的带宽。代价是脚本缓存丢失时返回 `NOSCRIPT`，客户端必须自动回退到 `SCRIPT LOAD` 后重试。

**问：Redis 是单线程，脚本还有并发问题吗？**
单节点内脚本是原子的，不会有其他命令插入；但多个脚本之间仍按到达顺序串行执行，"读-改-写"跨脚本不加锁依旧会互相覆盖。

**问：集群里为什么总报 `CROSSSLOT`？**
脚本声明了多个 key，而这些 key 落在不同槽。解决办法是用 hash tag 把它们强制落到同一槽，或把脚本拆成多个单 key 脚本。

**问：脚本里能调 `TIME` 或 `RANDOMKEY` 吗？**
效果复制下不会导致主从分歧，但会让重放结果不可复现，调试与测试困难；Redis 官方仍建议脚本保持确定性。

## 六、踩坑记录

- **脚本里对大集合做全量遍历**：单次执行几百毫秒，其他请求全部 `BUSY`，故障面被放大成全站。
- **依赖脚本缓存长期存在**：实例重启后 `EVALSHA` 全线 `NOSCRIPT`，若未做回退就是一次故障。
- **动态拼 key**：`redis.call('GET', 'user:'..id)` 在集群下绕过槽校验，路由到错误节点。
- **把复杂业务塞进脚本**：脚本无法调试、不能断点、改动要全量发布，维护成本极高。
- **忘记声明 `numkeys`**：key 被当成普通参数，脚本读到 `nil` 后静默走错误分支。
- **用 `DEL` 删除大 key**：应改用 `UNLINK` 交给后台线程异步释放，避免阻塞主线程。

## 七、选择建议

| 场景 | 建议 |
|---|---|
| 读-判断-写，key 数量少 | `EVALSHA` 脚本 |
| 多服务共用的原子逻辑 | Redis Functions（`FCALL`） |
| 只读计算，可走副本 | `EVAL_RO` / `FCALL_RO` |
| 需要跨 key 强一致 | 先确认能否同槽；不能就换方案（如 DB 事务或队列串行化） |
| 逻辑复杂、需要单测 | 放回应用层，用锁或消息串行化 |

## 八、最佳实践清单

1. 所有校验写命令之前完成，脚本内不产生"半完成"状态；
2. key 全部通过 `KEYS` 声明，集群下用 hash tag 保证同槽；
3. 脚本保持 O(1)~O(log N)，禁止全量遍历与 `KEYS` 模式匹配；
4. 客户端实现 `NOSCRIPT` 回退，或用 `DefaultRedisScript` 的默认行为；
5. 只读逻辑显式用 `EVAL_RO`，允许副本路由与超时终止；
6. 监控 `slowlog` 与 `latency` 指标，脚本耗时纳入告警；
7. 脚本纳入版本管理并写清输入契约（key 数量、参数含义）。

## 总结

Redis 脚本把"多次往返 + 客户端判断"压缩成服务端的单次原子执行，代价是把阻塞风险和确定性责任一并搬到服务端。工程上要守住三条线：校验在写之前（无回滚）、执行足够快（全局阻塞）、key 显式声明且同槽（集群可路由）。守住这三条，脚本就是限流、锁释放、库存扣减这类场景里最省事的一把工具。
