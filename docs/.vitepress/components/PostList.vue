<template>
  <div>
    <!-- Filter bar -->
    <div v-if="activeFilter" class="filter-bar">
      <span class="filter-label">{{ activeFilterLabel }}</span>
      <button class="filter-clear" @click="clearFilter">✕ 清除筛选</button>
    </div>

    <!-- Post cards -->
    <div v-if="filteredPosts.length" class="post-list">
      <article v-for="post in filteredPosts" :key="post.url" class="post-card">
        <a :href="post.url" class="card-link">
          <div class="card-body">
            <span class="card-category">{{ post.category }}</span>
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
          <div class="card-cover">
            <img :src="post.cover" :alt="post.title" loading="lazy" />
          </div>
        </a>
      </article>
    </div>
    <p v-else class="empty">没有匹配的文章 🙃</p>
  </div>
</template>

<script setup lang="ts">
import {
  filteredPosts,
  activeFilter,
  activeFilterLabel,
  clearFilter,
} from '../composables/usePostFilter'

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}
</script>

<style scoped>
/* ---- Filter bar ---- */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
  padding: 0.6rem 1rem;
  border-radius: 8px;
  background: var(--vp-c-brand-soft);
  font-size: 0.875rem;
}

.filter-label {
  font-weight: 500;
  color: var(--vp-c-brand-1);
}

.filter-clear {
  margin-left: auto;
  padding: 0.2rem 0.6rem;
  border: none;
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
  background: transparent;
  color: var(--vp-c-text-3);
  transition: color 0.2s, background 0.2s;
}

.filter-clear:hover {
  color: var(--vp-c-brand-1);
  background: rgba(36, 69, 235, 0.1);
}

/* ---- Post cards ---- */
.post-list {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.post-card {
  border-radius: 10px;
  overflow: hidden;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.25s, border-color 0.25s;
}

.post-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border-color: var(--vp-c-brand-soft);
}

.card-link {
  text-decoration: none;
  color: inherit;
  display: flex;
  flex-direction: row;
  min-height: 150px;
}

.card-body {
  flex: 1;
  padding: 1.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.card-category {
  display: inline-block;
  align-self: flex-start;
  padding: 0.2rem 0.65rem;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 4px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  margin-bottom: 0.6rem;
  letter-spacing: 0.3px;
}

.card-title {
  margin: 0 0 0.5rem;
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  line-height: 1.45;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-clamp: 2;
}

.card-excerpt {
  margin: 0 0 auto;
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  line-height: 1.6;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-clamp: 2;
}

.card-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding-top: 0.75rem;
}

.card-date {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  white-space: nowrap;
}

.card-date svg {
  flex-shrink: 0;
  opacity: 0.7;
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
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-3);
  transition: color 0.2s, background 0.2s;
}

.post-card:hover .card-tag {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.card-cover {
  width: 200px;
  min-width: 200px;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--vp-c-bg-mute);
}

.card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  margin: 0;
  transition: transform 0.35s;
}

.post-card:hover .card-cover img {
  transform: scale(1.05);
}

.empty {
  text-align: center;
  color: var(--vp-c-text-3);
  padding: 3rem 0;
}

@media (max-width: 640px) {
  .card-link {
    flex-direction: column-reverse;
  }

  .card-body {
    padding: 1.25rem;
  }

  .card-cover {
    width: 100%;
    min-width: unset;
    aspect-ratio: 16 / 9;
  }
}
</style>
