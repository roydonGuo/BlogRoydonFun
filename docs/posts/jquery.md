---
title: jQuery 入门到会用：DOM 操作、选择器、事件与动画全梳理
date: '2022-08-24 09:01:01'
category: 前端开发
cover: /images/posts/jquery/ethan-jquery-knowledge-map.webp
tags: [js, jQuery, DOM]
excerpt: 从“写得少，做的多”的宗旨出发，系统梳理 jQuery 的入口函数、$ 顶级对象、jQuery 对象与 DOM 对象互转、选择器、样式/效果/属性/内容操作、元素增删改、尺寸位置以及事件处理，配本地示例与运行时截图。
---

# jQuery 入门到会用：DOM 操作、选择器、事件与动画全梳理

<img src="/images/posts/jquery/ethan-jquery-knowledge-map.webp" alt="jQuery 入门到会用：DOM 操作、选择器、事件与动画全梳理知识串联图" style="border-radius: 10px;" />

很多刚学前端的人会有个疑问：**都 2026 年了，原生 JavaScript（简称 JS）这么强，为什么还要学 jQuery？**

答案很现实：jQuery 是大量历史项目、后台管理模板、插件生态的底座。你不一定从头写 jQuery，但你极有可能去维护、二次开发一个用 jQuery 写的项目。把它吃透，读别人代码、改老系统会顺手很多。

本文目标是：**让你拿到一个 jQuery 项目能读懂、能改、能写出正确的 jQuery 代码**。所有配图均为本地资源，离线也能看。

## 一、jQuery 是什么：为什么它曾经“统治”前端

**库（library）** 本质就是“别人封装好的一堆函数”，你直接调用来少写重复代码。**jQuery** 就是其中最经典的一个 JS 库，核心目的是：**更方便、更快速地操作 DOM（Document Object Model，文档对象模型）**。

它把原生 JS 里又臭又长的 DOM 操作、事件绑定、动画、Ajax 请求全部封装成了简洁的 API。学 jQuery，本质上就是**学怎么调用它封装好的一堆方法**。

> **核心宗旨：Write Less, Do More（写得少，做的多）。**

jQuery 解决的四件大事，也是它的四大能力：

- **DOM 操作（DOM manipulation）**：增删改查元素，比原生 `document.getElementById` 等写法统一得多。
- **事件处理（event handling）**：统一了各浏览器的事件绑定差异。
- **动画设计（animation）**：内置显示/隐藏、滑动、淡入淡出、自定义动画。
- **Ajax 交互（Ajax）**：一行 `$.ajax()` 搞定异步请求。

除此之外，它还有几个让人离不开的特性：

- **链式编程（chaining）**：一个对象连续调多个方法，`$('div').css('color','red').hide();`
- **隐式迭代（implicit iteration）**：选中多个元素后，方法自动逐个作用，不用手写 for 循环。
- **插件扩展（plugin）**：生态庞大，图表、轮播、日期选择器一装即用。
- **轻量、免费、开源**，且基本**兼容主流浏览器**。

<img src="/images/posts/jquery/jquery-01-overview.png" alt="jQuery 概览与特点" style="border-radius: 10px;" />

## 二、先把 jQuery 跑起来：下载与引入

去官网下载即可：<https://jquery.com/>

<img src="/images/posts/jquery/jquery-02-download.png" alt="jQuery 官网下载入口" style="border-radius: 10px;" />

**建议下载 3.x 版本**（兼容性好、仍维护、教程资料最多）：

<img src="/images/posts/jquery/jquery-03-version.png" alt="推荐下载 3.x 版本" style="border-radius: 10px;" />

进入下载页后，直接鼠标右键把页面**“另存为…”**保存成 `jquery.min.js`，再引入你的项目：

```html
<!-- 放在 </body> 之前，保证 DOM 已经存在 -->
<script src="jquery.min.js"></script>
```

<img src="/images/posts/jquery/jquery-04-download-page.png" alt="jQuery 下载页面与文件保存" style="border-radius: 10px;" />

