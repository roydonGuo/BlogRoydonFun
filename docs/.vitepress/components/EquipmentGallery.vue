<template>
  <div class="equipment-shell fixed inset-x-0 bottom-0 top-[var(--vp-nav-height)] z-20 grid grid-cols-[340px_1fr] overflow-hidden border-y border-divider text-text-1 max-[760px]:block max-[760px]:overflow-y-auto">
    <aside class="relative h-full overflow-hidden border-r border-black/10 px-10 py-8 dark:border-white/10 max-[760px]:h-auto max-[760px]:border-b max-[760px]:border-r-0 max-[760px]:px-[22px]">
      <div class="pointer-events-none absolute -left-20 top-8 size-52 rounded-full bg-blue-200/80 blur-3xl dark:bg-blue-500/20" aria-hidden="true"></div>
      <div class="relative z-10">
        <p class="!mb-4 !mt-0 flex items-center gap-2 text-[10px] !font-black tracking-[.24em]">
          <span class="size-2 rounded-full bg-brand shadow-[0_0_0_5px_var(--vp-c-brand-soft)]"></span>
          DAILY TOOLKIT · {{ currentYear }}
        </p>
        <h1 class="equipment-title-glow !m-0 !border-0 !text-[45px] !font-black !leading-[.99] !tracking-[-.06em]">
          我的生产力<br>装备清单<span class="text-brand">。</span>
        </h1>
        <p class="mb-0 mt-5 max-w-[238px] text-xs font-medium leading-5 text-text-2 opacity-60">
          记录真正参与日常工作的设备，以及它们在我的工作流中解决的问题。
        </p>
        <div class="mt-7 flex items-end gap-6" aria-label="装备统计">
          <div><strong class="block text-3xl !font-black">{{ equipment.length }}</strong><span class="text-[10px] font-bold opacity-45">在册装备</span></div>
          <div><strong class="block text-3xl !font-black">{{ categoryCount }}</strong><span class="text-[10px] font-bold opacity-45">设备分类</span></div>
        </div>
        <label class="mt-7 flex h-10 items-center gap-2 rounded-full border border-divider bg-bg px-4 shadow-sm focus-within:ring-2 focus-within:ring-brand">
          <RiSearchLine size="16" aria-hidden="true"/>
          <input v-model.trim="keyword" class="w-full border-0 bg-transparent p-0 text-[11px] font-bold outline-none" type="search" placeholder="搜索名称、SKU 或用途" aria-label="搜索生产力装备">
        </label>
        <div class="mt-7 border-t border-divider pt-5">
          <p class="!mb-3 !mt-0 text-[10px] !font-black tracking-[.18em] opacity-40">EXPLORE BY CATEGORY</p>
          <div class="flex flex-wrap gap-2" role="group" aria-label="装备分类筛选">
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

    <section class="h-full min-w-0 overflow-y-auto bg-bg-soft/50 px-[clamp(22px,3vw,52px)] pb-16 pt-4 [overflow-anchor:none] max-[760px]:h-auto max-[760px]:overflow-visible max-[760px]:px-4 max-[760px]:pb-12 max-[760px]:pt-7" aria-label="生产力装备瀑布流">
      <header class="mb-4 flex items-center justify-between gap-4">
        <p class="m-0 text-[10px] !font-black tracking-[.2em] text-text-3">TOOLS BEHIND THE WORK</p>
        <span class="text-[11px] font-extrabold text-text-3">已展示 {{ visibleEquipment.length }} / {{ filteredEquipment.length }}</span>
      </header>

      <div ref="masonryGrid" class="relative">
        <div class="equipment-masonry-sizer w-[calc((100%-48px)/4)] max-[1400px]:w-[calc((100%-32px)/3)] max-[1100px]:w-[calc((100%-16px)/2)] max-[760px]:w-full" aria-hidden="true"></div>
        <button v-for="(item, index) in visibleEquipment" :key="item.id" type="button"
                class="equipment-masonry-item equipment-card group relative mb-4 w-[calc((100%-48px)/4)] cursor-pointer overflow-hidden rounded-[20px] border-0 bg-[#080b16] p-0 text-left text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand max-[1400px]:w-[calc((100%-32px)/3)] max-[1100px]:w-[calc((100%-16px)/2)] max-[760px]:w-full"
                :aria-label="`查看 ${item.name} 装备详情`" @click="openEquipment(item)">
          <!-- 图片按自身宽高比撑开整张卡片，不设置固定高度或统一 aspect-ratio。 -->
          <LoadingImage
              class="equipment-cover-media w-full bg-[#080b16]"
              image-class="equipment-card-cover block !m-0 h-auto w-full"
              :src="item.cover"
              :alt="item.coverAlt"
          />
          <div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#070a12]/90 via-[#070a12]/30 via-45% to-transparent to-72%" aria-hidden="true"></div>
          <span class="equipment-card-badge">
            <span>{{ item.featured ? 'FEATURED' : item.categoryLabel }}</span>
          </span>
          <RiArrowRightUpLine
              size="34"
              class="absolute right-4 top-4 translate-y-1 text-white opacity-0 drop-shadow-[0_2px_5px_rgba(0,0,0,.45)] transition duration-200 group-hover:translate-y-0 group-hover:opacity-100"
              aria-hidden="true"
          />
          <div class="absolute inset-x-0 bottom-0 p-5 text-white">
            <p class="!m-0 text-[10px] !font-black tracking-[.14em] text-white/70">{{ item.categoryLabel }} · {{ item.status }}</p>
            <h2 class="!mb-0 !mt-2 !border-0 !py-0 !text-[23px] !font-black !leading-[1.12] tracking-[-.04em] text-white">{{ item.name }}</h2>
            <p class="!mb-0 !mt-2 text-[12px] font-medium leading-[1.55] text-white/85">{{ item.review }}</p>
