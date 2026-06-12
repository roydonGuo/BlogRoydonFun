# Roydon 个人博客 — 初始配置设计文档

> 日期: 2026-06-12
> 项目: blog-roydon-fun (VitePress)

---

## 1. 品牌识别

| 项目 | 值 |
|------|-----|
| 站点标题 | **Roydon** |
| 标语 | **Thoughts on code, design & life** |
| 视觉风格 | 极简清爽 (Minimal & Clean) |
| 品牌色 (Accent) | `#2445EB` |
| Logo | 纯文字 "Roydon" (基于站点标题) |
| Favicon | 首字母 "R" (SVG 图标) |

## 2. 站点结构

### 2.1 导航栏

| 栏目 | 链接 | 说明 |
|------|------|------|
| 首页 | `/` | 个人介绍 + 最新文章 |
| 文章 | `/posts/` | 文章列表页 |
| 归档 | `/archive/` | 按时间排列 |
| 关于 | `/about/` | 个人介绍页 |
| GitHub | 外链 | 社交链接 (已存在) |

### 2.2 首页布局

- **Hero 区域**: 大号站点名称 "Roydon" + 标语 + 两个按钮 ("最新文章" / "关于我")
- **内容区域**: 展示最新几篇文章，带左侧品牌色边框的卡片样式
- **Features 区域**: 可展示博客特色或分类入口

### 2.3 页面路由结构

```
docs/
├── index.md              # 首页 (Home)
├── posts/
│   └── index.md          # 文章列表页
├── archive/
│   └── index.md          # 归档页
└── about/
    └── index.md          # 关于页
```

## 3. 主题定制

### 3.1 CSS 变量覆盖

基于 VitePress 默认主题的 CSS 变量系统进行定制：

```css
:root {
  --vp-c-brand-1: #2445EB;       /* 品牌主色 - 用于链接、按钮 */
  --vp-c-brand-2: #1A36C4;       /* 品牌色 - 悬停态 */
  --vp-c-brand-3: #2445EB;       /* 品牌色 - 背景 */
  --vp-c-brand-soft: rgba(36, 69, 235, 0.08);  /* 品牌色 - 柔和背景 */
}
```

### 3.2 Hero 区域

首页 Hero 使用 VitePress 内置的 `layout: home` 布局，配置品牌色渐变效果（参考已有 style.css 中的渐变配置，将颜色替换为 `#2445EB` 的变体）。

### 3.3 首页卡片

最新文章卡片采用左侧品牌色边框 (`border-left: 3px solid #2445EB`) 的设计，保持极简。

## 4. 技术方案

### 4.1 实现方式

基于 VitePress 默认主题进行 CSS 层定制，不引入第三方主题或组件库。

### 4.2 博客文章管理

采用**纯 Markdown 原生组织**方案：
- 文章存放在 `docs/posts/` 目录下
- 使用 VitePress 的 `createContentLoader` API 自动生成文章列表 (首页 + 文章页)
- 归档页手动编写，按年月分组
- 暂不引入博客插件，后续可按需添加

### 4.3 Favicon

用内联 SVG 绘制首字母 "R"，保存为 `docs/public/favicon.svg`，在 `config.mts` 中引用。

## 5. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `docs/.vitepress/config.mts` | 修改 | 更新站点标题、描述、导航栏、主题配置 |
| `docs/.vitepress/theme/style.css` | 修改 | 重写品牌色、Hero 渐变、首页样式 |
| `docs/index.md` | 修改 | 定制首页 Hero 和 features 内容 |
| `docs/public/favicon.svg` | 新建 | SVG Favicon |
| `docs/posts/index.md` | 新建 | 文章列表页 |
| `docs/archive/index.md` | 新建 | 归档页 |
| `docs/about/index.md` | 新建 | 关于页 |

## 6. 后续可扩展

- 文章标签系统
- RSS Feed
- 搜索功能
- 评论系统 (Giscus / Twikoo)
- 暗色模式微调