> 记住：**必须先引入 jQuery，再写你的业务脚本**，否则 `$ is not defined`。

## 三、jQuery 的基本使用

### 1、入口函数：等 DOM 加载完再动手

原生 JS 里如果你把 `<script>` 写在 `<body>` 前面，去操作下面的元素会拿不到。jQuery 提供了**入口函数（entry function）**，作用是**等页面 DOM 结构加载完毕后再执行里面的代码**。

两种写法，效果等价：

```html
<body>
  <script>
    // 写法一（推荐）：DOM 加载完就执行
    $(function () {
      $('div').hide();
    });

    // 写法二：语义更完整
    $(document).ready(function () {
      $('div').hide();
    });
  </script>
  <div>114514</div>
</body>
```

- `$(function() { ... })` —— **最常用**，简洁。
- `$(document).ready(function() { ... })` —— 等价语义，**DOM 加载完成的入口**。

<img src="/images/posts/jquery/jquery-05-ready.png" alt="入口函数示例" style="border-radius: 10px;" />

### 2、$ 是 jQuery 的顶级对象

**`$` 是 jQuery 的别称（alias）**，代码里 `$` 和 `jQuery` 完全等价，为了方便大家都写 `$`。

`$` 相当于原生 JS 里的 `window`——它是 jQuery 的**顶级对象（top-level object）**。页面元素通过 `$()` 被“包装”成 **jQuery 对象**，然后才能调用 jQuery 的方法。

```html
<script>
  // $ 和 jQuery 可互换
  jQuery(function () {
    jQuery('div').hide(); // 等价于 $('div').hide();
  });
</script>
```

### 3、jQuery 对象 vs DOM 对象：最容易混淆的点

这是新手踩坑最多的地方，务必分清：

- 用**原生 JS** 获取来的对象，叫 **DOM 对象**（比如 `document.querySelector('div')`）。
- 用 **jQuery 方法** 获取来的对象，叫 **jQuery 对象**（比如 `$('div')`）。

**关键结论：jQuery 对象只能调用 jQuery 方法，DOM 对象只能调用原生 JS 方法和属性，两者不能混用。**

```html
<script>
  // DOM 对象：原生 JS 获取
  var div = document.querySelector('div');
  console.dir(div);

  // jQuery 对象：jQuery 获取
  console.dir($('div'));
</script>
```

控制台里你能清楚看到，DOM 对象暴露的是原生属性和方法，而 jQuery 对象外面套了一层 jQuery 的包装（伪数组结构，存着原生元素）：

<img src="/images/posts/jquery/jquery-06-console.png" alt="控制台中 DOM 对象与 jQuery 对象的区别" style="border-radius: 10px;" />

> 衔接上面的例子：
> - `div.style.display = 'none';` ✅ —— 这是原生 JS 写法，DOM 对象能调。
> - `$('div').style.display = 'none';` ❌ —— 这是错的！jQuery 对象没有 `style` 这种原生属性，**只能用 jQuery 封装的方法**（如 `.css()`）。

**两者如何互相转换？**

```html
<script>
  var div = document.querySelector('div');

  // jQuery 对象 → DOM 对象（两种方式，index 是索引号）
  $('div')[0].hide();      // 方式一：下标取
  $('div').get(0).hide();  // 方式二：get(index)

  // DOM 对象 → jQuery 对象（用 $ 包一下即可）
  $(div);
</script>
```

用一张图理清转换关系：

```mermaid
flowchart LR
  A[原生 DOM 元素<br/>document.querySelector] -->|"$(dom) 包装"| B[JQuery 对象<br/>$('div')]
  B -->|"下标 [index]<br/>或 get(index)"| A
  A -.->|只能调用| C[原生 JS 属性/方法<br/>.style / .innerHTML]
  B -.->|只能调用| D[jQuery 方法<br/>.css() / .hide()]
```

## 四、jQuery 常用 API

### 1、选择器：用 CSS 选择器找元素

