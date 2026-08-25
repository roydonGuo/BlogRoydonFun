<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vitepress'
import {
  RiAiGenerate2Line,
  RiArrowRightLine,
  RiArticleLine,
  RiBookmarkFill,
  RiBookmarkLine,
  RiCodeBoxLine,
  RiCodeSSlashLine,
  RiFigmaLine,
  RiFolder6Line,
  RiGithubFill,
  RiNodejsLine,
  RiPaletteLine,
  RiPriceTag3Line,
  RiQuillPenLine,
  RiSparkling2Line,
  RiStarLine,
  RiTimeLine,
  RiToolsLine,
  RiVuejsLine,
} from '@remixicon/vue'
import { data as postData } from '../../posts/posts.data'
import type { PostItem } from '../composables/usePostFilter'
import { selectedCategory, selectedTag } from '../composables/usePostFilter'

type FeaturedMode = 'latest' | 'ai' | 'backend'

interface FeatureCard {
  title: string
  description: string
  href: string
  category?: string
  tone: 'brand' | 'mint' | 'rose'
  icon: typeof RiCodeSSlashLine
}

const router = useRouter()
const posts = postData as PostItem[]
const featuredMode = ref<FeaturedMode>('latest')
const bookmarkedUrls = ref(new Set<string>())

const features: FeatureCard[] = [
  {
    title: '技术',
    description: '前端开发、系统架构、工具链与工程实践',
    href: '/posts/',
    tone: 'brand',
    icon: RiCodeSSlashLine,
  },
  {
    title: '随笔',
    description: '生活记录、思考碎片与阅读笔记',
    href: '/posts/',
    category: '随笔',
    tone: 'mint',
    icon: RiQuillPenLine,
  },
  {
    title: '设计',
    description: 'UI/UX、视觉表达与设计系统',
    href: '/projects/',
    tone: 'rose',
    icon: RiPaletteLine,
  },
]

const featureTabs: Array<{ key: FeaturedMode; label: string }> = [
  { key: 'latest', label: '最新' },
  { key: 'ai', label: 'AI' },
  { key: 'backend', label: '后端' },
]

const tools = [
  { name: 'VS Code', icon: RiCodeBoxLine },
  { name: 'Vue', icon: RiVuejsLine },
  { name: 'Node.js', icon: RiNodejsLine },
  { name: 'Figma', icon: RiFigmaLine },
  { name: 'GitHub', icon: RiGithubFill },
]

const categories = computed(() => new Set(posts.map(post => post.category)))

const tagStats = computed(() => {
  const counts = new Map<string, number>()
  posts.forEach(post => {
    new Set(post.tags || []).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1))
  })
  return Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
})

const popularTags = computed(() => tagStats.value.slice(0, 12))

const writingYears = computed(() => {
  const years = posts
    .map(post => Number(post.date?.slice(0, 4)))
    .filter(year => Number.isFinite(year) && year > 0)
  if (!years.length) return 1
  return Math.max(...years) - Math.min(...years) + 1
})

const featuredPosts = computed(() => {
  if (featuredMode.value === 'ai') {
    return posts.filter(post => post.category === 'AI' || post.tags.includes('ai')).slice(0, 3)
  }
  if (featuredMode.value === 'backend') {
    return posts.filter(post => post.category === '后端开发').slice(0, 3)
  }
  return posts.slice(0, 3)
})

function openFeature(feature: FeatureCard): void {
  if (feature.category) {
    selectedCategory.value = feature.category
    selectedTag.value = null
  }
  router.go(feature.href)
}

function openTag(tag: string): void {
  selectedTag.value = tag
  selectedCategory.value = null
  router.go('/posts/')
}

function toggleBookmark(url: string): void {
  const next = new Set(bookmarkedUrls.value)
  next.has(url) ? next.delete(url) : next.add(url)
  bookmarkedUrls.value = next
}

function formatDate(date: string): string {
  if (!date) return '最近更新'
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(date))
}
</script>

