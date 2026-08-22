<template>
  <div class="trending-page">
    <header class="page-hero">
      <div class="hero-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 .8a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.2c-3.23.7-3.91-1.37-3.91-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.78 1.2 1.78 1.2 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.74-1.55-2.58-.3-5.29-1.29-5.29-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.4-2.72 5.38-5.3 5.67.42.36.79 1.07.79 2.16v3.21c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .8Z"/></svg>
      </div>
      <span class="eyebrow">OPEN SOURCE RADAR</span>
      <h1>Github 热榜</h1>
      <p>聚合近期新建且 Star 增长亮眼的仓库，发现正在发生的开源趋势。</p>
    </header>

    <div class="trending-controls">
      <div class="period-tabs" aria-label="时间范围">
        <button v-for="option in periods" :key="option.value" :class="{ active: period === option.value }" type="button" @click="period = option.value">
          {{ option.label }}
        </button>
      </div>
      <label class="language-select">
        <span>语言</span>
        <select v-model="language" aria-label="编程语言">
          <option value="">全部语言</option>
          <option v-for="item in languages" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <button class="refresh-button" type="button" :disabled="loading || loadingMore" aria-label="刷新榜单" @click="resetAndLoad">
        <svg :class="{ spinning: loading || loadingMore }" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"/></svg>
        刷新
      </button>
    </div>

    <div v-if="loading && !repositories.length" class="repo-list" aria-busy="true">
      <div v-for="index in 8" :key="index" class="repo-card skeleton"><i/><div><b/><span/><span/></div></div>
    </div>

    <div v-else-if="error" class="error-state" role="alert">
      <span>!</span>
      <div><strong>榜单暂时加载失败</strong><p>{{ error }}</p></div>
      <button type="button" @click="resetAndLoad">重新加载</button>
    </div>

    <template v-else>
      <ol v-if="repositories.length" class="repo-list">
        <li v-for="(repo, index) in repositories" :key="repo.id" class="repo-card">
          <span class="rank" :class="`rank-${index + 1}`">{{ String(index + 1).padStart(2, '0') }}</span>
          <div class="repo-main">
            <div class="repo-title-row">
              <img :src="repo.owner.avatar_url" :alt="`${repo.owner.login} 头像`" width="28" height="28">
              <a :href="repo.html_url" target="_blank" rel="noopener noreferrer">{{ repo.full_name }}</a>
              <span v-if="repo.language" class="language"><i :style="{ background: languageColor(repo.language) }"/>{{ repo.language }}</span>
            </div>
            <p>{{ repo.description || '这个仓库暂时没有简介。' }}</p>
            <div class="repo-meta">
              <span title="Stars"><svg viewBox="0 0 24 24"><path d="m12 2.7 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.3l6.2-.9Z"/></svg>{{ compactNumber(repo.stargazers_count) }}</span>
              <span title="Forks"><svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v2c0 2 1 3 3 3h6c2 0 3-1 3-3V7M12 12v5"/></svg>{{ compactNumber(repo.forks_count) }}</span>
              <span>创建于 {{ formatDate(repo.created_at) }}</span>
            </div>
          </div>
          <a class="repo-link" :href="repo.html_url" target="_blank" rel="noopener noreferrer" :aria-label="`查看 ${repo.full_name}`">
            <svg viewBox="0 0 24 24"><path d="M7 17 17 7M8 7h9v9"/></svg>
          </a>
        </li>
      </ol>

      <div v-else class="empty-state">
        <strong>当前筛选条件下暂无项目</strong>
        <p>换一个时间范围或编程语言试试。</p>
      </div>

      <div v-if="loadingMore" class="repo-list load-more-skeleton" aria-label="正在加载更多项目" aria-busy="true">
        <div v-for="index in 3" :key="index" class="repo-card skeleton"><i/><div><b/><span/><span/></div></div>
      </div>

      <div v-if="loadMoreError" class="load-more-error" role="alert">
        <span>{{ loadMoreError }}</span>
        <button type="button" @click="loadMore">重试</button>
      </div>
      <p v-else-if="repositories.length && !hasMore" class="end-message">— 已经到底了 —</p>

      <div v-show="hasMore && !loadMoreError" ref="loadMoreSentinel" class="load-more-sentinel" aria-hidden="true" />
    </template>

    <p class="data-note">榜单按所选时间段内新建仓库的 Star 总数排序，数据来自 GitHub REST API，可能受公共接口限流影响。</p>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

