---
title: HTML5
date: 2022-08-24 08:31:20
category: 前端开发
cover: /images/posts/html5/ethan-html5-knowledge-map.webp
tags: [html, html5, frontend, 前端]
excerpt: 从浏览器怎么跑网页讲起，系统梳理 HTML5 的标签体系——排版、文本格式化、媒体、链接、列表、表格、表单、语义化标签与字符实体，配本地自托管图示。
---

# HTML5

<img src="/images/posts/html5/ethan-html5-knowledge-map.webp" alt="HTML5 知识串联图" style="border-radius: 10px;" />

**HTML5** 是构建网页的基石。下面从"浏览器怎么跑网页"一路讲到语义化标签与字符实体，按知识点拆成可查阅的体系。

## 一、基础认识

### 1、浏览器：网页的运行平台

**浏览器**（Browser）是解析并渲染网页的软件，本质是一个"网页运行平台"。

主流五大浏览器：

- **Chrome**：Google 出品，市场份额第一，内核 **Blink**
- **Edge**：微软现主力浏览器，内核同样为 **Blink**
- **Firefox**：Mozilla 出品，内核 **Gecko**
- **Safari**：苹果系默认浏览器，内核 **WebKit**
- **Opera**：老牌浏览器，现内核也是 **Blink**

> IE（Internet Explorer）已停止维护，其 **Trident** 内核仅存于历史兼容场景，新项目无需考虑。

![五大主流浏览器与对应内核概览](/images/posts/html5/01.webp)

### 2、浏览器渲染引擎

决定页面"长什么样"的核心模块是**渲染引擎**（Rendering Engine，也叫排版引擎 / 浏览器内核）。它负责把 HTML、CSS、JavaScript 转换成屏幕上的像素。

不同浏览器的渲染引擎：

| 浏览器 | 渲染引擎 |
| --- | --- |
| Chrome / Edge / Opera | Blink |
| Firefox | Gecko |
| Safari | WebKit |
| IE（已淘汰） | Trident |

![浏览器渲染引擎的工作位置与职责](/images/posts/html5/02.webp)

### 3、Web 标准

如果各家浏览器各搞一套，同一份代码在不同浏览器里就会"长不一样"。**Web 标准**由 **W3C**（World Wide Web Consortium，万维网联盟）制定，目的是让同一份网页在所有浏览器中表现一致。

Web 标准把网页拆成三层，各司其职：

- **结构**（Structure）：HTML，决定"页面有什么"
- **表现**（Presentation）：CSS，决定"页面长什么样"
- **行为**（Behavior）：JavaScript，决定"页面能做什么"

:::mermaid
graph TD
    A[Web 标准] --> B[结构 HTML]
    A --> C[表现 CSS]
    A --> D[行为 JavaScript]
    B --> E[页面内容与语义]
    C --> F[样式与布局]
    D --> G[交互与逻辑]
:::

![不同浏览器遵循同一 Web 标准后的统一表现](/images/posts/html5/03.webp)

## 二、HTML 基本语法

### 1、什么是 HTML

**HTML**（HyperText Markup Language，**超文本标记语言**）用来描述网页的结构与内容。"超文本"指页面之间可通过链接互相跳转，"标记"指用标签来标注内容含义。

### 2、注释与标签

注释不会被浏览器渲染，用于给开发者看：

```html
<!-- 这是一段注释，浏览器会忽略它 -->
```

HTML 标签分两类：

- **双标签**：由开始标签和结束标签包裹内容，例如 `<strong>文字</strong>`
- **单标签**：没有结束标签、不可包裹内容，例如 `<br>`、`<hr>`、`<img>`

```html
<!-- 双标签：有开始有结束，标签之间放内容 -->
<strong>文字加粗</strong>

<!-- 单标签：自闭合，不能包裹内容 -->
<br>
<hr>
```

## 三、排版标签（文档骨架）

### 1、标题标签

`<h1>` 到 `<h6>` 表示六级标题，重要性递减。`<h1>` 通常一个页面只用一次，作为主标题。