<template>
  <main class="home-dashboard">
    <section class="home-hero" aria-labelledby="home-title">
      <div class="hero-copy">
        <div class="hero-greeting">
          <span>👋 你好，我是 Ethan</span>
        </div>
        <h1 id="home-title">
          <span class="hero-name">Ethan</span>
          <span>Thoughts on code,<br>design &amp; life</span>
        </h1>
        <p>记录技术与生活的个人博客</p>
        <div class="hero-actions">
          <a class="hero-primary" href="/posts/">
            探索最新文章
            <RiArrowRightLine aria-hidden="true" />
          </a>
          <a class="hero-secondary" href="/about/">关于我</a>
        </div>
      </div>

      <div class="hero-visual" aria-label="Ethan 蓝莓标志">
        <img src="/1fad0.svg" alt="Ethan 蓝莓标志" class="hero-berry">
      </div>
    </section>

    <section class="home-overview" aria-label="内容概览">
      <div class="home-main-column">
        <div class="feature-grid">
          <button
            v-for="feature in features"
            :key="feature.title"
            type="button"
            class="feature-card home-panel"
            :class="`feature-${feature.tone}`"
            @click="openFeature(feature)"
          >
            <span class="feature-icon"><component :is="feature.icon" /></span>
            <span class="feature-copy">
              <strong>{{ feature.title }} <RiArrowRightLine aria-hidden="true" /></strong>
              <small>{{ feature.description }}</small>
            </span>
          </button>
        </div>

        <dl class="stats-bar home-panel">
          <div>
            <span class="stat-icon stat-brand"><RiArticleLine /></span>
            <div class="stat-copy"><dt>{{ posts.length }}</dt><dd>文章总数</dd></div>
          </div>
          <div>
            <span class="stat-icon stat-mint"><RiFolder6Line /></span>
            <div class="stat-copy"><dt>{{ categories.size }}</dt><dd>分类</dd></div>
          </div>
          <div>
            <span class="stat-icon stat-amber"><RiStarLine /></span>
            <div class="stat-copy"><dt>{{ tagStats.length }}</dt><dd>标签</dd></div>
          </div>
          <div>
            <span class="stat-icon stat-violet"><RiTimeLine /></span>
            <div class="stat-copy"><dt>{{ writingYears }}</dt><dd>年写作</dd></div>
          </div>
        </dl>

        <section class="featured-section home-panel" aria-labelledby="featured-title">
          <header class="section-heading">
            <div id="featured-title"><span class="heading-dot" />精选文章</div>
            <div class="featured-tabs" aria-label="文章分类">
              <button
                v-for="tab in featureTabs"
                :key="tab.key"
                type="button"
                :class="{ active: featuredMode === tab.key }"
                @click="featuredMode = tab.key"
              >{{ tab.label }}</button>
            </div>
          </header>

          <div class="featured-grid">
            <article v-for="post in featuredPosts" :key="post.url" class="featured-card">
              <a :href="post.url" class="featured-cover">
                <img :src="post.cover" :alt="post.title" loading="lazy">
              </a>
              <div class="featured-body">
                <a :href="post.url"><h3>{{ post.title }}</h3></a>
                <p>{{ post.excerpt || '记录一篇值得反复阅读的技术与生活笔记。' }}</p>
                <div class="featured-tags">
                  <button v-for="tag in post.tags.slice(0, 3)" :key="tag" type="button" @click="openTag(tag)"># {{ tag }}</button>
                </div>
                <footer>
                  <span>{{ formatDate(post.date) }} · {{ post.category }}</span>
                  <button
                    type="button"
                    class="bookmark-button"
                    :class="{ active: bookmarkedUrls.has(post.url) }"
                    :aria-label="bookmarkedUrls.has(post.url) ? `取消收藏${post.title}` : `收藏${post.title}`"
                    @click="toggleBookmark(post.url)"
                  >
                    <RiBookmarkFill v-if="bookmarkedUrls.has(post.url)" />
                    <RiBookmarkLine v-else />
                  </button>
                </footer>
              </div>
            </article>
          </div>
        </section>
      </div>

      <aside class="home-side-column" aria-label="博客动态">
        <section class="tags-panel home-panel" aria-labelledby="tags-title">
          <header class="side-heading">
            <div id="tags-title"><RiPriceTag3Line />热门标签</div>
            <a href="/posts/">全部标签 <RiArrowRightLine /></a>
          </header>
          <div class="popular-tags">
            <button v-for="tag in popularTags" :key="tag.name" type="button" @click="openTag(tag.name)">
              # {{ tag.name }}
              <span>{{ tag.count }}</span>
            </button>
          </div>
        </section>

        <section class="tools-panel home-panel" aria-labelledby="tools-title">
          <header class="side-heading">
            <div id="tools-title"><RiToolsLine />常用工具箱</div>
          </header>
          <div class="tool-grid">
            <div v-for="tool in tools" :key="tool.name" class="tool-item">
              <component :is="tool.icon" />
              <span>{{ tool.name }}</span>
            </div>
          </div>
        </section>
      </aside>
    </section>

    <footer class="home-footer">
      <span class="footer-brand"><img src="/1fad0.svg" alt="">Ethan</span>
      <span>© 2026 Ethan · Thoughts on code, design &amp; life</span>
      <span href="https://github.com/roydonGuo" target="_blank" rel="noopener noreferrer"><RiGithubFill /> GitHub</span>
    </footer>
  </main>
