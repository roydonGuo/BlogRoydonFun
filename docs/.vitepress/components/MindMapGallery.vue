<template>
  <div
      class="fixed inset-x-0 bottom-0 top-[var(--vp-nav-height)] z-20 grid grid-cols-[340px_1fr] overflow-hidden border-y border-divider text-text-1 max-[760px]:block max-[760px]:overflow-y-auto">
    <aside
        class="relative h-full overflow-hidden border-r border-black/10 px-10 py-8 dark:border-white/10 max-[760px]:h-auto max-[760px]:border-b max-[760px]:border-r-0 max-[760px]:px-[22px]">
      <div
          class="pointer-events-none absolute -left-20 top-8 size-52 rounded-full bg-blue-200/80 blur-3xl dark:bg-blue-500/20"
          aria-hidden="true"></div>
      <div class="relative z-10">
        <p class="!mb-4 !mt-0 flex items-center gap-2 text-[10px] !font-black tracking-[.24em]">
          <span class="size-2 rounded-full bg-brand shadow-[0_0_0_5px_var(--vp-c-brand-soft)]"></span>
          KNOWLEDGE SIGNAL · {{ currentYear }}
        </p>
        <h1 class="mind-map-title-glow !m-0 !border-0 !text-[45px] !font-black !leading-[.99] !tracking-[-.06em]">
          我的<br>思维星图<span class="text-brand">。</span>
        </h1>
        <p class="mb-0 mt-5 max-w-[238px] text-xs font-medium leading-5 text-text-2 opacity-60">
          把复杂知识折叠成可以漫游的路径。每一张图，都是一个仍在生长的认知坐标。
        </p>

        <div class="mt-7 grid grid-cols-3 gap-4" aria-label="思维导图统计">
          <div><strong class="block text-2xl !font-black">{{ mindMaps.length }}</strong><span
              class="text-[9px] font-bold opacity-45">导图</span></div>
          <div><strong class="block text-2xl !font-black">{{ totalNodes }}</strong><span
              class="text-[9px] font-bold opacity-45">节点</span></div>
          <div><strong class="block text-2xl !font-black">{{ categoryCount }}</strong><span
              class="text-[9px] font-bold opacity-45">领域</span></div>
        </div>

        <label
            class="mt-7 flex h-10 items-center gap-2 rounded-full border border-divider bg-bg px-4 shadow-sm focus-within:ring-2 focus-within:ring-brand">
          <RiSearchLine size="16" aria-hidden="true"/>
          <input v-model.trim="keyword" class="w-full border-0 bg-transparent p-0 text-[11px] font-bold outline-none"
                 type="search" placeholder="搜索名称、摘要、标签或作者" aria-label="搜索思维导图">
        </label>

        <div class="mt-7 border-t border-divider pt-5">
          <p class="!mb-3 !mt-0 text-[10px] !font-black tracking-[.18em] opacity-40">EXPLORE BY ORBIT</p>
          <div class="flex flex-wrap gap-2" role="group" aria-label="思维导图分类筛选">
            <button v-for="item in filters" :key="item.value" type="button"
                    class="cursor-pointer rounded-full border border-divider bg-bg px-[14px] py-[5px] text-[12px] font-bold transition hover:-translate-y-0.5 hover:border-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    :class="activeFilter === item.value ? '!border-text-1 !bg-text-1 !text-bg' : ''"
                    :aria-pressed="activeFilter === item.value" @click="activeFilter = item.value">
              {{ item.label }} {{ countByFilter(item.value) }}
            </button>
          </div>
        </div>
      </div>
    </aside>

    <section
        class="h-full min-w-0 overflow-y-auto bg-bg-soft/50 px-[clamp(22px,3vw,52px)] pb-16 pt-4 [overflow-anchor:none] max-[760px]:h-auto max-[760px]:overflow-visible max-[760px]:px-4 max-[760px]:pb-12 max-[760px]:pt-7"
        aria-label="思维导图瀑布流">
      <header class="mb-2 flex items-end justify-between gap-4">
        <div>
          <p class="m-0 text-[10px] !font-black tracking-[.2em] text-text-3">YOUR THINKING, VISUALIZED</p>
        </div>
        <span class="shrink-0 text-[10px] font-black text-text-3">按更新时间排序</span>
      </header>

      <div v-if="filteredMindMaps.length" ref="masonryGrid" class="relative">
        <div
            class="mind-map-masonry-sizer w-[calc((100%-48px)/4)] max-[1400px]:w-[calc((100%-32px)/3)] max-[1100px]:w-[calc((100%-16px)/2)] max-[760px]:w-full"
            aria-hidden="true"></div>
        <button v-for="(mindMap, index) in visibleMindMaps" :key="mindMap.id" type="button"
                class="mind-map-masonry-item mind-map-card group relative mb-4 block w-[calc((100%-48px)/4)] cursor-pointer overflow-hidden rounded-[20px] bg-[#080b16] p-0 text-left text-white max-[1400px]:w-[calc((100%-32px)/3)] max-[1100px]:w-[calc((100%-16px)/2)] max-[760px]:w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                :style="{ aspectRatio: `${mindMap.coverWidth} / ${mindMap.coverHeight}` }"
                :aria-label="`打开思维导图：${mindMap.name}`" @click="openMindMap(mindMap)">
          <img
              class="absolute inset-0 !m-0 h-full w-full object-contain transition duration-[600ms] ease-[cubic-bezier(.2,.8,.2,1)] group-hover:scale-[1.02]"
              :src="mindMap.cover" alt="" aria-hidden="true" loading="lazy">
          <div class="absolute inset-0 bg-gradient-to-b from-black/1 via-transparent to-black/25"
               aria-hidden="true"></div>
          <div
              class="absolute inset-x-0 bottom-0 h-[50%] bg-gradient-to-t from-[#050711]/95 via-[#050711]/45 to-transparent"
              aria-hidden="true"></div>

          <span
              class="absolute left-4 top-4 rounded-full border border-white/25 bg-white/75 px-3 py-1 text-[9px] !font-black tracking-[.08em] text-[#080b16] shadow-sm backdrop-blur-[12px]">
            {{ mindMap.featured ? 'FEATURED' : mindMap.categoryLabel }} · {{ String(index + 1).padStart(2, '0') }}
          </span>
          <RiArrowRightUpLine size="34"
                              class="absolute right-4 top-4 translate-y-1 text-white opacity-0 drop-shadow-[0_2px_5px_rgba(0,0,0,.45)] transition duration-200 group-hover:translate-y-0 group-hover:opacity-100"
                              aria-hidden="true"/>

          <div class="absolute inset-x-0 bottom-0 z-10 p-4">
            <div class="flex items-center justify-between gap-3">
              <p class="!m-0 truncate text-[9px] !font-black tracking-[.15em] text-white/65">{{
                  mindMap.categoryLabel
                }}</p>
            </div>

            <h2 class="truncate !mb-0 !mt-1.5 !border-0 !py-0 !text-[18px] !font-black !leading-[1.2] !text-white tracking-[-.03em]">
              {{ mindMap.name }}
            </h2>

            <footer
                class="mt-2 flex items-center justify-between gap-3 border-t border-white/15 pt-2 text-[9px] font-bold text-white/60">
              <span class="truncate">{{ mindMap.nodes }} 节点 · {{ mindMap.branches }} 分支 · {{
                  mindMap.images
                }} 图片</span>
              <time :datetime="mindMap.updatedAt" :title="`创建于 ${formatDate(mindMap.createdAt)}`"
                    class="flex items-center gap-1">
                <RiTimeLine size="13" aria-hidden="true"/>
                {{ formatDate(mindMap.updatedAt) }}
              </time>
            </footer>
          </div>
        </button>
      </div>

      <div v-else
           class="flex min-h-[360px] flex-col items-center justify-center rounded-[24px] border border-dashed border-divider bg-bg text-center">
        <RiSearchLine size="34" class="text-text-3" aria-hidden="true"/>
        <h2 class="!mb-0 !mt-4 !border-0 !text-xl !font-black">没有找到匹配的思维导图</h2>
        <p class="mb-0 mt-2 text-xs text-text-3">换一个关键词，或选择其他分类试试。</p>
      </div>

      <div v-if="hasMore" ref="loadMoreTrigger" class="py-4 text-center text-[11px] font-bold text-text-3"
           aria-label="继续加载思维导图">继续向下滚动，加载更多思维导图
      </div>
    </section>

    <Teleport to="body">
      <Transition name="mind-map-modal">
        <div v-if="selected"
             class="mind-map-modal-backdrop fixed inset-0 z-[1000] flex items-center justify-center bg-[#040712]/75 p-4 backdrop-blur-[10px] max-[760px]:p-2"
             :class="{ 'is-fullscreen': isFullscreen }"
             role="dialog" aria-modal="true" aria-labelledby="mind-map-modal-title" @click.self="closeMindMap">
          <article
              class="mind-map-modal-card flex h-[min(92vh,980px)] w-[min(96vw,1680px)] flex-col overflow-hidden rounded-[28px] bg-bg text-text-1 shadow-[0_36px_100px_rgba(0,0,0,.38)] max-[760px]:h-[96vh] max-[760px]:w-[98vw] max-[760px]:rounded-2xl"
              :class="{ 'is-fullscreen': isFullscreen }">
            <header
                class="mind-map-modal-header grid min-h-[72px] grid-cols-[minmax(0,1fr)_minmax(260px,620px)_minmax(0,1fr)] items-center gap-4 border-b border-divider px-6 py-3 max-[980px]:grid-cols-[minmax(0,1fr)_auto] max-[760px]:gap-2 max-[760px]:px-3">
              <div class="min-w-0">
                <p class="!m-0 text-[9px] !font-black tracking-[.18em] text-text-3">{{ selected.categoryLabel }}</p>
                <h2 id="mind-map-modal-title"
                    class="!mb-0 !mt-1 truncate !border-0 !py-0 !text-[20px] !font-black tracking-[-.03em] max-[760px]:text-base">
                  {{ selected.name }}
                </h2>
              </div>

              <label
                  class="mind-map-modal-search flex h-10 min-w-0 items-center gap-2 rounded-full border border-divider bg-bg-soft px-4 shadow-sm focus-within:ring-2 focus-within:ring-brand max-[980px]:order-3 max-[980px]:col-span-2">
                <RiSearchLine size="16" class="shrink-0" aria-hidden="true"/>
                <input ref="viewerSearchInput" v-model="viewerSearch"
                       class="min-w-0 flex-1 border-0 bg-transparent p-0 text-[11px] font-bold outline-none"
                       type="search" placeholder="搜索 834 个主题…" autocomplete="off" aria-label="搜索导图主题"
                       @input="searchViewer">
                <kbd
                    class="rounded border border-divider bg-bg px-1.5 py-0.5 text-[9px] font-black text-text-3 max-[560px]:hidden">Ctrl
                  K</kbd>
              </label>

              <div class="flex shrink-0 items-center justify-end gap-2">
                <button type="button" title="适应画布" aria-label="使思维导图适应画布"
                        class="mind-map-viewer-action flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-divider bg-bg px-3 text-[11px] font-black text-text-1 transition hover:bg-text-1 hover:text-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        @click="fitViewer">
                  <span class="text-base leading-none" aria-hidden="true">⌖</span>
                  <span class="max-[560px]:hidden">适应画布</span>
                </button>
                <button type="button" :title="isFullscreen ? '退出全屏' : '全屏查看'"
                        :aria-label="isFullscreen ? '退出全屏' : '全屏查看思维导图'" :aria-pressed="isFullscreen"
                        class="mind-map-viewer-action mind-map-fullscreen-button flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-divider bg-bg px-3 text-[11px] font-black text-text-1 transition hover:bg-text-1 hover:text-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        :class="{ 'is-active': isFullscreen }" @click="toggleFullscreen">
                  <span class="mind-map-fullscreen-icon text-base leading-none" aria-hidden="true">⛶</span>
                  <span class="max-[560px]:hidden">{{ isFullscreen ? '还原' : '全屏' }}</span>
                </button>
                <button ref="closeButton" type="button" title="关闭" aria-label="关闭思维导图"
                        class="flex size-9 cursor-pointer items-center justify-center rounded-full border border-divider bg-bg p-0 text-text-1 transition hover:rotate-90 hover:bg-text-1 hover:text-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        @click="closeMindMap">
                  <RiCloseLine size="20" aria-hidden="true"/>
                </button>
              </div>
            </header>

            <div class="min-h-0 flex-1 bg-bg-soft">
              <iframe ref="viewerFrame" :key="selected.id" class="block h-full w-full border-0" :src="selected.viewer"
                      :title="`${selected.name} 完整内容`" @load="handleViewerLoad"></iframe>
            </div>

            <footer
                class="mind-map-modal-footer flex min-h-10 items-center justify-between gap-4 border-t border-divider px-6 text-[10px] font-bold text-text-3 max-[760px]:px-3">
              <span>{{ selected.nodes }} 个主题 · {{ selected.branches }} 个一级分支 · {{
                  selected.images
                }} 张内嵌图片</span>
              <span class="shrink-0">滚轮缩放 · 拖拽画布 · 点击节点展开</span>
            </footer>
          </article>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import type Masonry from 'masonry-layout'
