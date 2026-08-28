---
title: jQuery之Ajax
date: 2022-08-24 09:12:01
category: 前端开发
cover: /images/posts/jquery-ajax/ethan-jquery-ajax-knowledge-map.webp
tags: [jQuery, Ajax, 前端请求, XMLHttpRequest]
excerpt: 从 $.get / $.post / $.ajax 三件套到 serialize 取表单，从 art-template 模板引擎到原生 XMLHttpRequest，讲清 jQuery 发起异步请求的写法、参数与底层原理。
---

# jQuery之Ajax

<img src="/images/posts/jquery-ajax/ethan-jquery-ajax-knowledge-map.webp" alt="jQuery之Ajax 知识串联图" style="border-radius: 10px;" />

Ajax 全称 **异步 JavaScript 和 XML**（Asynchronous JavaScript And XML）。在网页里借助 **XMLHttpRequest（XHR）** 对象与服务器做数据交互，这种方式就叫 Ajax。它最大的价值是**不刷新整页就能局部更新数据**——点了按钮、填了表单，页面不跳走，只把需要的部分换掉。

![Ajax 浏览器与服务端异步数据交互示意](/images/posts/jquery-ajax/00-ajax-concept.png)

下文从「先备工具」讲起，再到 jQuery 封装的三件套、模板引擎渲染、最后回归原生 XHR 本质，把异步请求这条链路拆开看。

## 一、接口调试工具

动手写请求前，先备一个能发请求、看响应的工具。PostMan 与 apifox 都能做接口调试，后者有中文界面。

- PostMan 下载：<https://www.postman.com/downloads/>
- apifox：<https://www.apifox.cn/>（帮助文档 <https://www.apifox.cn/help/>）

![PostMan 接口调试界面](/images/posts/jquery-ajax/01-postman.png)

![apifox 接口调试界面](/images/posts/jquery-ajax/02-apifox.png)

## 二、jQuery 的 Ajax 三件套

日常基本不会手写 XHR（第三节会讲），而是用 jQuery 封装好的三个方法。它们的关系是：**$.ajax() 是底层通用接口，$.get() 与 $.post() 是它针对 GET / POST 的简化封装**。

:::mermaid
flowchart LR
    A[浏览器页面] --> B[jQuery 封装]
    B -->|$.get / $.post / $.ajax| C[XMLHttpRequest]
    C -->|HTTP 请求| D[服务器]
    D -->|JSON 响应| C
    C -->|success 回调| A
:::

### 1、$.get()：向服务器拉数据

功能单一，发起 **GET 请求**（GET）向服务器索取数据。

```javascript
$.get(url, [data], [callback])
// url      string  要请求的资源地址
// data     object  请求期间携带的参数
// callback function 请求成功时的回调函数
```

```javascript
$.get('http://www.liulongbin.top:3006/api/getbooks', { id: 1 }, function (res) {
  console.log(res)
})
```

### 2、$.post()：向服务器交数据

发起 **POST 请求**（POST）向服务器提交数据。

```javascript
$.post(url, [data], [callback])
// url      string  提交数据的地址
// data     object  要提交的数据
// callback function 提交成功时的回调函数
```

```javascript
$.post('http://www.liulongbin.top:3006/api/addbook',
  { bookname: '水浒传', author: '施耐庵' },
  function (res) { console.log(res) })
```

### 3、$.ajax()：全功能接口

前两个搞不定的复杂场景（自定义请求头、超时、错误处理）用它，所有配置项都能写进去。

```javascript
$.ajax({
  type: 'GET',                   // 请求方式 GET 或 POST
  url: '',                       // 请求的 URL（必填）
  data: {},                      // 请求携带的数据
  success: function (res) {}     // 请求成功后的回调
})
```

常用配置项：

| 配置项 | 含义 | 说明 |
| --- | --- | --- |
| `type` | 请求方式 | `GET` / `POST` |
| `url` | 请求地址 | 必填 |
| `data` | 发送数据 | object，jQuery 自动序列化 |
| `success` | 成功回调 | 参数为服务器响应数据 |
| `error` | 失败回调 | 网络异常或状态码出错时触发 |
| `dataType` | 预期返回类型 | `json` / `text` / `html` |

