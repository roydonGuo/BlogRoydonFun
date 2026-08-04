<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vitepress'
import { data as posts } from '../../posts/posts.data'

const route = useRoute()

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
</script>

<template>
  <nav v-if="showPager" class="post-prev-next" aria-label="Post pagination">
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
  </nav>
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
</style>
