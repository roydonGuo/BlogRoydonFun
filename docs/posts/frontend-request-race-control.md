---
title: 前端异步请求竞态治理：AbortController、版本令牌与 Vue 清理
date: 2026-08-06
category: 前端开发
cover: /images/posts/frontend-request-race-control-knowledge-map.webp
tags: [frontend, typescript, abort-controller, vue, concurrency]
excerpt: 从搜索联想的乱序覆盖问题出发，建立取消旧请求、丢弃过期结果、明确状态归属与生命周期清理的完整治理链路。
---

# 前端异步请求竞态治理：AbortController、版本令牌与 Vue 清理

<img src="/images/posts/frontend-request-race-control-knowledge-map.webp" alt="前端异步请求竞态治理：AbortController、版本令牌与 Vue 清理知识串联图" style="border-radius: 10px;" />

搜索联想、级联选择、路由切换和弹窗详情都可能连续发出异步请求。用户先输入 `spring`，紧接着改成 `spring ai`，第二个请求先返回、旧请求后返回，页面就会被旧数据覆盖。这不是网络失败，而是多个正确请求以错误顺序提交了共享状态。

真正稳健的治理不能只加一个防抖。防抖只能减少请求数，无法消除已经并发出去的请求。完整方案需要同时处理四件事：取消不再需要的工作、拒绝过期结果写入、让加载与错误状态归属于正确请求，并在组件或监听器失效时清理副作用。

> 本文示例使用浏览器标准 `fetch`、TypeScript 与 Vue 3 Composition API；`onWatcherCleanup` 仅适用于 **Vue 3.5+**。事实依据 WHATWG DOM/Fetch Living Standard 与 Vue 官方文档，核对时间为 **2026-08-06**。

## 一、竞态发生在“提交状态”而不是“发起请求”

先看一个常见实现：

```ts
async function search(keyword: string) {
  loading.value = true

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(keyword)}`)
    results.value = await response.json()
  } finally {
    loading.value = false
  }
}
```

若连续调用 `search('spring')` 和 `search('spring ai')`，至少会竞争三个共享状态：

| 状态 | 可能出现的问题 | 用户看到的现象 |
|---|---|---|
| `results` | 旧请求最后写入 | 输入是新词，结果却属于旧词 |
| `loading` | 旧请求先结束并关闭加载态 | 新请求仍在执行，Spinner 已消失 |
| `error` | 旧请求失败覆盖新请求成功 | 页面有正确数据，却显示错误提示 |

因此“最后发起的请求获胜”必须是一条显式规则，而不能依赖响应恰好按发起顺序返回。更准确地说，应用要决定哪一个请求仍拥有状态提交权。

## 二、四类治理策略及其边界

异步竞态没有一个适合所有场景的万能写法。工程上常用的策略可以按业务语义分为四类。

### 1. 取消旧请求：只保留最新意图

适用于搜索联想、筛选预览、路由详情等“旧输入已经没有价值”的读取场景。新请求开始时调用旧 `AbortController.abort()`，可以停止 Fetch、响应体消费或相关流处理，从而减少浏览器与网络资源浪费。

但取消是一种协作信号，不是服务端事务回滚协议。请求可能已经到达服务端并完成处理，所以创建订单、付款、发消息等写操作不能把 `abort()` 当作撤销业务的手段。

### 2. 丢弃过期结果：只提交当前版本

并非所有异步 API 都支持 `AbortSignal`，而且取消与响应完成也可能处于临界时序。为每次请求分配递增版本号，在写状态前判断“我是否仍是最新版本”，可以提供最终提交防线。

这个策略不会节省已经发生的计算和流量，但能保证旧结果不污染界面。对于只读查询，通常应和取消旧请求组合使用，而不是二选一。

### 3. 串行化：每个意图都必须执行

保存草稿、按顺序同步编辑操作、分片上传等场景不能简单丢弃旧任务。此时应使用 Promise 队列、互斥锁或服务端序列号，把操作按业务顺序执行。代价是后续操作要等待，且队列必须定义失败后继续、停止还是补偿。

### 4. 合并与复用：相同意图共享一次请求

同一个资源在短时间被多个组件读取时，可以按规范化请求键复用进行中的 Promise，或交给具备缓存、去重与失效能力的数据请求层。它解决的是重复工作，不自动解决不同参数之间的先后覆盖；缓存键、组件状态归属和过期提交检查仍要明确。

| 业务语义 | 首选策略 | 仍需补充 |
|---|---|---|
| 只关心最新查询 | 取消旧请求 + 版本令牌 | 防抖、缓存 |
| 每次写入都必须保留 | 串行化 | 幂等键、失败恢复 |
| 相同查询被重复触发 | 合并进行中请求 | 缓存失效、订阅者清理 |
| 库不支持取消 | 版本令牌 | 资源上限、超时 |

## 三、AbortController 的正确使用方式

`AbortController` 持有一个 `signal`，异步 API 监听这个信号；调用 `abort(reason?)` 后，信号永久进入 aborted 状态。一个已经中止的信号不能复用，后续使用它的 Fetch 会立即被拒绝，因此每轮请求都要创建新的 Controller。

下面先实现一个只负责 HTTP 的基础函数：

```ts
interface SearchItem {
  id: string
  title: string
}

