<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref} from 'vue'
import {useRoute} from 'vitepress'
import {data as posts} from '../../posts/posts.data'
import {features} from '../composables/usePostFilter'
import LoadingImage from './LoadingImage.vue'
import {
  RiUserSmileLine,
  RiProfileLine,
  RiGithubLine,
  RiArticleLine,
  RiFocus3Line,
  RiFolder6Line,
  RiPriceTag3Line,
  RiArrowUpSLine,
  RiArrowDownSLine
} from "@remixicon/vue";

const route = useRoute()
const sidebarRef = ref<HTMLElement | null>(null)
const expandedCategories = ref(new Set(posts.map(post => post.category)))

// 文章列表页挂载后随机抽 5 篇作为推荐，避免 SSR 与客户端水合结果不一致。
const recommended = ref<typeof posts>([])
const recommendedWaveRef = ref<HTMLElement | null>(null)
let destroyRecommendedWave: (() => void) | undefined

function pickRecommended(): void {
  const pool = [...posts]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  recommended.value = pool.slice(0, 5)
}

onMounted(async () => {
  pickRecommended()
  if (!recommendedWaveRef.value) return

  // 仅在客户端加载推荐阅读标题动画，避免影响 VitePress 服务端渲染。
  const {default: lottie} = await import('lottie-web')
  const animation = lottie.loadAnimation({
    container: recommendedWaveRef.value,
    renderer: 'svg',
    loop: true,
    autoplay: true,
    path: '/lottie/emoji_star_strike.json',
  })
  destroyRecommendedWave = () => animation.destroy()
})

onBeforeUnmount(() => destroyRecommendedWave?.())

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

  return Array.from(groups, ([category, items]) => ({
    category,
    items,
    feature: features.value.find(feature => feature.category === category),
  }))
})

// 顶部开关仅在全部分类均展开时显示“收起”，部分展开时点击会统一展开全部分类。
const areAllCategoriesExpanded = computed(() => (
  categoryGroups.value.length > 0
  && categoryGroups.value.every(group => expandedCategories.value.has(group.category))
))

// 统计全部文章去重后的标签总数，供资料卡展示。
const tagCount = computed(() => {
  const tags = new Set<string>()
  posts.forEach(post => (post.tags || []).forEach(tag => tags.add(tag)))
  return tags.size
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

function toggleAllCategories(): void {
  expandedCategories.value = areAllCategoriesExpanded.value
    ? new Set<string>()
    : new Set(categoryGroups.value.map(group => group.category))
}

async function locateCurrentPost(): Promise<void> {
  const currentPost = posts.find(post => isActive(post.url))
  if (!currentPost) return

  if (!expandedCategories.value.has(currentPost.category)) {
    expandedCategories.value = new Set([
      ...expandedCategories.value,
      currentPost.category,
    ])
    await nextTick()
  }

  const activeLink = sidebarRef.value?.querySelector<HTMLElement>('.post-sidebar-list a.active')
  if (!activeLink) return

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  activeLink.scrollIntoView({
    behavior: reduceMotion ? 'auto' : 'smooth',
    block: 'center',
    inline: 'nearest',
  })
}
</script>

<template>
  <section ref="sidebarRef" class="post-sidebar" :aria-label="isPostListPage ? '作者信息' : '文章导航'">
    <template v-if="isPostListPage">
      <div class="ethan-profile">
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
            <dd class="flex items-center justify-center gap-0.5">
              <RiArticleLine size="12px"/>
              文章
            </dd>
          </div>
          <div>
            <dt>{{ categoryGroups.length }}</dt>
            <dd class="flex items-center justify-center gap-0.5">
              <RiFolder6Line size="12px"/>
              分类
            </dd>
          </div>
          <div>
            <dt>{{ tagCount }}</dt>
            <dd class="flex items-center justify-center gap-0.5">
              <RiPriceTag3Line size="12px"/>
              标签
            </dd>
          </div>
        </dl>

        <nav class="ethan-links" aria-label="Ethan 个人链接">
          <a href="/about/" class="flex items-center justify-center gap-1">
            <RiUserSmileLine size="18px"/>
            关于</a>
          <a href="/resume/" class="flex items-center justify-center gap-1">
            <RiProfileLine size="18px"/>
            简历</a>
          <a href="https://github.com/roydonGuo" target="_blank" rel="noopener noreferrer"
             class="flex items-center justify-center gap-1">
            <RiGithubLine size="18px"/>
            GitHub</a>
        </nav>
      </div>

      <div class="recommended-articles">
        <h3 class="recommended-title">
          <span ref="recommendedWaveRef" class="recommended-wave" aria-hidden="true"/>
          推荐阅读
        </h3>
        <ul class="recommended-list">
          <li v-for="post in recommended" :key="post.url">
            <a :href="post.url" class="recommended-item">
              <div class="recommended-cover">
                <LoadingImage
                    class="recommended-cover-media"
                    image-class="recommended-cover-image"
                    :src="post.cover"
                    :alt="post.title"
                />
              </div>
              <div class="recommended-body">
                <span class="recommended-name">{{ post.title }}</span>
                <div class="recommended-meta">
                  <span class="recommended-cat">{{ post.category }}</span>
                  <time v-if="post.date" class="recommended-date" :datetime="post.date">{{ post.date }}</time>
                </div>
              </div>
            </a>
          </li>
        </ul>
      </div>
    </template>

    <template v-else>
      <div class="post-sidebar-home">
        <a class="post-sidebar-home-link" href="/posts/">
          <span class="post-sidebar-home-icon" aria-hidden="true">#</span>
          <span class="post-sidebar-home-copy">
            <strong>文章导航</strong>
            <small>共 {{ posts.length }} 篇文章</small>
          </span>
        </a>
        <button
            class="post-sidebar-toggle"
            type="button"
            :aria-label="areAllCategoriesExpanded ? '折叠全部分类文章' : '展开全部分类文章'"
            :title="areAllCategoriesExpanded ? '折叠全部' : '展开全部'"
            :aria-expanded="areAllCategoriesExpanded"
            @click="toggleAllCategories"
        >
          <RiArrowUpSLine v-if="areAllCategoriesExpanded" size="18px" aria-hidden="true"/>
          <RiArrowDownSLine v-else size="18px" aria-hidden="true"/>
        </button>
        <button
            class="post-sidebar-toggle"
            type="button"
            aria-label="定位当前正在阅读的文章"
            title="定位当前文章"
            aria-controls="post-sidebar-article-list"
            @click="locateCurrentPost"
        >
          <RiFocus3Line size="16px" aria-hidden="true"/>
        </button>
      </div>

      <div id="post-sidebar-article-list" class="post-sidebar-groups">
        <section v-for="group in categoryGroups" :key="group.category" class="post-sidebar-group">
          <button
              class="post-sidebar-category"
              type="button"
              :aria-expanded="expandedCategories.has(group.category)"
              @click="toggleCategory(group.category)"
          >
            <span class="post-sidebar-category-name">
              <img v-if="group.feature" :src="group.feature.icon" :alt="`${group.category}分类图标`">
              <span>{{ group.category }}</span>
            </span>
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
  text-align: center;
}

.ethan-profile-head {
  position: relative;
  width: fit-content;
  margin: 0 auto 16px;
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
  transition: transform 0.7s ease;
}

.ethan-avatar:hover {
  transform: rotate(360deg);
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
  grid-template-columns: repeat(3, 1fr);
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
  display: flex;
  align-items: center;
  margin-bottom: 18px;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 16%, var(--vp-c-divider));
  border-radius: 16px;
  background: linear-gradient(135deg, var(--vp-c-brand-soft), transparent);
}