import {RiArrowRightUpLine, RiCloseLine, RiSearchLine, RiTimeLine} from '@remixicon/vue'
import mindMapData from '../../mind-map/mind-maps.json'

interface MindMap {
  id: number;
  name: string;
  summary: string;
  category: string;
  categoryLabel: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  cover: string;
  coverAlt: string;
  coverWidth: number;
  coverHeight: number;
  viewer: string;
  nodes: number;
  branches: number;
  images: number;
  sheets: number;
  fileSize: string;
  tags: string[];
  featured?: boolean;
}

const mindMaps = mindMapData as MindMap[]
const filters = [
  {label: '全部', value: 'all'},
  ...Array.from(new Map(mindMaps.map(item => [item.category, item.categoryLabel])).entries())
      .map(([value, label]) => ({label, value})),
]

const PAGE_SIZE = 10
const currentYear = new Date().getFullYear()
const keyword = ref('')
const activeFilter = ref('all')
const visibleCount = ref(PAGE_SIZE)
const masonryGrid = ref<HTMLElement | null>(null)
const loadMoreTrigger = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const viewerFrame = ref<HTMLIFrameElement | null>(null)
const viewerSearchInput = ref<HTMLInputElement | null>(null)
const selected = ref<MindMap | null>(null)
const isFullscreen = ref(false)
const viewerSearch = ref('')
let masonry: Masonry | null = null
let loadMoreObserver: IntersectionObserver | null = null
let themeObserver: MutationObserver | null = null