```html
<h1>一级标题</h1>
<h2>二级标题</h2>
<!-- ... -->
<h6>六级标题</h6>
```

### 2、段落标签

`<p>` 定义一个段落，浏览器会在段落之间自动留出间距。

```html
<p>这是第一段内容。</p>
<p>这是第二段内容。</p>
```

> 在 VS Code 中，若段落内容过长一行显示不下，按 `Alt + Z` 可开启 / 关闭自动换行（软换行），不影响实际代码。

### 3、换行标签

`<br>` 是单标签，表示强制换行（类似于文档里的回车）。

```html
第一行内容<br>第二行内容
```

### 4、水平线标签

`<hr>` 是单标签，在页面上画一条水平分隔线，常用于分隔内容区块。

```html
<hr>
```

## 四、文本格式化标签

这类标签用来修饰文字的粗细、斜体、下划线等，是"行内元素"，只作用在文字片段上。

| 标签 | 含义 | 语义 |
| --- | --- | --- |
| `<b>` / `<strong>` | 加粗 | `strong` 带强调语义，推荐用 `strong` |
| `<i>` / `<em>` | 斜体 | `em` 带强调语义，推荐用 `em` |
| `<u>` / `<ins>` | 下划线 | `ins` 表示插入内容 |
| `<s>` / `<del>` | 删除线 | `del` 表示删除内容 |
| `<sub>` | 下标 | 如 H<sub>2</sub>O |
| `<sup>` | 上标 | 如 x<sup>2</sup> |

![文本格式化标签的效果对照](/images/posts/html5/04.webp)

## 五、媒体标签

### 1、图片标签

`<img>` 是单标签，用来在页面中嵌入图片。

```html
<img src="路径" alt="替换文本（src 失效时显示）" title="鼠标悬停时的提示文本">
```

更多属性：

- `width` / `height`：只设置一个时，浏览器按比例缩放；两个都设置则按指定尺寸（可能变形）
- `alt`：图片加载失败时的替代文字，也利于无障碍与 SEO
- `title`：鼠标悬停提示

**路径**是 `src` 的核心，分相对路径与绝对路径两类：

**相对路径**（相对于当前文件位置）：

- 同级文件：直接写文件名，如 `<img src="logo.png">`
- 下级文件：写文件夹与文件名，如 `<img src="./images/logo.png">`
- 上级文件：用 `../` 往上退一级，如 `<img src="../banner.gif">`

![同级文件的相对路径写法](/images/posts/html5/05.webp)

![引用下级文件的相对路径写法](/images/posts/html5/06.webp)

![引用下级文件的另一种相对路径写法](/images/posts/html5/07.webp)

**绝对路径**：从盘符或站点根目录开始的完整位置，可直接定位到目标。

![绝对路径的写法示意](/images/posts/html5/08.webp)

### 2、音频标签

`<audio>` 是双标签，用来播放音频。

```html
<audio src="music.mp3" controls></audio>
```

常见属性：

- `src`：音频地址
- `controls`：显示播放控件（不写则不可见、不可播放）
- `autoplay`：自动播放（多数浏览器因体验策略会拦截）
- `loop`：循环播放

![音频标签的基础用法](/images/posts/html5/09.webp)

![音频标签常见属性对照](/images/posts/html5/10.webp)

![带控件的音频播放器外观](/images/posts/html5/11.webp)

目前 `<audio>` 支持三种格式：**MP3**、**Wav**、**Ogg**。MP3 兼容性最好，通常作为首选。

### 3、视频标签

`<video>` 用法与 `<audio>` 类似，常见属性也基本一致（`controls`、`autoplay`、`loop`、`muted` 等）。

```html
<video src="movie.mp4" controls></video>
```

![视频标签的基础用法](/images/posts/html5/12.webp)

![视频标签常见属性对照](/images/posts/html5/13.webp)

## 六、链接标签

