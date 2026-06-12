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
