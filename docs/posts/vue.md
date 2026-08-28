---
title: Vue 2 核心笔记：模板语法、六大指令、侦听器、计算属性与组件化
date: 2022-10-24 13:12:30
category: 前端开发
cover: /images/posts/vue/ethan-vue2-knowledge-map.webp
tags: [Vue, Vue2]
excerpt: 从 MVVM 视角讲清 Vue 2 为什么能让数据与视图自动同步，系统拆解模板语法、内容/属性/事件/双向/条件/列表六大指令、watch 侦听器、computed 计算属性，再到 vue-cli 工程化、单文件组件、父子/兄弟通信与组件生命周期，配本地截图与流程图，离线可看。
---

# Vue 2 核心笔记：模板语法、六大指令、侦听器、计算属性与组件化

<img src="/images/posts/vue/ethan-vue2-knowledge-map.webp" alt="Vue 2 核心笔记：模板语法、六大指令、侦听器、计算属性与组件化知识串联图" style="border-radius: 10px;" />

很多后端或刚入门前端的同学第一次接触 **Vue** 会困惑：明明只改了一个 JS 变量，页面就跟着变了，表单里输入点东西，数据也自动更新了。这件事背后并没有魔法，是一套叫 **MVVM** 的设计模式在干活。

本文目标是：**拿到一个 Vue 2 项目能读懂、能写、能改**。所有配图均下载到本地，断网也能看。内容覆盖 Vue 2 的模板语法、六大指令、侦听器、计算属性，以及工程化后的组件化与生命周期。Vue 3 在语法上大体兼容，但部分 API（如过滤器）已被移除，文中会标注。

## 一、Vue 是什么：数据与视图的双向桥梁

**Vue** 是一套用于构建用户界面（UI）的**渐进式框架（progressive framework）**。所谓框架，就是一套现成的解决方案：开发者遵守它的规范，把业务功能填进去即可，不用从零造轮子。Vue 提供的"积木"包括：指令（Directives）、组件（Component）、路由（Router）、状态管理（Vuex/Pinia）和组件库。

Vue 2 开发环境版本（含命令行警告，方便排错）：

```html
<!-- 开发环境版本，包含了有帮助的命令行警告 -->
<script src="https://cdn.jsdelivr.net/npm/vue/dist/vue.js"></script>
```

官方文档入口：
- Vue 3 中文文档：<https://cn.vuejs.org/guide/quick-start.html>
- Vue 2 中文文档：<https://v2.cn.vuejs.org/>

### 1、两个核心特性

Vue 区别于原生 JS 操作 DOM 的根本，是两个特性：

- **数据驱动视图（data-driven view）**：Vue 监听数据变化，数据变了，视图自动更新（**单向**）。开发者只管维护好数据，页面结构由 Vue 自动渲染。
- **双向数据绑定（two-way data binding）**：在表单场景里，JS 数据变化会自动渲染到页面；页面上表单采集的数据变化，也会被 Vue 自动写回 JS 数据。

> **核心结论**：数据驱动视图与双向数据绑定的底层原理是 **MVVM**（Model 数据源、View 视图、ViewModel 即 Vue 实例）。

### 2、MVVM 到底怎么协作

**MVVM** 把每个 HTML 页面拆成三部分：

- **Model（模型）**：当前页面渲染所依赖的**数据源**。
- **View（视图）**：当前页面所渲染的 **DOM 结构**。
- **ViewModel（视图模型）**：Vue 的实例，是 MVVM 的**核心**，负责把 Model 和 View 粘在一起。

:::mermaid
flowchart LR
    M[(Model 数据源)] -->|数据变化| VM[ViewModel Vue 实例]
    VM -->|驱动渲染| V[(View 视图 / DOM)]
    V -->|表单/事件采集| VM
    VM -->|自动写回| M
:::

<img src="/images/posts/vue/vue-01-mvvm.png" alt="MVVM 三层结构与数据流向示意" style="border-radius: 10px;" />

一句话理解：**ViewModel 盯着 Model，Model 一变就重画 View；View 上的输入一动，ViewModel 又把它同步回 Model。** 开发者几乎不用手动 `document.getElementById` 去改 DOM。

## 二、先把 Vue 跑起来：最小模板

### 1、一个能跑的 Vue 2 页面