原生 JS 获取元素的方式很杂，兼容性还不一致。jQuery 把它们统一了：**选择器直接写 CSS 选择器即可，但要加引号**。

```javascript
$("选择器")  // 里面写 CSS 选择器，必须加引号
```

**基础选择器**和原生 JS 获取方式基本一致：

<img src="/images/posts/jquery/jquery-07-selector-basic.png" alt="jQuery 基础选择器" style="border-radius: 10px;" />

**层级选择器（descendant / child selectors）** 用来按嵌套关系选元素：

<img src="/images/posts/jquery/jquery-08-selector-hierarchy.png" alt="jQuery 层级选择器" style="border-radius: 10px;" />

设置样式用 `.css()`：

```javascript
$('div').css('属性', '值');

// 例：把 ul 下所有 li 字体设为红色
$("ul li").css("color", "red");
```

这里就用到了 **隐式迭代**：`$("ul li")` 选中了多个 `<li>`，jQuery 会**自动遍历内部每个 DOM 元素**并逐个应用样式，你不用手写循环。

**筛选选择器（filter selectors）** 在基础选择器之上做过滤：

<img src="/images/posts/jquery/jquery-09-selector-filter.png" alt="jQuery 筛选选择器" style="border-radius: 10px;" />

```javascript
// 例：取 ul 下第一个 li 变红
$("ul li:first").css("color", "red");
```

除了筛选“选择器”，jQuery 还提供一批**筛选方法（filter methods）**，开发里更常用，重点记这几个：

| 方法 | 作用 | 记忆 |
|---|---|---|
| `parent()` | 找**亲父级** | 找亲爸 |
| `children()` | 找**亲儿子**（直接子元素） | 找亲儿子 |
| `find()` | 找**所有后代** | 找后代 |
| `siblings()` | 找**兄弟元素** | 找兄弟 |
| `eq(index)` | 按索引找某个元素 | 按号点名 |

<img src="/images/posts/jquery/jquery-10-filter-methods.png" alt="jQuery 筛选方法" style="border-radius: 10px;" />

### 2、样式操作：css() 与类操作

**（1）操作 CSS —— `css()` 方法**

```javascript
// 只写属性名 → 返回属性值
$(this).css('color');

// 属性名 + 属性值 → 设置一组样式（值可不加单位/引号）
$(this).css('color', 'red');

// 对象形式 → 一次设置多组样式（属性名可不加引号）
$(this).css({
  "width": "400px",
  height: 400,
  "color": "white",
  "font-size": "20px"
});
```

**（2）操作类样式 —— 类似原生 `classList`**

> 注意：操作类时**参数不要加点**。

```javascript
$("div").addClass('example');     // 添加类
$("div").removeClass('example');  // 移除类
$("div").toggleClass('example');  // 切换类（有则删，无则加）
```

> **类操作 vs `className` 的区别**：原生 `className` 会**覆盖**元素原有的类名；jQuery 的类操作**只针对指定类**，不影响其他已有类名。

### 3、效果（动画）：内置一堆现成动画

具体参数可查中文 API 文档：<https://jquery.cuishifeng.cn/>

jQuery 封装的动画家族一览：

<img src="/images/posts/jquery/jquery-11-effects.png" alt="jQuery 动画效果一览" style="border-radius: 10px;" />

下面三类方法参数含义一致，先统一记一下：

- `speed`：动画时长，可用字符串 `"slow"`/`"normal"`/`"fast"`，或毫秒数（如 `1000`）。
- `easing`：切换效果，默认 `"swing"`，可选 `"linear"`。
- `fn`：动画完成后的**回调函数（callback）**，每个元素执行一次。
- 中括号 `[...]` 表示参数可省略。

**（1）显示隐藏**

```javascript
show([speed, [easing], [fn]]);    // 显示
hide([speed, [easing], [fn]]);    // 隐藏
toggle([speed, [easing], [fn]]);  // 显示/隐藏切换
```

效果示意（带过渡动画的显示与隐藏）：