.post-sidebar-home-link {
  display: grid;
  min-width: 0;
  flex: 1;
  grid-template-columns: 38px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 2px;
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

.post-sidebar-home-copy {
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
  font-size: 12px;
}

.post-sidebar-toggle {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  place-items: center;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: color 0.2s ease, background-color 0.2s ease;
}

.post-sidebar-toggle:hover,
.post-sidebar-toggle:focus-visible {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
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
  font-size: 14px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.post-sidebar-category-name {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}

.post-sidebar-category-name img {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  margin: 0;
  object-fit: contain;
}

.post-sidebar-category-name span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  padding: 5px 9px;
  border-radius: 8px;
  color: var(--vp-c-text-2);
  font-size: 12.5px;
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

.recommended-articles {
  margin-top: 16px;
  padding: 18px 16px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 14%, var(--vp-c-divider));
  border-radius: 18px;
  background: var(--vp-c-bg);
  box-shadow: 0 14px 36px rgba(36, 69, 235, 0.08);
}

.recommended-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 14px;
  color: var(--vp-c-text-1);
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.recommended-wave {
  width: 32px;
  height: 32px;
  flex: 0 0 36px;
}

.recommended-list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.recommended-item {
  display: flex;
  align-items: stretch;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  transition: background-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

.recommended-item:hover {
  background: var(--vp-c-brand-soft);
  box-shadow: 0 6px 16px rgba(36, 69, 235, 0.12);
}

.recommended-cover {
  width: 38%;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--vp-c-divider);
}

.recommended-cover-media {
  width: 100%;
  height: 100%;
}

.recommended-cover :deep(.recommended-cover-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  margin: 0;
  transition: transform 0.35s ease;
}

.recommended-item:hover .recommended-cover :deep(.recommended-cover-image) {
  transform: scale(1.05);
}

.recommended-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 10px 12px;
}

.recommended-name {
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.recommended-item:hover .recommended-name {
  color: var(--vp-c-brand-1);
}

.recommended-cat {
  color: var(--vp-c-text-3);
  font-size: 11px;
}

.recommended-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.recommended-date {
  flex-shrink: 0;
  color: var(--vp-c-text-3);
  font-size: 11px;
  line-height: 1;
}

/* config.mts 中的占位分组只用于启用 VitePress 侧边栏布局。 */
:global(.VPSidebar:has(.post-sidebar) .group) {
  display: none;
}
</style>
