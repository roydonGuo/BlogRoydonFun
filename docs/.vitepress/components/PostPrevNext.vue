<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from 'vue'
import {useRoute} from 'vitepress'
import {data as posts} from '../../posts/posts.data'
import GiscusComment from './GiscusComment.vue' // 评论模块

const route = useRoute()
const showBackToTop = ref(false)

// Normalize trailing slashes so dev and build URLs resolve to the same post.
function normalizePath(path: string): string {
  return path.replace(/\/$/, '')
}

const currentIndex = computed(() => {
  const currentPath = normalizePath(route.path)
  return posts.findIndex(post => normalizePath(post.url) === currentPath)
})

// posts.data.ts is sorted newest first: the previous item is newer, the next item is older.
const prevPost = computed(() => {
  return currentIndex.value > 0 ? posts[currentIndex.value - 1] : undefined
})

const nextPost = computed(() => {
  const nextIndex = currentIndex.value + 1
  return currentIndex.value >= 0 && nextIndex < posts.length
      ? posts[nextIndex]
      : undefined
})

const showPager = computed(() => {
  return currentIndex.value >= 0 && (prevPost.value || nextPost.value)
})
const isPostDetail = computed(() => currentIndex.value >= 0)

// 使用被动监听更新按钮状态，避免影响文章正文的滚动性能。
function updateBackToTopVisibility() {
  showBackToTop.value = window.scrollY > 480
}

function scrollToTop() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({top: 0, behavior: reduceMotion ? 'auto' : 'smooth'})
}

onMounted(() => {
  updateBackToTopVisibility()
  window.addEventListener('scroll', updateBackToTopVisibility, {passive: true})
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', updateBackToTopVisibility)
})
</script>

<template>
  <nav v-if="showPager">
    <div class="post-prev-next" aria-label="Post pagination">
      <div class="post-pager">
        <a v-if="prevPost" class="post-pager-link prev" :href="prevPost.url">
          <span class="post-pager-desc">&#19978;&#19968;&#31687;</span>
          <span class="post-pager-title">{{ prevPost.title }}</span>
        </a>
      </div>

      <div class="post-pager">
        <a v-if="nextPost" class="post-pager-link next" :href="nextPost.url">
          <span class="post-pager-desc">&#19979;&#19968;&#31687;</span>
          <span class="post-pager-title">{{ nextPost.title }}</span>
        </a>
      </div>
    </div>
    <GiscusComment/>
  </nav>

  <!-- 仅在文章详情路由中提供固定于右下角的返回顶部入口。 -->
  <button
      v-if="isPostDetail"
      type="button"
      class="detail-back-to-top"
      :class="{ 'is-visible': showBackToTop }"
      :tabindex="showBackToTop ? 0 : -1"
      aria-label="返回文章顶部"
      title="返回顶部"
      @click="scrollToTop"
  >
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m18 15-6-6-6 6"/>
    </svg>
  </button>
</template>

<style scoped>
.post-prev-next {
  display: grid;
  grid-row-gap: 8px;
  margin-top: 64px;
  padding-top: 24px;
  border-top: 1px solid var(--vp-c-divider);
}

.post-pager-link {
  display: block;
  width: 100%;
  height: 100%;
  padding: 11px 16px 13px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  transition: border-color 0.25s;
}

.post-pager-link:hover {
  border-color: var(--vp-c-brand-1);
}

.post-pager-link.next {
  margin-left: auto;
  text-align: right;
}

.post-pager-desc {
  display: block;
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 500;
  line-height: 20px;
}

.post-pager-title {
  display: block;
  color: var(--vp-c-brand-1);
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  transition: color 0.25s;
}

@media (min-width: 640px) {
  .post-prev-next {
    grid-template-columns: repeat(2, 1fr);
    grid-column-gap: 16px;
  }
}

.detail-back-to-top {
  position: fixed;
  right: 28px;
  bottom: 28px;
  z-index: 30;
  display: grid;
  width: 46px;
  height: 46px;
  padding: 0;
  place-items: center;
  border: 1px solid var(--vp-c-border-1);
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

.detail-back-to-top.is-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0) scale(1);
}

.detail-back-to-top:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  transform: translateY(-2px) scale(1.04);
}

.detail-back-to-top:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 3px;
}

@media (max-width: 640px) {
  .detail-back-to-top {
    right: 16px;
    bottom: 18px;
    width: 42px;
    height: 42px;
  }
}
</style>