</template>

<style scoped>
.home-dashboard {
  --home-panel: color-mix(in srgb, var(--vp-c-bg) 88%, transparent);
  --home-panel-strong: color-mix(in srgb, var(--vp-c-bg) 95%, transparent);
  --home-shadow: 0 18px 20px rgba(47, 71, 148, 0.09);
  width: min(1470px, calc(100% - 64px));
  margin: 0 auto;
  padding: 3rem 0 28px;
  color: var(--vp-c-text-1);
}

.dark .home-dashboard {
  --home-panel: color-mix(in srgb, var(--vp-c-bg) 86%, transparent);
  --home-panel-strong: color-mix(in srgb, var(--vp-c-bg) 94%, transparent);
  --home-shadow: 0 20px 54px rgba(0, 0, 0, 0.22);
}

.home-dashboard :where(h1, h2, h3, p) {
  margin: 0;
  border: 0;
}

.home-dashboard :where(a, button) {
  -webkit-tap-highlight-color: transparent;
}

.home-dashboard button {
  font: inherit;
}

.home-hero {
  display: grid;
  min-height: 360px;
  grid-template-columns: minmax(0, 0.9fr) minmax(420px, 1.1fr);
  align-items: center;
  gap: 40px;
}

.hero-copy {
  position: relative;
  z-index: 2;
  padding-left: 18px;
}

.hero-greeting {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 18px;
  padding: 7px 13px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 12%, transparent);
  border-radius: 999px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-text-2);
  font-size: 13px;
  font-weight: 650;
}

.hero-greeting svg {
  width: 16px;
  color: #f4b83f;
}

.hero-copy h1 {
  display: grid;
  gap: 4px;
  color: #11172e;
  font-size: clamp(42px, 4.4vw, 72px);
  font-weight: 850;
  letter-spacing: -0.045em;
  line-height: 0.99;
}

.dark .hero-copy h1 {
  color: #f5f7ff;
}