<!--            <p class="!mb-0 !mt-2 text-[11px] font-bold leading-[1.5] text-white/75">{{ item.brand }} · {{ item.model }}</p>-->
            <footer class="mt-4 flex items-end justify-between gap-4 border-t border-white/20 pt-3">
              <p class="!m-0 min-w-0 break-words text-[10px] font-bold leading-[1.45] text-white/70">{{ item.sku }}</p>
              <span class="flex shrink-0 items-center gap-1.5 text-[10px] font-black text-white/75">
                <RiTimeLine size="14" aria-hidden="true"/>{{ formatDate(item.acquiredAt) }}
              </span>
            </footer>
          </div>
        </button>
      </div>

      <div v-if="!filteredEquipment.length" class="flex min-h-[360px] flex-col items-center justify-center rounded-[24px] border border-dashed border-divider bg-bg text-center">
        <RiSearchLine size="32" class="text-text-3" aria-hidden="true"/>
        <h2 class="!mb-0 !mt-4 !border-0 !text-xl !font-black">没有找到匹配的装备</h2>
        <p class="mb-0 mt-2 text-xs text-text-3">换一个关键词，或选择其他分类试试。</p>
      </div>

      <div v-if="hasMore" ref="loadMoreTrigger" class="py-5 text-center text-[11px] font-bold text-text-3" aria-label="继续加载装备">
        继续向下滚动，加载下一批装备
      </div>
      <p v-else-if="filteredEquipment.length" class="mb-0 mt-3 text-center text-[10px] font-bold tracking-[.16em] text-text-3">END OF TOOLKIT</p>
    </section>

    <Teleport to="body">
      <Transition name="equipment-modal">
        <div v-if="selected" class="fixed inset-0 z-[1000] flex items-center justify-center bg-[#040712]/70 p-4 backdrop-blur-[10px]" role="dialog" aria-modal="true" aria-labelledby="equipment-modal-title" @click.self="closeEquipment">
          <div
              ref="holoStage"
              class="equipment-holo-stage"
              :style="selectedHoloStyle"
              @pointermove="handleHoloPointerMove"
              @pointerenter="handleHoloPointerEnter"
              @pointerleave="handleHoloPointerLeave"
          >
              <div class="equipment-holo-ambient" aria-hidden="true"></div>
              <div
                  ref="holoCard"
                  class="equipment-holo-card"
                  :class="{'is-resetting': isHoloResetting}"
              >
                <div class="equipment-holo-inner">
                  <div class="equipment-holo-diffraction" aria-hidden="true"></div>
                  <header class="equipment-holo-frame-header">
                    <div class="min-w-0">
                      <div class="flex items-center justify-between gap-4">
                        <p class="!m-0 text-[10px] !font-black tracking-[.16em] text-white/85">{{ selected.categoryLabel }}</p>
                        <span class="equipment-holo-badge"><span>{{ selected.featured ? 'FEATURED' : selected.status }}</span></span>
                      </div>
                      <p class="!mb-0 !mt-2 truncate text-[10px] font-bold tracking-[.1em] text-white/65">{{ selected.brand }} · {{ selected.model }}</p>
                    </div>
                  </header>
                  <LoadingImage
                      class="equipment-holo-media"
                      image-class="equipment-holo-cover block !m-0 h-auto w-auto object-contain"
                      :src="selected.cover"
                      :alt="selected.coverAlt"
                      loading="eager"
                  />
                  <div class="equipment-holo-image-sheen" aria-hidden="true"></div>
                  <footer class="equipment-holo-frame-footer">
                    <h2 id="equipment-modal-title" class="!m-0 !border-0 !p-0 !text-[clamp(22px,3vw,34px)] !font-black !leading-[1.04] tracking-[-.05em] text-white">{{ selected.name }}</h2>
                    <p class="!mb-0 !mt-3 text-xs font-medium leading-[1.55] text-white/78">{{ selected.review }}</p>
                    <div class="mt-4 flex items-end justify-between gap-4 border-t border-white/20 pt-3">
                      <p class="!m-0 min-w-0 break-words text-[10px] font-bold leading-[1.45] text-white/65">{{ selected.sku }}</p>
                      <span class="flex shrink-0 items-center gap-1.5 text-[10px] font-black text-white/70">
                        <RiTimeLine size="14" aria-hidden="true"/>{{ formatDate(selected.acquiredAt) }}
                      </span>
                    </div>
                  </footer>
                </div>
              </div>
            </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import type {CSSProperties} from 'vue'