引入 `vue.js` 后，通过一个 `new Vue({...})` 把数据挂到某个 DOM 节点上：

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vue2</title>
</head>
<body>
  <div id="app">
    {{ msg }}
  </div>
  <!-- 引入 vue.js -->
  <script src="https://cdn.jsdelivr.net/npm/vue/dist/vue.js"></script>
  <script>
    var app = new Vue({
      // vue 挂载的位置，id 为 app 的 div
      el: "#app",
      // vue 要渲染的数据
      data: {
        msg: "hello vue"
      }
    })
  </script>
</body>
</html>
```

三个关键配置：

- `el`：挂载点，指定 Vue 接管页面上哪个 DOM 节点（这里是 `#app`）。
- `data`：Vue 要渲染的**响应式数据**。
- 模板里的 `{{ msg }}` 叫**插值表达式**，用来把 `data` 里的数据显示到页面。

<img src="/images/posts/vue/vue-02-template.png" alt="最小 Vue2 模板运行效果" style="border-radius: 10px;" />

### 2、装一个 vue-devtools 调试工具

Vue 官方提供的 **vue-devtools** 能直接在浏览器面板里查看组件树、data、props，调试效率翻倍。

- Chrome 安装入口：<https://chrome.zzzmh.cn/index#/index>（搜索 vue-devtools）
- Firefox 安装入口：<https://addons.mozilla.org/zh-CN/firefox/addon/vue-js-devtools/>

装好后重启浏览器，打开开发者工具即可看到 **Vue** 面板：

<img src="/images/posts/vue/vue-03-devtools-1.png" alt="vue-devtools 安装与面板入口" style="border-radius: 10px;" />

<img src="/images/posts/vue/vue-04-devtools-2.png" alt="vue-devtools 面板中查看组件与数据" style="border-radius: 10px;" />

## 三、六大指令：模板语法的骨架

**指令（Directives）** 是 Vue 提供给开发者的模板语法，用于辅助渲染页面基本结构。按用途分为六大类：

- ① 内容渲染指令
- ② 属性绑定指令
- ③ 事件绑定指令
- ④ 双向绑定指令
- ⑤ 条件渲染指令
- ⑥ 列表渲染指令

> **重点**：指令是 Vue 开发中最基础、最常用、最简单的知识点，务必逐个吃透。

### 1、内容渲染指令

负责把数据"填"进页面：

- `{{ }}` **插值表达式**：开发中用得最多，只是内容占位符，**不会覆盖**元素原有内容。
- `v-text`：把数据按**纯文本**输出。
- `v-html`：若数据里带 HTML 标签，会按 HTML **渲染**（相当于设置 `innerHTML`）。

```html
<!-- v-text：原样输出字符串，包括标签符号 -->
v-text="<a href='https://roydon.xyz'>roydon</a>"
<!-- 页面上显示：<a href='https://roydon.xyz'>roydon</a> -->

<!-- v-html：按标签渲染，显示成可点击的 roydon 超链接 -->
v-html="<a href='https://roydon.xyz'>roydon</a>"
```

<img src="/images/posts/vue/vue-05-content-render.png" alt="插值表达式与 v-text/v-html 对比" style="border-radius: 10px;" />

### 2、属性绑定指令

`v-bind:` 为元素的**属性**动态绑定值，简写为 `:`。常用于 `class`、`src`、`id`、`type` 等。

```html
<div v-bind:class="divClass">div 内容区域</div>
<h1 :class="myh1">h1 标题</h1>

<!-- v-bind 简写为 : -->
<div :class="divClass">div 内容区域</div>

<!-- 绑定内容需要动态拼接时，字符串外面要包单引号 -->
<div :class="'divClass' + index">这是一个 div</div>
```

> 注意：`v-bind` 绑的是**元素的属性**，不是文本内容。把属性值和 JS 数据打通，靠的就是它。

<img src="/images/posts/vue/vue-06-attr-bind.png" alt="v-bind 属性绑定示例" style="border-radius: 10px;" />

### 3、事件绑定指令

`v-on:` 为元素绑定事件，简写为 `@`。事件名自定义，`methods` 里写对应方法。

```html
<div id="app">
  <input type="button" value="点击触发" v-on:click="方法名">
  <input type="button" value="双击触发" v-on:dblclick="方法名">
  <input type="button" value="点击触发" @click="方法名">
  <!-- 按键修饰符：回车触发 -->
  <input type="text" value="回车触发事件" @keyup.enter="方法名">
</div>
```

<img src="/images/posts/vue/vue-07-event-bind.png" alt="v-on 事件绑定示例" style="border-radius: 10px;" />