async function fetchSearch(
  keyword: string,
  signal: AbortSignal,
): Promise<SearchItem[]> {
  const response = await fetch(
    `/api/search?q=${encodeURIComponent(keyword)}`,
    { signal },
  )

  if (!response.ok) {
    // fetch 只会因网络层问题拒绝；4xx/5xx 需要业务代码主动判断
    throw new Error(`搜索请求失败：HTTP ${response.status}`)
  }

  // abort 发生在响应头返回后，读取响应体同样可能抛出 AbortError
  return response.json() as Promise<SearchItem[]>
}
```

取消错误应与真实失败分开。用户输入变化导致的主动取消是预期控制流，不该弹出“网络异常”，也不该计入接口失败率：

```ts
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
```

浏览器还提供 `AbortSignal.timeout()` 和 `AbortSignal.any()` 等组合能力，但兼容目标、TypeScript `lib.dom` 版本和运行环境都需要在项目内确认。基础设施代码可以组合“组件取消”和“超时取消”，业务组件不应到处手写多个互相覆盖的计时器。

## 四、取消之外，再加版本令牌兜底

下面的控制器实现“最后一次调用拥有提交权”。它同时使用 AbortController 和递增版本号：前者尽量停止旧工作，后者阻止任何过期结果写状态。

```ts
type RequestState<T> = {
  data: T
  loading: boolean
  error: string | null
}

export function createLatestSearch(
  state: RequestState<SearchItem[]>,
) {
  let activeController: AbortController | null = null
  let activeVersion = 0

  async function run(keyword: string): Promise<void> {
    const normalizedKeyword = keyword.trim()

    // 新输入到达后，旧请求已经失去业务价值
    activeController?.abort()

    if (!normalizedKeyword) {
      activeVersion += 1
      state.data = []
      state.loading = false
      state.error = null
      return
    }

    const controller = new AbortController()
    const version = ++activeVersion
    activeController = controller
    state.loading = true
    state.error = null

    try {
      const data = await fetchSearch(normalizedKeyword, controller.signal)

      // 即使底层没有及时响应取消，也不允许旧版本提交数据
      if (version !== activeVersion) return
      state.data = data
    } catch (error) {
      // 主动取消属于正常分支；旧请求也无权覆盖当前错误状态
      if (isAbortError(error) || version !== activeVersion) return
      state.error = error instanceof Error ? error.message : '未知错误'
    } finally {
      // 只有当前请求可以关闭当前请求打开的 loading
      if (version === activeVersion) {
        state.loading = false
        activeController = null
      }
    }
  }

  function dispose(): void {
    activeVersion += 1
    activeController?.abort()
    activeController = null
    state.loading = false
  }

  return { run, dispose }
}
```

这里最容易遗漏的是 `finally`。如果不判断版本，旧请求虽然不能覆盖数据，仍可能把新请求的 `loading` 关闭。版本令牌不是只保护成功结果，而是保护本次请求拥有的全部状态。

## 五、在 Vue 3 中把清理绑定到监听器生命周期

Vue 3.5+ 的 `onWatcherCleanup()` 会在当前监听器失效、准备重新执行时调用清理函数。注册必须发生在监听器回调的同步阶段，不能放到第一个 `await` 之后：

```ts
import { onWatcherCleanup, ref, watch } from 'vue'

const keyword = ref('')
const results = ref<SearchItem[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)
let requestVersion = 0

watch(keyword, async (value) => {
  const query = value.trim()
  const version = ++requestVersion
  const controller = new AbortController()

  // Vue 3.5+：必须在 await 之前同步注册清理
  onWatcherCleanup(() => controller.abort())

  if (!query) {
    results.value = []
    loading.value = false
    errorMessage.value = null
    return
  }

  loading.value = true
  errorMessage.value = null

  try {
    const data = await fetchSearch(query, controller.signal)
    if (version === requestVersion) results.value = data
  } catch (error) {
    if (!isAbortError(error) && version === requestVersion) {
      errorMessage.value = error instanceof Error
        ? error.message
        : '搜索失败'
    }
  } finally {
    if (version === requestVersion) loading.value = false
  }
})
```

若项目还未升级到 Vue 3.5，可使用 `watch` 回调的第三个参数 `onCleanup`。它与当前 watcher 实例绑定，官方文档也将其作为兼容写法：

```ts
watch(keyword, async (value, _oldValue, onCleanup) => {
  const controller = new AbortController()

  // 该写法可用于 Vue 3.5 之前的版本
  onCleanup(() => controller.abort())

  const data = await fetchSearch(value.trim(), controller.signal)
  // 真实项目仍应加入版本令牌，保护最终状态提交
  results.value = data
})
```

如果请求由点击事件而非 watcher 触发，就把 Controller 放进 composable，并在 `onBeforeUnmount` 中调用 `dispose()`。关键不是选哪个 Hook，而是让“谁创建副作用，谁负责使它失效”。

## 六、请求状态要有明确所有权

竞态 Bug 往往来自多个请求共享几个布尔值。建议把状态设计成一个有身份的快照：

```ts
type AsyncSnapshot<T> =
  | { status: 'idle'; data: T }
  | { status: 'loading'; requestId: number; data: T }
  | { status: 'success'; requestId: number; data: T }
  | { status: 'error'; requestId: number; data: T; message: string }
