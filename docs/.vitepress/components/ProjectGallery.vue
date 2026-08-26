<template>
  <div
      class="fixed inset-x-0 bottom-0 top-[var(--vp-nav-height)] z-20 grid grid-cols-[340px_1fr] overflow-hidden border-y border-divider text-text-1 max-[760px]:block max-[760px]:overflow-y-auto">
    <aside
        class="relative h-full overflow-hidden border-r border-black/10 px-10 py-8 dark:border-white/10 max-[760px]:h-auto max-[760px]:border-b max-[760px]:border-r-0 max-[760px]:px-[22px] max-[760px]:py-8">
      <div
          class="pointer-events-none absolute -left-20 top-8 size-52 rounded-full bg-blue-200/80 blur-3xl dark:bg-blue-500/20"
          aria-hidden="true"></div>
      <div class="relative z-10">
        <p class="!mb-4 !mt-0 flex items-center gap-2 text-[10px] !font-black tracking-[.24em] text-text-1">
          <span class="size-2 rounded-full bg-brand shadow-[0_0_0_5px_var(--vp-c-brand-soft)]"></span>
          PROJECT CONSTELLATION · {{ currentYear }}
        </p>
        <h1 class="projects-title-glow !text-[45px] !font-black !leading-[.99] !tracking-[-.06em]">
          造一些<br>有趣的东西<span class="text-brand">。</span>
        </h1>
        <p class="mb-0 mt-5 max-w-[230px] text-xs font-medium leading-5 text-text-2 opacity-55">
          这里不是项目清单，而是一座持续扩张的数字星图。每个坐标，都记录一次从想法到上线的完整旅程。</p>
        <div class="mt-7 flex items-end gap-6" aria-label="项目统计">
          <div><strong class="block text-3xl !font-black">{{ projects.length }}</strong><span
              class="text-[10px] font-bold text-text-1 opacity-45">公开作品</span></div>
          <div><strong class="block text-3xl !font-black">{{ techCount }}</strong><span
              class="text-[10px] font-bold text-text-1 opacity-45">技术领域</span></div>
        </div>
        <div class="mt-8 border-t border-black/10 pt-5 dark:border-white/10">
          <p class="!mb-3 !mt-0 text-[10px] !font-black tracking-[.18em] text-text-1 opacity-40">EXPLORE BY ORBIT</p>
          <div class="flex flex-wrap gap-2" role="group" aria-label="项目分类筛选">
            <button
                v-for="item in filters"
                :key="item.value"
                type="button"
                class="cursor-pointer rounded-full border border-divider bg-bg px-[14px] py-[5px] text-[12px] font-bold text-text-1 transition hover:-translate-y-0.5 hover:border-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                :class="activeFilter === item.value ? '!border-text-1 !bg-text-1 !text-bg' : ''"
                :aria-pressed="activeFilter === item.value"
                @click="activeFilter = item.value"
            >{{ item.label }} {{ countByFilter(item.value) }}
            </button>
          </div>
        </div>
      </div>
    </aside>

    <section
        class="h-full min-w-0 overflow-y-auto bg-bg-soft/50 px-[clamp(22px,3vw,52px)] pb-16 pt-4 [overflow-anchor:none] max-[760px]:h-auto max-[760px]:overflow-visible max-[760px]:px-4 max-[760px]:pb-12 max-[760px]:pt-7"
        aria-label="项目瀑布流">
      <header class="flex items-center justify-between">
        <p class="m-0 text-[10px] !font-black tracking-[.2em] text-text-3">SIGNALS FROM MY LAB</p>
        <!--        <span class="text-[11px] font-extrabold text-text-1">按 ID 升序</span>-->
      </header>

      <div ref="masonryGrid" class="relative">
        <div
            class="masonry-sizer w-[calc((100%-48px)/4)] max-[1400px]:w-[calc((100%-32px)/3)] max-[1100px]:w-[calc((100%-16px)/2)] max-[760px]:w-full"
            aria-hidden="true"></div>
        <button
            v-for="(project, index) in visibleProjects"
            :key="`${project.name}-${index}`"
            type="button"
            class="masonry-item project-card group mb-4 w-[calc((100%-48px)/4)] cursor-pointer max-[1400px]:w-[calc((100%-32px)/3)] max-[1100px]:w-[calc((100%-16px)/2)] max-[760px]:w-full overflow-hidden rounded-[20px] border border-black/10 bg-bg p-0 text-left text-text-1 dark:border-white/10 transition duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            :aria-label="`查看 ${project.name} 项目详情`"
            @click="openProject(project)"
        >
          <div
              class="relative overflow-hidden bg-bg-soft"
          >
            <img
                class="block !m-0 h-full w-full object-cover transition duration-[600ms] ease-[cubic-bezier(.2,.8,.2,1)] group-hover:scale-105"
                :src="project.cover" :alt="project.coverAlt">
            <span
                class="absolute left-3 top-3 rounded-full bg-white/60 px-3 py-0.5 !text-[10px] !font-black tracking-[.08em] text-[#080b16] backdrop-blur-[10px]">{{
                project.featured ? 'FEATURED' : project.categoryLabel
              }} · {{ String(index + 1).padStart(2, '0') }}</span>
            <span
                class="absolute bottom-3 right-3 flex translate-y-[5px] text-white opacity-0 drop-shadow-[0_2px_5px_rgba(0,0,0,.35)] transition duration-200 group-hover:translate-y-0 group-hover:opacity-100"
                aria-hidden="true"><RiArrowRightUpLine size="36px"/></span>
          </div>
          <div class="p-[18px]">
            <div class="flex items-start justify-between gap-2.5">
              <h2 class="!m-0 !border-0 !text-[19px] !font-black leading-[1.2] tracking-[-.03em] !py-0">{{
                  project.name
                }}</h2>
              <small class="text-[11px] font-extrabold text-text-3">{{ project.year }}</small>
            </div>
            <p class="mb-0 mt-2 !text-[14px] !leading-[1.6] !text-text-2">{{ project.summary }}</p>
            <footer class="mt-[15px] flex flex-wrap gap-x-[11px] gap-y-1.5"><span
                v-for="language in project.languages.slice(0, 3)" :key="language"
                class="text-[10px] !font-black uppercase tracking-[.05em]">{{ language }}</span></footer>
          </div>
        </button>
      </div>
      <!-- 触底后继续追加下一批项目，避免一次性创建全部瀑布流卡片。 -->
      <div
          v-if="hasMore"
          ref="loadMoreTrigger"
          class="py-4 text-center text-[11px] font-bold text-text-3"
          aria-label="继续加载项目"
      >继续向下滚动，加载更多项目
      </div>
    </section>

    <!-- 项目详情弹窗卡片 -->
    <Teleport to="body">
      <Transition name="project-modal">
        <div v-if="selected"
             class="project-modal-backdrop fixed inset-0 z-[1000] flex items-center justify-center bg-[#040712]/70 p-[16px] backdrop-blur-[10px] max-[760px]:items-center max-[760px]:p-3"
             role="dialog" aria-modal="true" aria-labelledby="project-modal-title" @click.self="closeProject">
          <article
              class="project-modal-card grid h-[min(648px,86vh)] w-[min(1060px,94vw)] grid-cols-[58%_42%] overflow-hidden rounded-[30px] bg-bg text-text-1 shadow-[0_36px_100px_rgba(0,0,0,.35)] max-[1100px]:grid-cols-[54%_46%] max-[760px]:block max-[760px]:h-[min(90vh,760px)] max-[760px]:overflow-y-auto max-[760px]:rounded-3xl">
            <section
                class="project-modal-media relative min-w-0 overflow-hidden bg-[#080b16] max-[760px]:h-[42vh] max-[760px]:min-h-[300px]"
                aria-label="项目截图轮播">
              <img class="block !m-0 h-full w-full object-cover" :src="activeSlide.src" :alt="activeSlide.alt">
              <div class="absolute inset-0 bg-gradient-to-t from-[#040712]/80 via-transparent to-[#040712]/25"></div>
              <p class="absolute left-6 top-6 m-0 rounded-full border border-white/30 px-[11px] py-[7px] text-[9px] !font-black tracking-[.16em] text-white backdrop-blur-[10px]">
                {{ String(slideIndex + 1).padStart(2, '0') }} / {{ String(selected.slides.length).padStart(2, '0') }} ·
                PRODUCT VIEW</p>
              <footer
                  class="absolute bottom-[26px] left-[26px] right-[26px] flex items-end justify-between gap-6 text-white max-[760px]:bottom-[18px] max-[760px]:left-[18px] max-[760px]:right-[18px]">
                <div><span class="text-[9px] !font-black tracking-[.2em] opacity-65">VISUAL ARCHIVE</span>
                  <p class="mb-0 mt-1.5 max-w-[400px] text-[15px] font-bold leading-normal max-[760px]:text-xs">
                    {{ selected.tagline }}</p></div>
                <div class="flex gap-2">
                  <button type="button" title="上一张" aria-label="上一张项目截图"
                          class="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-[#040712]/25 p-0 text-white backdrop-blur-[10px] transition hover:bg-white hover:text-[#080b16] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                          @click="previousSlide">
                    <RiArrowLeftLine size="20px" aria-hidden="true"/>
                  </button>
                  <button type="button" title="下一张" aria-label="下一张项目截图"
                          class="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-[#040712]/25 p-0 text-white backdrop-blur-[10px] transition hover:bg-white hover:text-[#080b16] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                          @click="nextSlide">
                    <RiArrowRightLine size="20px" aria-hidden="true"/>
                  </button>
                </div>
              </footer>
            </section>

            <section
                class="project-modal-info relative flex min-w-0 flex-col px-10 pb-9 pt-11 max-[760px]:min-h-[420px] max-[760px]:px-6 max-[760px]:pb-6 max-[760px]:pt-9">
              <button ref="closeButton" type="button"
                      class="absolute right-5 top-5 flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-2 transition hover:rotate-90 hover:bg-bg-soft hover:text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      title="关闭" aria-label="关闭项目详情" @click="closeProject">
                <RiCloseLine size="22px" aria-hidden="true"/>
              </button>
              <p class="m-0 text-[9px] !font-black tracking-[.2em] text-text-3">
                {{ selected.featured ? 'FEATURED CASE' : selected.categoryLabel }} · {{ selected.year }}</p>
              <h2 id="project-modal-title"
                  class="!mb-0 !mt-6 !border-0 !text-[40px] !font-black leading-none tracking-[-.05em] max-[760px]:text-[34px]">
                {{ selected.name }}</h2>
              <p class="mb-0 mt-5 text-[13px] leading-[1.75] text-text-2">{{ selected.description }}</p>
              <dl class="mt-7 grid grid-cols-2 gap-[22px] border-t border-divider pt-6">
                <div>
                  <dt class="text-[9px] !font-black tracking-[.14em] text-text-3">DEVELOPMENT</dt>
                  <dd class="mt-[7px] flex items-center gap-2 text-xs font-extrabold">{{ selected.development }}</dd>
                </div>
                <div>
                  <dt class="text-[9px] !font-black tracking-[.14em] text-text-3">STATUS</dt>
                  <dd class="mt-[7px] flex items-center gap-2 text-xs font-extrabold"><span
                      class="size-2 rounded-full bg-brand shadow-[0_0_0_5px_var(--vp-c-brand-soft)]"></span>{{
                      selected.status
                    }}
                  </dd>
                </div>
                <div class="col-span-full">
                  <dt class="text-[9px] !font-black tracking-[.14em] text-text-3">LANGUAGES & STACK</dt>
                  <dd class="mt-[7px] flex flex-wrap items-center gap-2"><span
                      v-for="(language, index) in selected.languages" :key="language"
                      class="rounded-full bg-bg-soft px-3 py-[3px] !text-[10px] !font-extrabold"
                      :class="index === 0 ? '!bg-text-1 !text-bg' : ''">{{ language }}</span></dd>
                </div>
              </dl>
              <footer class="mt-auto grid grid-cols-2 gap-3 max-[760px]:mt-7">
                <a class="flex min-h-11 items-center justify-center gap-2 rounded-[13px] border border-divider text-xs font-extrabold text-text-1 no-underline transition hover:-translate-y-0.5 hover:bg-text-1 hover:text-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                   :href="selected.github" target="_blank" rel="noopener noreferrer">
                  <RiGithubFill size="18px" aria-hidden="true"/>
                  GitHub</a>
                <a v-if="selected.website"
                   class="flex min-h-11 items-center justify-center gap-2 rounded-[13px] border border-brand bg-brand text-xs font-extrabold text-white no-underline transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                   :href="selected.website" target="_blank" rel="noopener noreferrer">访问项目
                  <RiExternalLinkLine size="18px" aria-hidden="true"/>
                </a>
              </footer>
            </section>
          </article>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import type Masonry from 'masonry-layout'
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiArrowRightUpLine,
  RiCloseLine,
  RiExternalLinkLine,
  RiGithubFill
} from '@remixicon/vue'
import projectData from '../../projects/projects.json'