<img src="/images/posts/jquery/jquery-12-show-hide.gif" alt="jQuery 显示隐藏动画效果" style="border-radius: 10px;" />

**（2）滑动效果**

```javascript
slideDown([speed, [easing], [fn]]);   // 下滑展开
slideUp([speed, [easing], [fn]]);     // 上滑收起
slideToggle([speed, [easing], [fn]]); // 滑动切换
```

**（3）事件切换 `hover()`**

`hover([over,] out)` 是“鼠标经过 + 离开”的复合写法：

- `over`：鼠标移入触发（相当于 `mouseenter`）。
- `out`：鼠标移出触发（相当于 `mouseleave`）。
- 若只写一个函数，则**经过和离开都会触发它**。

经典案例：**导航栏下拉菜单**。HTML 结构是一个带二级 `<ul>` 的导航，CSS 默认隐藏二级菜单，jQuery 控制滑入滑出：

```html
<style>
  * { margin: 0; padding: 0; }
  li { list-style-type: none; }
  .nav { margin: 0 auto; height: 40px; border-bottom: 1px solid red; }
  .nav > li { position: relative; float: left; width: 80px; height: 41px; text-align: center; }
  .nav li a { display: block; width: 100%; height: 100%; line-height: 41px; color: #333; text-decoration: none; }
  .nav > li > a:hover { background-color: #eee; }
  .nav ul { display: none; position: absolute; top: 41px; left: 0; width: 100%; border: 1px solid red; border-top: none; }
  .nav ul li a:hover { background-color: #FFF5DA; }
</style>

<ul class="nav">
  <li><a href="#">导航一</a><ul><li><a href="">私信</a></li><li><a href="">评论</a></li><li><a href="">@我</a></li></ul></li>
  <li><a href="#">导航二</a><ul><li><a href="">私信</a></li><li><a href="">评论</a></li><li><a href="">@我</a></li></ul></li>
</ul>

<script src="jquery.min.js"></script>
<script>
  $(function () {
    // 鼠标经过下滑、离开上滑
    $(".nav>li").hover(
      function () { $(this).children("ul").stop().slideDown(200); },
      function () { $(this).children("ul").stop().slideUp(200); }
    );
  });
</script>
```

效果示意：

<img src="/images/posts/jquery/jquery-13-nav-dropdown.gif" alt="导航栏下拉菜单滑动效果" style="border-radius: 10px;" />

**（4）一个必踩的坑：动画排队**

如果快速来回划过导航，会出现“上一个动画没播完，下一个才开始排队”的卡顿：

<img src="/images/posts/jquery/jquery-14-queue-bug.gif" alt="动画排队导致的卡顿 bug" style="border-radius: 10px;" />

**原因**：动画一旦触发就会执行，多次触发就会排队依次播放（**动画队列 animation queue**）。

**解决：停止排队 —— `stop()`**

```javascript
// stop() 必须写在动画前面，结束上一次未播完的动画，只执行最新一次
$(".nav>li").hover(function () {
  $(this).children("ul").stop().slideToggle();
});
```

> 口诀：**动画前先 `stop()`，告别排队卡顿。**

**（5）淡入淡出**

```javascript
fadeIn([speed, [easing], [fn]]);     // 淡入
fadeOut([speed, [easing], [fn]]);    // 淡出
fadeToggle([speed, [easing], [fn]]); // 淡入淡出切换
fadeTo([[speed], opacity, [easing], [fn]]); // 渐进到指定不透明度（opacity 取值 0~1）
```

**（6）自定义动画 `animate()`**

```javascript
animate(params, [speed], [easing], [fn]);
// params：想改的样式，对象形式；复合属性用驼峰，如 borderLeft
```

### 4、属性操作：prop / attr / data

**固有属性（intrinsic attributes）** —— 元素天生自带的，如 `<a>` 的 `href`、`<input>` 的 `type`：

```javascript
prop('属性');          // 获取
prop('属性', '值');    // 设置
```

