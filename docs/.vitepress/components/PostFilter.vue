<template>
  <div v-if="isPostsPage" class="post-filter">
    <div class="filter-section">
      <h4 class="filter-title">📂 分类</h4>
      <ul class="filter-list">
<!--        <li>-->
<!--          <button :class="['filter-item', { active: !selectedCategory && !selectedTag }]"-->
<!--            @click="clearFilter">全部</button>-->
<!--        </li>-->
        <li v-for="feature in features" :key="feature.category">
          <button
            :class="['filter-item', { active: selectedCategory === feature.category }]"
            :style="{'--category-color': feature.primaryColor}"
            @click="filterByCategory(feature.category)"
          >
            <span class="filter-category-icon"><img :src="feature.icon" :alt="`${feature.title}分类图标`"></span>
            <span class="filter-category-name">{{ feature.title }}</span>
            <span class="filter-category-count">{{ feature.count }}</span>
          </button>
        </li>
      </ul>
    </div>

    <div class="filter-section">
      <h4 class="filter-title">🏷️ 标签</h4>
      <div class="filter-tags">
        <button v-for="tag in tags" :key="tag" :class="['filter-tag', { active: selectedTag === tag }]"
          @click="filterByTag(tag)">
          <span>#{{ tag }}</span>
          <span class="filter-tag-count">{{ tagArticleCounts[tag] }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vitepress'
import {
  features,
  tags,
  tagArticleCounts,
  selectedCategory,
  selectedTag,
  filterByCategory,
  filterByTag,
} from '../composables/usePostFilter'

const route = useRoute()
const isPostsPage = computed(() => {
  const p = route.path.replace(/\/+$/, '')
  return p === '/posts'
})
</script>

<style scoped>
.post-filter {
}

.filter-section {
  margin-bottom: 1.25rem;
}

.filter-title {
  font-size: 0.85rem;
  font-weight: 900;
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
  font-weight: 600;
}

.filter-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.5rem;
  text-align: left;
  padding: 0.3rem 0.6rem;
  border: none;
  border-radius: 9rem;
  font-size: 14px;
  cursor: pointer;
  background: transparent;
  color: var(--vp-c-text-2);
  transition: all 0.3s;
}

.filter-item:hover {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
}

.filter-item.active {
  background: color-mix(in srgb, var(--category-color) 20%, transparent);
  color: var(--category-color);
  font-weight: 600;
}

.filter-category-icon {
  display: inline-grid;
  width: 1.65rem;
  height: 1.65rem;
  flex: 0 0 1.65rem;
  place-items: center;
  border-radius: 0.45rem;
  background: color-mix(in srgb, var(--category-color) 5%, transparent);
}

.filter-category-icon img {
  width: 1.15rem;
  height: 1.15rem;
  margin: 0;
  object-fit: contain;
}

.filter-category-name {
  min-width: 0;
  flex: 1;
}

.filter-category-count {
  display: inline-grid;
  min-width: 1.45rem;
  height: 1.45rem;
  padding: 0 0.35rem;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--category-color) 10%, var(--vp-c-bg-soft));
  color: var(--category-color);
  font-size: 0.68rem;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}

.filter-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.filter-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.15rem 0.625rem;
  border: 1px solid var(--vp-c-border-1);
  border-radius: 1rem;
  font-size: 13px;
  cursor: pointer;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 86%, transparent);
  color: var(--vp-c-text-2);
  transition: all 0.3s;
}

.filter-tag-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 .3rem;
  width: .3rem;
  height: .3rem;
  color: var(--vp-c-text-3);
  font-size: 0.65rem;
  font-variant-numeric: tabular-nums;
  transition: all 0.3s;
}

.filter-tag:hover {
  border-color: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  background: color-mix(in srgb, var(--vp-c-brand-soft) 86%, transparent);
}

.filter-tag:hover .filter-tag-count {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.filter-tag.active .filter-tag-count {
  background: var(--vp-c-bg);
  color: var(--vp-c-brand-1);
}

.filter-tag.active {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
</style>