import type Masonry from 'masonry-layout'
import {RiArrowRightUpLine, RiSearchLine, RiTimeLine} from '@remixicon/vue'
import equipmentData from '../../equipment/equipment.json'
import LoadingImage from './LoadingImage.vue'

type EquipmentCategory = 'phone' | 'tablet' | 'computer' | 'display' | 'peripheral'

interface EquipmentSpec {
  label: string;
  value: string
}

interface Equipment {
  id: string;
  name: string;
  brand: string;
  category: EquipmentCategory;
  categoryLabel: string;
  model: string;
  sku: string;
  acquiredAt: string;
  status: string;
  review: string;
  borderGradient: string;
  specs: EquipmentSpec[];
  cover: string;
  coverAlt: string;
  featured?: boolean
}

const equipment = equipmentData as Equipment[]
const filters = [
  {label: '全部', value: 'all'},
  {label: '手机', value: 'phone'},
  {label: '平板', value: 'tablet'},
  {label: '电脑', value: 'computer'},
  {label: '显示器', value: 'display'},
  {label: '外设', value: 'peripheral'},
] as const
const currentYear = new Date().getFullYear()
const keyword = ref('')
const activeFilter = ref<(typeof filters)[number]['value']>('all')
const selected = ref<Equipment | null>(null)
const holoStage = ref<HTMLElement | null>(null)
const holoCard = ref<HTMLElement | null>(null)
const isHoloResetting = ref(false)
const masonryGrid = ref<HTMLElement | null>(null)
const loadMoreTrigger = ref<HTMLElement | null>(null)
const PAGE_SIZE = 8
const visibleCount = ref(PAGE_SIZE)
let masonry: Masonry | null = null
let loadMoreObserver: IntersectionObserver | null = null
let holoResetTimer: ReturnType<typeof setTimeout> | undefined
const DEFAULT_HOLO_GRADIENT = 'linear-gradient(135deg, #ff6a2a, #7c3aed)'