```

这种判别联合让 TypeScript 帮助调用方区分状态，也让日志能回答“哪个请求把页面改成了 error”。对复杂页面，还应按资源键保存状态，例如 `user:42` 与 `user:43` 各自拥有数据和加载态，而不是共用一个全局 `loading`。

请求身份建议记录以下字段，但不要把敏感查询内容完整写入日志：

- 前端生成的 `requestId` 或版本号；
- 规范化资源键的哈希；
- 发起、取消、完成和提交状态的时间点；
- 取消原因，如 `superseded`、`unmounted`、`timeout`；
- 结果是否因版本过期而被丢弃。

这样才能区分真正的慢接口、用户快速操作和前端状态提交错误。

## 七、取消读取不等于撤销写操作

对 `POST /orders` 调用 `abort()`，只能表示前端不再等待这次 Fetch。服务端可能已经落库，只是响应还没到浏览器。如果前端随后自动重试，可能创建两笔订单。

写操作需要另一套契约：

1. 客户端为一次业务意图生成稳定的幂等键；
2. 重试同一意图时复用该键，而不是创建新键；
3. 服务端按“调用方 + 幂等键”保存请求摘要与最终结果；
4. 相同键、相同请求返回第一次结果；相同键、不同请求拒绝冲突；
5. UI 取消等待后，提供查询最终状态或恢复任务的入口。

因此，查询场景通常是“取消 + latest-wins”，写入场景通常是“幂等 + 状态查询”，二者不能互换。

## 八、常见误区

### 误区 1：加了防抖就没有竞态

防抖窗口结束后仍可能同时存在多个请求；粘贴、回车立即搜索和组件初始化也可能绕过同一触发路径。防抖负责削峰，取消与版本检查负责正确性。

### 误区 2：只调用 abort，不处理拒绝

中止会让尚未完成的 Fetch 或响应体读取拒绝。如果所有异常都弹 Toast，用户每输入一次都会看到“请求失败”。必须把预期取消与网络、HTTP、解析和业务错误分层。

### 误区 3：复用同一个 AbortController

Signal 一旦中止就永久处于 aborted 状态。把同一个 Controller 放在模块常量中，第二次请求可能立即失败。正确做法是每轮创建新实例，只保存“当前活动实例”的引用。

### 误区 4：旧请求只能覆盖 data

旧请求还会覆盖 `loading`、`error`、分页游标和选中项。每一个提交共享状态的位置都必须验证所有权，尤其是 `catch` 和 `finally`。

### 误区 5：组件卸载后 Promise 自然消失

Promise 和网络请求不会因为 DOM 节点消失就自动停止。未清理的任务仍会占用资源、写入外部 store，或产生难以解释的错误日志。

### 误区 6：abort 等于服务端停止

客户端中止不保证服务器取消 CPU 计算、数据库事务或下游调用。若服务端任务也需要取消，应设计显式任务 ID、取消接口、状态机和权限校验。

## 九、落地检查清单

- 先为交互定义语义：最新获胜、全部执行、顺序执行还是相同请求复用；
- 只读且旧结果无价值时，为每轮请求创建独立 AbortController；
- 即使已经取消旧请求，也用版本号或 requestId 保护所有状态提交；
- 把取消注册到 watcher 失效、路由离开或组件卸载生命周期；
- 对预期取消、超时、网络错误、HTTP 错误、解析错误和业务错误分别处理；
- 不让旧请求在 `finally` 中关闭新请求的 loading；
- 写操作依赖服务端幂等与状态查询，不把前端 abort 当业务撤销；
- 通过指标观察取消率、过期结果丢弃率、真实失败率和端到端延迟。

## 十、总结

前端请求竞态的核心不是“网络太慢”，而是多个异步任务竞争同一份可变状态。AbortController 负责告诉旧任务尽快停止，版本令牌决定谁仍有提交权，Vue 的 watcher 清理把副作用绑定到正确生命周期，清晰的状态模型则防止 data、loading 和 error 相互串台。

对最新查询，采用“取消旧请求 + 版本令牌”作为默认组合；对必须保留的操作使用串行化；对相同读取使用合并与缓存；对写操作依赖服务端幂等和任务状态。先确定业务语义，再选择并发策略，才能既节省资源又保证界面最终正确。

## 参考资料

- [WHATWG DOM Living Standard：Aborting ongoing activities](https://dom.spec.whatwg.org/#aborting-ongoing-activities)
- [WHATWG Fetch Living Standard](https://fetch.spec.whatwg.org/)
- [MDN：AbortController.abort()](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort)
- [MDN：AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)
- [Vue 官方指南：侦听器与副作用清理](https://cn.vuejs.org/guide/essentials/watchers.html#side-effect-cleanup)
- [Vue 官方 API：watch()](https://cn.vuejs.org/api/reactivity-core.html#watch)
