---
title: JavaScript
date: 2022-08-24 11:12:01
category: 前端开发
cover: /images/posts/javascript/ethan-javascript-knowledge-map.webp
tags: [js]
excerpt: JavaScript 基础入门笔记，涵盖数据类型、数组、函数、对象、DOM、BOM、事件等核心知识点。
---

# JavaScript

<img src="/images/posts/javascript/ethan-javascript-knowledge-map.webp" alt="JavaScript 知识串联图" style="border-radius: 10px;" />

**JavaScript** 是浏览器端最核心的脚本语言，也是现代全栈开发的必备技能。它语法灵活、生态庞大，从网页交互到服务端（Node.js）、移动端、桌面端都有它的身影。

这篇文章整理了一份 JavaScript 基础学习笔记，覆盖变量与数据类型、数组、函数、对象、字符串，以及 **DOM**（Document Object Model，文档对象模型）、**BOM**（Browser Object Model，浏览器对象模型）、事件等 Web API 核心内容。适合刚入门或需要快速回顾基础的开发者。

> 提示：文中的截图均为原学习笔记的整理图片，已统一下载到本地引用。




## 一、基础认识

![JavaScript 学习笔记截图 01](/images/posts/javascript/01.png)  
弹出提示对话框：alert("弹出对话框")

解释型语言，一行一行解释。

```javascript
<script>
    alert("弹出对话框")
</script>
```

![JavaScript 学习笔记截图 02](/images/posts/javascript/02.png)

认识js

发明人：布兰登·艾奇(Brendan Eich，1961年~)

> 1995年利用十天完成JS设计  
网景公司最初命名为LiveScript，后来与Sun合作改名JavaScript
>

运行在客户端浏览器上。

js的作用：

![JavaScript 学习笔记截图 03](/images/posts/javascript/03.png)

js的组成：

![JavaScript 学习笔记截图 04](/images/posts/javascript/04.png)

注释：  
![JavaScript 学习笔记截图 05](/images/posts/javascript/05.png)

![JavaScript 学习笔记截图 06](/images/posts/javascript/06.png)

js的输入输出：

![JavaScript 学习笔记截图 07](/images/posts/javascript/07.png)

`prompt取值是字符型的`

### 1、变量

```javascript
var age;//声明一个名称为age的变量，赋值var age=18;
```

只声明不赋值值为`undefined`

![JavaScript 学习笔记截图 08](/images/posts/javascript/08.png)

## 二、数据类型

数据类型可变

简单（基本）数据类型  
![JavaScript 学习笔记截图 09](/images/posts/javascript/09.png)判断变量是否为数字型的方法:  
![JavaScript 学习笔记截图 10](/images/posts/javascript/10.png)

获取字符串String长度

```javascript
str.length
```

转义符  
![JavaScript 学习笔记截图 11](/images/posts/javascript/11.png)

**undefined和null**

![JavaScript 学习笔记截图 12](/images/posts/javascript/12.png)

判断变量类型`typeof 变量名`

```javascript
<script>
    var str = 'roydon';
    alert(typeof str) //string
</script>
```

![JavaScript 学习笔记截图 13](/images/posts/javascript/13.png)  
这里的null类型为object，现在不考虑，后面会讲。

**数据类型转换**

1.转换成string

![JavaScript 学习笔记截图 14](/images/posts/javascript/14.png)

2.转换成数字型number

![JavaScript 学习笔记截图 15](/images/posts/javascript/15.png)

隐式转换

![JavaScript 学习笔记截图 16](/images/posts/javascript/16.png)

> `NaN`：not a number不是一个数字
>

![JavaScript 学习笔记截图 17](/images/posts/javascript/17.png)

3.转换成布尔型boolean

> Boolean函数。例如：Boolean('true');  
![JavaScript 学习笔记截图 18](/images/posts/javascript/18.png)
>

![JavaScript 学习笔记截图 19](/images/posts/javascript/19.png)

## 三、数组

```javascript
var arr = new Array(2，3，4);//==>arr[2,3,4]，若参数为一个，表示数组长度，元素为空
```

或者，利用字面量创建数组