const categoryCount = computed(() => new Set(equipment.map(item => item.category)).size)
const filteredEquipment = computed(() => {
  const query = keyword.value.toLocaleLowerCase('zh-CN')
  return equipment
    .filter(item => activeFilter.value === 'all' || item.category === activeFilter.value)
    .filter(item => !query || [item.name, item.brand, item.model, item.sku, item.review, ...item.specs.flatMap(spec => [spec.label, spec.value])].join(' ').toLocaleLowerCase('zh-CN').includes(query))
    .sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt))
})
const visibleEquipment = computed(() => filteredEquipment.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < filteredEquipment.value.length)
const selectedHoloStyle = computed<CSSProperties>(() => {
  const gradient = selected.value?.borderGradient ?? DEFAULT_HOLO_GRADIENT
  const colorStops = gradient.match(/#[\da-f]{6}\b/gi) ?? ['#ff6a2a', '#7c3aed']
  return {
    '--equipment-holo-gradient': gradient,
    '--equipment-holo-glow-start': colorStops[0],
    '--equipment-holo-glow-end': colorStops[colorStops.length - 1],
  } as CSSProperties
})
const countByFilter = (filter: string) => filter === 'all' ? equipment.length : equipment.filter(item => item.category === filter).length
const formatDate = (date: string) => date.replace('-', '.')

function clearHoloResetTimer() {
  if (!holoResetTimer) return
  clearTimeout(holoResetTimer)
  holoResetTimer = undefined
}

function resetHoloCard() {
  const card = holoCard.value
  if (!card) return
  card.style.setProperty('--equipment-holo-active', '0')
  card.style.setProperty('--equipment-holo-rotate-x', '0deg')
  card.style.setProperty('--equipment-holo-rotate-y', '0deg')
  card.style.setProperty('--equipment-holo-tx', '0%')
  card.style.setProperty('--equipment-holo-ty', '0%')
}

function handleHoloPointerMove(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  const card = holoCard.value
  const stage = holoStage.value
  if (!card || !stage) return

  const rect = stage.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
  const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
  const offsetX = (x - rect.width / 2) / (rect.width / 2)
  const offsetY = (y - rect.height / 2) / (rect.height / 2)

  card.style.setProperty('--equipment-holo-pointer-x', `${(x / rect.width) * 100}%`)
  card.style.setProperty('--equipment-holo-pointer-y', `${(y / rect.height) * 100}%`)
  card.style.setProperty('--equipment-holo-rotate-x', `${offsetY * -15}deg`)
  card.style.setProperty('--equipment-holo-rotate-y', `${offsetX * 15}deg`)
  card.style.setProperty('--equipment-holo-bg-x', `${50 + offsetX * 30}%`)
  card.style.setProperty('--equipment-holo-bg-y', `${50 + offsetY * 30}%`)
  card.style.setProperty('--equipment-holo-tx', `${offsetX * -8}%`)
  card.style.setProperty('--equipment-holo-ty', `${offsetY * -8}%`)
}

function handleHoloPointerEnter(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  clearHoloResetTimer()
  isHoloResetting.value = false
  holoCard.value?.style.setProperty('--equipment-holo-active', '1')
}

function handleHoloPointerLeave(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  clearHoloResetTimer()
  isHoloResetting.value = true
  resetHoloCard()
  holoResetTimer = setTimeout(() => {
    isHoloResetting.value = false
    holoResetTimer = undefined
  }, 600)
}

function openEquipment(item: Equipment) {
  selected.value = item
  isHoloResetting.value = false
  document.documentElement.style.overflow = 'hidden'
}

function closeEquipment() {
  clearHoloResetTimer()
  resetHoloCard()
  isHoloResetting.value = false
  selected.value = null
  document.documentElement.style.overflow = ''
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && selected.value) closeEquipment()
}