**自定义属性（custom attributes）** —— 你自己加的，如 `index="1"`：

```javascript
attr('属性');                 // 获取，类似原生 getAttribute()
attr('属性', '属性值');       // 设置，类似原生 setAttribute()
```

**数据缓存 `data()`** —— 在元素上存取数据，**不修改 DOM 结构**，本质存在元素缓存里，页面刷新即清除：

```javascript
$('span').data('uname', 'roydon'); // 存入
$('span').data('uname');           // 取出，得到数字型/字符串数据
// 取 H5 自定义属性 data-index 时，直接写 index 即可
```

### 5、内容文本值：html / text / val

| 方法 | 作用 | 对应原生 |
|---|---|---|
| `html()` | 获取/设置元素内容（含标签） | `innerHTML` |
| `text()` | 获取/设置文本内容 | `innerText` |
| `val()` | 获取/设置表单值 | `value` |

```javascript
html();          html("内容")
text();          text("文本内容")
val();           val("内容")

// 保留两位小数
(123.456).toFixed(2); // "123.46"
```

### 6、元素操作：遍历、创建、增删

**遍历元素（each）** —— 隐式迭代只能对同类元素做相同操作，`each` 可以**给每个元素做不同处理**。

语法一：`$(selector).each()` 遍历 DOM 集合

```javascript
// index：索引号；domEle：每个原生 DOM 元素（非 jQuery 对象）
$("div").each(function (index, domEle) {
  // 要用 jQuery 方法，需把 domEle 转成 jQuery 对象：$(domEle)
});
```

例：统计三个 div 内容之和

```html
<div>2</div><div>3</div><div>5</div>
<script>
  $(function () {
    var sum = 0;
    $('div').each(function (index, domEle) {
      sum += parseInt($(domEle).text());
    });
    console.log(sum); // 10
  });
</script>
```

<img src="/images/posts/jquery/jquery-15-each-sum.png" alt="each 遍历求和的控制台结果" style="border-radius: 10px;" />

语法二：`$.each()` 遍历任意对象/数组（常用于数据处理）

```javascript
// index：索引/属性名；element：值
$.each(object, function (index, element) {
  // 遍历数组时 index 为下标、element 为值
  // 遍历对象时 index 为属性名、element 为属性值
});
```

例：遍历对象 `{ name: "roydon", age: 20 }`

<img src="/images/posts/jquery/jquery-16-each-object.png" alt="$.each 遍历对象的控制台结果" style="border-radius: 10px;" />

**创建元素**

```javascript
$("<li></li>"); // 仅创建，尚未加入页面
```

**添加元素**

```javascript
// 内部添加（形成父子关系）
element.append('内容');   // 放到匹配元素内部最后面，类似 appendChild
element.prepend('内容');  // 放到匹配元素内部最前面

// 外部添加（形成兄弟关系）
element.after('内容');    // 放到目标元素后面
element.before('内容');   // 放到目标元素前面
```

**删除元素**

```javascript
element.remove(); // 删除匹配元素（自身）
element.empty();  // 删除匹配元素内的所有子节点
element.html(''); // 清空内容（也可设置新内容）
```

例：对 `<ul><li></li><li></li><li></li></ul>`

- `$("ul").remove();` → ul 连同 li 全删。
- `$("ul").empty();` → 只清空里面的 li。

### 7、尺寸与位置操作

**尺寸（dimensions）**

<img src="/images/posts/jquery/jquery-17-dimensions.png" alt="jQuery 尺寸相关方法" style="border-radius: 10px;" />

规则：**参数为空是取值，有参数是设置**。

```javascript
$("div").width();      // 获取宽度
$("div").width(300);   // 设置宽度为 300
```

**位置（position）** 主要三个：`offset()`、`position()`、`scrollTop()/scrollLeft()`

- `offset()`：**相对于文档**的偏移，与父级无关；有 `left`、`top` 两个属性；可设置 `offset({ top: 50, left: 50 })`。
- `position()`：**相对于带定位的父级**的偏移；若无定位父级则以文档为准；**只能获取不能设置**。
- `scrollTop()/scrollLeft()`：元素被卷去的头部/左侧距离；可传参设置。

