---
title: CSS3
date: 2022-07-13 12:12:01
category: 前端开发
cover: /images/posts/css3/ethan-css3-knowledge-map.webp
tags: [css, 前端, 布局, 选择器, 盒子模型]
excerpt: 从 CSS 基础认识到盒子模型、浮动、定位与装饰，系统梳理 CSS3 核心知识点，配 50+ 图解与可直接复制的代码示例，适合前端入门与查漏补缺。
---

# CSS3 核心知识全梳理

<img src="/images/posts/css3/ethan-css3-knowledge-map.webp" alt="CSS3 核心知识全梳理知识串联图" style="border-radius: 10px;" />

**CSS（Cascading Style Sheets，层叠样式表）** 的作用是给 HTML 标签"化妆"——结构（HTML）负责有什么，样式（CSS）负责长什么样。本文按"基础认识 → 选择器 → 字体文本 → 背景 → 显示模式 → 三大特性 → 盒子模型 → 浮动 → 定位 → 装饰"的顺序，把 CSS3 的核心知识点串成一条线，配图全部为本地图片，代码示例均可直接复制运行。

> 结论先行：**HTML 管结构，CSS 管样式**。写页面时先搭骨架（HTML），再用 CSS 调外观，二者分离是前端工程化的起点。

## 一、CSS 基础认识

### 1、什么是 CSS

- 中文名称：**层叠样式表（Cascading Style Sheets，CSS）**
- 作用：**给页面中的 HTML 标签设置样式**

简单理解：HTML 是"毛坯房"，CSS 是"装修"。

![CSS 作用：给 HTML 标签设置样式](/images/posts/css3/01.png)

### 2、语法规范

CSS 写在 `<style>` 标签中，`<style>` 一般写在 `<head>` 里、`<title>` 下方。核心结构 = **选择器 + 声明块**：

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <title>Document</title>
    <!-- CSS位置 -->
    <style>
        /* 写在style标签中 */
        /* 选择器 */
        p {
            color: pink;                 /* CSS属性 key：value */
            background-color: aqua;
            font-size: 18px;             /* 字体默认大小：16px */
            width: 300px;
            height: 100px;
        }
    </style>
</head>
<body>
    <p>我是字体</p>
</body>
</html>
```

运行效果如下（粉色文字 + 浅绿背景 + 固定宽高）：

![第一段 style 标签代码实现效果](/images/posts/css3/02.png)

### 3、三种引入方式

| 方式 | 写法 | 适用场景 |
| --- | --- | --- |
| **内嵌式** | CSS 写在 `<style>` 标签中（如上） | 单页面、快速验证 |
| **行内式** | CSS 写在标签的 `style` 属性中 | 个别元素的临时覆盖 |
| **外联式** | CSS 写在独立 `.css` 文件，用 `<link>` 引入 | 实际项目（推荐） |

行内式示例：

```html
<p style="color: pink;">我是字体</p>
```

外联式结构（独立 `.css` 文件 + 引入）：

![外联式：CSS 写在单独的 .css 文件](/images/posts/css3/03.png)

## 二、选择器

**选择器（Selector）** 是 CSS 的"瞄准镜"——告诉浏览器"这段样式作用在哪些元素上"。

### 1、基础选择器

| 选择器 | 语法 | 特点 |
| --- | --- | --- |
| **标签选择器** | `标签名 { }` | 选中一类标签，一选一大片 |
| **类选择器** | `.类名 { }` | 最常用，一个标签可多类名，多标签可共用类名 |
| **id 选择器** | `#id { }` | 一个标签只能有一个 id，一选一个；通常配合 JS |
| **通配符选择器** | `* { }` | 选中所有标签，极特殊场景才用 |

标签选择器：

![标签选择器示例](/images/posts/css3/04.png)

类选择器（用得最多）：

![类选择器示例](/images/posts/css3/05.png)

id 选择器：

![id 选择器示例](/images/posts/css3/06.png)

通配符选择器：

![通配符选择器示例](/images/posts/css3/07.png)

四类基础选择器综合效果：

![基础选择器综合效果](/images/posts/css3/08.png)

### 2、进阶选择器

