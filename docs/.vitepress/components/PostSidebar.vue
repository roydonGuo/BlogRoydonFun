<script setup lang="ts">
import {computed, ref} from 'vue'
import {useRoute} from 'vitepress'
import {data as posts} from '../../posts/posts.data'

const route = useRoute()
const expandedCategories = ref(new Set(posts.map(post => post.category)))

// /posts/ 是文章列表页，其余 /posts/* 路由均按文章详情页处理。
const isPostListPage = computed(() => normalizePath(route.path) === '/posts')

// 复用文章数据源并保留首次出现顺序，新增文章后无需手工维护侧边栏。
const categoryGroups = computed(() => {
  const groups = new Map<string, typeof posts>()

  posts.forEach((post) => {
    const group = groups.get(post.category) || []
    group.push(post)
    groups.set(post.category, group)
  })

  return Array.from(groups, ([category, items]) => ({category, items}))
})

function normalizePath(path: string): string {
  return path.replace(/\/$/, '')
}

function isActive(url: string): boolean {
  return normalizePath(route.path) === normalizePath(url)
}

function toggleCategory(category: string): void {
  const next = new Set(expandedCategories.value)
  next.has(category) ? next.delete(category) : next.add(category)
  expandedCategories.value = next
}
</script>

<template>
  <section class="post-sidebar" :aria-label="isPostListPage ? '作者信息' : '文章导航'">
    <div v-if="isPostListPage" class="ethan-profile">
      <div class="ethan-profile-head">
        <img class="ethan-avatar" src="/1fad0.svg" alt="Ethan">
        <span class="ethan-status" title="持续创作中" aria-label="持续创作中"/>
      </div>

      <div class="ethan-profile-copy">
        <h2 class="ethan-name">Ethan</h2>
        <p class="ethan-role">全栈开发</p>
        <p class="ethan-bio">热爱技术与设计，记录工程实践、生活思考与创意灵感。</p>
      </div>

      <dl class="ethan-stats">
        <div>
          <dt>{{ posts.length }}</dt>
          <dd>文章</dd>
        </div>
        <div>
          <dt>{{ categoryGroups.length }}</dt>
          <dd>分类</dd>
        </div>
      </dl>

      <nav class="ethan-links" aria-label="Ethan 个人链接">
        <a href="/about/">关于我</a>
        <a href="/resume/">个人简历</a>
        <a href="https://github.com/roydonGuo" target="_blank" rel="noopener noreferrer">GitHub</a>
      </nav>
    </div>

    <template v-else>
      <a class="post-sidebar-home" href="/posts/">
        <span class="post-sidebar-home-icon" aria-hidden="true">#</span>
        <span>
          <strong>文章导航</strong>
          <small>共 {{ posts.length }} 篇文章</small>
        </span>
      </a>

      <div class="post-sidebar-groups">
        <section v-for="group in categoryGroups" :key="group.category" class="post-sidebar-group">
          <button
              class="post-sidebar-category"
              type="button"
              :aria-expanded="expandedCategories.has(group.category)"
              @click="toggleCategory(group.category)"
          >
            <span>{{ group.category }}</span>
            <small>{{ group.items.length }}</small>
            <svg aria-hidden="true" viewBox="0 0 16 16" :class="{ expanded: expandedCategories.has(group.category) }">
              <path d="m5 6 3 3 3-3"/>
            </svg>
          </button>

          <ul v-show="expandedCategories.has(group.category)" class="post-sidebar-list">
            <li v-for="post in group.items" :key="post.url">
              <a :href="post.url" :class="{ active: isActive(post.url) }"
                 :aria-current="isActive(post.url) ? 'page' : undefined">
                <span>{{ post.title }}</span>
                <time v-if="post.date" :datetime="post.date">{{ post.date.slice(5) }}</time>
              </a>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </section>
</template>

<style scoped>
.post-sidebar {
  width: 100%;
  padding-bottom: 24px;
}