type Period = 'daily' | 'weekly' | 'monthly'
interface Repository {
  id: number
  full_name: string
  html_url: string
  description: string | null
  language: string | null
  stargazers_count: number
  forks_count: number
  created_at: string
  owner: { login: string; avatar_url: string }
}
interface SearchResponse { total_count?: number; items?: Repository[]; message?: string }

const periods: { label: string; value: Period }[] = [
  { label: '今日', value: 'daily' },
  { label: '本周', value: 'weekly' },
  { label: '本月', value: 'monthly' },
]
const languages = ['JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'C++', 'C#', 'Swift', 'Kotlin', 'PHP']
const colorMap: Record<string, string> = { JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572a5', Java: '#b07219', Go: '#00add8', Rust: '#dea584', 'C++': '#f34b7d', 'C#': '#178600', Swift: '#f05138', Kotlin: '#a97bff', PHP: '#4f5d95' }

const period = ref<Period>('weekly')
const language = ref('')
const repositories = ref<Repository[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const loadMoreError = ref('')
const hasMore = ref(true)
const currentPage = ref(0)
const loadMoreSentinel = ref<HTMLElement | null>(null)
const pageSize = 15
let requestController: AbortController | undefined
let loadMoreObserver: IntersectionObserver | undefined

function sinceDate(value: Period): string {
  const date = new Date()
  const days = value === 'daily' ? 1 : value === 'weekly' ? 7 : 30
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

async function loadRepositories(targetPage: number, append: boolean) {
  if (append && (loading.value || loadingMore.value || !hasMore.value)) return

  if (!append) requestController?.abort()
  const controller = new AbortController()
  requestController = controller
  if (append) loadingMore.value = true
  else loading.value = true
  if (append) loadMoreError.value = ''
  else error.value = ''
  const qualifiers = [`created:>=${sinceDate(period.value)}`, 'stars:>0']
  if (language.value) qualifiers.push(`language:${language.value}`)
  const params = new URLSearchParams({ q: qualifiers.join(' '), sort: 'stars', order: 'desc', per_page: String(pageSize), page: String(targetPage) })

  try {
    const response = await fetch(`https://api.github.com/search/repositories?${params}`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
    const data = await response.json() as SearchResponse
    if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'GitHub 公共接口请求次数已达上限，请稍后再试。' : data.message || `GitHub API 返回 ${response.status}`)
    const incoming = data.items ?? []
    if (append) {
      const existingIds = new Set(repositories.value.map(repo => repo.id))
      repositories.value.push(...incoming.filter(repo => !existingIds.has(repo.id)))
    } else {
      repositories.value = incoming
    }
    currentPage.value = targetPage
    const searchableTotal = Math.min(data.total_count ?? 0, 1000)
    hasMore.value = incoming.length === pageSize && targetPage * pageSize < searchableTotal
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') return
    const message = caught instanceof Error ? caught.message : '网络连接异常，请稍后再试。'
    if (append) loadMoreError.value = message
    else {
      repositories.value = []
      error.value = message
    }
  } finally {
    if (requestController === controller) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function resetAndLoad() {
  requestController?.abort()
  repositories.value = []
  currentPage.value = 0
  hasMore.value = true
  error.value = ''
  loadMoreError.value = ''
  void loadRepositories(1, false)
}

function loadMore() {
  void loadRepositories(currentPage.value + 1, true)
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}
function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value))
}
function languageColor(value: string): string { return colorMap[value] || '#8b949e' }

watch([period, language], resetAndLoad)
watch(loadMoreSentinel, (sentinel, previousSentinel) => {
  if (previousSentinel) loadMoreObserver?.unobserve(previousSentinel)
  if (sentinel) loadMoreObserver?.observe(sentinel)
})
onMounted(() => {
  loadMoreObserver = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) loadMore()
  }, { rootMargin: '320px 0px' })
  resetAndLoad()
})
onBeforeUnmount(() => {
  requestController?.abort()
  loadMoreObserver?.disconnect()
})
</script>