```javascript
var arr = ['小明','小红','小强'];
```

![JavaScript 学习笔记截图 20](/images/posts/javascript/20.png)

数组遍历：length拿数组长度

![JavaScript 学习笔记截图 21](/images/posts/javascript/21.png)

数组排序：

![JavaScript 学习笔记截图 22](/images/posts/javascript/22.png)  
![JavaScript 学习笔记截图 23](/images/posts/javascript/23.png)

> 上图数组排序得到的结果：  
1.arr [ 'blue', 'red', 'pink' ] ;  
2.arr1 [1,4, 7, 13 ,77];  
`sort()`函数默认只对一位数的数字排序生效，若要排序多位数数字，需要添加function方法。  
[解析链接：Array.prototype.sort()](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array/sort)  
默认sort()排序结果：（位数大于一的数字出现结果不正确)  
![JavaScript 学习笔记截图 24](/images/posts/javascript/24.png)
>

检测是否为数组：`instanceof`和`Array.isArray()`

![JavaScript 学习笔记截图 25](/images/posts/javascript/25.png)

数组操作：添加或删除

![JavaScript 学习笔记截图 26](/images/posts/javascript/26.png)

1.添加

![JavaScript 学习笔记截图 27](/images/posts/javascript/27.png)push();  
![JavaScript 学习笔记截图 28](/images/posts/javascript/28.png)

2.删除

![JavaScript 学习笔记截图 29](/images/posts/javascript/29.png)

数组索引方法：

![JavaScript 学习笔记截图 30](/images/posts/javascript/30.png)  
![JavaScript 学习笔记截图 31](/images/posts/javascript/31.png)

![JavaScript 学习笔记截图 32](/images/posts/javascript/32.png)

![JavaScript 学习笔记截图 33](/images/posts/javascript/33.png)  
![JavaScript 学习笔记截图 34](/images/posts/javascript/34.png)

![JavaScript 学习笔记截图 35](/images/posts/javascript/35.png)

## 四、函数

声明和调用：`function`

![JavaScript 学习笔记截图 36](/images/posts/javascript/36.png)

> 第一行**function getSum**后面括号中的**num1**和**num2**是形参。  
最后两行调用传入的两个参数叫实参。
>

两种声明方式：

![JavaScript 学习笔记截图 37](/images/posts/javascript/37.png)

return：

![JavaScript 学习笔记截图 38](/images/posts/javascript/38.png)

arguments

内置对象，存储传递来的所有实参，保存的形式是数组（伪数组）

![JavaScript 学习笔记截图 39](/images/posts/javascript/39.png)

作用域：

全局和局部

就近

## 五、对象

对象的创建3法

```javascript
	<script>
        //创建对象的3种方法
        //var person={} //创建了一个空对象
        //方法1=============
        var person = {
            pname: 'roydon',
            age: 18,
            gender: 'man',
            getAge: function () {//方法
                console.log(this.age);
            }
        }
        //获取属性的两种方法
        //1.
        console.log(person.pname);
        //2.
        console.log(person['age']);
        person.getAge();//既然是方法，就要带()
        //方法2=============
        var person1 = new Object();
        person1.pname = 'yicheng';
        person1.age = 19;
        person1.gender = 'man';
        person1.getAge = function () {
            console.log(this.age);
        }
        //获取属性两种方法同上
        console.log(person1);
        person1.getAge();
        //方法3==============构造函数法,首字母大写
        function Person3(pname, age) {
            this.pname = pname;
            this.age = age;
            this.getAge = function () {
                console.log(this.age);
            }
        }
        var person3 = new Person3('jack',20);
        person3.getAge();
    </script>
```

遍历forin：

```javascript
//遍历
for (const key in person3) {
	if (Object.hasOwnProperty.call(person3, key)) {
		const name = key;//属性名
        console.log(name);
        const element = person3[key];//值
        console.log(element);
     }
}
```

![JavaScript 学习笔记截图 40](/images/posts/javascript/40.png)  
![JavaScript 学习笔记截图 41](/images/posts/javascript/41.png)

