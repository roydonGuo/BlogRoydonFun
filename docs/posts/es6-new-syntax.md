---
title: ES6 新语法特性解析
date: 2026-06-05
category: 前端开发
cover: /covers/frontend.svg
tags: [js, es6, javascript]
excerpt: 全面解析 ES6（ECMAScript 2015）中最实用的新语法特性，包括箭头函数、解构赋值、模板字符串等。
---

# ES6 新语法特性解析

ES6（ECMAScript 2015）是 JavaScript 发展史上最重要的版本之一，引入了大量现代化语法特性。

## let 和 const

`let` 和 `const` 取代了传统的 `var`，提供了块级作用域：

```javascript
// var 存在变量提升
console.log(a); // undefined
var a = 1;

// let 不存在变量提升
console.log(b); // ReferenceError
let b = 1;

// const 声明常量，不可重新赋值
const PI = 3.14159;
PI = 3; // TypeError: Assignment to constant variable
```

## 箭头函数

箭头函数让函数写法更简洁，且不绑定 `this`：

```javascript
// 传统写法
const sum = function(a, b) {
    return a + b;
};

// 箭头函数
const sum = (a, b) => a + b;

// 数组操作中的妙用
const result = [1, 2, 3, 4]
    .filter(x => x % 2 === 0)
    .map(x => x * 10);
// result: [20, 40]
```

## 解构赋值

从数组或对象中提取值更方便：

```javascript
// 对象解构
const person = { name: 'Roydon', age: 25, city: 'Beijing' };
const { name, age } = person;

// 数组解构
const [first, second, ...rest] = [1, 2, 3, 4, 5];
// first = 1, second = 2, rest = [3, 4, 5]

// 函数参数解构
function greet({ name, age }) {
    return `Hi, I'm ${name}, ${age} years old.`;
}
```

## 模板字符串

用反引号实现字符串插值：

```javascript
const name = 'Roydon';
const message = `Hello, ${name}!
今天天气真不错。`;
// 支持多行和表达式
```

## 扩展运算符

```javascript
// 数组合并
const arr1 = [1, 2, 3];
const arr2 = [4, 5, 6];
const merged = [...arr1, ...arr2]; // [1,2,3,4,5,6]

// 对象复制
const obj1 = { a: 1, b: 2 };
const obj2 = { ...obj1, c: 3 }; // { a:1, b:2, c:3 }
```

## Promise 与异步编程

```javascript
// Promise 链式调用
fetch('/api/user')
    .then(res => res.json())
    .then(data => console.log(data))
    .catch(err => console.error(err));

// async/await 语法（ES8）
async function getUser() {
    try {
        const res = await fetch('/api/user');
        const data = await res.json();
        return data;
    } catch (err) {
        console.error(err);
    }
}
```

## 总结

ES6 让 JavaScript 从一门脚本语言真正成长为现代化编程语言，掌握这些特性是前端开发的必备技能。
