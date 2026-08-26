<template>
  <div>
    <!-- Filter bar -->
    <div v-if="activeFilter" class="filter-bar">
      <span class="filter-label">{{ activeFilterLabel }}</span>
      <button class="filter-clear" @click="clearFilter">✕ 清除筛选</button>
    </div>

    <!-- Post cards -->
    <div v-if="filteredPosts.length" class="post-list">
      <article v-for="post in visiblePosts" :key="post.url" class="post-card">
        <a :href="post.url" class="card-link">
          <div class="card-body">

            <h3 class="card-title">{{ post.title }}</h3>
            <p v-if="post.excerpt" class="card-excerpt">{{ post.excerpt }}</p>
            <div class="card-footer">
              <time v-if="post.date" class="card-date">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                {{ formatDate(post.date) }}
              </time>
              <span class="card-category">{{ post.category }}</span>
              <div v-if="post.tags.length" class="card-tags">
                <span v-for="tag in post.tags" :key="tag" class="card-tag">#{{ tag }}</span>
              </div>
            </div>
          </div>
          <div class="card-cover">
            <img :src="post.cover" :alt="post.title" loading="lazy" />
          </div>
        </a>
      </article>
      <!-- 进入视口后继续追加下一批文章，避免一次性渲染全部卡片。 -->
      <div
        v-if="hasMore"
        ref="loadMoreTrigger"
        class="load-more-trigger"
        aria-label="继续加载文章"
      >
        继续向下滚动，加载更多文章
      </div>
    </div>
    <p v-else class="empty">没有匹配的文章 🙃</p>

    <!-- 页面滚动较深时显示，方便从文章列表快速返回顶部。 -->
    <button
      type="button"
      class="back-to-top"
      :class="{ 'is-visible': showBackToTop }"
      :tabindex="showBackToTop ? 0 : -1"
      aria-label="返回文章列表顶部"
      title="返回顶部"
      @click="scrollToTop"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m18 15-6-6-6 6" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  filteredPosts,
  activeFilter,
  activeFilterLabel,
  clearFilter,
} from '../composables/usePostFilter'

const PAGE_SIZE = 10
const visibleCount = ref(PAGE_SIZE)
const loadMoreTrigger = ref<HTMLElement | null>(null)
const showBackToTop = ref(false)
const visiblePosts = computed(() => filteredPosts.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < filteredPosts.value.length)

let observer: IntersectionObserver | null = null

// 切换分类或标签后重新从前 10 篇开始展示。
watch(filteredPosts, () => {
  visibleCount.value = PAGE_SIZE
})

// 哨兵节点进入视口时，每次只追加 10 篇文章。
watch(loadMoreTrigger, (trigger) => {
  observer?.disconnect()
  observer = null

  if (!trigger || typeof IntersectionObserver === 'undefined') return

  observer = new IntersectionObserver((entries) => {
    if (!entries[0]?.isIntersecting || !hasMore.value) return
    visibleCount.value = Math.min(visibleCount.value + PAGE_SIZE, filteredPosts.value.length)
  }, {
    rootMargin: '0px 0px 160px',
  })
  observer.observe(trigger)
}, { flush: 'post' })

// 使用被动滚动监听更新按钮状态，避免阻塞页面滚动。
function updateBackToTopVisibility() {
  showBackToTop.value = window.scrollY > 480
}

function scrollToTop() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
}

onMounted(() => {
  updateBackToTopVisibility()
  window.addEventListener('scroll', updateBackToTopVisibility, { passive: true })
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('scroll', updateBackToTopVisibility)
})

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
  border-radius: 9rem;
  background: var(--vp-c-brand-soft);
  font-size: 1rem;
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
  border-radius: 1rem;
  overflow: hidden;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border-1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.25s, border-color 0.25s;
}

.post-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
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
  padding: 0.15rem 0.65rem;
  font-size: 0.7rem;
  font-weight: 600;
  border-radius: 99px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
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
  padding: 0.1rem 0.7rem;
  font-size: 0.75rem;
  border-radius: 99px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  transition: color 0.2s, background 0.2s;
}

.post-card:hover .card-tag {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.card-cover {
  width: 40%;
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

.load-more-trigger {
  padding: 0.75rem 0;
  text-align: center;
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
}

.back-to-top {
  position: fixed;
  right: 28px;
  bottom: 28px;
  z-index: 30;
  display: grid;
  width: 46px;
  height: 46px;
  padding: 0;
  place-items: center;
  border: 1px solid var(--vp-c-border);
  border-radius: 50%;
  background: color-mix(in srgb, var(--vp-c-bg) 88%, transparent);
  color: var(--vp-c-text-1);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.14);
  opacity: 0;
  pointer-events: none;
  cursor: pointer;
  transform: translateY(14px) scale(0.92);
  backdrop-filter: blur(12px);
  transition: opacity 0.2s, transform 0.25s, color 0.2s, border-color 0.2s;
}

.back-to-top.is-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0) scale(1);
}

.back-to-top:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  transform: translateY(-2px) scale(1.04);
}

.back-to-top:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 3px;
}

.empty {
  text-align: center;
  color: var(--vp-c-text-3);
  padding: 3rem 0;
}

@media (max-width: 640px) {
  .back-to-top {
    right: 16px;
    bottom: 18px;
    width: 42px;
    height: 42px;
  }

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
