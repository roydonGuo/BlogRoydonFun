---
title: Node.js
date: 2022-08-30 11:31:20
category: 后端开发
cover: /images/posts/node.js/ethan-nodejs-knowledge-map.webp
tags: [node.js, javascript, express, mysql, jwt, backend]
excerpt: 从 Node.js 运行环境、fs/path/http 内置模块，到模块化与 npm、Express 框架、数据库整合，再到 Session 与 JWT 身份认证，系统梳理 Node.js 后端开发基础。
---

# Node.js

<img src="/images/posts/node.js/ethan-nodejs-knowledge-map.webp" alt="Node.js 知识串联图" style="border-radius: 10px;" />

**Node.js** 是一个基于 Chrome **V8 引擎**（V8 Engine）的 JavaScript 运行环境（**R**untime）。它把浏览器里只能跑在前端的 JavaScript，带到了服务器端，让一门语言通吃前后端成为可能。

这篇内容按「运行环境 → 内置模块 → 模块化与包管理 → Web 框架 Express → 数据库 → 身份认证」的顺序递进，覆盖 Node.js 后端开发最基础也最常踩坑的部分。

## 一、Node.js 是什么

### 1、前置知识

上手 Node.js 之前，需要先把几条基础线理清：JavaScript 基本语法、浏览器里 JS 能做什么、以及它为什么不能直接当后端用。

<img src="/images/posts/node.js/prereq.webp" alt="Node.js 学习前置知识：需要掌握的 JavaScript 基础与环境铺垫" style="border-radius: 10px;" />

### 2、浏览器中的 JavaScript

在浏览器环境里，JavaScript 依托宿主提供的 **BOM**（Browser Object Model）和 **DOM**（Document Object Model）操作页面，靠 **Ajax**（Asynchronous JavaScript And XML）发起网络请求。

<img src="/images/posts/node.js/browser-js.webp" alt="浏览器中的 JavaScript：依托 DOM/BOM 与 Ajax 运行" style="border-radius: 10px;" />

### 3、Node.js 与浏览器的区别

两者都能跑 JavaScript，但**运行环境**（Runtime）完全不同：浏览器是前端运行环境，Node.js 是后端运行环境。Node.js 里拿不到 `document`、`window` 这类浏览器内置 API，取而代之的是文件、网络等操作系统能力。

<img src="/images/posts/node.js/node-vs-browser.webp" alt="Node.js 与浏览器运行环境对比：浏览器有 DOM/BOM，Node.js 有 fs/http 等系统能力" style="border-radius: 10px;" />

关键结论：**浏览器是 JavaScript 的前端运行环境，Node.js 是 JavaScript 的后端运行环境；Node.js 中无法调用 DOM 和 BOM 等浏览器内置 API。**

- 浏览器是 JavaScript 的前端运行环境。
- Node.js 是 JavaScript 的后端运行环境。Node.js 中无法调用 DOM 和 BOM 等浏览器内置 API。