interface Slide {
  src: string;
  alt: string
}

interface Project {
  id: string;
  name: string;
  category: 'fullstack' | 'ai' | 'opensource';
  categoryLabel: string;
  year: number;
  development: string;
  status: string;
  summary: string;
  description: string;
  tagline: string;
  languages: string[];
  github: string;
  website?: string;
  cover: string;
  coverAlt: string;
  slides: Slide[];
  featured?: boolean;
}

// 项目数据由独立 JSON 文件集中维护，组件只负责交互与展示。
const projects = projectData as Project[]

const filters = [{label: '全部', value: 'all'}, {label: '全栈', value: 'fullstack'}, {
  label: 'AI 实验',
  value: 'ai'
}, {label: '开源', value: 'opensource'}] as const
const activeFilter = ref<(typeof filters)[number]['value']>('all')
const selected = ref<Project | null>(null)
const slideIndex = ref(0)
const closeButton = ref<HTMLButtonElement | null>(null)
const masonryGrid = ref<HTMLElement | null>(null)
const loadMoreTrigger = ref<HTMLElement | null>(null)
const PAGE_SIZE = 10
const visibleCount = ref(PAGE_SIZE)
let masonry: Masonry | null = null
let loadMoreObserver: IntersectionObserver | null = null
const currentYear = new Date().getFullYear()
const techCount = computed(() => new Set(projects.flatMap(item => item.languages)).size)
// 项目按 ID 升序
const filteredProjects = computed(() => projects.filter(item => activeFilter.value === 'all' || item.category === activeFilter.value).sort((a, b) => Number(a.id) - Number(b.id)))
const visibleProjects = computed(() => filteredProjects.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < filteredProjects.value.length)
const activeSlide = computed(() => selected.value?.slides[slideIndex.value] ?? {src: '', alt: ''})
const countByFilter = (filter: string) => filter === 'all' ? projects.length : projects.filter(item => item.category === filter).length

