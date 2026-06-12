---
title: CSS Grid 布局完全指南
date: 2026-06-03
category: 前端开发
tags: [css, layout, frontend]
excerpt: 从入门到精通 CSS Grid 布局，掌握现代 Web 页面中最强大的二维布局系统。
---

# CSS Grid 布局完全指南

CSS Grid 是 CSS 中最强大的布局系统，它让我们可以轻松实现二维布局。

## 基础概念

Grid 布局由**容器**和**项目**组成：

```css
.container {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    grid-template-rows: auto;
    gap: 16px;
}
```

## 定义行列

### fr 单位

`fr` 是 Grid 特有的弹性单位，表示剩余空间的等分：

```css
/* 三列等宽 */
grid-template-columns: 1fr 1fr 1fr;

/* 固定 + 自适应 + 固定 */
grid-template-columns: 200px 1fr 200px;
```

### repeat 函数

```css
/* 重复 3 次 1fr，等同于 1fr 1fr 1fr */
grid-template-columns: repeat(3, 1fr);

/* 自动填充，每列最小 200px */
grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
```

## 网格项目定位

```css
.item {
    /* 按行列线定位 */
    grid-column: 1 / 3;  /* 从第1列线到第3列线 */
    grid-row: 1 / 2;

    /* 或使用 span */
    grid-column: span 2;  /* 跨越2列 */
}
```

## 实际布局示例

### 圣杯布局

```css
.layout {
    display: grid;
    grid-template:
        "header header header" auto
        "nav    main   aside" 1fr
        "footer footer footer" auto
        / 200px 1fr 200px;
    gap: 16px;
    min-height: 100vh;
}

.header { grid-area: header; }
.nav    { grid-area: nav; }
.main   { grid-area: main; }
.aside  { grid-area: aside; }
.footer { grid-area: footer; }
```

### 响应式卡片网格

```css
.card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 24px;
}
```

无需任何媒体查询，卡片就会自动适应容器宽度。

## Grid vs Flexbox

| 特性 | Grid | Flexbox |
|------|------|---------|
| 维度 | 二维（行列） | 一维（单方向） |
| 适用场景 | 整体页面布局 | 组件内部排列 |
| 对齐控制 | 更强大 | 灵活 |

## 总结

CSS Grid 是布局的终极方案，特别适合页面级的二维布局。配合 Flexbox 使用，可以应对几乎所有布局需求。