| 选择器 | 语法 | 作用 |
| --- | --- | --- |
| **后代选择器** | `选择器1 选择器2 { }` | 选父元素内所有满足条件的后代（空格隔开） |
| **子代选择器** | `选择器1 > 选择器2 { }` | 只选直接子元素 |
| **并集选择器** | `选择器1 , 选择器2 { }` | 同时选中多组，设相同样式 |
| **交集选择器** | `选择器1选择器2 { }` | 同时满足多个选择器（紧挨写） |
| **hover 伪类** | `选择器 : hover { }` | 鼠标悬停时的状态 |

> 结论：**后代用空格，子代用 `>`，并集用逗号，交集紧挨写**。

![进阶选择器（后代/子代/并集/交集/hover）总结](/images/posts/css3/09.png)

### 3、Emmet 语法

VSCode 里的快捷写法（输入缩写 + Tab 自动生成）：

![Emmet 语法（vscode 快捷写法）](/images/posts/css3/10.png)

### 4、结构伪类选择器

根据元素在 HTML 中的**结构关系**查找，常用于列表、表格的奇偶行等：

![结构伪类选择器（:first-child 等）](/images/posts/css3/28.png)

![结构伪类选择器（续）](/images/posts/css3/29.png)

其中 `:nth-child(n)` 的小括号里可以写数学公式，`n` 取值为 0、1、2、3……：

![nth-child(n) 公式示例](/images/posts/css3/30.png)

### 5、伪元素

**伪元素（Pseudo-element）** 由 CSS 创建出来的"虚拟标签"（如 `::before`、`::after`）：

- **必须设置 `content` 属性才生效**
- 伪元素**默认是行内元素**

![伪元素（::before / ::after）示意](/images/posts/css3/31.png)

![伪元素示例](/images/posts/css3/32.png)

## 三、字体与文本样式

### 1、字体样式

| 属性 | 作用 | 常用值 |
| --- | --- | --- |
| `font-size` | 字体大小 | 数字 + `px`（谷歌默认 16px） |
| `font-weight` | 字体粗细 | `normal` / `bold`，或 100~900 整百数 |
| `font-style` | 字体样式 | `normal` / `italic`（倾斜） |
| `font-family` | 字体类型 | `"Microsoft YaHei"`、黑体、宋体… |

`font-family` 会从左往右按顺序查找，电脑没装就顺延，都不支持则按系统默认字体：

![font-family 字体类型示例](/images/posts/css3/11.png)

**`font` 连写**（复合属性）：`font: style weight size family;`。注意：单独样式要么写在连写下面，要么写进连写里。

### 2、文本样式

- **文本缩进**：`text-indent: 2em;` （两字符）
- **文本水平对齐**：`text-align`

![text-align 文本水平对齐示例](/images/posts/css3/12.png)

- **文本修饰** `text-decoration`：`underline`(下划线) / `line-through`(删除线) / `overline`(上划线) / `none`(无修饰，常用来去掉链接下划线)

### 3、line-height 行高

| 取值 | 含义 |
| --- | --- |
| 数字 + `px` | 固定行高 |
| 倍数 | 相对当前文字大小 |
| `line-height: 1` | 取消上下间距 |

连写时 `size` 和 `line-height` 用 `/` 隔开（如 `font: 16px/1.5 ...`）：

![line-height 行高示意](/images/posts/css3/13.png)

### 4、颜色

- 文字颜色：**`color`**
- 背景颜色：**`background-color`**

![文字颜色 color / 背景颜色 background-color](/images/posts/css3/14.png)

大盒子水平居中：`margin: 0 auto`（块级元素 + 有宽度时才生效）。

## 四、背景相关属性

| 属性 | 作用 |
| --- | --- |
| `background-color` | 背景颜色（默认透明 `transparent`） |
| `background-image: url('路径')` | 背景图片（默认水平+垂直平铺） |
| `background-repeat` | 背景平铺方式 |
| `background-position` | 背景位置 |

背景平铺 `background-repeat`：

![background-repeat 背景平铺](/images/posts/css3/15.png)

背景位置 `background-position: 水平 垂直;`：

![background-position 背景位置](/images/posts/css3/16.png)

**连写推荐**：`background: color image repeat position`，例如 `background: url(./img/tb.gif) no-repeat left center;`

## 五、元素显示模式