const totalNodes = computed(() => mindMaps.reduce((sum, mindMap) => sum + mindMap.nodes, 0))
const categoryCount = computed(() => new Set(mindMaps.map(mindMap => mindMap.category)).size)
const filteredMindMaps = computed(() => {
  const query = keyword.value.toLocaleLowerCase('zh-CN')
  return mindMaps
      .filter(mindMap => activeFilter.value === 'all' || mindMap.category === activeFilter.value)
      .filter(mindMap => !query || [mindMap.name, mindMap.summary, mindMap.categoryLabel, mindMap.author, ...mindMap.tags]
          .join(' ').toLocaleLowerCase('zh-CN').includes(query))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id - b.id)
})
const visibleMindMaps = computed(() => filteredMindMaps.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < filteredMindMaps.value.length)
const latestUpdatedAt = computed(() => filteredMindMaps.value[0]?.updatedAt ?? mindMaps[0]?.updatedAt ?? '')
const countByFilter = (filter: string) => filter === 'all' ? mindMaps.length : mindMaps.filter(item => item.category === filter).length
const formatDate = (date: string) => date ? date.replaceAll('-', '.') : '暂无'

function openMindMap(mindMap: MindMap) {
  isFullscreen.value = false
  viewerSearch.value = ''
  selected.value = mindMap
  nextTick(() => closeButton.value?.focus())
}