.hero-name {
  width: fit-content;
  background: linear-gradient(112deg, #3659ff 8%, #7754f6 92%);
  background-clip: text;
  color: transparent;
  font-size: 0.96em;
  line-height: 1.05;
}

.hero-copy > p {
  margin-top: 22px;
  color: var(--vp-c-text-2);
  font-size: 19px;
  font-weight: 560;
  letter-spacing: 0.02em;
}

.hero-actions {
  display: flex;
  gap: 14px;
  margin-top: 26px;
}

.hero-actions a {
  display: inline-flex;
  min-height: 48px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 26px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.hero-actions a:hover {
  transform: translateY(-2px);
}

.hero-primary {
  border: 1px solid transparent;
  background: linear-gradient(110deg, #2e61f1, #7842f6);
  color: #fff !important;
  box-shadow: 0 12px 30px rgba(83, 74, 241, 0.24);
}

.hero-primary svg {
  width: 18px;
}

.hero-secondary {
  min-width: 120px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 22%, var(--vp-c-divider));
  background: color-mix(in srgb, var(--vp-c-bg) 62%, transparent);
  color: var(--vp-c-text-1) !important;
}

.hero-secondary:hover {
  border-color: var(--vp-c-brand-1);
}

.hero-visual {
  position: relative;
  display: grid;
  min-height: 340px;
  place-items: center;
}

.hero-berry {
  position: relative;
  z-index: 2;
  width: min(520px, 50%);
  margin: 0;
  filter: drop-shadow(0 24px 32px rgba(52, 75, 185, 0.26));
  transform: rotate(-3deg);
}

.home-overview {
  margin-top: 3rem;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 335px;
  gap: 18px;
  align-items: start;
}

.home-main-column,
.home-side-column {
  display: grid;
  gap: 18px;
  min-width: 0;
}

.home-panel {
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 10%, var(--vp-c-divider));
  background: var(--home-panel);
  box-shadow: var(--home-shadow);
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.feature-card {
  position: relative;
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  align-items: center;
  gap: 15px;
  min-height: 112px;
  padding: 18px;
  overflow: hidden;
  border-radius: 18px;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
}

.feature-card::after {
  position: absolute;
  right: 22px;
  bottom: 0;
  width: 34px;
  height: 3px;
  border-radius: 99px 99px 0 0;
  background: currentColor;
  content: '';
  opacity: 0.72;
}

.feature-card:hover {
  border-color: color-mix(in srgb, currentColor 38%, var(--vp-c-divider));
  box-shadow: 0 20px 40px color-mix(in srgb, currentColor 13%, transparent);
  transform: translateY(-3px);
}

.feature-icon {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 16px;
  color: #fff;
  box-shadow: 0 12px 24px color-mix(in srgb, currentColor 25%, transparent);
}

.feature-icon svg {
  width: 28px;
}

.feature-copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.feature-copy strong {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--vp-c-text-1);
  font-size: 17px;
}

.feature-copy strong svg {
  width: 16px;
  color: currentColor;
}

.feature-copy small {
  color: var(--vp-c-text-3);
  font-size: 12px;
  line-height: 1.55;
}

.feature-brand { color: #536df6; }
.feature-brand .feature-icon { background: linear-gradient(135deg, #4266ff, #7044f7); }
.feature-mint { color: #3fcba2; }
.feature-mint .feature-icon { background: linear-gradient(135deg, #3ed8aa, #29b987); }
.feature-rose { color: #ff7598; }
.feature-rose .feature-icon { background: linear-gradient(135deg, #ff879d, #ff668d); }

.stats-bar {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  min-height: 86px;
  margin: 0;
  padding: 13px 8px;
  border-radius: 18px;
}

.stats-bar > div {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.stats-bar > div + div {
  border-left: 1px solid var(--vp-c-divider);
}

.stats-bar dt {
  color: var(--vp-c-text-1);
  font-size: 20px;
  font-weight: 800;
  line-height: 1.05;
}

.stats-bar dd {
  margin: 4px 0 0;
  color: var(--vp-c-text-3);
  font-size: 11px;
}

.stat-icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 50%;
}

.stat-icon svg { width: 19px; }
.stat-brand { background: rgba(79, 104, 255, 0.11); color: #4f68ff; }
.stat-mint { background: rgba(52, 206, 155, 0.12); color: #26bd8b; }
.stat-amber { background: rgba(255, 176, 45, 0.13); color: #f4a719; }
.stat-violet { background: rgba(126, 82, 245, 0.12); color: #7958ee; }

.featured-section,
.tags-panel,
.tools-panel {
  border-radius: 20px;
}

.featured-section {
  padding: 18px;
}

.section-heading,
.side-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.section-heading {
  margin-bottom: 16px;
}

.section-heading h2,
.side-heading h2 {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--vp-c-text-1);
  font-size: 15px;
  font-weight: 800;
}

.heading-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6fb5ff, #7957f3);
  box-shadow: 0 0 0 5px rgba(88, 115, 243, 0.08);
}

.featured-tabs {
  display: flex;
  gap: 4px;
}

.featured-tabs button {
  padding: 5px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--vp-c-text-3);
  font-size: 11px;
  cursor: pointer;
}

.featured-tabs button:hover,
.featured-tabs button.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.featured-tabs button.active {
  font-weight: 700;
}

.featured-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.featured-card {
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 15px;
  background: var(--home-panel-strong);
  transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

.featured-card:hover {
  box-shadow: 0 16px 30px rgba(40, 64, 142, 0.11);
}

.featured-cover {
  display: block;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
}

.featured-cover img {
  width: 100%;
  height: 100%;
  margin: 0;
  object-fit: cover;
  transition: transform 0.35s ease;
}

.featured-card:hover .featured-cover img {
  transform: scale(1.045);
}

.featured-body {
  display: grid;
  gap: 9px;
  padding: 14px;
}

.featured-body a {
  color: inherit;
  text-decoration: none;
}

.featured-body h3 {
  display: -webkit-box;
  overflow: hidden;
  color: var(--vp-c-text-1);
  font-size: 14px;
  font-weight: 750;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.featured-body p {
  display: -webkit-box;
  min-height: 38px;
  overflow: hidden;
  color: var(--vp-c-text-3);
  font-size: 11px;
  line-height: 1.65;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.featured-tags {
  display: flex;
  min-height: 24px;
  flex-wrap: wrap;
  gap: 5px;
}

.featured-tags button {
  padding: 4px 7px;
  border: 0;
  border-radius: 999px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-size: 9px;
  cursor: pointer;
}

.featured-body footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 2px;
  color: var(--vp-c-text-3);
  font-size: 10px;
}

.bookmark-button {
  display: grid;
  width: 28px;
  height: 28px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--vp-c-text-3);
  cursor: pointer;
}

.bookmark-button:hover,
.bookmark-button.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.bookmark-button svg { width: 16px; }

.tags-panel,
.learning-panel,
.tools-panel {
  padding: 18px;
}

.side-heading {
  margin-bottom: 15px;
}

.side-heading h2 svg {
  width: 17px;
  color: var(--vp-c-brand-1);
}

.side-heading > a,
.side-heading > span {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--vp-c-text-3);
  font-size: 10px;
  text-decoration: none;
}

.side-heading > a:hover {
  color: var(--vp-c-brand-1);
}

.side-heading > a svg {
  width: 14px;
}

.popular-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.popular-tags button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 10px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 9%, var(--vp-c-divider));
  border-radius: 999px;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 84%, transparent);
  color: var(--vp-c-text-2);
  font-size: 10px;
  cursor: pointer;
  transition: color 0.18s ease, border-color 0.18s ease, background-color 0.18s ease;
}

.popular-tags button:hover {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 35%, var(--vp-c-divider));
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.popular-tags button span {
  color: var(--vp-c-text-3);
  font-variant-numeric: tabular-nums;
}

.learning-card {
  padding: 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 13px;
  background: var(--home-panel-strong);
}

.learning-card strong {
  color: var(--vp-c-text-1);
  font-size: 12px;
}

.learning-progress {
  height: 4px;
  margin: 12px 0 8px;
  overflow: hidden;
  border-radius: 99px;
  background: var(--vp-c-bg-soft);
}

.learning-progress span {
  display: block;
  width: 78%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #4267f4, #8a4cf3);
}

.learning-card footer {
  display: flex;
  justify-content: space-between;
  color: var(--vp-c-text-3);
  font-size: 9px;
}

.learning-card footer b {
  color: var(--vp-c-text-2);
}

.tool-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 7px;
}

.tool-item {
  display: grid;
  justify-items: center;
  gap: 7px;
  min-width: 0;
  padding: 8px 2px;
  color: var(--vp-c-text-3);
  font-size: 9px;
}

.tool-item svg {
  width: 24px;
  color: var(--vp-c-text-1);
}

.tool-item:nth-child(1) svg { color: #3188e8; }
.tool-item:nth-child(2) svg { color: #42b883; }
.tool-item:nth-child(3) svg { color: #5fa04e; }
.tool-item:nth-child(4) svg { color: #f24e1e; }
.tool-item:nth-child(5) svg { color: var(--vp-c-text-1); }

.home-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 26px 8px 4px;
  color: var(--vp-c-text-3);
  font-size: 11px;
}

.home-footer a,
.footer-brand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.home-footer a {
  color: var(--vp-c-text-3);
  text-decoration: none;
}

.home-footer a:hover {
  color: var(--vp-c-brand-1);
}

.home-footer svg {
  width: 16px;
}

.footer-brand {
  color: var(--vp-c-text-1);
  font-weight: 750;
}

.footer-brand img {
  width: 22px;
  height: 22px;
  margin: 0;
}

.home-dashboard button:focus-visible,
.home-dashboard a:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 3px;
}

@media (max-width: 1100px) {
  .home-dashboard {
    width: min(100% - 40px, 1240px);
    margin-inline: auto;
  }

  .home-hero {
    grid-template-columns: minmax(0, 1fr) minmax(360px, 0.85fr);
  }

  .home-overview {
    grid-template-columns: minmax(0, 1fr) 270px;
  }

  .feature-card {
    grid-template-columns: 44px minmax(0, 1fr);
    gap: 11px;
    padding: 15px;
  }

  .feature-icon {
    width: 44px;
    height: 44px;
    border-radius: 13px;
  }

  .feature-icon svg { width: 23px; }
}

@media (max-width: 900px) {
  .home-dashboard {
    width: min(100% - 28px, 760px);
    padding-top: 24px;
  }

  .home-hero {
    min-height: 0;
    grid-template-columns: 1fr;
    gap: 12px;
    padding-top: 28px;
  }

  .hero-copy {
    padding-left: 0;
    text-align: center;
  }

  .hero-copy h1,
  .hero-name {
    margin-inline: auto;
  }

  .hero-actions {
    justify-content: center;
  }

  .hero-visual {
    min-height: 300px;
  }

  .hero-berry {
    width: 260px;
  }

  .hero-note { right: 9%; bottom: 48px; }

  .home-overview {
    grid-template-columns: 1fr;
  }

  .home-side-column {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .tags-panel {
    grid-row: span 2;
  }
}

@media (max-width: 680px) {
  .home-dashboard {
    width: min(100% - 20px, 520px);
    padding-top: 10px;
  }

  .home-hero {
    padding-top: 20px;
  }

  .hero-greeting {
    margin-bottom: 13px;
  }

  .hero-copy h1 {
    font-size: clamp(37px, 11vw, 52px);
  }

  .hero-copy > p {
    margin-top: 17px;
    font-size: 15px;
  }

  .hero-actions {
    gap: 9px;
    margin-top: 21px;
  }

  .hero-actions a {
    min-height: 44px;
    padding: 0 19px;
    font-size: 13px;
  }

  .hero-secondary { min-width: 102px; }

  .hero-visual {
    min-height: 250px;
  }

  .hero-berry { width: 210px; }
  .hero-note { right: 2%; bottom: 32px; width: 118px; padding: 13px; }

  .feature-grid,
  .featured-grid,
  .home-side-column {
    grid-template-columns: 1fr;
  }

  .feature-card {
    min-height: 96px;
  }

  .stats-bar {
    grid-template-columns: repeat(2, 1fr);
    gap: 0;
  }

  .stats-bar > div {
    min-height: 62px;
  }

  .stats-bar > div:nth-child(3) {
    border-left: 0;
    border-top: 1px solid var(--vp-c-divider);
  }

  .stats-bar > div:nth-child(4) {
    border-top: 1px solid var(--vp-c-divider);
  }

  .tags-panel { grid-row: auto; }

  .featured-cover { aspect-ratio: 16 / 8.5; }

  .home-footer {
    flex-direction: column;
    gap: 7px;
    text-align: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-dashboard *,
  .home-dashboard *::before,
  .home-dashboard *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
