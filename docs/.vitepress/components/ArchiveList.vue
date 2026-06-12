<template>
  <div class="archive">
    <div v-for="group in grouped" :key="group.year" class="archive-year">
      <h2 class="year-title">{{ group.year }}</h2>
      <div v-for="post in group.posts" :key="post.url" class="archive-item">
        <time class="archive-date">{{ formatDate(post.date) }}</time>
        <a :href="post.url" class="archive-link">{{ post.title }}</a>
        <span class="archive-category">{{ post.category }}</span>
        <span class="archive-tags">
          <span v-for="tag in post.tags" :key="tag" class="tag">{{ tag }}</span>
        </span>
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
  category: string
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
  gap: 0.75rem;
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
  flex-shrink: 0;
}

.archive-link:hover {
  color: var(--vp-c-brand-1);
}

.archive-category {
  font-size: 0.75rem;
  padding: 0.1rem 0.45rem;
  border-radius: 3px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  flex-shrink: 0;
}

.archive-tags {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.archive-tags .tag {
  font-size: 0.7rem;
  padding: 0.05rem 0.35rem;
  border-radius: 3px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-3);
}

.empty {
  text-align: center;
  color: var(--vp-c-text-3);
  padding: 3rem 0;
}
</style>