日期Date对象：  
![JavaScript 学习笔记截图 42](/images/posts/javascript/42.png)  
![JavaScript 学习笔记截图 43](/images/posts/javascript/44.png)

获取时间戳：

![JavaScript 学习笔记截图 44](/images/posts/javascript/45.png)为啥时是从1970年开始，自行百度。

时间戳转换成时分秒：

![JavaScript 学习笔记截图 45](/images/posts/javascript/46.png)

倒计时案例：

```javascript
	<script>
        // 定义一个函数参数为倒计时结束时间
        function countDown(time) {
            var nowTime = +new Date();//当前时间戳（毫秒数
            var inputTime = +new Date(time);//输入时间的时间戳
            var times = (inputTime - nowTime) / 1000;
            var d = parseInt(times / 60 / 60 / 24);//天
            d = d < 10 ? '0' + d : d;//个位数转成01，02，03形式
            var h = parseInt(times / 60 / 60 % 24);//时
            h = h < 10 ? '0' + h : h;
            var m = parseInt(times / 60 % 60);//分
            m = m < 10 ? '0' + m : m;
            var s = parseInt(times % 60);//秒
            s = s < 10 ? '0' + s : s;
            return d + '天' + h + '时' + m + '分' + s + '秒';
        }
        console.log(countDown('2022-7-8 20:00:00'));
        var date = new Date();
        console.log(date);
    </script>
```

下面是模拟：  
![JavaScript 学习笔记截图 46](/images/posts/javascript/47.gif)

## 六、字符串

字符串基本操作

![JavaScript 学习笔记截图 47](/images/posts/javascript/48.png)

![JavaScript 学习笔记截图 48](/images/posts/javascript/49.png)

![JavaScript 学习笔记截图 49](/images/posts/javascript/51.png)

## 七、Web API

应用程序编程接口

![JavaScript 学习笔记截图 50](/images/posts/javascript/52.png)

## 八、DOM

![JavaScript 学习笔记截图 51](/images/posts/javascript/53.png)

dom树：

![JavaScript 学习笔记截图 52](/images/posts/javascript/54.png)

每一个元素可以看作一个对象

### 1、获取页面元素

![JavaScript 学习笔记截图 53](/images/posts/javascript/55.png)

1. 根据ID获取（返回的是一个匹配到ID的DOM Element对象）

```javascript
document.getElementById();
```

可以使用`console.dir();`查看

2. 通过标签名获取（返回的是一个指定标签的集合）

```javascript
element.getElementByTagName();
```

3. 通过类名获取  
![JavaScript 学习笔记截图 54](/images/posts/javascript/56.png)  
![JavaScript 学习笔记截图 55](/images/posts/javascript/57.png)

### 2、事件基础

例如，点击一个按钮，弹出对话框

```html
<button id="btn">
    点我
</button>
```

事件分为三部分：事件源、事件类型、事件处理程序。也叫事件三要素

```javascript
//1.事件源=事件被触发的对象（按钮）
var btn = document.getElementById('btn');
//2.事件类型=如何触发，例如：点击，鼠标悬停，按键按下
//3.事件处理程序=函数赋值
btn.onclick=function(){
	alert('点了我');
}
```

### 3、操作元素

1. 改变元素内容

![JavaScript 学习笔记截图 56](/images/posts/javascript/58.png)

![JavaScript 学习笔记截图 57](/images/posts/javascript/59.png)

![JavaScript 学习笔记截图 58](/images/posts/javascript/60.png)

同时，亦可获取标签，innerText获取内容（去空格和换行），

innerHtml获取元素加内容，（保留空格和换行）

**案例：密码框显示，隐藏密码**

html

![JavaScript 学习笔记截图 59](/images/posts/javascript/61.png)

css  
![JavaScript 学习笔记截图 60](/images/posts/javascript/62.png)

js

![JavaScript 学习笔记截图 61](/images/posts/javascript/63.png)

---

### 4、DOM核心重点

获取过来的DOM元素是一个对象所以称为**文档对象模型**

![JavaScript 学习笔记截图 62](/images/posts/javascript/64.png)  
DOM操作：