**`$event` 特殊变量**：表示原生事件参数对象 `event`，用来解决事件参数被覆盖的问题。原生元素上 `$event` 是 DOM 对象；自定义组件（如 Element、Vant 的非原生元素）上 `$event` 是组件当前的值。

```html
<div id="app">
  <input type="button" :value="count" @click="add(10, $event)" />
</div>
<script src="https://cdn.jsdelivr.net/npm/vue/dist/vue.js"></script>
<script>
  var app = new Vue({
    el: "#app",
    data: { count: 0 },
    methods: {
      add(num, e) {
        this.count += num
        console.log(e) // 打印的是对应的元素 DOM 对象
      }
    }
  })
</script>
```

**事件修饰符（Event Modifiers）**：调用 `event.preventDefault()` 或 `event.stopPropagation()` 是高频需求，Vue 用修饰符简化：

```html
<!-- .prevent：阻止默认行为（如链接跳转） -->
<a @click.prevent="xxx">链接</a>
<!-- .stop：阻止事件冒泡 -->
<button @click.stop="xxx">按钮</button>
```

常用的 5 个事件修饰符：`.stop`、`.prevent`、`.capture`、`.self`、`.once`（外加滚动相关的 `.passive`）。

<img src="/images/posts/vue/vue-08-event-modifier.png" alt="常用事件修饰符对照" style="border-radius: 10px;" />

**按键修饰符（Key Modifiers）**：监听键盘事件时精确判断按键。

```html
<div id="app">
  {{ msg }}<br>
  <input @keyup.enter="submit" />
  <input @keyup.esc="clear" />
</div>
<script src="https://cdn.jsdelivr.net/npm/vue/dist/vue.js"></script>
<script>
  var app = new Vue({
    el: "#app",
    data: { msg: "hello vue2" },
    methods: {
      submit() { alert("点击了 enter 回车键") },
      clear() { alert("点击了 esc 退出键") }
    }
  })
</script>
```

### 4、双向绑定指令

`v-model` 实现**双向数据绑定**，专用于表单。表单输入变化 → 写回 `data`；`data` 变化 → 渲染回绑定元素。

```html
<div id="app">
  <input type="text" v-model="content" />
  <h1>{{ content }}</h1>
</div>
<script src="https://cdn.jsdelivr.net/npm/vue/dist/vue.js"></script>
<script>
  var app = new Vue({
    el: "#app",
    data: { content: '' }
  })
</script>
```

为方便处理用户输入，Vue 给 `v-model` 提供 3 个修饰符：

- `.lazy`：在 `change` 事件而非 `input` 事件触发，失焦后才同步。
- `.number`：自动把输入值转为**数值类型**。
- `.trim`：自动过滤输入首尾**空白字符**。

<img src="/images/posts/vue/vue-09-vmodel-modifier.png" alt="v-model 三个修饰符对照" style="border-radius: 10px;" />

### 5、条件渲染指令

按需控制 DOM 的**显示与隐藏**：

- `v-show`：原理是给元素加 `display: none`（**元素始终在 DOM 里**）。
- `v-if`：原理是**动态创建/移除 DOM 元素**。

| 指令 | 实现原理 | 适用场景 |
|---|---|---|
| `v-show` | `display: none` | 频繁切换显示/隐藏 |
| `v-if` | 增删 DOM 节点 | 运行时条件很少改变 |

> 经验法则：需要非常频繁切换用 `v-show`；运行时条件很少改变用 `v-if`。实际开发中绝大多数情况不考虑性能，直接用 `v-if` 即可。

`v-if` 可单独使用，或配合 `v-else` / `v-else-if`：

```html
<div id="app">
  <h1 v-if="number >= 60">成绩合格</h1>
  <h1 v-else>成绩不及格</h1>
</div>
```

```html
<div id="app">
  <h1 v-if="number >= 80">成绩优秀！</h1>
  <h1 v-else-if="number >= 60 && number < 80">成绩合格</h1>
  <h1 v-else>成绩不及格</h1>
</div>
```

> 注意：`v-else` 和 `v-else-if` **必须紧跟 `v-if` 配合使用**，否则不会被识别。

### 6、列表渲染指令

`v-for` 基于一个**数组**循环渲染列表结构：

```html
<!-- item 是数组每一项；person 是待循环的数组 -->
<h1 v-for="item in person">姓名：{{ item.name }}</h1>

<!-- 同时拿到索引（可选参数） -->
<h1 v-for="(item, index) in person">
  姓名：{{ item.name }} 索引：{{ index }}
</h1>

<!-- data 中的数组 -->
data: {
  person: [
    { id: 1, name: 'roydon' },
    { id: 2, name: 'yicheng' }
  ]
}
```