async function initializeMasonry() {
  if (!masonryGrid.value) return
  const [{default: MasonryLayout}, {default: imagesLoaded}] = await Promise.all([
    import('masonry-layout'),
    import('imagesloaded'),
  ])
  if (!masonryGrid.value) return
  masonry = new MasonryLayout(masonryGrid.value, {
    itemSelector: '.equipment-masonry-item',
    columnWidth: '.equipment-masonry-sizer',
    gutter: 16,
    horizontalOrder: true,
    percentPosition: true,
    transitionDuration: '0.25s',
  })
  imagesLoaded(masonryGrid.value).on('progress', () => masonry?.layout())
}

async function refreshMasonry() {
  await nextTick()
  if (!masonryGrid.value) return
  if (!masonry) {
    await initializeMasonry()
    return
  }
  masonry.reloadItems()
  masonry.layout()
  const {default: imagesLoaded} = await import('imagesloaded')
  imagesLoaded(masonryGrid.value).on('progress', () => masonry?.layout())
}

async function appendEquipment(previousCount: number) {
  await nextTick()
  if (!masonryGrid.value || !masonry) return
  const newItems = Array.from(masonryGrid.value.querySelectorAll<HTMLElement>('.equipment-masonry-item')).slice(previousCount)
  if (!newItems.length) return
  newItems.forEach((item, index) => {
    item.classList.add('is-equipment-entering')
    item.style.setProperty('--equipment-enter-delay', `${Math.min(index * 45, 270)}ms`)
    item.addEventListener('animationend', () => {
      item.classList.remove('is-equipment-entering')
      item.style.removeProperty('--equipment-enter-delay')
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
    const previousCount = visibleEquipment.value.length
    visibleCount.value = Math.min(visibleCount.value + PAGE_SIZE, filteredEquipment.value.length)
    appendEquipment(previousCount)
  }, {rootMargin: '0px 0px 160px'})
  loadMoreObserver.observe(trigger)
}, {flush: 'post'})

onMounted(() => {
  initializeMasonry()
  document.documentElement.classList.add('h-full', 'overflow-hidden')
  document.body.classList.add('h-full', 'overflow-hidden', 'equipment-page-active')
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  clearHoloResetTimer()
  loadMoreObserver?.disconnect()
  masonry?.destroy()
  masonry = null
  window.removeEventListener('keydown', onKeydown)
  document.documentElement.style.overflow = ''
  document.documentElement.classList.remove('h-full', 'overflow-hidden')
  document.body.classList.remove('h-full', 'overflow-hidden', 'equipment-page-active')
})
</script>

<style>
body.equipment-page-active .VPFooter {
  display: none;
}

.equipment-title-glow {
  position: relative;
  isolation: isolate;
}

.equipment-title-glow::after {
  position: absolute;
  z-index: -1;
  right: -8%;
  bottom: -180%;
  left: -10%;
  height: 280%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(51, 243, 120, .17), rgba(59, 130, 246, .11) 56%, transparent);
  filter: blur(18px);
  content: '';
  pointer-events: none;
}

.equipment-card {
  box-shadow: 0 1px 3px rgba(0, 0, 0, .04);
  transition: box-shadow .25s ease, border-color .25s ease;
}

.equipment-card:hover {
  box-shadow: 0 12px 30px rgba(15, 23, 42, .11);
}