> 1. 创建
>
>  
>
> + `document.write`
> + `innerHTML`
> + `createElement`
>
>  
>
> 2. 增
>
>  
>
> + `appendChild`
> + `insertBefore`
>
>  
>
> 3. 删
>
>  
>
> + `removeChild`
>
>  
>
> 4. 改(主要修改DOM元素的属性、内容、表单的值等)
>
>  
>
> + 修改元素属性：src、href、title等
> + 修改普通元素内容：innerHTML、innerText
> + 修改元素样式：style、className
> + 修改表单元素：value、type、disabled等
>
>  
>
> 5. 查(获取DOM元素)
>
>  
>
> + DOM提供的API方法：**querySelector()**、**querySelectorAll()**。(H5新方法，推荐)
> + 利用节点操作获取元素：父(**parentNode**)、子(**children**)、兄弟(**previousElementSibling、nextElementSibling**)。
>
>  
>
> 6. 属性操作(可自定义属性)
>
>  
>
> + `setAttribute()`：设置DOM的属性值
> + `getAttribute()`：得到DOM的属性值
> + `removeAttribute()`移除属性
>
>  
>
> 7. 事件操作  
![JavaScript 学习笔记截图 63](/images/posts/javascript/65.png)
>

---

### 5、事件高级

#### 1.注册事件（绑定事件）

注册事件两种方法：传统方式、方法监听注册方式

![JavaScript 学习笔记截图 64](/images/posts/javascript/66.png)  
`addEventListener()`事件监听方式

![JavaScript 学习笔记截图 65](/images/posts/javascript/67.png)

#### 2.删除事件（解绑事件）

传统解绑方法：

```javascript
var divs = document.querySelectorAll('div');
    divs[0].onclick = function() {
        alert(11);
        // 1. 传统方式删除事件
        divs[0].onclick = null;
     }
```

方法监听注册解绑方式：

```javascript
    // 2. removeEventListener 删除事件
        divs[1].addEventListener('click', fn) // 里面的fn 不需要调用加小括号
        function fn() {
            alert(22);
            divs[1].removeEventListener('click', fn);
        }
```

#### 3.DOM事件流

![JavaScript 学习笔记截图 66](/images/posts/javascript/68.png)

![JavaScript 学习笔记截图 67](/images/posts/javascript/69.png)

#### 4.事件对象event

```javascript
// 事件对象
var div = document.querySelector('div');
div.onclick = function(e) {
     console.log(e);
    }
     // 1. event 就是一个事件对象 写到我们侦听函数的 小括号里面 当形参来看
     // 2. 事件对象只有有了事件才会存在，它是系统给我们自动创建的，不需要我们传递参数
     // 3. 事件对象 是 我们事件的一系列相关数据的集合 跟事件相关的 比如鼠标点击里面就包含了鼠标的相关信息，鼠标坐标啊，如果是键盘事件里面就包含的键盘事件的信息 比如 判断用户按下了那个键
     // 4. 这个事件对象我们可以自己命名 比如 event 、 evt、 e
```

常见属性和方法：  
ie以si，下列方法结合实际记忆

![JavaScript 学习笔记截图 68](/images/posts/javascript/70.png)

#### 5.阻止事件冒泡

`e.stopPropagation();` // stop 停止  Propagation 传播  
下列代码为例，当点击父盒子中的son盒子时，不阻止事件冒泡，会发生弹出三个提示框(son、father和document)，阻止事件冒泡后，父亲元素不在冒泡弹出框。只弹出son提示框。

```javascript
<script>
  // 常见事件对象的属性和方法
  // 阻止冒泡  dom 推荐的标准 stopPropagation() 
  var son = document.querySelector('.son');
  son.addEventListener('click', function(e) {
     alert('son');
     e.stopPropagation(); // stop 停止  Propagation 传播
  }, false);
  var father = document.querySelector('.father');
  father.addEventListener('click', function() {
      alert('father');
  }, false);
  document.addEventListener('click', function() {
      alert('document');
  })
</script>
```

#### 6.事件委托

![JavaScript 学习笔记截图 69](/images/posts/javascript/71.png)  
![JavaScript 学习笔记截图 70](/images/posts/javascript/72.png)

#### 7.鼠标事件