function openProject(project: Project) {
  selected.value = project;
  slideIndex.value = 0;
  document.documentElement.style.overflow = 'hidden';
  nextTick(() => closeButton.value?.focus())
}

function closeProject() {
  selected.value = null;
  document.documentElement.style.overflow = ''
}

function nextSlide() {
  if (selected.value) slideIndex.value = (slideIndex.value + 1) % selected.value.slides.length
}

function previousSlide() {
  if (selected.value) slideIndex.value = (slideIndex.value - 1 + selected.value.slides.length) % selected.value.slides.length
}

function onKeydown(event: KeyboardEvent) {
  if (!selected.value) return;
  if (event.key === 'Escape') closeProject();
  if (event.key === 'ArrowRight') nextSlide();
  if (event.key === 'ArrowLeft') previousSlide()
}

// Masonry 负责按横向顺序计算卡片位置，图片加载后再次布局以避免高度误差。
async function initializeMasonry() {
  if (!masonryGrid.value) return
  const [{default: MasonryLayout}, {default: imagesLoaded}] = await Promise.all([
    import('masonry-layout'),
    import('imagesloaded')
  ])
  if (!masonryGrid.value) return
  masonry = new MasonryLayout(masonryGrid.value, {
    itemSelector: '.masonry-item',
    columnWidth: '.masonry-sizer',
    gutter: 16,
    horizontalOrder: true,
    percentPosition: true,
    transitionDuration: '0.25s'
  })
  imagesLoaded(masonryGrid.value).on('progress', () => masonry?.layout())
}