.equipment-card-badge {
  position: absolute;
  z-index: 3;
  top: 16px;
  left: 16px;
  isolation: isolate;
  display: inline-flex;
  min-height: 26px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, .42);
  border-radius: 999px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, .3), rgba(255, 255, 255, .07) 48%, rgba(255, 255, 255, .16)),
    rgba(255, 255, 255, .08);
  color: rgba(255, 255, 255, .97);
  box-shadow:
    0 10px 28px rgba(2, 6, 23, .26),
    inset 0 1px 0 rgba(255, 255, 255, .62),
    inset 0 -1px 0 rgba(255, 255, 255, .12),
    inset 1px 0 0 rgba(255, 255, 255, .2),
    inset -1px 0 0 rgba(255, 255, 255, .1);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .08em;
  text-shadow: 0 1px 4px rgba(2, 6, 23, .56);
  -webkit-backdrop-filter: blur(18px) saturate(185%);
  backdrop-filter: blur(18px) saturate(185%);
}

.equipment-card-badge::before {
  position: absolute;
  z-index: 0;
  top: -70%;
  left: 6%;
  width: 72%;
  height: 125%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, .62), transparent 68%);
  filter: blur(5px);
  content: '';
  pointer-events: none;
}

.equipment-card-badge::after {
  position: absolute;
  z-index: 1;
  inset: 1px;
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: inherit;
  content: '';
  pointer-events: none;
}

.equipment-card-badge > span {
  position: relative;
  z-index: 2;
}

.equipment-card .loading-image__image.equipment-card-cover {
  will-change: transform;
}

.equipment-card:hover .loading-image__image.equipment-card-cover {
  transform: scale(1.05);
  transition: opacity .25s ease, transform .6s cubic-bezier(.2, .8, .2, 1);
}

.equipment-masonry-item.is-equipment-entering {
  animation: equipment-card-enter .42s cubic-bezier(.2, .8, .2, 1) both;
  animation-delay: var(--equipment-enter-delay, 0ms);
}

@keyframes equipment-card-enter {
  from { opacity: 0; translate: 0 22px; }
  to { opacity: 1; translate: 0 0; }
}

.equipment-modal-enter-active,
.equipment-modal-leave-active {
  transition: opacity .25s ease;
}

.equipment-modal-enter-active .equipment-holo-card,
.equipment-modal-leave-active .equipment-holo-card {
  transition: opacity .25s ease, transform .25s cubic-bezier(.2, .8, .2, 1);
}

.equipment-modal-enter-from,
.equipment-modal-leave-to,
.equipment-modal-enter-from .equipment-holo-card,
.equipment-modal-leave-to .equipment-holo-card {
  opacity: 0;
}

.equipment-modal-enter-from .equipment-holo-card,
.equipment-modal-leave-to .equipment-holo-card {
  transform: translateY(18px) scale(.985);
}

.equipment-holo-stage {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: -14px;
  padding: 14px;
  perspective: 1500px;
  isolation: isolate;
}