### 4、serialize()：一把取走表单数据

jQuery 的 **serialize()** 函数能一次性拿到表单里所有带 `name` 的字段，拼成 `key=value&...` 的查询字符串，省去手动拼接。

```html
<form id="form1">
  <input type="text" name="name" />
  <input type="password" name="password" />
  <button type="submit">提交</button>
</form>
```

```javascript
$('#form1').serialize()
// 结果：name=值&password=值
```

**要点：每个表单元素必须加 `name` 属性，否则 serialize() 取不到它。** 这一点最容易漏。

## 三、模板引擎：用 art-template 渲染列表

拿到服务器返回的数组或对象后，总不能一个个拼字符串往 DOM 里塞。模板引擎帮把「数据」与「HTML 模板」分离，**数据变、视图变，逻辑清晰**。

**art-template** 是轻量模板引擎，官网：<http://aui.github.io/art-template/zh-cn/index.html>

最小示例（在页面里引入引擎与 jQuery，再定义模板）：

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>模板引擎</title>
  <!-- 1. 引入模板引擎与 jQuery -->
  <script src="./lib/template-web.js"></script>
  <script src="./lib/jquery.js"></script>
</head>
<body>
  <div id="container"></div>

  <!-- 2. 定义模板，type 必须为 text/html 才会被当作模板而非脚本执行 -->
  <script type="text/html" id="example">
    <h1>{{name}}</h1>
  </script>

  <script>
    // 3. 准备数据
    var data = { name: 'roydon' }
    // 4. 调用 template(模板id, 数据) 得到渲染后的 HTML
    var temp = template('example', data)
    // 5. 塞进页面
    $('#container').html(temp)
  </script>
</body>
</html>
```

标准语法：

```html
{{value}}
{{obj.key}}            // 输出对象属性
{{obj['key']}}
{{a ? b : c}}          // 三元表达式
{{a || b}}             // 逻辑或
{{a + b}}              // 运算
{{@ value }}           // 原样输出 HTML（不转义，用于含标签的数据）
```

条件输出：

```html
{{if condition}} 按需输出的内容 {{/if}}
{{if condition1}} 内容1 {{else if condition2}} 内容2 {{/if}}
```

循环输出（数组自带 `$index` 下标与 `$value` 值）：

```html
{{each arr}}
  <li>索引:{{$index}} 值:{{$value}}</li>
{{/each}}
```

过滤器（管道 `|` 把值交给处理函数）：

```html
{{value | filterName}}

