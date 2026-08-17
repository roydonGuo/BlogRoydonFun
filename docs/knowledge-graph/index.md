---
title: 知识图谱
description: 浏览博客文章、分类与标签之间的关联
aside: false
pageClass: knowledge-graph-page
---

<div class="graph-page-header">
  <span class="graph-page-eyebrow">KNOWLEDGE GRAPH</span>
  <h1>在文章之间，发现新的连接</h1>
  <p>每篇文章都是一个节点，分类与标签把散落的思考连接成一张持续生长的知识网络。</p>
</div>

<ClientOnly>
  <KnowledgeGraph />
</ClientOnly>

<style scoped>
.graph-page-header { margin: 0 auto 1rem; text-align: center; }
.graph-page-eyebrow { color: var(--vp-c-brand-1); font-size: 12px; font-weight: 700; letter-spacing: .18em; }
.graph-page-header h1 { margin: 10px 0 12px; border: 0; font-size: clamp(28px, 5vw, 44px); line-height: 1.2; background: linear-gradient(120deg, #2445eb 30%, #6c8cff); background-clip: text; -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.graph-page-header p { margin: 0; color: var(--vp-c-text-2); line-height: 1.8; }
</style>