function closeMindMap() {
  isFullscreen.value = false
  viewerSearch.value = ''
  selected.value = null
}

function postViewerCommand(type: 'fit' | 'search' | 'theme', value = '') {
  viewerFrame.value?.contentWindow?.postMessage({source: 'mind-map-gallery', type, value}, window.location.origin)
}

function fitViewer() {
  postViewerCommand('fit')
}

function searchViewer() {
  postViewerCommand('search', viewerSearch.value)
}

function handleViewerLoad() {
  syncViewerTheme()
  if (viewerSearch.value) searchViewer()
}

function syncViewerTheme() {
  postViewerCommand('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light')
}

function onViewerMessage(event: MessageEvent) {
  if (event.origin !== window.location.origin || event.source !== viewerFrame.value?.contentWindow) return
  if (event.data?.source === 'mind-map-viewer' && event.data?.type === 'focus-search') {
    viewerSearchInput.value?.focus()
  }
}

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
}

function onKeydown(event: KeyboardEvent) {
  if (selected.value && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    viewerSearchInput.value?.focus()
    return
  }
  if (event.key !== 'Escape' || !selected.value) return
  if (isFullscreen.value) {
    isFullscreen.value = false
    return
  }
  closeMindMap()
}

async function initializeMasonry() {
  if (!masonryGrid.value) return
  const [{default: MasonryLayout}, {default: imagesLoaded}] = await Promise.all([
    import('masonry-layout'),
    import('imagesloaded'),
  ])
  if (!masonryGrid.value) return
  masonry = new MasonryLayout(masonryGrid.value, {
    itemSelector: '.mind-map-masonry-item',
    columnWidth: '.mind-map-masonry-sizer',
    gutter: 16,
    horizontalOrder: true,
    percentPosition: true,
    transitionDuration: '0.25s',
  })
  imagesLoaded(masonryGrid.value).on('progress', () => masonry?.layout())
}

