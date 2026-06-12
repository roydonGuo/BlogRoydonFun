<template>
  <div v-if="isPostsPage" class="post-filter">
    <div class="filter-section">
      <h4 class="filter-title">📂 分类</h4>
      <ul class="filter-list">
        <li>
          <button
            :class="['filter-item', { active: !selectedCategory && !selectedTag }]"
            @click="clearFilter"
          >全部</button>
        </li>
        <li v-for="cat in categories" :key="cat">
          <button
            :class="['filter-item', { active: selectedCategory === cat }]"
            @click="filterByCategory(cat)"
          >{{ cat }}</button>
        </li>
      </ul>
    </div>

    <div class="filter-section">
      <h4 class="filter-title">🏷️ 标签</h4>
      <div class="filter-tags">
        <button
          v-for="tag in tags"
          :key="tag"
          :class="['filter-tag', { active: selectedTag === tag }]"
          @click="filterByTag(tag)"
        >{{ tag }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vitepress'
import {
  categories,
  tags,
  selectedCategory,
  selectedTag,
  filterByCategory,
  filterByTag,
  clearFilter,
} from '../composables/usePostFilter'

const route = useRoute()
const isPostsPage = computed(() => route.path === '/posts/')
</script>

<style scoped>
.post-filter {
  padding: 0.5rem 0;
}

.filter-section {
  margin-bottom: 1.25rem;
}

.filter-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
  margin: 0 0 0.5rem;
  letter-spacing: 0.5px;
}

.filter-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.filter-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.3rem 0.6rem;
  border: none;
  border-radius: 5px;
  font-size: 0.82rem;
  cursor: pointer;
  background: transparent;
  color: var(--vp-c-text-2);
  transition: all 0.2s;
}

.filter-item:hover {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
}

.filter-item.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 500;
}

.filter-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.filter-tag {
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--vp-c-border);
  border-radius: 5px;
  font-size: 0.75rem;
  cursor: pointer;
  background: transparent;
  color: var(--vp-c-text-3);
  transition: all 0.2s;
}

.filter-tag:hover {
  border-color: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.filter-tag.active {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 500;
}
</style>
