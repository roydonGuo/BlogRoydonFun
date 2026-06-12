# Roydon 博客初始配置 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 应用设计文档中的品牌识别、导航结构和主题样式，完成 Roydon 个人博客的初始配置。

**Architecture:** 基于 VitePress 默认主题扩展，通过 CSS 变量覆盖实现品牌定制，纯 Markdown 组织博客内容。不改动主题核心组件，所有修改集中在配置层和样式层。

**Tech Stack:** VitePress 2.x · Vue 3 · CSS3 · SVG

---

## 文件变更总览

| 文件 | 操作 | 职责 |
|------|------|------|
| `docs/.vitepress/config.mts` | 修改 | 站点标题/描述/导航栏/社交链接 |
| `docs/.vitepress/theme/style.css` | 修改 | 品牌色 CSS 变量、Hero 渐变、首页样式 |
| `docs/index.md` | 修改 | 首页 Hero 内容和 Features |
| `docs/public/favicon.svg` | 新建 | SVG 格式的 "R" 字 favicon |
| `docs/posts/index.md` | 新建 | 文章列表页占位 |
| `docs/archive/index.md` | 新建 | 归档页占位 |
| `docs/about/index.md` | 新建 | 关于页占位内容 |

---

### Task 1: 站点核心配置 (config.mts)

**Files:**
- Modify: `docs/.vitepress/config.mts`

- [ ] **Step 1: 更新站点标题、描述和导航栏**

编辑 `docs/.vitepress/config.mts`，替换为以下内容：

```ts
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Roydon',
  description: 'Thoughts on code, design & life',

  head: [
    ['link', { rel: 'icon', href: '/favicon.svg' }],
  ],

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '文章', link: '/posts/' },
      { text: '归档', link: '/archive/' },
      { text: '关于', link: '/about/' },
    ],

    sidebar: [],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/roydonGuo' },
    ],

    footer: {
      message: 'Thoughts on code, design & life',
      copyright: 'Copyright © 2026 Roydon',
    },
  },
})
```

- [ ] **Step 2: 验证配置语法**

Run: `npx vitepress build docs --no-logs 2>&1 || echo "BUILD FAILED"`
Expected: 构建成功，无配置错误

- [ ] **Step 3: Commit**

```bash
git add docs/.vitepress/config.mts
git commit -m "feat: update site config with brand identity and navigation

- Set site title to 'Roydon' and tagline
- Add nav links: Home, Posts, Archive, About
- Add SVG favicon link
- Add footer with tagline and copyright
- Keep GitHub social link

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 主题样式 — 品牌色与 Hero (style.css)

**Files:**
- Modify: `docs/.vitepress/theme/style.css`

- [ ] **Step 1: 重写全部 CSS 变量，应用 #2445EB 品牌色**

将 `docs/.vitepress/theme/style.css` 全部内容替换为：

```css
/**
 * Roydon Blog — 极简主题样式
 * Brand color: #2445EB
 */

:root {
  /* Brand colors */
  --vp-c-brand-1: #2445EB;
  --vp-c-brand-2: #1A36C4;
  --vp-c-brand-3: #2445EB;
  --vp-c-brand-soft: rgba(36, 69, 235, 0.08);

  /* Default colors (gray) */
  --vp-c-default-1: var(--vp-c-gray-1);
  --vp-c-default-2: var(--vp-c-gray-2);
  --vp-c-default-3: var(--vp-c-gray-3);
  --vp-c-default-soft: var(--vp-c-gray-soft);

  /* Tip (reuse brand) */
  --vp-c-tip-1: var(--vp-c-brand-1);
  --vp-c-tip-2: var(--vp-c-brand-2);
  --vp-c-tip-3: var(--vp-c-brand-3);
  --vp-c-tip-soft: var(--vp-c-brand-soft);

  /* Warning */
  --vp-c-warning-1: var(--vp-c-yellow-1);
  --vp-c-warning-2: var(--vp-c-yellow-2);
  --vp-c-warning-3: var(--vp-c-yellow-3);
  --vp-c-warning-soft: var(--vp-c-yellow-soft);

  /* Danger */
  --vp-c-danger-1: var(--vp-c-red-1);
  --vp-c-danger-2: var(--vp-c-red-2);
  --vp-c-danger-3: var(--vp-c-red-3);
  --vp-c-danger-soft: var(--vp-c-red-soft);
}

/**
 * Buttons
 */
:root {
  --vp-button-brand-border: transparent;
  --vp-button-brand-text: var(--vp-c-white);
  --vp-button-brand-bg: var(--vp-c-brand-3);
  --vp-button-brand-hover-border: transparent;
  --vp-button-brand-hover-text: var(--vp-c-white);
  --vp-button-brand-hover-bg: var(--vp-c-brand-2);
  --vp-button-brand-active-border: transparent;
  --vp-button-brand-active-text: var(--vp-c-white);
  --vp-button-brand-active-bg: var(--vp-c-brand-1);
}