<style scoped>
.trending-page { margin: 1rem auto; }
.page-hero { position: relative; overflow: hidden; padding: 36px 28px 38px; text-align: center; border: 1px solid var(--vp-c-divider); border-radius: 24px; background: radial-gradient(circle at 50% -20%, rgba(36,69,235,.23), transparent 48%), var(--vp-c-bg-soft); }
.hero-mark { display: grid; width: 54px; height: 54px; margin: 0 auto 14px; place-items: center; border-radius: 17px; color: white; background: #111827; box-shadow: 0 12px 28px rgba(17,24,39,.2); }
.hero-mark svg { width: 32px; fill: currentColor; }
.eyebrow { color: var(--vp-c-brand-1); font-size: 11px; font-weight: 800; letter-spacing: .2em; }
.page-hero h1 { margin: 8px 0 8px; border: 0; font-size: clamp(30px, 5vw, 44px); line-height: 1.2; background: linear-gradient(120deg, #2445eb 25%, #7794ff); background-clip: text; -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.page-hero p { margin: 0; color: var(--vp-c-text-2); line-height: 1.7; }
.trending-controls { display: flex; align-items: center; gap: 12px; margin: 22px 0 14px; padding: 10px; border: 1px solid var(--vp-c-divider); border-radius: 15px; background: var(--vp-c-bg-soft); }
.period-tabs { display: flex; gap: 4px; padding: 3px; border-radius: 10px; background: var(--vp-c-bg); }
.period-tabs button { padding: 7px 14px; border: 0; border-radius: 8px; color: var(--vp-c-text-2); background: transparent; cursor: pointer; font: 600 13px/1 inherit; }
.period-tabs button.active { color: white; background: var(--vp-c-brand-1); box-shadow: 0 4px 10px rgba(36,69,235,.22); }
.language-select { display: flex; align-items: center; gap: 8px; margin-left: auto; color: var(--vp-c-text-3); font-size: 12px; }
.language-select select { padding: 7px 28px 7px 10px; border: 1px solid var(--vp-c-divider); border-radius: 8px; outline: 0; color: var(--vp-c-text-1); background: var(--vp-c-bg); font: inherit; }
.refresh-button { display: flex; align-items: center; gap: 6px; padding: 8px 11px; border: 1px solid var(--vp-c-divider); border-radius: 8px; color: var(--vp-c-text-2); background: var(--vp-c-bg); cursor: pointer; }
.refresh-button:disabled { cursor: wait; opacity: .6; }
.refresh-button svg { width: 15px; fill: none; stroke: currentColor; stroke-width: 2; }
.spinning { animation: spin .8s linear infinite; }
.repo-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.repo-card { display: flex; align-items: center; gap: 16px; min-width: 0; padding: 18px 20px; border: 1px solid var(--vp-c-divider); border-radius: 15px; background: var(--vp-c-bg); transition: transform .2s, border-color .2s, box-shadow .2s; }
.repo-card:hover { border-color: rgba(36,69,235,.36); box-shadow: 0 10px 25px rgba(15,23,42,.07); transform: translateY(-2px); }
.rank { flex: 0 0 34px; color: var(--vp-c-text-3); font: 800 14px/1 monospace; text-align: center; }
.rank-1 { color: #f59e0b; font-size: 18px; }.rank-2 { color: #94a3b8; font-size: 17px; }.rank-3 { color: #b7791f; font-size: 16px; }
.repo-main { min-width: 0; flex: 1; }
.repo-title-row { display: flex; align-items: center; gap: 9px; }
.repo-title-row img { border-radius: 50%; background: var(--vp-c-bg-soft); }
.repo-title-row a { overflow: hidden; color: var(--vp-c-text-1); font-size: 15px; font-weight: 700; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.repo-title-row a:hover { color: var(--vp-c-brand-1); }
.language { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; color: var(--vp-c-text-2); font-size: 11px; white-space: nowrap; }
.language i { width: 9px; height: 9px; border-radius: 50%; }
.repo-main > p { margin: 8px 0 9px; overflow: hidden; color: var(--vp-c-text-2); font-size: 13px; line-height: 1.55; text-overflow: ellipsis; white-space: nowrap; }
.repo-meta { display: flex; flex-wrap: wrap; gap: 15px; color: var(--vp-c-text-3); font-size: 11px; }
.repo-meta span { display: inline-flex; align-items: center; gap: 4px; }
.repo-meta svg { width: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; }
.repo-link { display: grid; flex: 0 0 34px; height: 34px; place-items: center; border-radius: 10px; color: var(--vp-c-text-3); background: var(--vp-c-bg-soft); }
.repo-link:hover { color: white; background: var(--vp-c-brand-1); }
.repo-link svg { width: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; }
.skeleton { min-height: 112px; pointer-events: none; }
.skeleton i { width: 34px; height: 18px; }.skeleton div { display: grid; flex: 1; gap: 10px; }.skeleton b { width: 36%; height: 16px; }.skeleton span { width: 82%; height: 11px; }.skeleton span:last-child { width: 48%; }
.skeleton i,.skeleton b,.skeleton span { display: block; border-radius: 5px; background: linear-gradient(90deg,var(--vp-c-bg-soft),var(--vp-c-divider),var(--vp-c-bg-soft)); background-size: 200% 100%; animation: shine 1.3s infinite; }
.load-more-skeleton { margin-top: 10px; }
.load-more-sentinel { height: 1px; }
.load-more-error { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 14px; color: var(--vp-c-text-2); font-size: 12px; }
.load-more-error button { padding: 5px 10px; border: 1px solid var(--vp-c-divider); border-radius: 7px; color: var(--vp-c-brand-1); background: var(--vp-c-bg); cursor: pointer; }
.end-message { margin: 18px 0 0; color: var(--vp-c-text-3); font-size: 11px; text-align: center; }
.empty-state { padding: 64px 20px; border: 1px dashed var(--vp-c-divider); border-radius: 15px; color: var(--vp-c-text-2); text-align: center; }
.empty-state p { margin: 6px 0 0; color: var(--vp-c-text-3); font-size: 13px; }
.error-state { display: flex; align-items: center; gap: 14px; min-height: 130px; padding: 22px; border: 1px solid color-mix(in srgb, var(--vp-c-danger-1) 30%, transparent); border-radius: 15px; background: var(--vp-c-danger-soft); }
.error-state > span { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 50%; color: white; background: var(--vp-c-danger-1); font-weight: 800; }.error-state div { flex: 1; }.error-state p { margin: 4px 0 0; color: var(--vp-c-text-2); font-size: 13px; }.error-state button { padding: 8px 12px; border: 0; border-radius: 8px; color: white; background: var(--vp-c-danger-1); cursor: pointer; }
.data-note { margin: 14px 2px 0; color: var(--vp-c-text-3); font-size: 11px; line-height: 1.6; text-align: center; }
@keyframes spin { to { transform: rotate(360deg); } } @keyframes shine { to { background-position: -200% 0; } }
@media (max-width: 700px) { .page-hero { padding: 30px 18px; } .trending-controls { align-items: stretch; flex-wrap: wrap; } .period-tabs { flex: 1; }.period-tabs button { flex: 1; }.language-select { order: 3; width: 100%; margin: 0; }.language-select select { flex: 1; }.repo-card { align-items: flex-start; gap: 10px; padding: 15px 12px; }.rank { flex-basis: 25px; padding-top: 7px; }.repo-title-row { flex-wrap: wrap; }.language { width: 100%; margin-left: 37px; }.repo-main > p { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }.repo-link { display: none; } }
</style>