async function refreshMasonry() {
  await nextTick()
  if (!masonryGrid.value) {
    masonry?.destroy()
    masonry = null
    return
  }
  if (!masonry) {
    await initializeMasonry()
    return
  }
  masonry.reloadItems()
  masonry.layout()
  const {default: imagesLoaded} = await import('imagesloaded')
  imagesLoaded(masonryGrid.value).on('progress', () => masonry?.layout())
}

async function appendMindMaps(previousCount: number) {
  await nextTick()
  if (!masonryGrid.value || !masonry) return
  const newItems = Array.from(masonryGrid.value.querySelectorAll<HTMLElement>('.mind-map-masonry-item')).slice(previousCount)
  if (!newItems.length) return

  newItems.forEach((item, index) => {
    item.classList.add('is-mind-map-entering')
    item.style.setProperty('--mind-map-enter-delay', `${Math.min(index * 45, 270)}ms`)
    item.addEventListener('animationend', () => {
      item.classList.remove('is-mind-map-entering')
      item.style.removeProperty('--mind-map-enter-delay')
    }, {once: true})
  })

  masonry.appended(newItems)
  const {default: imagesLoaded} = await import('imagesloaded')
  imagesLoaded(newItems).on('progress', () => masonry?.layout())
}

watch([activeFilter, keyword], () => {
  visibleCount.value = PAGE_SIZE
  refreshMasonry()
})

watch(loadMoreTrigger, (trigger) => {
  loadMoreObserver?.disconnect()
  loadMoreObserver = null
  if (!trigger || typeof IntersectionObserver === 'undefined') return

  loadMoreObserver = new IntersectionObserver((entries) => {
    if (!entries[0]?.isIntersecting || !hasMore.value) return
    const previousCount = visibleMindMaps.value.length
    visibleCount.value = Math.min(visibleCount.value + PAGE_SIZE, filteredMindMaps.value.length)
    appendMindMaps(previousCount)
  }, {rootMargin: '0px 0px 160px'})
  loadMoreObserver.observe(trigger)
}, {flush: 'post'})

onMounted(() => {
  initializeMasonry()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('message', onViewerMessage)
  themeObserver = new MutationObserver(syncViewerTheme)
  themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['class']})
  document.documentElement.classList.add('h-full', 'overflow-hidden')
  document.body.classList.add('h-full', 'overflow-hidden', 'mind-map-page-active')
})

onBeforeUnmount(() => {
  loadMoreObserver?.disconnect()
  loadMoreObserver = null
  masonry?.destroy()
  masonry = null
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('message', onViewerMessage)
  themeObserver?.disconnect()
  themeObserver = null
  document.documentElement.classList.remove('h-full', 'overflow-hidden')
  document.body.classList.remove('h-full', 'overflow-hidden', 'mind-map-page-active')
})
</script>