.ethan-profile {
  padding: 22px 18px 18px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 14%, var(--vp-c-divider));
  border-radius: 18px;
  background: radial-gradient(circle at 85% 8%, var(--vp-c-brand-soft), transparent 42%),
  var(--vp-c-bg);
  box-shadow: 0 14px 36px rgba(36, 69, 235, 0.08);
}

.ethan-profile-head {
  position: relative;
  width: fit-content;
  margin-bottom: 16px;
}

.ethan-avatar {
  display: block;
  width: 72px;
  height: 72px;
  padding: 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 72px;
  background: var(--vp-c-bg-soft);
  object-fit: contain;
}

.ethan-status {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 15px;
  height: 15px;
  border: 3px solid var(--vp-c-bg);
  border-radius: 50%;
  background: #22c55e;
}

.ethan-profile-copy {
  margin-bottom: 18px;
}

.ethan-name {
  color: var(--vp-c-brand-1) !important;
  font-weight: 800;
  letter-spacing: 0.05em;
}

.ethan-profile h2 {
  margin: 0;
  color: var(--vp-c-text-1);
  font-size: 22px;
  line-height: 1.2;
}

.ethan-role {
  margin: 5px 0 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
  font-weight: 600;
}

.ethan-bio {
  margin: 12px 0 0;
  color: var(--vp-c-text-3);
  font-size: 12px;
  line-height: 1.75;
}

.ethan-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  margin: 0 0 16px;
  padding: 13px 0;
  border-top: 1px solid var(--vp-c-divider);
  border-bottom: 1px solid var(--vp-c-divider);
}

.ethan-stats div {
  text-align: center;
}

.ethan-stats div + div {
  border-left: 1px solid var(--vp-c-divider);
}

.ethan-stats dt {
  color: var(--vp-c-text-1);
  font-size: 17px;
  font-weight: 800;
}

.ethan-stats dd {
  margin: 2px 0 0;
  color: var(--vp-c-text-3);
  font-size: 10px;
}

.ethan-links {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.ethan-links a {
  padding: 7px 5px;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  transition: color 0.2s ease, background-color 0.2s ease;
}

.ethan-links a:hover {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.post-sidebar-home {
  display: grid;
  grid-template-columns: 38px 1fr;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 16%, var(--vp-c-divider));
  border-radius: 12px;
  background: linear-gradient(135deg, var(--vp-c-brand-soft), transparent);
}

.post-sidebar-home-icon {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 10px;
  background: var(--vp-c-brand-1);
  color: #fff;
  font-size: 18px;
  font-weight: 700;
}

.post-sidebar-home span:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.post-sidebar-home strong {
  color: var(--vp-c-text-1);
  font-size: 14px;
}

.post-sidebar-home small,
.post-sidebar-category small {
  color: var(--vp-c-text-3);
  font-size: 11px;
}

.post-sidebar-groups {
  display: grid;
  gap: 12px;
}

.post-sidebar-category {
  display: grid;
  width: 100%;
  grid-template-columns: 1fr auto 18px;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: 0;
  background: transparent;
  color: var(--vp-c-text-1);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.post-sidebar-category svg {
  width: 16px;
  fill: none;
  stroke: var(--vp-c-text-3);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
  transition: transform 0.2s ease;
}

.post-sidebar-category svg.expanded {
  transform: rotate(180deg);
}

.post-sidebar-list {
  margin: 4px 0 0;
  padding: 0 0 0 8px;
  border-left: 1px solid var(--vp-c-divider);
  list-style: none;
}

.post-sidebar-list a {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  margin: 2px 0;
  padding: 7px 9px;
  border-radius: 8px;
  color: var(--vp-c-text-2);
  font-size: 12px;
  line-height: 1.45;
  transition: color 0.2s ease, background-color 0.2s ease;
}

.post-sidebar-list a:hover,
.post-sidebar-list a.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.post-sidebar-list a.active {
  font-weight: 600;
}

.post-sidebar-list span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.post-sidebar-list time {
  color: var(--vp-c-text-3);
  font-size: 10px;
}

/* config.mts 中的占位分组只用于启用 VitePress 侧边栏布局。 */
:global(.VPSidebar:has(.post-sidebar) .group) {
  display: none;
}
</style>