常用：  
![JavaScript 学习笔记截图 71](/images/posts/javascript/73.png)

![JavaScript 学习笔记截图 72](/images/posts/javascript/74.png)  
`e.preventDefault();`阻止默认事件；阻止默认右键显示菜单操作；

![JavaScript 学习笔记截图 73](/images/posts/javascript/75.png)

```javascript
<script>
    // 1. contextmenu 禁用右键菜单
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
    })
    // 2. 禁止选中文字 selectstart
    document.addEventListener('selectstart', function(e) {
        e.preventDefault();
     })
 </script>
```

**鼠标事件对象**：  
MouseEvent   -->   clientX、pageX、screenX

```javascript
<script>
        // 鼠标事件对象 MouseEvent
        document.addEventListener('click', function(e) {
            // 1. client 鼠标在可视区的x和y坐标
            console.log(e.clientX);
            console.log(e.clientY);
            console.log('---------------------');
            // 2. page 鼠标在页面文档的x和y坐标
            console.log(e.pageX);
            console.log(e.pageY);
            console.log('---------------------');
            // 3. screen 鼠标在电脑屏幕的x和y坐标
            console.log(e.screenX);
            console.log(e.screenY);
        })
    </script>
```

#### 8.键盘事件

![JavaScript 学习笔记截图 74](/images/posts/javascript/76.png)例如，网站的搜索框一般会设置一个快捷键，当我们点击**s**键时，利用ASCII码判断按下的键是否为**s**若是则给搜索框一个焦点。  
![JavaScript 学习笔记截图 75](/images/posts/javascript/77.gif)  
源码：

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Document</title>
    <style>
        *{
            margin: 0;
            padding: 0;
        }
        input{
            display: block;
            margin: 100px auto;
            width: 300px;
            height: 25px;
            border: 1px solid orange;
        }
    </style>
</head>
<body>
    <input type="text">
    <script>
        // 核心思路： 检测用户是否按下了s 键，如果按下s 键，就把光标定位到搜索框里面
        // 使用键盘事件对象里面的keyCode 判断用户按下的是否是s键
        // 搜索框获得焦点： 使用 js 里面的 focus() 方法
        var search = document.querySelector('input');
        document.addEventListener('keyup', function(e) {
            if (e.keyCode === 83) {
                search.focus();
            }
        })
    </script>
</body>
</html>
```

---

## 九、BOM

![JavaScript 学习笔记截图 76](/images/posts/javascript/79.png)

![JavaScript 学习笔记截图 77](/images/posts/javascript/80.png)

### 1、window对象常见事件

#### 1.窗口加载事件

![JavaScript 学习笔记截图 78](/images/posts/javascript/81.png)

![JavaScript 学习笔记截图 79](/images/posts/javascript/82.png)

![JavaScript 学习笔记截图 80](/images/posts/javascript/83.png)

// load 等页面内容全部加载完毕，包含页面dom元素 图片 flash  css 等等

// DOMContentLoaded 是DOM 加载完毕，不包含图片 falsh css 等就可以执行 加载速度比 load更快一些

#### 2.调整窗口大小事件

![JavaScript 学习笔记截图 81](/images/posts/javascript/84.png)

### 2、定时器

![JavaScript 学习笔记截图 82](/images/posts/javascript/85.png)

#### 1.`setTimeout()`定时器

![JavaScript 学习笔记截图 83](/images/posts/javascript/86.png)

```javascript
    <script>
        // 1. setTimeout 
        // 语法规范：  window.setTimeout(调用函数, 延时时间);
        // 1. 这个window在调用的时候可以省略
        // 2. 这个延时时间单位是毫秒 但是可以省略，如果省略默认的是0
        // 3. 这个调用函数可以直接写函数 还可以写 函数名 还有一个写法 '函数名()'
        // 4. 页面中可能有很多的定时器，我们经常给定时器加标识符 （名字)
        // setTimeout(function() {
        //     console.log('时间到了');

        // }, 2000);
        function callback() {
            console.log('爆炸了');
        }
        var timer1 = setTimeout(callback, 3000);
        var timer2 = setTimeout(callback, 5000);
        // setTimeout('callback()', 3000); // 我们不提倡这个写法
    </script>