/**
 * Home Hero — brand gradient
 */
:root {
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: -webkit-linear-gradient(
    120deg,
    #2445EB 30%,
    #6C8CFF
  );

  --vp-home-hero-image-background-image: linear-gradient(
    -45deg,
    #2445EB 50%,
    #6C8CFF 50%
  );
  --vp-home-hero-image-filter: blur(44px);
}

@media (min-width: 640px) {
  :root {
    --vp-home-hero-image-filter: blur(56px);
  }
}

@media (min-width: 960px) {
  :root {
    --vp-home-hero-image-filter: blur(68px);
  }
}

/**
 * Custom block
 */
:root {
  --vp-custom-block-tip-border: transparent;
  --vp-custom-block-tip-text: var(--vp-c-text-1);
  --vp-custom-block-tip-bg: var(--vp-c-brand-soft);
  --vp-custom-block-tip-code-bg: var(--vp-c-brand-soft);
}
```

- [ ] **Step 2: 验证样式编译**

Run: `npx vitepress build docs --no-logs 2>&1 || echo "BUILD FAILED"`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add docs/.vitepress/theme/style.css
git commit -m "feat: apply brand theme with #2445EB color scheme

- Replace indigo palette with custom blue #2445EB
- Update hero gradient to brand blue tones
- Keep minimal CSS — no unnecessary overrides

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: SVG Favicon (favicon.svg)

**Files:**
- Create: `docs/public/favicon.svg`

- [ ] **Step 1: 创建 public 目录（如不存在）并写入 favicon**

```bash
mkdir -p "d:/Jetbrains/WebstormProjects/blog-roydon-fun/docs/public"
```

写入 `docs/public/favicon.svg`：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#2445EB"/>
  <text x="50" y="68" font-size="56" font-weight="700"
        font-family="system-ui, -apple-system, sans-serif"
        fill="white" text-anchor="middle">R</text>
</svg>
```

- [ ] **Step 2: Commit**

```bash
git add docs/public/favicon.svg
git commit -m "feat: add SVG favicon with brand-colored R monogram

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 首页内容 (index.md)

**Files:**
- Modify: `docs/index.md`

- [ ] **Step 1: 更新首页 Hero 和 Features**

将 `docs/index.md` 内容替换为：

```markdown
---
layout: home

hero:
  name: "Roydon"
  text: "Thoughts on code, design & life"
  tagline: 记录技术与生活的个人博客
  image:
    src: /favicon.svg
    alt: Roydon
  actions:
    - theme: brand
      text: 最新文章
      link: /posts/
    - theme: alt
      text: 关于我
      link: /about/

features:
  - title: 💻 技术
    details: 前端开发、架构设计、工具链、最佳实践
  - title: ✏️ 随笔
    details: 生活记录、思考碎片、阅读笔记
  - title: 🎨 设计
    details: UI/UX、视觉风格、设计系统
---
```

- [ ] **Step 2: 验证首页渲染**

Run: `npx vitepress build docs --no-logs 2>&1 || echo "BUILD FAILED"`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add docs/index.md
git commit -m "feat: redesign home page with brand hero and features

- Brand hero with title, tagline, and favicon image
- Three feature cards: Tech, Life, Design
- Action buttons linking to posts and about pages

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 文章列表页 (posts/index.md)

**Files:**
- Create: `docs/posts/index.md`

- [ ] **Step 1: 创建文章页面目录和文件**

```bash
mkdir -p "d:/Jetbrains/WebstormProjects/blog-roydon-fun/docs/posts"
```

写入 `docs/posts/index.md`：

```markdown
# 文章

欢迎来到我的博客，这里记录着技术探索与生活思考。

<ClientOnly>
  <PostList />
</ClientOnly>

<script setup lang="ts">
import { data as posts } from './posts.data.ts'
import PostList from '../../.vitepress/components/PostList.vue'
</script>
```

等等——这里需要用 VitePress 的 `createContentLoader` 来实现文章列表。但在此之前需要先创建组件和数据加载器。

让我重新设计——文章列表有两种实现方式：
1. 使用 VitePress 内置的 `content` 目录 + 前端数据加载
2. 先不做动态加载，直接放一个说明页面，后续再补

最稳妥的方式是用 `createContentLoader` + 一个简单的 Vue 组件。需要额外创建两个文件：

- `docs/.vitepress/components/PostList.vue` — 列表组件
- `docs/posts/posts.data.ts` — 数据加载器

修改后的 Task 5：

- [ ] **Step 1: 创建数据加载器 `docs/posts/posts.data.ts`**

```bash
mkdir -p "d:/Jetbrains/WebstormProjects/blog-roydon-fun/docs/.vitepress/components"
mkdir -p "d:/Jetbrains/WebstormProjects/blog-roydon-fun/docs/posts"
```

写入 `docs/posts/posts.data.ts`：

```ts
import { createContentLoader } from 'vitepress'