关键约束：**遍历时必须绑定 `key`，推荐用具有唯一性的 `id`**（类型为 number/string）。`key` 重复会报错 `Duplicate keys detected`；`index` 不具有唯一性，**不推荐**当 `key`。

```html
<div id="app">
  <img alt="" v-for="(item, index) in imgSrc" :key="item.id" :src="item.urll" />
</div>
```

## 四、watch 侦听器：盯着数据变化做响应

**watch 侦听器** 允许开发者监视数据变化，并针对变化做特定操作。

```html
<div id="app">
  <h1>{{ msg }}</h1>
  <input v-model:value="msg" style="border: none;">
</div>
<script src="https://cdn.jsdelivr.net/npm/vue/dist/vue.js"></script>
<script>
  var app = new Vue({
    el: "#app",
    data: { msg: "hello vue2.js" },
    watch: {
      msg(newVal, oldVal) {
        console.log(newVal + '|' + oldVal)
      }
    }
  })
</script>
```

<img src="/images/posts/vue/vue-10-watch.png" alt="watch 侦听器基本用法" style="border-radius: 10px;" />

### 1、方法格式 vs 对象格式

watch 有两种写法，能力差别明显：

- **方法格式**（上面那种）：缺点 1 是组件初次加载后**不会自动触发**；缺点 2 是侦听**对象**时，对象内部属性变化**无法被监听到**。
- **对象格式**（下面带 `handler`）：好处 1 可通过 `immediate` 让侦听器立即触发；好处 2 可通过 `deep` 深度监听对象每个属性。

### 2、immediate 立即执行

默认组件加载完毕不会调用 watch。加 `immediate: true` 可在首次渲染后就立即触发一次：

```html
<script>
  var app = new Vue({
    el: "#app",
    data: { msg: "hello vue2.js" },
    watch: {
      msg: {
        // handler 是固定写法，值变化时自动调用
        handler: async function (newVal) {
          if (newVal === '') return
          const { data: res } = await axios.get('https://www.escook.cn/api/finduser/' + newVal)
          console.log(res)
        },
        // 页面初次渲染好后立即触发
        immediate: true
      }
    }
  })
</script>
```

### 3、deep 深度监听

watch 侦听**对象**时，若对象内部属性变化，默认监听不到。加 `deep: true` 解决：

```html
<script>
  var app = new Vue({
    el: "#app",
    data: {
      userInfo: { name: 'roydon', age: 18 }
    },
    watch: {
      userInfo: {
        handler(newVal) { console.log(newVal.name) },
        deep: true
      }
    }
  })
</script>
```

若只关心对象的某个属性，可单独监听路径，省去对整个对象深度遍历：

```javascript
watch: {
  'userInfo.age': {
    handler(newVal) { console.log(newVal) },
    deep: true
  }
}
```

<img src="/images/posts/vue/vue-11-watch-deep.png" alt="watch 的 deep 深度监听示意" style="border-radius: 10px;" />

## 五、computed 计算属性：声明式的派生值

**计算属性（computed）** 指经过一系列运算后得到的一个**属性值**，可被模板或方法直接使用。

```html
<div id="app">
  <h1>{{ rgb }}</h1>
  <input type="button" value="获取rgb" @click="show">
</div>
<script src="https://cdn.jsdelivr.net/npm/vue/dist/vue.js"></script>
<script>
  var app = new Vue({
    el: "#app",
    data: { r: 10, g: 20, b: 30 },
    computed: {
      rgb() {
        return `rgb(${this.r + 10}, ${this.g - 10}, ${this.b * 1})`
      }
    },
    methods: {
      show() {
        console.log(this.rgb) // 注意此处不加括号
      }
    }
  })
</script>
```

> **核心结论**：计算属性声明时写成方法，但**本质是一个属性**；它会**缓存计算结果**，只有依赖的数据变化时才重新运算。频繁基于 data 派生展示值时，优先用 `computed` 而非方法调用。

## 六、工程化：从单文件到 Vue 项目

### 1、单页面应用

**单页面应用（SPA，Single Page Application）** 只有一个 HTML 页面。Vue 的观念是**组件化**：往这一个页面里不断塞组件。记住"Vue 即单页"即可。

### 2、用 vue-cli 创建项目