// 新卡片进入 DOM 后通知 Masonry 重收集项目，并在图片加载时校正布局。
async function refreshMasonry() {
  await nextTick()
  if (!masonryGrid.value || !masonry) return
  masonry.reloadItems()
  masonry.layout()
  const {default: imagesLoaded} = await import('imagesloaded')
  imagesLoaded(masonryGrid.value).on('progress', () => masonry?.layout())
}

// 仅将新增卡片交给 Masonry，避免全量重排导致已有卡片和滚动位置抖动。
async function appendProjects(previousCount: number) {
  await nextTick()
  if (!masonryGrid.value || !masonry) return

  const newItems = Array.from(masonryGrid.value.querySelectorAll<HTMLElement>('.masonry-item')).slice(previousCount)
  if (!newItems.length) return

  newItems.forEach((item, index) => {
    item.classList.add('is-project-entering')
    item.style.setProperty('--project-enter-delay', `${Math.min(index * 45, 270)}ms`)
    item.addEventListener('animationend', () => {
      item.classList.remove('is-project-entering')
      item.style.removeProperty('--project-enter-delay')
    }, {once: true})
  })

  masonry.appended(newItems)
  const {default: imagesLoaded} = await import('imagesloaded')
  imagesLoaded(newItems).on('progress', () => masonry?.layout())
}

