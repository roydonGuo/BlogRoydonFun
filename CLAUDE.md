# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A bilingual personal tech blog ("Ethan" — "Thoughts on code, design & life") built with VitePress. Content is authored as Markdown and rendered as a static site. Simplified Chinese is the default locale; English content lives under `/en/`.

## Commands

- `npm run docs:dev` — start the VitePress dev server (content lives in `docs/`)
- `npm run docs:build` — build the static site to `docs/.vitepress/dist/`
- `npm run docs:preview` — preview the production build

There is no lint, test, or typecheck setup. There is no separate `vite.config` or `tsconfig` — all build/theme config lives in `docs/.vitepress/config.mts`. Uses npm (`package-lock.json`).

## Architecture

The site is a standard VitePress project whose content root is `docs/`:

- **`docs/.vitepress/config.mts`** — the single source of config. Defines locales (`zh-CN` root + `en-US` under `/en/`), nav/sidebar, local search, Tailwind v4 Vite plugin, group-icons plugin, RSS hooks, and the Mermaid markdown plugin. `i18nRouting: false` means untranslated articles don't map to same-path English URLs.
- **`docs/.vitepress/theme/index.ts`** — custom theme extending VitePress's `DefaultTheme`. It globally registers the Vue components under `components/` and overrides default layout slots via `AnimatedLayout`: `sidebar-nav-before` → `PostSidebar`, `aside-top` → `PostFilter`, `doc-before` → `ArticleReader` (text-to-speech), `doc-after` → `PostPrevNext` + `ArticleImagePreview`. It also replaces the theme toggle with a click-origin View Transition animation.
- **`docs/.vitepress/components/*.vue`** — reusable Vue components (PostList, ArchiveList, ProjectGallery, SkillsGallery, KnowledgeGraph, MermaidDiagram, etc.). Pages invoke them inside `<ClientOnly>`; they run in the browser, not at build time.
- **`docs/.vitepress/composables/usePostFilter.ts`** — a module-level singleton holding the post category/tag filter state, imported by the filter/lis components.

### Data flow (important)

- **`docs/posts/posts.data.ts`** — a VitePress `createContentLoader('posts/*.md')` that extracts post frontmatter into a sorted list (title, url, date, category, tags, cover, excerpt). Components consume it via `import { data } from '../posts/posts.data'`. It is the shared source of truth for post lists, archive, sidebar, and filters.
- **`docs/projects/projects.json`** and **`docs/skills/skills.json`** — hand-authored JSON data files consumed by `ProjectGallery` and `SkillsGallery` respectively. Adding a project/skill means editing these files (plus dropping images in `docs/public/images/projects/<id>/`).
- **`docs/.vitepress/rss.ts`** — generates `/feed.xml` (RSS 2.0). It collects post frontmatter via the `transformPageData` hook and writes the file in `buildEnd`; a dev-mode Vite middleware (`rssDevPlugin`) serves `/feed.xml` on the fly because the dev server never runs `buildEnd`.
- **`docs/.vitepress/markdown/mermaid-container.ts`** — a custom `markdown-it` block rule that converts `:::mermaid ... :::` fenced containers into a `<MermaidDiagram encoded-code="…">` component (URI-encoded source), avoiding a pinned VitePress plugin.

### Styling

Tailwind v4 is pulled in through `@tailwindcss/vite` (no `tailwind.config` — tokens are in `docs/.vitepress/theme/tailwind.css`). Additional theme CSS lives in `docs/.vitepress/theme/` (`style.css`, `block.css`, `code.css`, `mermaid.css`, `dark-transition.css`, `link-icons.css`). `link-icons.ts` injects favicon.im icons onto external links in article bodies at runtime.

## Content conventions

- **Posts** live in `docs/posts/*.md`. Required frontmatter: `title`, `date`, `category` (values like `后端开发`, `前端开发`, `随笔`), `tags` (array), `cover`, `excerpt`. `posts/index.md` is the list page and is excluded from all post aggregations.
- **Cover images**: each post has a `-knowledge-map.webp` cover in `docs/public/images/posts/<slug>-knowledge-map.webp`. If `cover` is absent, `posts.data.ts` falls back to a category default in `docs/public/covers/` (`backend.svg`, `frontend.svg`, `life.svg`).
- **Local search** is scoped to post detail pages only (see the `_render` override in `config.mts`); other pages are excluded from the search index.
- **Gallery/archive pages** set `aside: false` (and often `lastUpdated: false`) in frontmatter and remove default padding so the full-width component controls layout.
- Codebase comments and UI copy are written in Chinese; English is only the `/en/` locale content.

## Notes

- `design/` holds standalone HTML mockups; `design-qa.md` documents the visual QA process for the projects page (driven by Playwright against `http://127.0.0.1:4174/`; screenshots land in `output/design-qa/`). `.playwright-cli/` stores Playwright page snapshots.
- The nav in `config.mts` links to `/mind-map` and `/equipment/`, but those pages do not exist yet in `docs/` — dangling links, not broken config.
- `docs/.vitepress/cache/` and `docs/.vitepress/dist/` are generated by VitePress and are currently tracked in git (not in `.gitignore`).

## 设计风格

- 仿苹果IOS26毛玻璃质感
- 大圆角设计
- 浅色/深色双主题
- 简单UI采用tailwindcss进行CSS编写，复杂布局可采用tailwindcss加CSS的形式，例如flex、gap等tailwindcss里的常用且简单用法可直接使用tailwindcss，然后复杂布局可单独使用CSS编写，这种方式更灵活。


## 文章写作规范！！！重中之重

- 文章在本项目的docs/posts文件夹下，markdown格式，文件名为英文，例如一个标题为：Agent 上下文工程实践：选择、压缩与缓存治理的文章，其文件名为：agent-context-engineering-selection-compaction-cache.md。
- 文章内容元数据区域格式： 1.title: 文章中文标题 2.date: 发布时间，格式为YYYY-MM-DD HH:MM:SS 3.category: 文章分类 4.cover: 文章封面图片路径（可以是网络图片链接，例如：https://img.com/1.webp ；可以是本地图片路径，例如：/images/posts/agent-context-knowledge-map.webp，此图片在本项目的docs/public/images/posts/agent-context-knowledge-map.webp） 5.tags: 文章标签，可以是多个，使用[]数组表示 6.excerpt: 文章摘要，一段中文文章摘要。
- 文章正文的一些配图如果是使用本地资源，那么图片资源需要保存到docs/public/images/posts文件夹下，单独简历文件夹，文件夹名称为文章英文文件名，然后再次文件夹下存放正文配图
