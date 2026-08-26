<template>
  <div
      class="skills-shell fixed inset-x-0 bottom-0 top-[var(--vp-nav-height)] z-20 grid grid-cols-[340px_1fr] overflow-hidden border-y border-divider text-text-1 max-[760px]:block max-[760px]:overflow-y-auto">
    <aside
        class="relative h-full overflow-hidden border-r border-black/10 px-10 py-8 dark:border-white/10 max-[760px]:h-auto max-[760px]:border-b max-[760px]:border-r-0 max-[760px]:px-[22px]">
      <div
          class="pointer-events-none absolute -left-20 top-8 size-52 rounded-full bg-blue-200/80 blur-3xl dark:bg-blue-500/20"
          aria-hidden="true"></div>
      <div class="relative z-10">
        <p class="!mb-4 !mt-0 flex items-center gap-2 text-[10px] !font-black tracking-[.24em]"><span
            class="size-2 rounded-full bg-brand shadow-[0_0_0_5px_var(--vp-c-brand-soft)]"></span>AGENT CAPABILITY ·
          {{ currentYear }}</p>
        <h1 class="skills-title-glow !m-0 !border-0 !text-[45px] !font-black !leading-[.99] !tracking-[-.06em]">给 Agent<br>装上技能<span
            class="text-brand">。</span></h1>
        <p class="mb-0 mt-5 max-w-[238px] text-xs font-medium leading-5 text-text-2 opacity-60">Skills 是 Agent
          可调用的专业工作流。每个技能都把方法、工具和交付标准封装成一项可复用能力。</p>
        <div class="mt-7 flex items-end gap-6" aria-label="技能统计">
          <div><strong class="block text-3xl !font-black">{{ skills.length }}</strong><span
              class="text-[10px] font-bold opacity-45">已收录技能</span></div>
          <div><strong class="block text-3xl !font-black">{{ categoryCount }}</strong><span
              class="text-[10px] font-bold opacity-45">能力分类</span></div>
        </div>
        <label
            class="mt-7 flex h-10 items-center gap-2 rounded-full border border-divider bg-bg px-4 shadow-sm focus-within:ring-2 focus-within:ring-brand">
          <RiSearchLine size="16" aria-hidden="true"/>
          <input v-model.trim="keyword" class="w-full border-0 bg-transparent p-0 text-[11px] font-bold outline-none"
                 type="search" placeholder="搜索技能、描述或标签" aria-label="搜索技能"></label>
        <div class="mt-7 border-t border-divider pt-5">
          <p class="!mb-3 !mt-0 text-[10px] !font-black tracking-[.18em] opacity-40">EXPLORE BY DOMAIN</p>
          <div class="flex flex-wrap gap-2" role="group" aria-label="技能分类筛选">
            <button v-for="item in filters" :key="item.value" type="button"
                    class="cursor-pointer rounded-full border border-divider bg-bg px-[14px] py-[5px] text-[12px] font-bold transition hover:-translate-y-0.5 hover:border-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    :class="activeFilter === item.value ? '!border-text-1 !bg-text-1 !text-bg' : ''"
                    :aria-pressed="activeFilter === item.value" @click="activeFilter = item.value">{{ item.label }}
              {{ countByFilter(item.value) }}
            </button>
          </div>
        </div>
      </div>
    </aside>
    <section
        class="h-full min-w-0 overflow-y-auto bg-bg-soft/50 px-[clamp(22px,3vw,52px)] pb-16 pt-4 max-[760px]:h-auto max-[760px]:overflow-visible max-[760px]:px-4 max-[760px]:pb-12 max-[760px]:pt-7"
        aria-label="Skills 技能列表">
      <header class="mb-4"><p class="m-0 text-[10px] !font-black tracking-[.2em] text-text-3">CAPABILITIES IN MY
        TOOLBOX</p></header>
      <div v-if="filteredSkills.length" class="grid grid-cols-4 gap-4 max-[1440px]:grid-cols-3 max-[1240px]:grid-cols-2 max-[820px]:grid-cols-1">
        <div v-for="skill in filteredSkills" :key="skill.id" role="link" tabindex="0"
           :aria-label="`打开 ${skill.name} Skill 链接`"
           class="skill-card group relative min-h-[244px] cursor-pointer overflow-hidden rounded-[20px] border border-black/10 bg-bg p-5 text-text-1 no-underline dark:border-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
           @click="openSkill(skill)" @keydown.enter="openSkill(skill)" @keydown.space.prevent="openSkill(skill)">
          <div class="flex items-start !items-center gap-4"><span
              class="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand transition duration-300 group-hover:-rotate-3 group-hover:scale-105"><component
              :is="iconMap[skill.icon] || RiSparkling2Line" size="25" aria-hidden="true"/></span><h2 class="!mb-0 !mt-0 !border-0 !py-0 !text-[20px] !font-black !leading-tight tracking-[-.03em]">
            {{ skill.name }}</h2></div>
          <p class="mb-0 mt-2 text-[13px] leading-[1.65] text-text-2">{{ skill.description }}</p>
          <div class="flex flex-wrap gap-1.5"><span v-for="tag in skill.tags" :key="tag"
                                                         class="rounded-full bg-bg-soft px-2.5 py-0.5 text-[10px] !font-extrabold text-text-2">{{
              tag
            }}</span></div>
          <footer
              class="mt-2 flex items-center justify-between border-t border-divider pt-4 text-[11px] font-bold text-text-3">
            <span class="flex items-center gap-1.5"><RiTimeLine size="14" aria-hidden="true"/>更新于 {{
                formatDate(skill.updatedAt)
              }}</span><span class="flex items-center gap-1.5 text-text-2"> <span
              class="rounded-full border border-divider px-3 py-0.5 text-[10px] !font-black tracking-[.08em] text-text-2">{{
              skill.categoryLabel
            }}</span><RiArrowRightUpLine size="16"
                                         class="transition-transform group-hover:translate-x-0.5 opacity-0 group-hover:opacity-100 group-hover:-translate-y-0.5"
                                         aria-hidden="true"/></span></footer>
        </div>
      </div>
      <div v-else
           class="flex min-h-[360px] flex-col items-center justify-center rounded-[24px] border border-dashed border-divider bg-bg text-center">
        <RiSearchEyeLine size="34" class="text-text-3" aria-hidden="true"/>
        <h2 class="!mb-0 !mt-4 !border-0 !text-xl !font-black">没有找到匹配的技能</h2>
        <p class="mb-0 mt-2 text-xs text-text-3">换一个关键词，或选择其他分类试试。</p></div>
    </section>
  </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from 'vue'