// 切换项目分类后重新从首批 10 个项目开始展示。
watch(activeFilter, () => {
  visibleCount.value = PAGE_SIZE
  refreshMasonry()
})

// 哨兵节点进入可视区域时，每次追加 10 个项目。
watch(loadMoreTrigger, (trigger) => {
  loadMoreObserver?.disconnect()
  loadMoreObserver = null

  if (!trigger || typeof IntersectionObserver === 'undefined') return

  loadMoreObserver = new IntersectionObserver((entries) => {
    if (!entries[0]?.isIntersecting || !hasMore.value) return
    const previousCount = visibleProjects.value.length
    visibleCount.value = Math.min(visibleCount.value + PAGE_SIZE, filteredProjects.value.length)
    appendProjects(previousCount)
  }, {
    rootMargin: '0px 0px 160px',
  })
  loadMoreObserver.observe(trigger)
}, {flush: 'post'})

// 外层布局使用 Tailwind 工具类，并通过页面状态类控制页脚显隐。
onMounted(() => {
  initializeMasonry()
  document.documentElement.classList.add('h-full', 'overflow-hidden')
  document.body.classList.add('h-full', 'overflow-hidden', 'projects-page-active')
})

if (typeof window !== 'undefined') window.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => {
  loadMoreObserver?.disconnect()
  loadMoreObserver = null
  masonry?.destroy()
  masonry = null
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown);
  if (typeof document !== 'undefined') {
    document.documentElement.style.overflow = ''
    document.documentElement.classList.remove('h-full', 'overflow-hidden')
    document.body.classList.remove('h-full', 'overflow-hidden', 'projects-page-active')
  }
})
</script>

<style>
body.projects-page-active .VPFooter {
  display: none;
}

.projects-title-glow {
  position: relative;
  isolation: isolate;
  margin: 0;
  border: 0;
}