template.defaults.imports.filterName = function (value) {
  return /* 处理结果，必须有 return */
}
```

### 手搓一个模板引擎

模板引擎的本质，就是用正则把 `{{ }}` 占位符替换成数据。下面拆解原理。

**exec()** 是正则的检索方法：匹配到返回结果数组，否则返回 `null`；结果里第一项是整段匹配，后续项是捕获分组。

```javascript
var str = '<div>我是{{name}}</div>'
var pattern = /{{([a-zA-Z]+)}}/
var result = pattern.exec(str)
// ["{{name}}", "name", index: 7, input: "<div>我是{{name}}</div>", groups: undefined]
```

正则里 `()` 包起来的是**捕获分组**（capturing group），从这里能拿到 `name` 这个键名。再配合 **replace()** 把占位符替换成真实数据：

```javascript
var data = { name: '张三', age: 20 }
var str = '<div>{{name}}今年{{ age }}岁了</div>'
var pattern = /{{\s*([a-zA-Z]+)\s*}}/
var m = null
while ((m = pattern.exec(str))) {
  str = str.replace(m[0], data[m[1]])   // m[0] 是 {{name}}，m[1] 是 name
}
console.log(str) // <div>张三今年20岁了</div>
```

套上 `id` 取模板、封装成函数，就是最小模板引擎：

```javascript
function template(id, data) {
  var str = document.getElementById(id).innerHTML
  var pattern = /{{\s*([a-zA-Z]+)\s*}}/
  var m = null
  while ((m = pattern.exec(str))) {
    str = str.replace(m[0], data[m[1]])
  }
  return str
}
```

## 四、回归本源：原生 XMLHttpRequest

jQuery 的三个方法都是基于 **XMLHttpRequest（XHR）** 封装的。理解 XHR，才知道上层封装到底省了什么。

发起 GET 请求分四步：

```javascript
var xhr = new XMLHttpRequest()                                  // 1. 创建对象
xhr.open('GET', 'http://www.liulongbin.top:3006/api/getbooks')  // 2. 调用 open
xhr.send()                                                       // 3. 发起请求
xhr.onreadystatechange = function () {                          // 4. 监听状态变化
  if (xhr.readyState === 4 && xhr.status === 200) {
    console.log(xhr.responseText)   // 服务器返回的 JSON 字符串
  }
}
```

**`readyState === 4` 表示请求完成，`status === 200` 表示服务器成功响应**，两个条件同时满足才算拿到有效数据。

POST 请求多一步——设置 **Content-Type** 并把数据以查询字符串提交：

```javascript
var xhr = new XMLHttpRequest()
xhr.open('POST', 'http://www.liulongbin.top:3006/api/addbook')
xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded') // 关键：声明提交格式
xhr.send('bookname=水浒传&author=施耐庵&publisher=上海图书出版社')
xhr.onreadystatechange = function () {
  if (xhr.readyState === 4 && xhr.status === 200) {
    console.log(xhr.responseText)
  }
}
```

:::mermaid
sequenceDiagram
    participant B as 浏览器
    participant X as XMLHttpRequest
    participant S as 服务器
    B->>X: new + open(GET, url)
    B->>X: send()
    X->>S: HTTP GET 请求
    S-->>X: 响应体 responseText
    X-->>B: readyState=4, status=200
    B->>B: success 回调处理数据
:::

### JSON 与 JS 对象的互转

服务器返回的多是 JSON 字符串，要用 **JSON.parse()** 转成对象；要把数据发给服务器时用 **JSON.stringify()**。

```javascript
var obj = JSON.parse('{"a": "Hello", "b": "World"}')   // 字符串 -> 对象：{a:'Hello', b:'World'}
var json = JSON.stringify({ a: 'Hello', b: 'World' })   // 对象 -> 字符串：'{"a":"Hello","b":"World"}'
```

Ajax 异步请求的本质就是：浏览器发请求不阻塞页面，等服务器回了数据，在回调里把 JSON 解析成对象，再交給模板引擎渲染到 DOM。三件套、模板引擎、XHR 串起来，就是一条完整的数据流。

**要点回顾**：`$.get()/$post()/$ajax()` 是 XHR 的封装，越往后越通用；`serialize()` 取表单必须先给元素加 `name`；模板引擎用正则替换 `{{ }}` 占位符；原生 XHR 靠 `readyState===4 && status===200` 判定成功；JSON 与对象互转用 `parse()` / `stringify()`。

**关联知识点**：**Fetch API**（浏览器原生异步请求新标准，基于 Promise）；**axios**（现更常用的请求库）；**同源策略与 CORS**（跨域为什么会报错）；**Promise 与 async/await**（摆脱回调嵌套）；**formData**（上传文件时的数据格式）。

**面试常问**：`$.ajax` 与 `fetch` 的区别？—— 答：`$.ajax` 基于 XHR、回调风格、需引入 jQuery；`fetch` 基于 Promise、原生无依赖，但默认不带 cookie、错误状态码不进 reject，需手动处理。

**参考资料**：
- jQuery 官方 Ajax 文档：<https://api.jquery.com/jquery.ajax/>
- art-template 官网：<http://aui.github.io/art-template/zh-cn/index.html>
- MDN XMLHttpRequest：<https://developer.mozilla.org/zh-CN/docs/Web/API/XMLHttpRequest>
- 文中示例接口：<http://www.liulongbin.top:3006>