官方地址：[https://nodejs.org/zh-cn/](https://nodejs.org/zh-cn/)

<img src="/images/posts/node.js/nodejs-intro.webp" alt="Node.js 官网介绍：基于 V8 引擎的 JavaScript 运行环境" style="border-radius: 10px;" />

### 4、终端操作小技巧

在 Node.js 终端里高频用到的几个快捷键：

- **Tab 键**：快速补全路径。
- **Esc 键**：清空当前已输入的命令。
- **cls 命令**：清空终端屏幕。

## 二、fs 文件系统模块

**fs 模块**（File System）是 Node.js 官方提供的、用来操作文件的模块。它提供了一系列方法和属性，满足对文件的读写需求。

- **fs.readFile()**：读取指定文件中的内容。
- **fs.writeFile()**：向指定文件中写入内容。

使用前先导入：

```javascript
const fs = require('fs')
```

### 1、fs.readFile() 的语法格式

```javascript
fs.readFile(path, [options,] callback)
```

参数解读：

- 参数1（必选）：字符串，表示文件的路径。
- 参数2（可选）：以什么编码格式读取文件。
- 参数3（必选）：文件读取完成后，通过回调函数拿到结果。

### 2、fs.writeFile() 的语法格式

```javascript
fs.writeFile(file, data, [options,] callback)
```

参数解读：

- 参数1（必选）：文件存放路径的字符串。
- 参数2（必选）：要写入的内容。
- 参数3（可选）：写入格式，默认 `utf8`。
- 参数4（必选）：文件写入完成后的回调函数。

### 3、路径动态拼接的问题

使用 `./` 或 `../` 开头的相对路径时，很容易出现**路径动态拼接错误**。原因在于：代码运行时，会以执行 `node` 命令时所处的目录，动态拼接出被操作文件的完整路径。

解决方案：**直接提供完整的绝对路径**，不要依赖相对路径。

```javascript
const fs = require('fs')

// 出现路径拼接错误，是因为提供了 ./ 或 ../ 开头的相对路径
fs.readFile('./files/1.txt', 'utf8', function(err, dataStr) {
  if (err) {
    return console.log('读取文件失败！' + err.message)
  }
  console.log('读取文件成功！' + dataStr)
})

// 移植性非常差、不利于维护
fs.readFile('C:\\Users\\31330\\Desktop\\nodejs\\code\\files\\1.txt', 'utf8', function(err, dataStr) {
  if (err) {
    return console.log('读取文件失败！' + err.message)
  }
  console.log('读取文件成功！' + dataStr)
})

// __dirname 表示当前文件所处的目录，推荐写法
fs.readFile(__dirname + '/files/1.txt', 'utf8', function(err, dataStr) {
  if (err) {
    return console.log('读取文件失败！' + err.message)
  }
  console.log('读取文件成功！' + dataStr)
})
```

关键结论：**涉及文件路径拼接时，优先用 `__dirname` 配合 `path.join()`，杜绝相对路径带来的动态拼接坑。**

## 三、path 路径模块

**path 模块**（Path）是 Node.js 官方提供的、用来处理路径的模块。

- **path.join()**：将多个路径片段拼接成一个完整的路径字符串。
- **path.basename()**：从路径字符串中解析出文件名。
- **path.extname()**：获取路径中的扩展名部分。

使用前先导入：

```javascript
const path = require('path')
```

### 1、path.join() 的语法格式

```javascript
path.join([...paths])
```

- `...paths <string>`：路径片段的序列。
- 返回值：`<string>` 完整路径字符串。

注意：`../` 表示回退一层路径；**凡是涉及路径拼接的操作，都要使用 `path.join()`，不要直接用 `+` 拼接字符串。**

```javascript
const path = require('path')
const fs = require('fs')

// 注意：../ 会抵消前面的路径
const pathStr = path.join('/a', '/b/c', '../../', './d', 'e')
console.log(pathStr)  // \a\b\d\e

fs.readFile(path.join(__dirname, './files/1.txt'), 'utf8', function(err, dataStr) {
  if (err) {
    return console.log(err.message)
  }
  console.log(dataStr) // 当前文件所在目录\files\1.txt
})
```

### 2、path.basename() 的语法格式

```javascript
path.basename(path[, ext])
```

- `path <string>`（必选）：路径字符串。
- `ext <string>`（可选）：文件扩展名。
- 返回：`<string>` 路径中的最后一部分。

```javascript
const path = require('path')
const fpath = 'a/b/c/index.html' // 文件存放路径

const fullName = path.basename(fpath)
console.log(fullName) // 输出 index.html

const nameWithoutExt = path.basename(fpath, '.html')
console.log(nameWithoutExt) // 输出 index
```

### 3、path.extname() 的语法格式

```javascript
path.extname(path)
```

- `path <string>`（必选）：路径字符串。
- 返回：`<string>` 扩展名字符串。

```javascript
const path = require('path')
const fpath = 'a/b/c/index.html'

const fext = path.extname(fpath)
console.log(fext) // 输出 .html
```

## 四、http 模块

**http 模块**（HyperText Transfer Protocol）是 Node.js 官方提供的、用来创建 Web 服务器的模块。通过 `http.createServer()` 方法，就能把一台电脑变成 Web 服务器，对外提供资源服务。

### 1、创建基本的 Web 服务器

```javascript
// 1. 导入 http 模块
const http = require('http')
// 2. 创建 web 服务器实例
const server = http.createServer()
// 3. 服务器实例绑定 request 事件，监听客户端请求
server.on('request', function (req, res) {
  console.log('Someone visit our web server.')
})
// 4. 启动服务器
server.listen(8080, function () {
  console.log('server running at http://127.0.0.1:8080')
})
```

### 2、req 请求对象

只要客户端访问了服务器监听的地址，就会触发 `server.on()` 绑定的 request 事件处理函数。通过 `req` 参数可以访问与**客户端**相关的数据或属性：

```javascript
server.on('request', (req, res) => {
  // req.url 是客户端请求的 URL 地址；req.method 是请求的 method 类型
  const str = `Your request url is ${req.url}, and request method is ${req.method}`
  console.log(str)
  // 输出结果：Your request url is /, and request method is GET
})
```

### 3、res 响应对象

通过 `res.end()` 方法，可以向客户端发送内容并结束本次请求处理：

```javascript
server.on('request', (req, res) => {
  const str = `Your request url is ${req.url}, and request method is ${req.method}`
  res.end(str)
})
```

注意：调用 `res.end()` 发送中文内容时会出现**乱码**，需要手动设置编码格式：

```javascript
server.on('request', (req, res) => {
  const str = `您请求的 URL 地址是 ${req.url}，请求的 method 类型为 ${req.method}`
  // 设置 Content-Type 响应头，解决中文乱码
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(str) // 模块化之后 end() 全部变为 send()
})
```

## 五、模块化

### 1、模块化的基本概念

**模块化**（Modularization）类似于电脑主机：把不同功能拆成独立部件，各自负责一块，再拼装到一起。Node.js 按模块来源把模块分为 3 类：

- **内置模块**：Node.js 官方提供，例如 `fs`、`path`、`http`。
- **自定义模块**：用户创建的每个 `.js` 文件，都是自定义模块。
- **第三方模块**：由第三方开发，使用前需先下载（又称**包**，Package）。

`require()` 方法可以加载内置模块、自定义模块、第三方模块：

```javascript
const http = require('http')
```

**模块作用域**（Module Scope）与函数作用域类似：自定义模块中定义的变量、方法，只能在当前模块内访问。这种模块级别的访问限制能有效**防止变量污染**。

<img src="/images/posts/node.js/module-scope.webp" alt="模块作用域示意：自定义模块内的成员只在当前模块可见，防止变量污染" style="border-radius: 10px;" />

向外共享模块作用域中的成员，依赖以下对象：

**① module 对象**

每个 `.js` 自定义模块中都有一个 `module` 对象，存储了和当前模块有关的信息。

<img src="/images/posts/node.js/module-object.webp" alt="module 对象打印结果：包含 id、path、exports 等字段" style="border-radius: 10px;" />

**② module.exports 对象**

在自定义模块中，使用 `module.exports` 对象把成员共享出去。外界用 `require()` 导入时，得到的就是 `module.exports` 所指向的对象。**导入结果永远以 `module.exports` 指向的对象为准。**

<img src="/images/posts/node.js/module-exports-object.webp" alt="module.exports 对象：向外共享模块内成员" style="border-radius: 10px;" />

**③ exports 对象**

为简化向外共享成员的代码，Node 提供了 `exports` 对象。默认情况下 `exports` 和 `module.exports` 指向同一个对象，但**最终共享结果仍以 `module.exports` 为准**。

<img src="/images/posts/node.js/exports-object.webp" alt="exports 对象：默认与 module.exports 指向同一对象" style="border-radius: 10px;" />

关键结论：**时刻谨记，`require()` 模块时得到的永远是 `module.exports` 指向的对象；不建议同一个模块中混用 `exports` 和 `module.exports`。**

<img src="/images/posts/node.js/exports-vs-moduleexports.webp" alt="exports 与 module.exports 的关系及混用时的指向变化" style="border-radius: 10px;" />

### 2、npm 与包

Node.js 中的第三方模块又叫做**包**（Package）。全球最大的包共享平台是 [npm](https://www.npmjs.com/)，包统一从 [registry.npmjs.org](https://registry.npmjs.org/) 下载。随 Node.js 一同安装的 **npm**（Node Package Manager）就是包管理工具。

查看 npm 版本：`npm -v`

安装第三方包（默认最新版）：

```bash
npm i 包名
```

安装指定版本：

```bash
npm i moment@2.22.2
```

初次装包后，项目里会多出 `node_modules` 文件夹和 `package-lock.json` 配置文件：

- `node_modules`：存放所有已安装的包，`require()` 从这里查找并加载。
- `package-lock.json`：记录每个包的下载信息（名称、版本号、下载地址等）。

**包管理配置文件 `package.json`** 记录项目相关配置，依赖信息存放在 `dependencies` 节点中。新建项目时执行：

```bash
npm init -y
```

拿到剔除 `node_modules` 的项目后，执行下面命令即可按 `package.json` 还原所有包：

```bash
npm i
```

卸载包（会自动从 `dependencies` 移除）：

```bash
npm uninstall 包名
```

只在开发阶段使用的包，安装到 `devDependencies` 节点：

```bash
npm i 包名 -D   # 等价于 npm i 包名 --save-dev
```

国外服务器下包慢，可切换为淘宝镜像源：

```bash
npm config get registry                              # 查看当前镜像源
npm config set registry=https://registry.npm.taobao.org  # 切换淘宝镜像
npm config get registry                              # 检测是否切换成功
```

为更方便地切换镜像源，可安装 `nrm` 小工具：

```bash
npm i nrm -g
nrm ls
nrm use taobao
```

**包的分类：**

- **项目包**：安装到项目 `node_modules` 目录中的包。
  - `npm i 包名 -D`：开发依赖包（仅开发期间用）。
  - `npm i 包名`：核心依赖包（开发与上线都要用）。
- **全局包**：安装到全局目录（如 `C:\Users\用户\AppData\Roaming\npm\node_modules`）。
  - `npm i 包名 -g`：全局安装；`npm uninstall 包名`：卸载全局包。
  - 只有提供好用终端命令的**工具性质包**才有全局安装的必要性。

## 六、Express

**Express** 是基于 Node.js 平台、基于 http 模块，快速、开放、极简的 Web 开发框架。本质就是一个 npm 上的第三方包，提供快速创建 Web 服务器的便捷方法。中文官网：[http://www.expressjs.com.cn/](http://www.expressjs.com.cn/)

安装：

```bash
npm i express@4.17.1
```

### 1、基本使用

```javascript
// 1. 导入 express
const express = require('express')
// 2. 创建 web 服务器
const app = express()

// 4. 监听客户端的 GET 和 POST 请求
app.get('/user', (req, res) => {
  // res.send() 向客户端响应一个 JSON 对象
  res.send({ name: 'zs', age: 20, gender: '男' })
})
app.post('/user', (req, res) => {
  res.send('请求成功')
})
app.get('/', (req, res) => {
  // req.query 获取客户端发送过来的查询参数，默认是空对象
  console.log(req.query)
  res.send(req.query)
})
// 注意：:id 是动态参数
app.get('/user/:ids/:username', (req, res) => {
  // req.params 是动态匹配到的 URL 参数，默认也是空对象
  console.log(req.params)
  res.send(req.params)
})

// 3. 启动 web 服务器
app.listen(80, () => {
  console.log('express server running at http://127.0.0.1')
})
```

**托管静态资源**：通过 `express.static()` 快速对外提供静态资源服务器：

```javascript
app.use('/public', express.static('public'))
```

随后可通过 `http://localhost/public/images/kitten.jpg` 等地址访问 `public` 目录中的文件。

> 调试时修改代码需频繁手动重启。可用 **nodemon** 监听文件变动自动重启：
> ```bash
> npm i -g nodemon
> ```
> 把 `node app.js` 替换为 `nodemon app.js` 即可。

### 2、Express 路由

广义上，**路由**（Routing）就是映射关系。在 Express 中，路由指客户端的请求与服务器处理函数之间的映射关系，由 3 部分组成：**请求类型、请求 URL 地址、处理函数**。

```javascript
const express = require('express')
const app = express()

// 匹配 GET 请求，URL 为 /
app.get('/', (req, res) => {
  res.send('hello world.')
})
// 匹配 POST 请求，URL 为 /
app.post('/', (req, res) => {
  res.send('Post Request.')
})
// 请求类型和 URL 同时匹配成功，才会调用对应处理函数
app.listen(80, () => {
  console.log('http://127.0.0.1')
})
```

**将路由抽离为单独模块**（推荐做法）：

① 创建路由模块对应的 `.js` 文件
② 调用 `express.Router()` 创建路由对象
③ 向路由对象挂载具体路由
④ 用 `module.exports` 向外共享路由对象
⑤ 用 `app.use()` 注册路由模块

```javascript
// app.js
const express = require('express')
const app = express()
// 导入路由模块
const router = require('./user_router')
// 5. 注册路由模块，并添加前缀 /api
app.use('/api', router)
// 注意：app.use() 的作用是注册全局中间件
app.listen(80, () => {
  console.log('http://127.0.0.1')
})
```

```javascript
// user_router.js
const express = require('express')
const router = express.Router()
// 3. 挂载具体的路由
router.get('/user/list', (req, res) => {
  res.send('Get user list.')
})
router.post('/user/add', (req, res) => {
  res.send('Add new user.')
})
// 4. 向外导出路由对象
module.exports = router
```

### 3、Express 中间件

**中间件**（Middleware）特指业务流程的中间处理环节。当一个请求到达 Express 服务器后，可以连续调用多个中间件，从而对这次请求进行预处理。

<img src="/images/posts/node.js/middleware-concept.webp" alt="中间件概念：请求在到达路由前经过多个中间处理环节" style="border-radius: 10px;" />

Express 中间件本质上就是一个 **function 处理函数**，格式如下：

<img src="/images/posts/node.js/middleware-format.webp" alt="Express 中间件格式：形参包含 req、res、next" style="border-radius: 10px;" />

中间件函数的形参列表中**必须包含 `next` 参数**，而路由处理函数只包含 `req` 和 `res`。`next` 函数是实现多个中间件连续调用的关键，它把流转关系转交给下一个中间件或路由。

<img src="/images/posts/node.js/next-function.webp" alt="next 函数：把请求流转关系转交给下一个中间件或路由" style="border-radius: 10px;" />

中间件需要在路由之前定义（JavaScript 从上到下读取）。定义全局生效的中间件：

```javascript
// 多个中间件之间，共享 req 和 res 对象
app.use((req, res, next) => {
  console.log('这是最简单的中间件函数')
  const time = Date.now()
  // 为 req 挂载自定义属性，把时间共享给后面所有路由
  req.startTime = time
  next()
})
```

局部生效的中间件：

```javascript
const mw1 = (req, res, next) => {
  console.log('调用了局部生效的中间件')
  next()
}
// 仅在 / 路由生效
app.get('/', mw1, (req, res) => {
  res.send('Home page.')
})
// 同时使用多个局部中间件：app.get('/', [mw1, mw2], (req, res) => {...})
```

请求连续经过多个中间件的流程如下：

:::mermaid
flowchart LR
    A[客户端请求] --> B[中间件 mw1]
    B -->|next| C[中间件 mw2]
    C -->|next| D[路由处理函数]
    D --> E[响应 res]
:::

Express 官方把常见的中间件用法分成 5 大类：

① **应用级别的中间件**：通过 `app.use()` / `app.get()` / `app.post()` 绑定到 `app` 实例。
② **路由级别的中间件**：绑定到 `express.Router()` 实例上，用法与应用级一致，只是绑定对象不同。
③ **错误级别的中间件**：专门捕获整个项目的异常，防止崩溃。
④ **Express 内置的中间件**：如 `express.static`、`express.json`、`express.urlencoded`。
⑤ **第三方的中间件**：如老版本 `body-parser`。

**① 应用级别**

```javascript
app.use((req, res, next) => { next() })        // 全局
app.get('/', mw1, (req, res) => { res.send('Home page.') }) // 局部
```

**② 路由级别**

```javascript
const router = express.Router()
router.use(function (req, res, next) { next() })
app.use('/', router)
```

**③ 错误级别**

格式上 `function` 必须有 4 个形参，顺序为 `(err, req, res, next)`。**必须注册在所有路由之后！**

```javascript
const express = require('express')
const app = express()

app.get('/', (req, res) => {
  throw new Error('服务器内部发生了错误！')
  res.send('Home page.')
})

// 错误级别中间件，捕获整个项目的异常错误
app.use((err, req, res, next) => {
  console.log('发生了错误！' + err.message)
  res.send('Error：' + err.message)
})

app.listen(80, function () {
  console.log('Express server running at http://127.0.0.1')
})
```

**④ Express 内置中间件**

自 4.16.0 版本起，Express 内置了 3 个常用中间件：

- `express.static`：快速托管静态资源（HTML、图片、CSS）。
- `express.json`：解析 JSON 格式的请求体数据（4.16.0+）。
- `express.urlencoded`：解析 URL-encoded 格式的请求体数据（4.16.0+）。

```javascript
// 除了错误级别中间件，其他中间件必须在路由之前配置
app.use(express.json())                                  // 解析 JSON 请求体
app.use(express.urlencoded({ extended: false }))         // 解析 url-encoded 请求体
app.post('/user', (req, res) => {
  // 默认不配置解析中间件时，req.body 为 undefined
  console.log(req.body)
  res.send('ok')
})
```

<img src="/images/posts/node.js/builtin-middleware.webp" alt="Express 内置中间件：static、json、urlencoded 的作用" style="border-radius: 10px;" />

**⑥ 自定义中间件**

以模拟 `express.urlencoded` 为例，实现步骤：① 定义中间件 → ② 监听 `req` 的 `data` 事件 → ③ 监听 `req` 的 `end` 事件 → ④ 用 `querystring` 解析 → ⑤ 挂载为 `req.body` → ⑥ 封装为模块。

```javascript
const express = require('express')
const app = express()
const qs = require('querystring')

app.use((req, res, next) => {
  let str = ''
  req.on('data', (chunk) => { str += chunk })       // 2. 监听 data
  req.on('end', () => {                              // 3. 监听 end
    const body = qs.parse(str)                       // 4. 解析请求体
    req.body = body                                  // 5. 挂载到 req.body
    next()                                           // 交由路由处理
  })
})

app.post('/user', (req, res) => {
  res.send(req.body)
})
app.listen(80, function () {
  console.log('Express server running at http://127.0.0.1')
})
```

封装为模块后使用：

```javascript
// my-body-parser.js
const qs = require('querystring')
const bodyParser = (req, res, next) => {
  let str = ''
  req.on('data', (chunk) => { str += chunk })
  req.on('end', () => {
    const body = qs.parse(str)
    req.body = body
    next()
  })
}
module.exports = bodyParser
```

```javascript
const express = require('express')
const app = express()
const customBodyParser = require('./my-body-parser')
app.use(customBodyParser)   // 注册为全局中间件

app.post('/user', (req, res) => { res.send(req.body) })
app.listen(80, function () {
  console.log('Express server running at http://127.0.0.1')
})
```

注：`const` 定义常量，`let` 定义变量。

### 4、Express 写接口

一个带 JSONP、CORS、路由的接口示例：

```javascript
const express = require('express')
const app = express()

// 解析表单数据
app.use(express.urlencoded({ extended: false }))

// 必须在配置 cors 之前配置 JSONP 接口
app.get('/api/jsonp', (req, res) => {
  const funcName = req.query.callback
  const data = { name: 'zs', age: 22 }
  const scriptStr = `${funcName}(${JSON.stringify(data)})`
  res.send(scriptStr)
})

// 路由之前配置 cors 中间件，解决接口跨域
const cors = require('cors')
app.use(cors())

// 导入路由模块
const router = require('./my-apiRouter')
app.use('/api', router)

app.listen(80, () => {
  console.log('express server running at http://127.0.0.1')
})
```

```javascript
// my-apiRouter.js
const express = require('express')
const router = express.Router()

router.get('/get', (req, res) => {
  res.send({ status: 0, msg: 'GET 请求成功！', data: req.query })
})
router.post('/post', (req, res) => {
  res.send({ status: 0, msg: 'POST 请求成功！', data: req.body })
})
router.delete('/delete', (req, res) => {
  res.send({ status: 0, msg: 'DELETE请求成功' })
})

module.exports = router
```

**使用 cors 中间件解决跨域问题**：`cors` 是 Express 的第三方中间件，三步即可启用 —— ① `npm install cors`；② `const cors = require('cors')`；③ 路由之前 `app.use(cors())`。

**CORS**（Cross-Origin Resource Sharing，跨域资源共享）由一系列 HTTP 响应头组成，决定浏览器是否阻止前端 JS 跨域获取资源。浏览器同源策略默认阻止跨域，但服务端配置了 CORS 响应头即可解除限制。

<img src="/images/posts/node.js/cors-concept.webp" alt="CORS 跨域资源共享：服务端配置响应头解除浏览器跨域限制" style="border-radius: 10px;" />

CORS 主要在服务端配置，客户端无需额外操作（但有浏览器兼容性，需支持 XMLHttpRequest Level2）。

关键响应头：

1. **Access-Control-Allow-Origin**：允许访问该资源的外域。

```javascript
res.setHeader('Access-Control-Allow-Origin', 'https://roydon.xyz') // 只允许该域
res.setHeader('Access-Control-Allow-Origin', '*')                  // 允许任意域
```

2. **Access-Control-Allow-Headers**：默认 CORS 仅支持 9 个请求头（Accept、Accept-Language、Content-Language、DPR、Downlink、Save-Data、Viewport-Width、Width、Content-Type 受限值）。额外请求头需在此声明：

```javascript
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Custom-Header')
```

3. **Access-Control-Allow-Methods**：默认仅支持 GET、POST、HEAD，其他方法需指明：

```javascript
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, HEAD')
res.setHeader('Access-Control-Allow-Methods', '*') // 允许所有
```

**CORS 请求的分类：**

- **简单请求（Simple Request）**：① 请求方式为 GET/POST/HEAD 之一；② 头部不超过规定的 9 个字段、且无自定义头部、Content-Type 仅限三种值。
- **预检请求（Preflight Request）**：只要符合以下任一条件就需要预检 —— ① 请求方式非 GET/POST/HEAD；② 含自定义头部字段；③ 发送了 `application/json` 数据。浏览器会先发 `OPTIONS` 请求预检，成功后才发真实请求。

:::mermaid
flowchart TD
    A[客户端发起请求] --> B{简单请求?}
    B -->|是 GET/POST/HEAD 且无自定义头| C[直接发送真实请求]
    B -->|否 或 含自定义头/JSON| D[先发送 OPTIONS 预检]
    D --> E{服务器允许?}
    E -->|是| F[发送真实请求]
    E -->|否| G[浏览器拦截]
:::

## 七、数据库

### 1、基本概念

**数据库**（Database）是组织、存储和管理数据的仓库。除了文本，图像、音乐、声音也都是数据。基本操作就是**增删查改**（CRUD）。

后端开发中推荐使用 **MySQL**（关系型数据库，Relational Database）。Node.js 整合 MySQL 前，需先掌握 SQL 基础（建表、增删查改语句）。

### 2、node 整合 mysql

步骤：

① 安装操作 MySQL 的第三方模块：

```bash
npm i mysql
```

② 通过 `mysql` 模块连接数据库：

```javascript
const mysql = require('mysql')
// 建立与 MySQL 数据库的连接
const db = mysql.createPool({
  host: '127.0.0.1',    // 数据库 IP 地址
  user: 'root',         // 登录账号
  password: 'qwer1234', // 登录密码
  database: 'db_1',     // 指定操作的数据库
})
```

③ 通过 `mysql` 模块执行 SQL 语句。以下以 `users` 表为例。

**查找**（结果是一个数组）：

```javascript
const sqlStr = 'select * from users'
db.query(sqlStr, (err, results) => {
  if (err) return console.log(err.message)
  console.log(results)
})
```

**增加**：

```javascript
// 写法一
const user = { username: 'guo', password: '123' }
const sqlStr = 'insert into users (username, password) values (?, ?)'
db.query(sqlStr, [user.username, user.password], (err, results) => {
  if (err) return console.log(err.message)
  // 通过 affectedRows 判断是否插入成功
  if (results.affectedRows === 1) console.log('插入数据成功!')
})
// 写法二（推荐）
const user = { username: 'roydon', password: '123456' }
const sqlStr = 'insert into users set ?'
db.query(sqlStr, user, (err, results) => {
  if (err) return console.log(err.message)
  if (results.affectedRows === 1) console.log('插入数据成功')
})
```

**修改（更新）**：

```javascript
// 写法一
const user = { id: 1, username: 'aaa', password: '000' }
const sqlStr = 'update users set username=?, password=? where id=?'
db.query(sqlStr, [user.username, user.password, user.id], (err, results) => {
  if (err) return console.log(err.message)
  if (results.affectedRows === 1) console.log('更新成功')
})
// 写法二（推荐）
const user = { id: 1, username: 'bbb', password: '111' }
const sqlStr = 'update users set ? where id=?'
db.query(sqlStr, [user, user.id], (err, results) => {
  if (err) return console.log(err.message)
  if (results.affectedRows === 1) console.log('更新数据成功')
})
```

**删除**：

```javascript
const sqlStr = 'delete from users where id=?'
db.query(sqlStr, 2, (err, results) => {
  if (err) return console.log(err.message)
  if (results.affectedRows === 1) console.log('删除数据成功')
})
```

## 八、前后端身份认证

目前主流的 Web 开发模式有两种：

**① 服务端渲染（SSR）的传统模式**

服务器发送的 HTML 页面，是在服务器通过字符串拼接动态生成的，客户端不需要用 Ajax 额外请求数据。

- 优点：前端耗时少（尤其省电）；有利于 **SEO**（Search Engine Optimization，搜索引擎优化），爬虫更容易抓取。
- 缺点：占用服务器资源；不利于前后端分离，开发效率低。

**② 前后端分离模式**

依赖 Ajax 的广泛应用。后端只提供 API 接口，前端用 Ajax 调用接口把数据渲染到页面。

- 优点：开发体验好、用户体验好（局部刷新）、减轻服务器渲染压力。
- 缺点：不利于 SEO（完整 HTML 在客户端拼接，爬虫难抓取；可用 Vue/React 的 SSR 技术解决）。

### 1、身份认证与 Cookie

**身份认证**（Authentication）又称「身份验证」「鉴权」，指通过一定手段完成对用户身份的确认。

两种开发模式对应不同的认证方案：**服务端渲染推荐使用 Session 认证机制；前后端分离推荐使用 JWT 认证机制。**

**Cookie** 是存储在用户浏览器中不超过 4 KB 的字符串，由名称、值及若干控制属性组成。不同域名下的 Cookie 各自独立，请求时自动随请求头发送。**Cookie 容易被伪造、不具备安全性，不应把重要隐私数据通过 Cookie 发给浏览器。**

**Session 的工作原理**：客户端首次请求时，服务器通过响应头向客户端发送身份认证的 Cookie；此后每次请求，浏览器自动带上该 Cookie，服务器据此验明身份。

<img src="/images/posts/node.js/session-workflow.webp" alt="Session 工作原理：服务端保存 session，客户端保存 cookie，每次请求自动携带" style="border-radius: 10px;" />

:::mermaid
sequenceDiagram
    participant C as 客户端
    participant S as 服务器
    C->>S: 首次登录（提交账号密码）
    S->>S: 验证通过，创建 Session 并保存
    S-->>C: 响应头 Set-Cookie（SessionID）
    C->>C: 浏览器保存 Cookie
    C->>S: 后续请求（自动携带 Cookie）
    S->>S: 凭 SessionID 验明身份
    S-->>C: 返回受保护资源
:::

### 2、Express 使用 Session 认证

① 安装 `express-session`：

```bash
npm i express-session
```

② 配置中间件：

```javascript
const session = require('express-session')
app.use(
  session({
    secret: 'roydon',            // 自定义字符串（签名密钥）
    resave: false,               // 固定写法
    saveUninitialized: true,     // 固定写法
  })
)
```

③ 向 session 存数据：

```javascript
app.post('/api/login', (req, res) => {
  if (req.body.username !== 'admin' || req.body.password !== '000000') {
    return res.send({ status: 1, msg: '登录失败' })
  }
  req.session.user = req.body   // 用户信息
  req.session.islogin = true    // 登录状态
  res.send({ status: 0, msg: '登录成功' })
})
```

④ 从 session 取数据：

```javascript
app.get('/api/username', (req, res) => {
  if (!req.session.islogin) {
    return res.send({ status: 1, msg: 'fail' })
  }
  res.send({ status: 0, msg: 'success', username: req.session.user.username })
})
```

⑤ 清空 session：`req.session.destroy()`

```javascript
app.post('/api/logout', (req, res) => {
  req.session.destroy()
  res.send({ status: 0, msg: '退出登录成功' })
})
```

局限性：Session 认证需配合 Cookie，而 Cookie 默认不支持跨域。因此**无跨域时用 Session；跨域请求后端接口时不推荐 Session，改用 JWT**。

### 3、Express 使用 JWT

**JWT**（JSON Web Token，JSON Web 令牌）是目前最流行的跨域认证解决方案，前后端分离模式推荐使用。用户信息以 Token 字符串形式保存在客户端，服务器通过还原 Token 来认证身份。

<img src="/images/posts/node.js/jwt-workflow.webp" alt="JWT 工作原理：用户信息加密为 Token 存客户端，每次请求携带 Token 由服务端还原" style="border-radius: 10px;" />

JWT 由三部分组成，用英文 `.` 分隔：`Header.Payload.Signature`。

- **Payload** 是真正的用户信息（加密后的字符串）。
- **Header** 和 **Signature** 是安全性相关部分，保证 Token 安全。

客户端收到 JWT 后通常存于 `localStorage` 或 `sessionStorage`，每次通信带上，推荐放在 HTTP 请求头的 **Authorization** 字段：`Authorization: Bearer <token>`。

:::mermaid
sequenceDiagram
    participant C as 客户端
    participant S as 服务器
    C->>S: POST /api/login（账号密码）
    S->>S: 验证通过，jwt.sign() 生成 Token
    S-->>C: 返回 token
    C->>C: 保存 token 到 localStorage
    C->>S: 后续请求 Authorization: Bearer <token>
    S->>S: express-jwt 解析还原用户信息
    S-->>C: 返回受保护资源
:::

Express 中使用 JWT：

① 安装并导入包：`jsonwebtoken` 用于生成 Token，`express-jwt` 用于解析还原。

```bash
npm i jsonwebtoken express-jwt
```

② 老版本写法：

```javascript
const express = require('express')
const app = express()
const jwt = require('jsonwebtoken')
const expressJWT = require('express-jwt')

const cors = require('cors')
app.use(cors())
const bodyParser = require('body-parser')
app.use(bodyParser.urlencoded({ extended: false }))

const secretKey = 'i am roydon' // 自定义密钥

// 注册解析中间件，把用户信息挂载到 req.user
app.use(expressJWT({ secret: secretKey }).unless({ path: [/^\/api\//] }))

app.post('/api/login', function (req, res) {
  const userinfo = req.body
  if (userinfo.username !== 'admin' || userinfo.password !== '000000') {
    return res.send({ status: 400, message: '登录失败！' })
  }
  // jwt.sign() 生成 Token，参数：用户信息对象、密钥、配置（有效期）
  const tokenStr = jwt.sign({ username: userinfo.username }, secretKey, { expiresIn: '30s' })
  res.send({ status: 200, message: '登录成功！', token: tokenStr })
})

app.get('/admin/getinfo', function (req, res) {
  console.log(req.user) // 解析出的用户信息
  res.send({ status: 200, message: '获取用户信息成功！', data: req.user })
})

// 全局错误处理中间件，捕获 JWT 解析失败
app.use((err, req, res, next) => {
  if (err.name === 'UnauthorizedError') {
    return res.send({ status: 401, message: '无效的token' })
  }
  res.send({ status: 500, message: '未知的错误' })
})

app.listen(8888, function () {
  console.log('Express server running at http://127.0.0.1:8888')
})
```

③ 新版本写法：解析出的信息挂载到 `req.auth`，且需指定 `algorithms`。

```javascript
const jwt = require('jsonwebtoken')
const { expressjwt: expressjwt } = require('express-jwt')

const secretKey = 'i am roydon'
app.use(expressjwt({ secret: secretKey, algorithms: ['HS256'] }).unless({ path: [/^\/api\//] }))

app.post('/api/login', function (req, res) {
  const userinfo = req.body
  if (userinfo.username !== 'roydon' || userinfo.password !== 'roydon') {
    return res.send({ status: 400, message: '登录失败！' })
  }
  const tokenStr = jwt.sign({ username: userinfo.username }, secretKey, { expiresIn: '60s' })
  res.send({ status: 200, message: '登录成功！', token: tokenStr })
})

app.get('/admin/getinfo', function (req, res) {
  console.log(req.auth) // 新版本挂载在 req.auth
  res.send({ status: 200, message: '获取用户信息成功！', data: req.auth })
})

app.use((err, req, res, next) => {
  if (err.name === 'UnauthorizedError') {
    return res.send({ status: 401, message: '无效的token' })
  }
  res.send({ status: 500, message: '未知的错误' })
})

app.listen(8888, function () {
  console.log('Express server running at http://127.0.0.1:8888')
})
```

登录接口返回生成的加密 Token：

<img src="/images/posts/node.js/jwt-token-generated.webp" alt="访问登录接口后生成的加密 JWT Token 字符串" style="border-radius: 10px;" />

客户端访问有权限的接口时，需在请求头带 `Authorization: Bearer <token>`，服务端即可拿到挂载的用户信息：

<img src="https://img1.imgtp.com/2022/08/30/evOCZIwX.png" alt="携带 Authorization 请求头访问 getinfo 接口后得到的 req.auth 信息（原图托管于 imgtp，下载受限，保留原链接）" style="border-radius: 10px;" />

## 总结

Node.js 把 JavaScript 从浏览器带到服务端，依靠 `fs`/`path`/`http` 等内置模块处理文件、路径与网络，依靠 CommonJS 模块化与 npm 包管理组织工程，再由 Express 这类框架快速搭建 Web 服务与接口，最后通过 Session 或 JWT 完成身份认证。

**要点回顾**：浏览器与 Node.js 是 JS 的前后两端运行环境，Node.js 无法调用 DOM/BOM；路径拼接优先用 `path.join()` + `__dirname`；CommonJS 中 `require()` 永远拿到 `module.exports`；Express 的核心是中间件机制与路由；跨域用 CORS（简单请求直达、非简单请求先 OPTIONS 预检）；Session 依赖 Cookie 适合同源、JWT 适合跨域。

**关联知识点**：事件循环（Event Loop）与异步 I/O；CommonJS 与 ES Module 的差异；MySQL 索引与事务；OAuth2 与 Session/JWT 的适用边界；VitePress 等静态站点如何托管这类技术文章。

**面试常问**：问 → Node.js 和浏览器里的 JS 有什么不同？答 → 运行环境不同，Node.js 没有 DOM/BOM，提供 fs/http 等系统能力。问 → `exports` 和 `module.exports` 的区别？答 → 默认指向同一对象，但 `require` 结果以 `module.exports` 为准。问 → 简单请求和预检请求如何区分？答 → 看请求方法是否为 GET/POST/HEAD 且无自定义头、Content-Type 受限，否则先发 OPTIONS 预检。

**参考资料**：
- [Node.js 中文官网](https://nodejs.org/zh-cn/)
- [Express 中文官网](http://www.expressjs.com.cn/)
- [npm 官网](https://www.npmjs.com/)
- [MDN：CORS](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/CORS)
- [JWT 官方介绍](https://jwt.io/)