`<a>`（anchor，**锚点**）用来跳转到其他页面或页面内锚点。

```html
<a href="https://example.com" target="_blank">访问示例网站</a>
```

- `href`：目标地址；`href="#"` 表示**空链接**，常用于"还没想好跳去哪"的占位
- `target`：打开方式

`target` 常见取值：

- `_self`：在当前窗口打开（**默认值**）
- `_blank`：在新窗口 / 新标签页打开

![链接标签的基础用法](/images/posts/html5/14.webp)

![target="_self" 在当前窗口打开](/images/posts/html5/15.webp)

![target="_blank" 在新标签页打开](/images/posts/html5/16.webp)

## 七、列表标签

列表分三类：无序列表（圆点）、有序列表（序号）、自定义列表（术语 + 描述）。

![三种列表的整体形态对比](/images/posts/html5/17.webp)

### 1、无序列表

`<ul>`（unordered list）+ `<li>`（list item），每一项前是圆点。

```html
<ul>
  <li>苹果</li>
  <li>香蕉</li>
  <li>橙子</li>
</ul>
```

![无序列表的渲染效果](/images/posts/html5/18.webp)

### 2、有序列表

`<ol>`（ordered list）+ `<li>`，每一项前自动带序号。

```html
<ol>
  <li>第一步</li>
  <li>第二步</li>
  <li>第三步</li>
</ol>
```

![有序列表的渲染效果](/images/posts/html5/19.webp)

### 3、自定义列表

`<dl>`（description list）+ `<dt>`（术语）+ `<dd>`（描述），常用于"名词—解释"场景。

```html
<dl>
  <dt>HTML</dt>
  <dd>超文本标记语言</dd>
  <dt>CSS</dt>
  <dd>层叠样式表</dd>
</dl>
```

![自定义列表的结构与渲染效果](/images/posts/html5/20.webp)

![自定义列表的多条术语对照](/images/posts/html5/21.webp)

![自定义列表的嵌套用法](/images/posts/html5/22.webp)

## 八、表格标签

`<table>` 用来展示结构化数据，由行、单元格、表头组成。

```html
<table border="1">
  <caption>商品清单</caption>
  <thead>
    <tr><th>名称</th><th>价格</th></tr>
  </thead>
  <tbody>
    <tr><td>键盘</td><td>199</td></tr>
    <tr><td>鼠标</td><td>99</td></tr>
  </tbody>
</table>
```

常用结构标签：

- `<caption>`：表格大标题
- `<thead>` / `<tbody>` / `<tfoot>`：表头、表体、表尾分组
- `<tr>`：一行
- `<th>`：表头单元格（默认加粗居中）
- `<td>`：普通单元格

常见属性：

| 属性 | 作用 |
| --- | --- |
| `border` | 表格边框宽度 |
| `cellspacing` | 单元格之间的间距 |
| `cellpadding` | 单元格内容与边框的内边距 |
| `colspan` | 单元格**横向**合并几列 |
| `rowspan` | 单元格**纵向**合并几行 |
| `align` / `valign` | 水平 / 垂直对齐（现代推荐用 CSS 替代） |

![表格标签的基础结构](/images/posts/html5/23.webp)

![表格常见属性：边框与间距](/images/posts/html5/24.webp)

![表格的表头与标题结构](/images/posts/html5/25.webp)

![单元格横向合并 colspan 效果](/images/posts/html5/26.webp)

![单元格纵向合并 rowspan 效果](/images/posts/html5/27.webp)

![复杂表格的多重合并示例](/images/posts/html5/28.webp)

![表格整体样式的综合示例](/images/posts/html5/29.webp)

> 实际项目中，表格的样式（边框、对齐、间距）基本都交给 CSS 控制，`border`、`cellspacing` 等属性属于早期写法，了解即可。

## 九、表单标签

表单是网页"收集用户输入"的核心，登录、注册、搜索都靠它。

![表单的整体组成概览](/images/posts/html5/30.webp)

### 1、form 与 input