.projects-title-glow::after {
  position: absolute;
  z-index: -1;
  right: -12%;
  bottom: -200%;
  left: -10%;
  height: 300%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(47, 99, 255, .18), rgba(16, 151, 253, 0.1) 52%, transparent);
  filter: blur(18px);
  content: '';
  pointer-events: none;
}

.project-card {
  box-shadow: 0 1px 3px rgba(0, 0, 0, .04);
}

.project-card:hover {
  box-shadow: 0 4px 12px rgba(15, 23, 42, .12);
}

/* 新增项目使用独立 translate 属性入场，不覆盖 Masonry 写入的定位 transform。 */
.masonry-item.is-project-entering {
  animation: project-card-enter .52s cubic-bezier(.16, 1, .3, 1) var(--project-enter-delay, 0ms) both;
  will-change: opacity, translate;
}

@keyframes project-card-enter {
  from {
    opacity: 0;
    translate: 0 52px;
  }
  to {
    opacity: 1;
    translate: 0 0;
  }
}

/* 项目详情弹窗：仅动画合成友好的 opacity 与 transform，避免首次打开闪白。 */
.project-modal-enter-active,
.project-modal-leave-active {
  transition: opacity .2s ease;
}

.project-modal-enter-active .project-modal-card {
  transition: opacity .28s ease, transform .44s cubic-bezier(.16, 1, .3, 1);
}

.project-modal-leave-active .project-modal-card {
  transition: opacity .16s ease, transform .22s cubic-bezier(.4, 0, 1, 1);
}

.project-modal-enter-active .project-modal-media,
.project-modal-enter-active .project-modal-info {
  transition: opacity .3s ease, transform .46s cubic-bezier(.16, 1, .3, 1);
}

.project-modal-enter-active .project-modal-info > * {
  transition: opacity .28s ease, transform .4s cubic-bezier(.16, 1, .3, 1);
}

.project-modal-enter-active .project-modal-info > :nth-child(2) {
  transition-delay: .04s;
}

.project-modal-enter-active .project-modal-info > :nth-child(3) {
  transition-delay: .07s;
}

.project-modal-enter-active .project-modal-info > :nth-child(4) {
  transition-delay: .1s;
}

.project-modal-enter-active .project-modal-info > :nth-child(5) {
  transition-delay: .13s;
}

.project-modal-enter-active .project-modal-info > :nth-child(6) {
  transition-delay: .16s;
}

.project-modal-enter-from,
.project-modal-leave-to {
  opacity: 0;
}

.project-modal-enter-from .project-modal-card {
  opacity: 0;
  transform: translate3d(0, 24px, 0) scale(.965);
}

.project-modal-leave-to .project-modal-card {
  opacity: 0;
  transform: translate3d(0, 12px, 0) scale(.985);
}

.project-modal-enter-from .project-modal-media {
  opacity: 0;
  transform: translate3d(-18px, 0, 0) scale(1.025);
}

.project-modal-enter-from .project-modal-info {
  opacity: 0;
  transform: translate3d(20px, 0, 0);
}

.project-modal-enter-from .project-modal-info > * {
  opacity: 0;
  transform: translate3d(0, 10px, 0);
}

.project-modal-card,
.project-modal-media,
.project-modal-info {
  backface-visibility: hidden;
  transform-origin: center;
  will-change: transform, opacity;
}

@media (prefers-reduced-motion: reduce) {
  .masonry-item.is-project-entering {
    animation-duration: .01ms;
    animation-delay: 0ms;
  }

  .project-modal-enter-active,
  .project-modal-leave-active,
  .project-modal-enter-active .project-modal-card,
  .project-modal-leave-active .project-modal-card,
  .project-modal-enter-active .project-modal-media,
  .project-modal-enter-active .project-modal-info,
  .project-modal-enter-active .project-modal-info > * {
    transition-duration: .01ms !important;
    transition-delay: 0ms !important;
  }
}
</style>
