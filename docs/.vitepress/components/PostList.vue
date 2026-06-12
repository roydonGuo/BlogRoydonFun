<template>
  <div class="post-grid">
    <article v-for="post in posts" :key="post.url" class="post-card">
      <a :href="post.url" class="card-link">
        <div class="card-cover">
          <img :src="post.cover" :alt="post.title" loading="lazy" />
          <span class="card-category">{{ post.category }}</span>
        </div>
        <div class="card-body">
          <h3 class="card-title">{{ post.title }}</h3>
          <p v-if="post.excerpt" class="card-excerpt">{{ post.excerpt }}</p>
          <div class="card-footer">
            <time v-if="post.date" class="card-date">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              {{ formatDate(post.date) }}
            </time>
            <div v-if="post.tags.length" class="card-tags">
              <span v-for="tag in post.tags" :key="tag" class="card-tag">{{ tag }}</span>
            </div>
          </div>
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
.post-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 1.5rem;
  margin: 2rem 0;
}

.post-card {
  border-radius: 12px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-bg-soft);
  transition: transform 0.25s, box-shadow 0.25s, border-color 0.25s;
}

.post-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.1);
  border-color: var(--vp-c-brand-soft);
}

.card-link {
  text-decoration: none;
  color: inherit;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.card-cover {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--vp-c-bg-mute);
}

.card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.35s;
}

.post-card:hover .card-cover img {
  transform: scale(1.05);
}

.card-category {
  position: absolute;
  top: 12px;
  left: 12px;
  padding: 0.25rem 0.7rem;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 6px;
  background: rgba(36, 69, 235, 0.9);
  color: #fff;
  backdrop-filter: blur(4px);
  letter-spacing: 0.3px;
}

.card-body {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.card-title {
  margin: 0 0 0.5rem;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-clamp: 2;
}

.card-excerpt {
  margin: 0 0 1rem;
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  line-height: 1.6;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-clamp: 2;
  flex: 1;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--vp-c-bg-mute);
}

.card-date {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
}

.card-date svg {
  flex-shrink: 0;
}

.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.card-tag {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  font-size: 0.72rem;
  border-radius: 4px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.empty {
  text-align: center;
  color: var(--vp-c-text-3);
  padding: 3rem 0;
  grid-column: 1 / -1;
}

@media (max-width: 640px) {
  .post-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}
</style>