`<form>` 是表单容器，内部放各种输入控件；`<input>` 是最常用的输入项，靠 `type` 决定形态。

```html
<form action="/submit" method="post">
  <input type="text" name="username" placeholder="请输入用户名">
  <input type="password" name="pwd">
</form>
```

`<input>` 常用 `type`：

| type | 形态 | 说明 |
| --- | --- | --- |
| `text` | 单行文本 | 最常用 |
| `password` | 密码框 | 输入内容掩码显示 |
| `radio` | 单选 | 同 `name` 一组互斥 |
| `checkbox` | 多选 | 可同时选多个 |
| `file` | 文件上传 | 配合 `multiple` 多文件 |
| `submit` | 提交按钮 | 触发表单提交 |
| `button` | 普通按钮 | 需 JS 绑定行为 |
| `reset` | 重置按钮 | 清空表单 |

![input 标签的基础用法](/images/posts/html5/31.webp)

![input 常见属性对照](/images/posts/html5/32.webp)

**单选功能**：同一组单选框必须设置相同的 `name`，才能达到"只能选一个"的效果；`checked` 表示默认选中（多选框同样适用）。

```html
<input type="radio" name="gender" value="male" checked> 男
<input type="radio" name="gender" value="female"> 女
```

![单选框 name 分组与默认选中](/images/posts/html5/33.webp)

**文件上传**：加 `multiple` 属性可一次选多个文件。

**提交按钮**：`<input type="submit">` 或 `<button>` 必须放在 `<form>` 内部，点击才会把表单数据提交到 `action` 指定的地址；用 `value` 属性设置按钮上显示的文字。

```html
<form action="/login" method="post">
  <input type="text" name="user">
  <input type="submit" value="登录">
</form>
```

![按钮与表单的提交关系](/images/posts/html5/34.webp)

### 2、button

`<button>` 是双标签按钮，比 `<input type="button">` 更灵活，标签内可放文字、图标甚至其他元素。

```html
<button type="submit">提交</button>
<button type="button">普通按钮</button>
```

`type` 取值：`submit`（提交表单）、`reset`（重置）、`button`（默认不提交，常用于 JS 交互）。

![button 标签的用法](/images/posts/html5/35.webp)

### 3、select 下拉菜单

`<select>` + `<option>` 构成下拉选择框，`selected` 设置默认选中项。

```html
<select name="city">
  <option value="bj">北京</option>
  <option value="sh" selected>上海</option>
  <option value="gz">广州</option>
</select>
```

![select 下拉菜单结构](/images/posts/html5/36.webp)

![select 默认选中项的效果](/images/posts/html5/37.webp)

### 4、textarea 文本域

`<textarea>` 是多行文本输入框，适合留言、简介这类长文本。

```html
<textarea rows="4" cols="30" placeholder="请输入简介"></textarea>
```

![textarea 文本域的渲染效果](/images/posts/html5/38.webp)

> 实际开发中，文本域的尺寸通常用 CSS 控制，`rows` / `cols` 只作兜底。

### 5、label 增强可用性

`<label>` 把文字和控件"绑"在一起：点文字也能触发对应控件，扩大可点击区域，对单选 / 复选尤其友好。

两种方式：

```html
<!-- 方式一：用 for 指向控件的 id -->
<label for="agree">同意协议</label>
<input type="checkbox" id="agree">

<!-- 方式二：直接把控件包起来 -->
<label>
  <input type="checkbox"> 同意协议
</label>
```

![label 与控件绑定的两种写法](/images/posts/html5/39.webp)

![点文字也能选中控件的效果](/images/posts/html5/40.webp)

![label 提升可点击区域的示意图](/images/posts/html5/41.webp)

## 十、语义化标签

### 1、无语义布局标签

`<div>` 和 `<span>` 是最常用的"盒子"，但**不携带任何语义**——`div` 是块级盒子，`span` 是行内容器，只用来划分区域或包裹文字，具体含义全靠 class / 样式约定。