export default createContentLoader('posts/*.md', {
  exclude: ['posts/index.md'],
  transform(raw) {
    return raw
      .filter(page => !page.url.endsWith('/posts/'))
      .map(page => ({
        title: page.frontmatter.title || page.url,
        url: page.url,
        date: page.frontmatter.date,
        tags: page.frontmatter.tags || [],
        excerpt: page.frontmatter.excerpt || page.excerpt || '',
      }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  },
})
```

- [ ] **Step 2: 创建文章列表组件 `docs/.vitepress/components/PostList.vue`**

写入 `docs/.vitepress/components/PostList.vue`：

```vue
<template>
  <div class="post-list">
    <article v-for="post in posts" :key="post.url" class="post-item">
      <a :href="post.url" class="post-link">
        <h3 class="post-title">{{ post.title }}</h3>
        <p v-if="post.excerpt" class="post-excerpt">{{ post.excerpt }}</p>
        <div class="post-meta">
          <time v-if="post.date" class="post-date">{{ formatDate(post.date) }}</time>
          <span v-if="post.tags.length" class="post-tags">
            <span v-for="tag in post.tags" :key="tag" class="tag">{{ tag }}</span>
          </span>
        </div>
      </a>
    </article>
    <p v-if="!posts.length" class="empty">还没有文章，敬请期待 ✨</p>
  </div>
</template>

<script setup lang="ts">
import { data as posts } from '../../posts/posts.data'

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}
</script>

<style scoped>
.post-list {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  margin: 2rem 0;
}

.post-item {
  padding: 1.25rem;
  border-radius: 8px;
  border-left: 3px solid var(--vp-c-brand-1);
  background: var(--vp-c-bg-soft);
  transition: background 0.2s;
}

.post-item:hover {
  background: var(--vp-c-bg-mute);
}

.post-link {
  text-decoration: none;
  color: inherit;
}

.post-title {
  margin: 0 0 0.5rem;
  font-size: 1.2rem;
  color: var(--vp-c-text-1);
}

.post-excerpt {
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}

.post-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.85rem;
  color: var(--vp-c-text-3);
}