```

![JavaScript 学习笔记截图 84](/images/posts/javascript/87.png)

停止`setTimeout()`定时器

![JavaScript 学习笔记截图 85](/images/posts/javascript/88.png)

```html
    <button>点击停止定时器</button>
    <script>
        var btn = document.querySelector('button');
        //先给定时器一个名称，根据名称指定停止
        var timer = setTimeout(function() {
            console.log('爆炸了');
        }, 5000);
        btn.addEventListener('click', function() {
            clearTimeout(timer);
        })
    </script>
```

#### 2.`setInterval()`定时器

![JavaScript 学习笔记截图 86](/images/posts/javascript/89.png)

```javascript
    <script>
        // 1. setInterval 
        // 语法规范：  window.setInterval(调用函数, 延时时间);
        setInterval(function() {
            console.log('继续输出');
        }, 1000);
        // 2. setTimeout  延时时间到了，就去调用这个回调函数，只调用一次 就结束了这个定时器
        // 3. setInterval  每隔这个延时时间，就去调用这个回调函数，会调用很多次，重复调用这个函数
    </script>
```

### 3、JS执行队列

![JavaScript 学习笔记截图 87](/images/posts/javascript/90.png)

![JavaScript 学习笔记截图 88](/images/posts/javascript/91.png)

异步：  
![JavaScript 学习笔记截图 89](/images/posts/javascript/92.png)

### 4、location对象

URL

![JavaScript 学习笔记截图 90](/images/posts/javascript/93.png)

![JavaScript 学习笔记截图 91](/images/posts/javascript/94.png)search得到的是网址主机问号？(包含)之后的数据，是string字符串

例如：[https://editor.csdn.net/md/?articleId=1256752823244](https://editor.csdn.net/md/?articleId=1256752823244)  
location.search得到的是?articleId=1256752823244  
可以用substr(1)方法去掉问号  
![JavaScript 学习笔记截图 92](/images/posts/javascript/95.png)

### 5、navigator对象

![JavaScript 学习笔记截图 93](/images/posts/javascript/96.png)

### 6、history对象

![JavaScript 学习笔记截图 94](/images/posts/javascript/97.png)

## 十、PC端网页特效

丰富网页

### 1、元素偏移量offset

![JavaScript 学习笔记截图 95](/images/posts/javascript/98.png)


## 总结

一句话结论：JavaScript 是一门灵活、动态、解释执行的脚本语言，掌握变量作用域、数据类型、函数闭包、DOM/BOM 操作，是写出健壮前端代码的基础。

**要点回顾**：变量声明注意 `var` 的变量提升与函数作用域，`let`/`const` 提供块级作用域；基本数据类型包括 Number、String、Boolean、Undefined、Null、Symbol、BigInt，引用类型主要是 Object；数组与字符串提供了丰富的内置方法，能覆盖日常 80% 的操作；函数是一等公民，`this` 指向由调用方式决定；DOM 负责页面元素增删改查，事件机制支持冒泡、捕获与委托；BOM 提供 `window`、`location`、`navigator`、`history` 等浏览器级能力；定时器与事件循环是异步编程的入门钥匙。

**关联知识点**：ES6+ 新语法（`let/const`、箭头函数、解构、Promise、async/await）可以进一步简化代码；JavaScript 原型链与继承是面向对象进阶；事件循环（Event Loop）是理解异步与性能优化的关键；TypeScript 通过静态类型约束提升大型项目可维护性；前端工程化（模块化、打包、Babel）是项目落地的必备配套。

**面试常问**：`var/let/const` 的区别；`==` 与 `===` 的差异；`this` 指向的几种场景；闭包的形成条件与实际应用；事件委托的原理与优点；`setTimeout`/`setInterval` 的异同；`localStorage`/`sessionStorage`/`cookie` 的区别。

**参考资料**：[MDN JavaScript 指南](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide)、[MDN Web API](https://developer.mozilla.org/zh-CN/docs/Web/API)、[ECMAScript 规范](https://tc39.es/ecma262/)