**vue-cli** 是 Vue.js 开发的标准工具，把基于 webpack 创建工程化项目的过程极大简化。官网：<https://cli.vuejs.org/zh/>

```shell
# 安装
npm install -g @vue/cli
# 或
yarn global add @vue/cli

# 创建项目（名字为 my-project）
vue create my-project
# 或图形化界面
vue ui
```

> 命令行进度条卡住不动时，可尝试 `ctrl + d` 退出重来。

vue 项目 `src` 目录构成：

- `assets`：静态资源（css、图片）。
- `components`：可复用组件。
- `main.js`：项目入口文件，整个项目先执行它。
- `App.vue`：项目根组件。

<img src="/images/posts/vue/vue-16-vue-cli.png" alt="vue-cli 创建出的完整 Vue2 项目结构" style="border-radius: 10px;" />

### 3、Vue 项目运行流程

工程化项目里，Vue 只做一件事：通过 `main.js` 把 `App.vue` 渲染到 `index.html` 的指定区域。

:::mermaid
flowchart LR
    A[main.js 入口文件] -->|render 渲染| B[App.vue 根组件模板]
    B -->|挂载到| C[index.html 预留的 #app 区域]
    C --> D[浏览器渲染出页面]
:::

三要素拆解：

- `App.vue`：编写待渲染的**模板结构**。
- `index.html`：需预留一个挂载区域（如 `<div id="app">`）。
- `main.js`：把 `App.vue` 渲染到 `index.html` 预留区域。

### 4、.vue 组件的三部分

每个 `.vue` 组件由三部分构成：

- `template`：**模板结构**，不会被渲染成 DOM，只能包含**唯一根节点**。
- `script`：**JavaScript 行为**，`export` 中的 `data` **必须是一个函数**。
- `style`：**样式 CSS**，给组件单独设样式需在 `style` 上加 `scoped` 属性。

<img src="/images/posts/vue/vue-12-component-tree.png" alt="Vue 官方组件树示意" style="border-radius: 10px;" />

<img src="/images/posts/vue/vue-13-component-parts.png" alt=".vue 组件三大组成部分" style="border-radius: 10px;" />

> 注意：每个组件**必须包含 template**；`script` 和 `style` 是可选的。

## 七、组件通信：父子与兄弟

**组件化开发** 是按封装思想，把页面上可复用的 UI 结构封装为组件，提升开发与维护效率。

### 1、props：父向子传值

**props（自定义属性）** 用于父组件向子组件传值：子组件定义 `props`，父组件给它赋值即可。

```javascript
export default {
  props: {
    msg: {
      required: true,   // 必填项
      type: String,     // 声明类型：Number、Object 等
      default: ""       // 默认值
    }
  }
}
```

> **核心结论**：props 是**只读**的，子组件不能直接改。要改就间接借助 `data`——自定义一个数据把 props 的值传进来再改。

每个组件被复用时，会创建自己的新**实例**，各自独立维护 props，避免互相污染。这也解释了为什么 `data` 必须是一个函数（每次复用返回新对象）。

<img src="/images/posts/vue/vue-14-props-1.png" alt="父组件通过 props 向子组件传值" style="border-radius: 10px;" />

<img src="/images/posts/vue/vue-15-props-2.png" alt="props 数据流与组件实例隔离" style="border-radius: 10px;" />

### 2、$emit：子向父传值

子向父传值用**自定义事件 `$emit`**。子组件触发事件并抛出数值，父组件监听并接收：

```html
<!-- 子组件抛出数值 10 -->
<button v-on:click="$emit('numchange', 10)">+10</button>

<!-- 父组件通过 $event 拿到抛出的值 -->
<Child @numchange="count = $event" />
```

### 3、eventBus：兄弟组件间共享数据

非父子（如兄弟）组件共享数据，可用 **eventBus（事件总线）**：

1. 创建 `eventBus.js`，向外共享一个 Vue 实例对象。
2. **发送方**调用 `bus.$emit('事件名', 数据)` 触发事件。
3. **接收方**调用 `bus.$on('事件名', 处理函数)` 注册监听。

> Vue 3 中 eventBus 思路已被更规范的状态管理（Pinia）取代，但理解其"发布-订阅"本质对学习状态管理很有帮助。

## 八、生命周期：组件从生到灭

**生命周期（Life Cycle）** 指一个组件从**创建 → 运行 → 销毁**的整个阶段，强调的是**时间段**。**生命周期函数** 是 Vue 框架内置、伴随生命周期自动按次序执行的函数（强调的是**时间点**）。

> 区别记牢：生命周期 = 时间段；生命周期函数 = 时间点。

:::mermaid
flowchart TD
    A[new Vue 创建实例] --> B[beforeCreate]
    B --> C[created 数据观测已就绪]
    C --> D[beforeMount]
    D --> E[mounted DOM 挂载完成]
    E --> F{数据变化?}
    F -->|是| G[beforeUpdate]
    G --> H[updated]
    H --> F
    F -->|组件销毁| I[beforeDestroy]
    I --> J[destroyed 实例解绑]
:::

官方生命周期图示（建议收藏，对照理解）：

<img src="/images/posts/vue/vue-17-lifecycle.png" alt="Vue 2 官方生命周期图示" style="border-radius: 10px;" />

<img src="/images/posts/vue/vue-18-lifecycle-2.jpg" alt="Vue 2 生命周期流程图解（含各阶段说明）" style="border-radius: 10px;" />

常用钩子速查：

- `created`：data 与 methods 已初始化，**适合发起 ajax 请求**（此时 DOM 还没生成）。
- `mounted`：DOM 已挂载，**适合操作 DOM、初始化第三方库**。
- `beforeDestroy` / `destroyed`：清理定时器、解绑全局事件，防止内存泄漏。

## 九、顺带一提：用 axios 配 Vue 发请求

**axios** 是一个专注于网络请求的库，常和 Vue 搭配：在 `created`/`methods` 里发请求，把返回数据写进 `data`，视图自动更新。前提：已 `npm install axios` 或引入 axios 的 JS 文件。

```javascript
// 发起 GET 请求
axios({
  method: 'GET',
  url: 'http://www.example.xyz/xxx',
  params: { id: 1 }
}).then(function (result) {
  console.log(result)
})
```

```html
<script>
  document.querySelector('#btnPost').addEventListener('click', async function () {
    // 调用方法的返回值是 Promise，前面可加 await
    // await 只能用在被 async 修饰的方法中
    const { data: res } = await axios({
      method: 'POST',
      url: 'http://www.example.xyz/xxx',
      data: { name: 'zs', age: 20 }
    })
    console.log(res)
  })
</script>
```

> 注意：`axios` 返回的是一个 Promise；解构时 `{ data: res }` 取的是响应体里的 `data` 字段，别和 Vue 的 `data` 配置混淆。

## 总结

**要点回顾**：Vue 2 以 **MVVM** 为内核，用**数据驱动视图**与**双向数据绑定**取代手动 DOM 操作；模板靠**六大指令**（内容/属性/事件/双向/条件/列表）搭建；`watch` 监听数据变化做副作用、`computed` 声明式派生并带缓存；工程化后一切皆**组件**，`props` 父传子、`$emit` 子传父、`eventBus` 解决兄弟通信；组件从 `created` 到 `destroyed` 经历完整**生命周期**；配 `axios` 即可把后端数据接进响应式系统。

**关联知识点**：**Vue 3 组合式 API（Composition API）** 用 `setup`/`ref`/`reactive` 重构逻辑复用；**Vuex / Pinia** 是比 eventBus 更规范的状态管理；**Vue Router** 负责 SPA 的路由与视图切换；**虚拟 DOM 与 Diff 算法** 解释数据为何能高效驱动视图；**响应式原理（Object.defineProperty）** 是 Vue 2 实现数据劫持的底层机制。

**面试常问**：
- 问 → 答：`v-if` 和 `v-show` 区别？`v-if` 增删 DOM、`v-show` 切 `display`，频繁切换用后者。
- 问 → 答：为什么 `data` 必须是函数？组件复用会创建独立实例，函数返回新对象避免数据互相污染。
- 问 → 答：`computed` 和 `watch` 怎么选？派生展示值用 `computed`（带缓存），数据变化触发异步/副作用用 `watch`。
- 问 → 答：`key` 在 `v-for` 中起什么作用？给节点稳定身份，帮助 Diff 精准复用，推荐用唯一 `id`。

**参考资料**：
- [Vue 2 中文文档](https://v2.cn.vuejs.org/)
- [Vue 3 中文文档](https://cn.vuejs.org/guide/quick-start.html)
- [vue-cli 官方文档](https://cli.vuejs.org/zh/)
- [vue-devtools（Firefox 插件）](https://addons.mozilla.org/zh-CN/firefox/addon/vue-js-devtools/)
- [axios GitHub](https://github.com/axios/axios)