.tag {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  font-size: 0.8rem;
  border-radius: 4px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.empty {
  text-align: center;
  color: var(--vp-c-text-3);
  padding: 3rem 0;
}
</style>
```

- [ ] **Step 3: 在 `config.mts` 中注册组件（无需，VitePress 会自动扫描 `.vitepress/components` 下的全局组件）**

- [ ] **Step 4: 写入文章列表页 `docs/posts/index.md`**

```markdown
---
title: 文章
---

# 文章

欢迎来到我的博客，这里记录着技术探索与生活思考。

<ClientOnly>
  <PostList />
</ClientOnly>
```

- [ ] **Step 5: 创建一篇示例文章用于测试**

写入 `docs/posts/hello-world.md`：

```markdown
---
title: Hello World
date: 2026-06-12
tags: [生活]
excerpt: 这是我的第一篇博客文章，很高兴在这里与你相遇。
---

# Hello World

这是我的第一篇博客文章。

很高兴在这里与你相遇。这个博客将记录我在技术、设计和生活方面的思考与探索。

敬请期待更多内容！
```

- [ ] **Step 6: 验证构建**

Run: `npx vitepress build docs --no-logs 2>&1 || echo "BUILD FAILED"`
Expected: 构建成功，PostList 组件正确渲染

- [ ] **Step 7: Commit**

```bash
git add docs/posts/ docs/.vitepress/components/PostList.vue
git commit -m "feat: add blog post listing with content loader

- Create PostList Vue component with branded card style
- Add createContentLoader for auto-generated post index
- Add sample hello-world post for testing
- Set up posts directory structure

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 归档页 (archive/index.md)

**Files:**
- Create: `docs/archive/index.md`

- [ ] **Step 1: 创建归档目录和文件**

```bash
mkdir -p "d:/Jetbrains/WebstormProjects/blog-roydon-fun/docs/archive"
```

写入 `docs/archive/index.md`：

```markdown
# 归档

按时间线排列的所有文章。

<ClientOnly>
  <ArchiveList />
</ClientOnly>

<script setup lang="ts">
import ArchiveList from '../../.vitepress/components/ArchiveList.vue'
</script>
```

- [ ] **Step 2: 创建归档组件**

写入 `docs/.vitepress/components/ArchiveList.vue`：

```vue
<template>
  <div class="archive">
    <div v-for="group in grouped" :key="group.year" class="archive-year">
      <h2 class="year-title">{{ group.year }}</h2>
      <div v-for="post in group.posts" :key="post.url" class="archive-item">
        <time class="archive-date">{{ formatDate(post.date) }}</time>
        <a :href="post.url" class="archive-link">{{ post.title }}</a>
      </div>
    </div>
    <p v-if="!grouped.length" class="empty">还没有文章，敬请期待 ✨</p>
  </div>
</template>

<script setup lang="ts">
import { data as posts } from '../../posts/posts.data'

interface Post {
  title: string
  url: string
  date: string
  tags: string[]
  excerpt: string
}

interface YearGroup {
  year: string
  posts: Post[]
}

const grouped = posts.reduce<YearGroup[]>((acc, post) => {
  if (!post.date) return acc
  const year = new Date(post.date).getFullYear().toString()
  const existing = acc.find(g => g.year === year)
  if (existing) {
    existing.posts.push(post)
  } else {
    acc.push({ year, posts: [post] })
  }
  return acc
}, [])

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })
}
</script>

<style scoped>
.archive-year {
  margin-bottom: 2rem;
}

.year-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--vp-c-brand-soft);
}

.archive-item {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  padding: 0.5rem 0;
  transition: padding-left 0.2s;
}

.archive-item:hover {
  padding-left: 0.5rem;
}

.archive-date {
  flex-shrink: 0;
  font-size: 0.85rem;
  color: var(--vp-c-text-3);
  font-family: monospace;
  min-width: 3.5rem;
}

.archive-link {
  text-decoration: none;
  color: var(--vp-c-text-1);
  font-size: 1rem;
}

.archive-link:hover {
  color: var(--vp-c-brand-1);
}

.empty {
  text-align: center;
  color: var(--vp-c-text-3);
  padding: 3rem 0;
}
</style>
```

- [ ] **Step 3: 将归档页加入导航配置（已在 Task 1 中完成）**

- [ ] **Step 4: 验证构建**

Run: `npx vitepress build docs --no-logs 2>&1 || echo "BUILD FAILED"`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add docs/archive/ docs/.vitepress/components/ArchiveList.vue
git commit -m "feat: add archive page with yearly grouping

- Create ArchiveList Vue component
- Group posts by year with timeline layout
- Style with brand-colored year headers

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 关于页 (about/index.md)

**Files:**
- Create: `docs/about/index.md`

- [ ] **Step 1: 创建关于目录和文件**

```bash
mkdir -p "d:/Jetbrains/WebstormProjects/blog-roydon-fun/docs/about"
```

写入 `docs/about/index.md`：

```markdown
# 关于我

## 👋 Hey there!

我是 **Roydon**，一名热爱技术与设计的开发者。

这个博客是我的个人空间，用来记录：
- 💻 技术探索与项目实践
- ✏️ 生活随笔与思考
- 🎨 设计与创意灵感

## 🔗 找到我

- **GitHub**: [@roydonGuo](https://github.com/roydonGuo)
- **Email**: 待完善

---

*blog built with [VitePress](https://vitepress.dev)*
```

- [ ] **Step 2: 验证构建**

Run: `npx vitepress build docs --no-logs 2>&1 || echo "BUILD FAILED"`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add docs/about/index.md
git commit -m "feat: add about page with personal intro

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: 最终验证

- [ ] **Step 1: 完整构建项目**

Run: `npx vitepress build docs`
Expected: 构建成功，无 warning

- [ ] **Step 2: 启动开发服务器检查**

Run: `npx vitepress dev docs --port 5199`
Expected: 服务启动成功，访问 http://localhost:5199 可查看

- [ ] **Step 3: 验证关键页面**

| 页面 | URL | 验证要点 |
|------|-----|----------|
| 首页 | `/` | Hero 显示 "Roydon" + 标语 + 品牌色 |
| 文章 | `/posts/` | PostList 组件渲染，示例文章可见 |
| 归档 | `/archive/` | ArchiveList 组件，按年分组 |
| 关于 | `/about/` | 个人介绍内容可见 |
| Favicon | `/favicon.svg` | 浏览器标签页显示蓝色 R 图标 |

- [ ] **Step 4: 最终 Commit**

```bash
git add .
git status
```
确认所有文件已纳入版本控制。

---

## 验证清单

完成全部任务后运行：

```bash
npx vitepress build docs 2>&1
echo "---"
echo "Page check:"
curl -s -o /dev/null -w "%{http_code}" http://localhost:5199/
curl -s -o /dev/null -w " %{http_code}" http://localhost:5199/posts/
curl -s -o /dev/null -w " %{http_code}" http://localhost:5199/archive/
curl -s -o /dev/null -w " %{http_code}" http://localhost:5199/about/
curl -s -o /dev/null -w " %{http_code}" http://localhost:5199/favicon.svg
echo ""
```

所有页面应返回 200。