## 五、jQuery 事件

### 1、事件注册

事件类型和原生基本一致：`click`、`mouseover`、`mouseout`、`blur`、`focus`、`change`、`keydown`、`keyup`、`resize`、`scroll` 等。

```javascript
element.事件(function () { /* 事件处理程序 */ });

// 例
$("div").click(function () {
  // ...
});
```

### 2、事件处理：on / off / trigger

**（1）`on()` 绑定事件** —— 在匹配元素上绑定一个或多个事件。

```javascript
element.on(events, [selector], fn);
// events：空格分隔的多个事件类型，如 "click" 或 "mouseover"
// selector：子元素选择器（用于事件委派）
// fn：回调函数
```

绑定多个事件：

```javascript
$("div").on({
  mouseover: function () {},
  mouseout: function () {},
  click: function () {}
});
// 若 mouseover 与 mouseout 逻辑相同，可合并：
// $("div").on("mouseover mouseout", function () { ... });
```

**事件委派（event delegation）** —— 把子元素事件委托给父级，动态创建的元素也能自动获得事件：

```javascript
// 把 li 的点击事件委派给父 ul，每个 li 都有
$('ul').on('click', 'li', function () {
  alert('hello world!');
});

// 动态创建的 li 也会自动绑定
var li = $("<li>后来创建的li</li>");
$("ul").append(li);
```

**（2）`off()` 解绑事件** —— 移除通过 `on()` 绑定的处理程序。

```javascript
$("p").off();                 // 解绑 p 上所有事件
$("p").off("click");          // 只解绑 click
$("ul").off("click", "li");   // 解绑事件委派
```

> 只想让事件触发一次：用 `one()` 替代 `on()` 即可。

**（3）`trigger()` 自动触发事件** —— 无需鼠标操作也能触发事件（如轮播图自动播放）。

```javascript
$("div").on("click", function () {
  $(this).css("background", "red");
});
$("div").triggerHandler("click"); // 自动触发，且不触发元素默认行为
// 另两种：$("div").click() 与 $("div").trigger("click") 会触发默认行为
```

### 3、事件对象 event

事件触发时会产生**事件对象（event object）**，用于阻止默认行为与冒泡：

```javascript
element.on(events, [selector], function (event) {
  event.preventDefault();   // 阻止默认行为（或 return false;）
  event.stopPropagation();  // 阻止冒泡
});
```

## 六、小结：jQuery 学习地图

把全文串成一张图，帮你建立整体认知：

```mermaid
flowchart TD
  A[引入 jQuery] --> B[入口函数 $(function)]
  B --> C["$ 顶级对象：包装出 jQuery 对象"]
  C --> D[jQuery 对象 ⇄ DOM 对象转换]
  C --> E[常用 API]
  E --> E1[选择器：基础/层级/筛选]
  E --> E2[样式：css / 类操作]
  E --> E3[效果：show/hide/slide/fade/animate]
  E --> E4[属性：prop/attr/data]
  E --> E5[内容：html/text/val]
  E --> E6[元素：each/增删改]
  E --> E7[尺寸位置：width/offset/scroll]
  C --> F[事件：on/off/trigger + event 对象]
```

**记住三句话就能上手：**

1. **`$()` 包一切**：原生元素包成 jQuery 对象，才能用 jQuery 方法。
2. **隐式迭代省循环**：选中多个元素，方法自动逐个作用。
3. **动画前加 `stop()`**：避免多次触发造成的排队卡顿。

jQuery 不神秘，就是“原生 JS 的语法糖 + 兼容性补丁 + 动画库”。把它当工具用熟，维护老项目、快速写交互都会轻松很多。

## 参考资料

- jQuery 官网：<https://jquery.com/>
- jQuery 中文 API 文档：<https://jquery.cuishifeng.cn/>