.equipment-holo-ambient {
  position: absolute;
  inset: 8%;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--equipment-holo-glow-start, #ff6a2a) 42%, transparent),
    color-mix(in srgb, var(--equipment-holo-glow-end, #7c3aed) 24%, transparent) 52%,
    transparent 76%
  );
  filter: blur(60px);
  opacity: .8;
  pointer-events: none;
}

.equipment-holo-card {
  --equipment-holo-active: 0;
  --equipment-holo-rotate-x: 0deg;
  --equipment-holo-rotate-y: 0deg;
  --equipment-holo-pointer-x: 50%;
  --equipment-holo-pointer-y: 50%;
  --equipment-holo-bg-x: 50%;
  --equipment-holo-bg-y: 50%;
  --equipment-holo-tx: 0%;
  --equipment-holo-ty: 0%;
  position: relative;
  z-index: 1;
  display: inline-block;
  overflow: hidden;
  /*padding: 3px;*/
  border-radius: 26px;
  background: var(--equipment-holo-gradient);
  transform: rotateX(var(--equipment-holo-rotate-x)) rotateY(var(--equipment-holo-rotate-y));
  transform-style: preserve-3d;
  filter: drop-shadow(0 28px 34px rgba(0, 0, 0, .82));
  transition: transform .1s cubic-bezier(.2, .8, .2, 1);
  will-change: transform;
}

.equipment-holo-card.is-resetting {
  transition: transform .6s cubic-bezier(.2, .8, .2, 1);
}

.equipment-holo-card::before,
.equipment-holo-card::after {
  position: absolute;
  z-index: 10;
  inset: 0;
  border-radius: inherit;
  content: '';
  pointer-events: none;
}

.equipment-holo-card::before {
  inset: -8%;
  background: linear-gradient(
    118deg,
    transparent 8%,
    color-mix(in srgb, var(--equipment-holo-glow-start) 16%, transparent) 25%,
    color-mix(in srgb, var(--equipment-holo-glow-start) 28%, transparent) 36%,
    color-mix(in srgb, var(--equipment-holo-glow-end) 34%, transparent) 48%,
    color-mix(in srgb, var(--equipment-holo-glow-start) 30%, transparent) 59%,
    color-mix(in srgb, var(--equipment-holo-glow-end) 14%, transparent) 74%,
    transparent 92%
  );
  background-position: var(--equipment-holo-bg-x) var(--equipment-holo-bg-y);
  background-size: 260% 260%;
  mix-blend-mode: screen;
  opacity: calc(var(--equipment-holo-active) * .42);
  filter: blur(7px);
  transition: opacity .4s ease;
}

.equipment-holo-card::after {
  background-image:
    url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='2' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='.15'/%3E%3C/svg%3E"),
    repeating-linear-gradient(45deg, rgba(255, 255, 255, .04) 0, rgba(255, 255, 255, .04) 1px, transparent 1px, transparent 3px),
    radial-gradient(
      farthest-corner circle at var(--equipment-holo-pointer-x) var(--equipment-holo-pointer-y),
      color-mix(in srgb, var(--equipment-holo-glow-end) 28%, transparent) 0%,
      color-mix(in srgb, var(--equipment-holo-glow-start) 18%, transparent) 24%,
      color-mix(in srgb, var(--equipment-holo-glow-end) 9%, transparent) 48%,
      transparent 82%
    );
  background-size: 150px 150px, 100% 100%, 100% 100%;
  mix-blend-mode: screen;
  opacity: calc(var(--equipment-holo-active) * .45 + .06);
  transition: opacity .4s ease;
}

.equipment-holo-inner {
  position: relative;
  z-index: 1;
  display: inline-grid;
  grid-template-columns: minmax(0, 1fr);
  overflow: hidden;
  border-radius: 23px;
  background: #080b16;
  box-shadow:
    0 20px 44px -10px rgba(0, 0, 0, .9),
    0 0 34px color-mix(in srgb, var(--equipment-holo-glow-end) 42%, transparent),
    inset 0 0 0 1px rgba(255, 218, 190, .48),
    inset 0 0 0 3px rgba(20, 8, 3, .46);
}

.equipment-holo-diffraction {
  position: absolute;
  z-index: 4;
  inset: -50%;
  background: linear-gradient(
    -45deg,
    transparent 4%,
    color-mix(in srgb, var(--equipment-holo-glow-start) 18%, transparent) 22%,
    color-mix(in srgb, var(--equipment-holo-glow-end) 22%, transparent) 38%,
    color-mix(in srgb, var(--equipment-holo-glow-start) 14%, transparent) 54%,
    color-mix(in srgb, var(--equipment-holo-glow-end) 16%, transparent) 70%,
    transparent 96%
  );
  background-size: 180% 180%;
  mix-blend-mode: color-dodge;
  opacity: calc(var(--equipment-holo-active) * .28);
  filter: blur(10px);
  -webkit-mask-image: radial-gradient(ellipse at center, #000 0%, rgba(0, 0, 0, .82) 58%, transparent 88%);
  mask-image: radial-gradient(ellipse at center, #000 0%, rgba(0, 0, 0, .82) 58%, transparent 88%);
  transform: translate(var(--equipment-holo-tx), var(--equipment-holo-ty)) scale(1.5);
  pointer-events: none;
}

.equipment-holo-media {
  display: block;
  max-width: min(88vw, 960px);
  max-height: min(64vh, 700px);
  border-top: 1px solid rgba(255, 255, 255, .2);
  border-bottom: 1px solid rgba(255, 255, 255, .2);
  background: #080b16;
}

.equipment-holo-cover {
  display: block;
  width: auto;
  height: auto;
  max-width: min(88vw, 960px);
  max-height: min(64vh, 700px);
  opacity: .96;
  filter: saturate(1.08) contrast(1.06);
}

.equipment-holo-image-sheen {
  position: absolute;
  z-index: 5;
  inset: 0;
  pointer-events: none;
}

.equipment-holo-image-sheen {
  background: linear-gradient(
    125deg,
    transparent 24%,
    color-mix(in srgb, var(--equipment-holo-glow-start) 6%, transparent) 36%,
    color-mix(in srgb, var(--equipment-holo-glow-end) 14%, transparent) 50%,
    color-mix(in srgb, var(--equipment-holo-glow-start) 5%, transparent) 64%,
    transparent 76%
  );
  mix-blend-mode: screen;
  opacity: calc(var(--equipment-holo-active) * .45);
  filter: blur(6px);
}

.equipment-holo-frame-header,
.equipment-holo-frame-footer {
  position: relative;
  z-index: 6;
  box-sizing: border-box;
  width: 0;
  min-width: 100%;
  color: white;
  transform: translateZ(34px);
}

.equipment-holo-frame-header {
  padding: 17px 18px 15px;
  background:
    linear-gradient(115deg, rgba(3, 6, 16, .5), rgba(3, 6, 16, .78)),
    var(--equipment-holo-gradient);
}

.equipment-holo-frame-footer {
  padding: 18px 20px 20px;
  background:
    linear-gradient(115deg, rgba(3, 6, 16, .68), rgba(3, 6, 16, .88)),
    var(--equipment-holo-gradient);
}

.equipment-holo-badge {
  position: relative;
  isolation: isolate;
  display: inline-flex;
  min-width: 32px;
  height: 24px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, .38);
  border-radius: 999px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, .28), rgba(255, 255, 255, .07) 48%, rgba(255, 255, 255, .16)),
    rgba(255, 255, 255, .08);
  box-shadow:
    0 8px 24px rgba(2, 6, 23, .24),
    inset 0 1px 0 rgba(255, 255, 255, .58),
    inset 0 -1px 0 rgba(255, 255, 255, .12),
    inset 1px 0 0 rgba(255, 255, 255, .18),
    inset -1px 0 0 rgba(255, 255, 255, .1);
  color: rgba(255, 255, 255, .96);
  font-size: 8px;
  font-weight: 900;
  letter-spacing: .1em;
  text-shadow: 0 1px 3px rgba(2, 6, 23, .45);
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  backdrop-filter: blur(18px) saturate(180%);
}

.equipment-holo-badge::before {
  position: absolute;
  z-index: 0;
  top: -65%;
  left: 8%;
  width: 72%;
  height: 120%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, .58), rgba(255, 255, 255, 0) 68%);
  filter: blur(4px);
  content: '';
  pointer-events: none;
}

.equipment-holo-badge::after {
  position: absolute;
  z-index: 1;
  inset: 1px;
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: inherit;
  content: '';
  pointer-events: none;
}

.equipment-holo-badge > span {
  position: relative;
  z-index: 2;
}

@media (prefers-reduced-motion: reduce) {
  .equipment-card,
  .equipment-card *,
  .equipment-masonry-item,
  .equipment-modal-enter-active,
  .equipment-modal-leave-active,
  .equipment-holo-card,
  .equipment-holo-card::before,
  .equipment-holo-card::after {
    animation-duration: .01ms !important;
    transition-duration: .01ms !important;
  }

  .equipment-holo-card {
    transform: none !important;
  }
}
</style>