![div/span 的纯布局作用](/images/posts/html5/42.webp)

### 2、有语义布局标签（HTML5 新增）

HTML5 新增了一批"带含义的布局标签"，行为和 `<div>` 一样是块级盒子，但名字就说明了**这块是干什么的**，可读性、可访问性、SEO 都更好。

常用语义标签：

- `<header>`：页眉 / 区块头部
- `<nav>`：导航
- `<main>`：页面主体（一个页面建议只有一个）
- `<article>`：独立成篇的内容（如一篇文章、一条评论）
- `<section>`：按主题划分的区块
- `<aside>`：侧边栏 / 补充内容
- `<footer>`：页脚 / 区块底部

一个典型页面的语义结构：

:::mermaid
graph TD
    H[header 页眉] --> N[nav 导航]
    N --> M[main 主体]
    M --> A[article 文章]
    M --> S[section 区块]
    M --> AS[aside 侧边栏]
    H --> F[footer 页脚]
:::

![HTML5 语义化布局标签一览](/images/posts/html5/43.webp)

![语义化页面结构示例](/images/posts/html5/44.webp)

> `div` 与 `section` 的区别：`div` 纯布局、无含义；`section` 表示"按主题归组的内容块"，有语义。能用语义标签表达结构时，优先语义标签，剩下的纯容器再用 `div`。

## 十一、字符实体

HTML 里有些字符被语法占用（如 `<`、`>`、`&`），直接写会被当成标签或实体开头。要用**字符实体**（Character Entity，也叫 HTML 实体）来"转义"显示。

常见实体：

| 显示 | 实体写法 | 含义 |
| --- | --- | --- |
| `<` | `&lt;` | 小于号 |
| `>` | `&gt;` | 大于号 |
| `&` | `&amp;` | 与号 |
| 空格 | `&nbsp;` | 不间断空格 |
| `©` | `&copy;` | 版权符号 |
| `"` | `&quot;` | 双引号 |

```html
<p>用 &lt;div&gt; 包裹内容，&amp; 符号需要转义。</p>
```

![字符实体的常见对照表](/images/posts/html5/45.webp)

## 总结

HTML5 是网页的结构层，由浏览器内核解析、遵循 W3C 标准，通过标签描述"页面有什么"。

**要点回顾**：浏览器靠渲染引擎把 HTML/CSS/JS 变成可见页面，五大浏览器内核各不相同但都遵循 Web 标准（结构 HTML / 表现 CSS / 行为 JS）；标签分双标签与单标签，排版、文本格式化、媒体、链接、列表、表格、表单、语义化标签各自解决一类结构问题；表单靠 `form` 容器收集输入，控件形态由 `input` 的 `type` 决定；HTML5 新增语义化标签让结构自带含义；特殊字符用字符实体转义。

**关联知识点**：**CSS 盒模型与布局**（决定表现层）、**JavaScript DOM 操作**（让结构动起来）、**表单与后端交互**（`action` / `method` / 提交）、**无障碍 ARIA**（语义化与可访问性）、**SEO 基础**（语义标签对收录的影响）。

**面试常问**：
- 问：`src` 和 `href` 的区别？答：`src` 会替换当前元素（如 `<img>`、`<script>` 把资源载入并占位），`href` 建立资源与目标间的链接关系（如 `<a>`、`<link>`），不替换当前内容。
- 问：`div` 和 `section` 怎么选？答：`div` 无语义、纯容器；`section` 表示按主题聚合的内容块，有语义，结构清晰时优先用语义标签。
- 问：块级元素和行内元素的区别？答：块级（如 `div`、`p`、`h1`）独占一行、可设宽高；行内（如 `span`、`a`、`strong`）在一行内排列、宽高由内容决定。

**参考资料**：
- [MDN Web Docs — HTML](https://developer.mozilla.org/zh-CN/docs/Web/HTML)
- [MDN Web Docs — HTML 元素参考](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Element)
- [WHATWG — HTML 现行标准](https://html.spec.whatwg.org/)