import {
  RiApps2Line,
  RiArrowRightUpLine,
  RiArticleLine,
  RiCodeBoxLine,
  RiFileChartLine,
  RiFilePdf2Line,
  RiImage2Line,
  RiLayoutGridLine,
  RiMic2Line,
  RiMovie2Line,
  RiPresentationLine,
  RiSearchEyeLine,
  RiSearchLine,
  RiSparkling2Line,
  RiTimeLine,
  RiWindowLine
} from '@remixicon/vue'
import skillsData from '../../skills/skills.json'

type SkillCategory = 'engineering' | 'design' | 'media' | 'productivity' | 'research'

interface Skill {
  id: number;
  icon: string;
  name: string;
  description: string;
  category: SkillCategory;
  categoryLabel: string;
  updatedAt: string;
  link: string;
  tags: string[]
}

// 技能内容由独立 JSON 文件集中维护，组件只负责筛选与展示。
const skills = skillsData as Skill[]
const currentYear = new Date().getFullYear()
const keyword = ref('')
const activeFilter = ref<'all' | SkillCategory>('all')
const filters = [{label: '全部', value: 'all'}, {label: '工程', value: 'engineering'}, {
  label: '设计',
  value: 'design'
}, {label: '内容', value: 'media'}, {label: '效率', value: 'productivity'}, {label: '研究', value: 'research'}] as const
// JSON 中只保存稳定的图标键，实际 Vue 组件在展示层集中映射。
const iconMap: Record<string, unknown> = {
  app: RiApps2Line,
  RiArrowRightUpLine,
  audio: RiMic2Line,
  browser: RiWindowLine,
  code: RiCodeBoxLine,
  document: RiArticleLine,
  image: RiImage2Line,
  layout: RiLayoutGridLine,
  pdf: RiFilePdf2Line,
  research: RiSearchEyeLine,
  sheet: RiFileChartLine,
  slides: RiPresentationLine,
  video: RiMovie2Line
}
const categoryCount = computed(() => new Set(skills.map(skill => skill.category)).size)
const filteredSkills = computed(() => {
  const query = keyword.value.toLocaleLowerCase('zh-CN')
  return skills.filter(skill => activeFilter.value === 'all' || skill.category === activeFilter.value).filter(skill => !query || [skill.name, skill.description, skill.categoryLabel, ...skill.tags].join(' ').toLocaleLowerCase('zh-CN').includes(query)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
})
const countByFilter = (filter: string) => filter === 'all' ? skills.length : skills.filter(skill => skill.category === filter).length
const formatDate = (date: string) => date.replaceAll('-', '.')
// div 卡片通过鼠标或键盘打开 Skill 链接，并阻断新页面访问当前页面的 window.opener。
const openSkill = (skill: Skill) => {
  const skillWindow = window.open(skill.link, '_blank', 'noopener,noreferrer')
  if (skillWindow) skillWindow.opener = null
}
let pageFooter: HTMLElement | null = null
// 与 Projects 页面保持一致：全屏展示时隐藏页脚，离开页面后恢复默认布局。
onMounted(() => {
  document.documentElement.classList.add('h-full', 'overflow-hidden');
  document.body.classList.add('h-full', 'overflow-hidden');
  pageFooter = document.querySelector<HTMLElement>('.VPFooter');
  pageFooter?.classList.add('hidden')
})
onBeforeUnmount(() => {
  document.documentElement.classList.remove('h-full', 'overflow-hidden');
  document.body.classList.remove('h-full', 'overflow-hidden');
  pageFooter?.classList.remove('hidden')
})
</script>

<style>
.skills-title-glow {
  position: relative;
  isolation: isolate;
}

.skills-title-glow::after {
  position: absolute;
  z-index: -1;
  right: -12%;
  bottom: -200%;
  left: -10%;
  height: 300%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(51, 243, 120, 0.18), rgba(174, 250, 43, 0.1) 52%, transparent);
  filter: blur(18px);
  content: '';
  pointer-events: none;
}

.skill-card {
  box-shadow: 0 1px 3px rgba(0, 0, 0, .04);
  transition: box-shadow .25s ease;
}

.skill-card:hover {
  box-shadow: 0 8px 24px rgba(15, 23, 42, .1);
}

@media (prefers-reduced-motion: reduce) {
  .skill-card, .skill-card * {
    transition-duration: .01ms !important;
  }
}
</style>