| 模式 | 特点 | 能否设宽高 | 代表标签 |
| --- | --- | --- | --- |
| **块级 block** | 独占一行，宽度默认父级，高度由内容撑开 | ✅ | `div`、`p`、`h` 系列、`ul/li`、`form`、`header/nav/footer` |
| **行内 inline** | 一行多个，宽高由内容撑开 | ❌ | `a`、`span`、`b`、`u`、`i`、`strong` |
| **行内块 inline-block** | 一行多个，可设宽高 | ✅ | `input`、`textarea`、`button`、`select` |

通过 `display` 可互相转换：

![元素显示模式转换示意 1](/images/posts/css3/17.png)

![元素显示模式转换示意 2](/images/posts/css3/18.png)

## 六、CSS 三大特性

1. **继承性**：控制文字的属性（color、font、text-* 等）能继承给子元素。
2. **层叠性**：同元素多规则冲突时，后写的覆盖先写的。
3. **优先级**：当不同选择器选中同一元素，**优先级高的生效**。

优先级（权重）从高到低：**行内样式 > id > 类/伪类 > 标签 > 通配符**。

![CSS 优先级（权重）示意](/images/posts/css3/19.png)

> 记忆口诀：**行内(1000) > id(100) > 类(10) > 标签(1)**。权重可叠加，比较时"先比高位，高位大者胜"。

## 七、盒子模型

**核心结论**：页面中每个标签都是一个**盒子（Box）**。浏览器渲染时把元素当成矩形区域，这就是**盒子模型（Box Model）**。

一个盒子由四部分组成：

:::mermaid
flowchart LR
    A[margin 外边距] --> B[border 边框]
    B --> C[padding 内边距]
    C --> D[content 内容区域]
    style D fill:#fde2e2,stroke:#e89
    style C fill:#e2f0fd,stroke:#69c
    style B fill:#e6f7e6,stroke:#6a6
    style A fill:#f3e8ff,stroke:#a6c
:::

> 重点：`width` 和 `height` 默认设置的是**内容区域（content）**的大小，不是整个盒子的大小。

### 1、边框 border

边框三要素：**粗细 + 样式 + 颜色**。

一般直接连写：`border: 10px solid red;`

给某一侧单独设：`border-方位名词: 10px solid red;`（如 `border-top`）

![border 边框示意](/images/posts/css3/20.png)

![border 方位单独设置](/images/posts/css3/21.png)

完整盒子模型示例：

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <title>Document</title>
    <style>
        div {
            width: 300px;
            height: 300px;
            background-color: pink;
            border: 10px solid orange;  /* 边框线 */
            padding: 10px;              /* 内边距 */
            margin: 20px;               /* 外边距 */
        }
    </style>
</head>
<body>
    <div>Hello World</div>
    <div>Hello CSS</div>
</body>
</html>
```

效果（带边框、内边距、外边距的盒子）：

![盒子模型效果动画](/images/posts/css3/22.gif)

![盒子模型效果截图](/images/posts/css3/23.png)

### 2、内边距 padding

**内边距（padding）** = 边框 到 内容区域 的距离。

| 写法 | 含义 |
| --- | --- |
| `padding: 20px;` | 上下左右各 20px |
| `padding: 20px 30px;` | 上下 20px、左右 30px |
| `padding-left: 50px;` | 仅左侧 50px |

![padding 内边距示意](/images/posts/css3/24.png)

![padding 取值示例](/images/posts/css3/25.png)

**固定盒子尺寸**的小技巧：设 `box-sizing: border-box;` 后，`width/height` 就包含 padding 和 border，布局更可控。

```css
/* 固定盒子尺寸 */
box-sizing: border-box;
```

### 3、外边距 margin

清除浏览器默认内外边距（项目标配）：

```css
* {
    margin: 0;
    padding: 0;
}
```

**外边距折叠**现象：

- **垂直外边距合并**：相邻块级元素上下 margin 会合并（取较大值）。
- **margin 塌陷**：子元素的 `margin-top` "顶破"父元素。解决办法：
  1. 给父元素加 `border-top` 或 `padding-top`；
  2. 给父元素加 `overflow: hidden`；
  3. 父/子转成行内块或浮动。

> 注意：**行内元素**的 `margin` 和 `padding` 只有**水平方向**生效，垂直方向无效。

### 4、父盒子中子盒子居中（六种方法）

基础结构：

```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>HTML5</title>
    <style>
        * { padding: 0; margin: 0; box-sizing: border-box; }
        .father {
            height: 500px; width: 500px;
            background-color: pink; margin: 0 auto;
        }
        .son {
            height: 200px; width: 200px;
            background-color: aqua; color: pink;
        }
    </style>
