---
title: 文章
---

<!-- 文章列表页标题区 -->
<div class="posts-header">
  <h1 class="posts-title">所有文章</h1>
  <p class="posts-subtitle">技术探索、生活思考、设计灵感 — 都在这里</p>
</div>

<ClientOnly>
  <PostList />
</ClientOnly>

<style scoped>
.posts-header {
  text-align: center;
  padding: 2rem 0 1rem;
}

.posts-title {
  font-size: 2rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
  background: linear-gradient(120deg, #2445EB 30%, #6C8CFF);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.posts-subtitle {
  font-size: 1rem;
  color: var(--vp-c-text-2);
  margin: 0;
}
</style>