<style>
body.mind-map-page-active .VPFooter {
  display: none;
}

.mind-map-title-glow {
  position: relative;
  isolation: isolate;
}

.mind-map-title-glow::after {
  position: absolute;
  z-index: -1;
  right: -12%;
  bottom: -200%;
  left: -10%;
  height: 300%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(47, 99, 255, .18), rgba(16, 151, 253, .1) 52%, transparent);
  filter: blur(18px);
  content: '';
  pointer-events: none;
}

.mind-map-card {
  box-shadow: 0 1px 3px rgba(0, 0, 0, .04);
  transition: box-shadow .25s ease, border-color .25s ease;
}

.mind-map-card:hover {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 40%, transparent);
  box-shadow: 0 8px 24px rgba(15, 23, 42, .12);
}

.mind-map-masonry-item.is-mind-map-entering {
  animation: mind-map-card-enter .52s cubic-bezier(.16, 1, .3, 1) var(--mind-map-enter-delay, 0ms) both;
  will-change: opacity, translate;
}

.mind-map-modal-enter-active,
.mind-map-modal-leave-active {
  transition: opacity .2s ease;
}

.mind-map-modal-enter-active .mind-map-modal-card,
.mind-map-modal-leave-active .mind-map-modal-card {
  transition: opacity .24s ease, transform .36s cubic-bezier(.16, 1, .3, 1);
}

.mind-map-modal-card {
  transition: width .46s cubic-bezier(.16, 1, .3, 1), height .46s cubic-bezier(.16, 1, .3, 1), border-radius .36s ease, box-shadow .36s ease;
  will-change: width, height, border-radius;
}

.mind-map-modal-header,
.mind-map-modal-footer {
  background: color-mix(in srgb, var(--vp-c-bg) 82%, transparent);
  backdrop-filter: blur(20px) saturate(1.4);
}

.mind-map-modal-search,
.mind-map-viewer-action {
  background: color-mix(in srgb, var(--vp-c-bg) 76%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 52%, transparent), 0 5px 18px rgba(15, 23, 42, .06);
  backdrop-filter: blur(16px) saturate(1.35);
}

.mind-map-modal-search:focus-within {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 48%, transparent);
  box-shadow: 0 0 0 3px var(--vp-c-brand-soft), 0 8px 24px rgba(36, 69, 235, .09);
}

.mind-map-modal-backdrop.is-fullscreen {
  padding: 0 !important;
}

.mind-map-modal-card.is-fullscreen {
  width: 100vw !important;
  height: 100vh !important;
  height: 100dvh !important;
  border-radius: 0 !important;
  box-shadow: none;
}

.mind-map-fullscreen-icon {
  display: inline-block;
  transition: transform .36s cubic-bezier(.16, 1, .3, 1);
}

.mind-map-fullscreen-button.is-active .mind-map-fullscreen-icon {
  transform: rotate(180deg) scale(.9);
}

.mind-map-modal-enter-from,
.mind-map-modal-leave-to,
.mind-map-modal-enter-from .mind-map-modal-card,
.mind-map-modal-leave-to .mind-map-modal-card {
  opacity: 0;
}

.mind-map-modal-enter-from .mind-map-modal-card,
.mind-map-modal-leave-to .mind-map-modal-card {
  transform: translate3d(0, 20px, 0) scale(.975);
}

@keyframes mind-map-card-enter {
  from {
    opacity: 0;
    translate: 0 52px;
  }
  to {
    opacity: 1;
    translate: 0 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mind-map-card, .mind-map-card * {
    transition-duration: .01ms !important;
  }

  .mind-map-masonry-item.is-mind-map-entering {
    animation-duration: .01ms;
    animation-delay: 0ms;
  }

  .mind-map-modal-enter-active,
  .mind-map-modal-leave-active,
  .mind-map-modal-enter-active .mind-map-modal-card,
  .mind-map-modal-leave-active .mind-map-modal-card {
    transition-duration: .01ms !important;
  }

  .mind-map-modal-card,
  .mind-map-fullscreen-icon {
    transition-duration: .01ms !important;
  }
}
</style>