</head>
<body>
    <div class="father">父盒子
        <div class="son">俺是子盒子</div>
    </div>
</body>
</html>
```

| 方法 | 核心代码 | 要点 |
| --- | --- | --- |
| ① absolute + transform | `position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);` | `translate` 百分比相对**自身**尺寸，最常用 |
| ② flex | `display:flex; justify-content:center; align-items:center;` | 最简单，现代首选 |
| ③ absolute + margin:auto | 四边 `0` + `margin:auto` | 父相对、子绝对 |
| ④ table-cell | `display:table-cell; vertical-align:middle;` + 子 `margin:auto` | 父 margin 居中失效 |
| ⑤ absolute + 负 margin | `left:50%; top:50%; margin:-100px ...` | 仅适合子盒子**固定宽高** |
| ⑥ inline-block | 父 `text-align:center; line-height:500px;`，子 `vertical-align:middle` | 父有内容时居中失效 |

> 结论：日常开发**首选 flex（②）**；要兼容老浏览器用 **absolute + transform（①）**。

## 八、浮动

### 1、为什么需要浮动

看这段代码：两个 `inline-block` 的 div，本想紧挨，结果中间出现莫名间距：

![行内块元素换行产生的间距问题](/images/posts/css3/26.png)

原因是：浏览器解析行内/行内块标签时，**标签换行也会被当成一个空格距离**：

![换行导致间距的原因](/images/posts/css3/27.png)

全写一行能消除间距，但可读性崩了。于是引入**浮动**来解决"块级元素水平排列"的问题。

### 2、标准流

**标准流（Normal Flow，又称文档流）** 是浏览器默认的排版规则：

- **块级元素**：从上往下，垂直布局，独占一行
- **行内 / 行内块元素**：从左往右，水平布局，空间不够自动折行

![标准流：块级元素垂直布局](/images/posts/css3/34.png)

![标准流：行内 / 行内块水平布局](/images/posts/css3/35.png)

### 3、浮动特性

浮动类比 Word 里图片环绕文字：

```html
<img class="img2" src="./img/csdn_head.png" alt="">  <!-- float: left -->
```

![浮动效果：图片环绕文字（word 式）](/images/posts/css3/33.png)

特点：

- 脱离标准流，像"图层"叠放，不影响原标签；
- 一行可多个、可设宽高（具备行内块特性）；
- 后一个浮动会挨着前一个浮动；
- 浮动后 `margin: 0 auto;` 居中失效（可外层嵌套 div 解决）。

### 4、清除浮动

**作用**：清除浮动带来的"父盒子高度塌陷"影响。场景：父盒子不方便设高度，子元素有多少内容展示多少。

:::mermaid
flowchart TD
    A[清除浮动] --> B[① 给父元素设高度<br/>（麻烦）]
    A --> C[② 额外标签法<br/>末尾加块级元素 clear:both]
    A --> D[③ 单伪元素法<br/>::after + clear:both]
    A --> E[④ 双伪元素法 ★<br/>::before/::after]
    A --> F[⑤ overflow:hidden]
:::

推荐**双伪元素法**：

```css
.clearfix::before,
.clearfix::after {
    content: '';
    display: table;
}
.clearfix::after {
    clear: both;
}
```

单伪元素法（也常用）：

```css
.clearfix::after {
    content: '';
    display: block;   /* 伪元素行内转块 */
    clear: both;
}
```

## 九、定位

### 1、三种常见布局方式

| 方式 | 说明 |
| --- | --- |
| **标准流** | 块级垂直、行内水平，浏览器默认 |
| **浮动** | 让块级变水平排列，子元素浮在父上方（图片环绕效果） |
| **定位** | 让元素摆到页面任意位置，处理**盒子叠层**问题，可固定在屏幕某处 |

![定位：盒子叠层效果示例](/images/posts/css3/36.png)

使用定位两步：① 设定位方式；② 设偏移量（水平 + 垂直就近各取一个）。

![定位偏移量设置示意](/images/posts/css3/37.png)

### 2、四种定位方式

| 定位 | 代码 | 参照物 | 是否脱标 |
| --- | --- | --- | --- |
| **静态** static | `position: static` | 默认，不能移动 | 否 |
| **相对** relative | `position: relative` | 自己原位置 | 否（原位置保留） |
| **绝对** absolute | `position: absolute` | 最近有定位的祖先（子绝父相） | 是 |
| **固定** fixed | `position: fixed` | 浏览器窗口 | 是 |

**相对定位**：相对自己原位置移动，原位置仍占着：

![相对定位效果](/images/posts/css3/38.png)

![相对定位剖析（参考线）](/images/posts/css3/39.png)

> 注意：`left` 和 `right` 同时存在只认 `left`；`top` 和 `bottom` 同时存在只认 `top`；属性值可为负。

**绝对定位**：子绝父相。脱标后具备行内块特点，`margin:0 auto` 失效。居中用：

```css
position: absolute;
left: 50%; top: 50%;
transform: translate(-50%, -50%);  /* 位移自身宽高一半，支持奇偶数 */
```

**固定定位**：相对浏览器窗口，常用于吸顶导航。

## 十、装饰

### 1、垂直对齐 vertical-align

行内块/行内元素按**文字基线（baseline）**对齐，类似英语本写法：

![基线对齐（行内块以基线为基准）](/images/posts/css3/40.png)

![vertical-align 对齐示意](/images/posts/css3/41.png)

![vertical-align 案例](/images/posts/css3/42.png)

### 2、光标类型 cursor

鼠标悬停时显示的样式：

![cursor 光标类型](/images/posts/css3/43.png)

### 3、边框圆角 border-radius

属性名 `border-radius`，值可为数字 + `px` 或百分比。

![border-radius 圆角属性](/images/posts/css3/44.png)

原理是按四角切圆：

![圆角原理（四角圆切）](/images/posts/css3/45.png)

**赋值规则**：从左上角开始顺时针，没赋值的看对角。例如 `border-radius: 40px 80px 120px;` 只给左上、右上、右下赋值。

![border-radius 赋值规则效果](/images/posts/css3/46.png)

案例 1 —— 画圆圈（正方形 + `border-radius: 50%`）：

![画圆圈（border-radius: 50%）](/images/posts/css3/47.png)

案例 2 —— 胶囊按钮（长方形 + 高度一半圆角）：

![胶囊按钮效果（圆角 + hover）](/images/posts/css3/48.gif)

```css
border-radius: 40px 40px;  /* 高度的一半 */
```

### 4、溢出显示 overflow

盒子固定高度、内容过多时会溢出：

![overflow 溢出情况](/images/posts/css3/49.png)

用 `overflow` 控制：

![overflow 属性取值示意](/images/posts/css3/50.png)

![overflow 案例](/images/posts/css3/51.png)

### 5、元素本身隐藏

| 属性 | 行为 |
| --- | --- |
| `visibility: hidden` | **占位隐藏**（位置保留） |
| `display: none` | **不占位隐藏**（常用） |
| `opacity: 小数` | 整体透明度（占位） |

常用于导航 hover 显隐：

![元素 hover 显示 / 隐藏效果](/images/posts/css3/52.gif)

### 6、链接与焦点伪类

**链接伪类**（常用于 `a` 标签）：

![链接伪类选择器（a:hover 等）](/images/posts/css3/53.png)

**焦点伪类** `:focus`（用于表单控件）：

![焦点伪类选择器（表单 :focus）](/images/posts/css3/54.png)

## 总结

- **结构用 HTML，样式用 CSS**，三者引入方式各有适用场景。
- **选择器**是核心武器：基础（标签/类/id/通配符）+ 进阶（后代/子代/并集/交集/hover）+ 结构伪类 + 伪元素。
- **盒子模型**是布局的基石：content / padding / border / margin，居中首选 flex。
- **浮动**解决块级水平排列，**清除浮动**用双伪元素最稳。
- **定位**解决叠层与固定，记住"子绝父相"和 `transform` 居中。
- **装饰**（`vertical-align` / `cursor` / `border-radius` / `overflow` / 隐藏）是细节打磨。

> 学 CSS 的捷径就一句：**多写多调，对着浏览器开发者工具改样式**，比背概念快十倍。

## 参考资料

- MDN Web Docs — [CSS](https://developer.mozilla.org/zh-CN/docs/Web/CSS)（权威属性文档）
- W3C CSS 规范 — [Cascading Style Sheets](https://www.w3.org/Style/CSS/)
- VitePress 官方文档 — [Markdown 扩展](https://vitepress.dev/guide/markdown)（本项目基于 VitePress 渲染）
