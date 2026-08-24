<template>
  <div class="archive">
    <section class="heatmap-card" aria-labelledby="heatmap-title">
      <div class="heatmap-scroll" tabindex="0" aria-label="过去一年的每日文章发布热力图">
        <div class="month-row" aria-hidden="true">
          <span/>
          <span v-for="month in monthLabels" :key="month.key" class="month-label"
                :style="{ gridColumn: `${month.column} / span ${month.span}` }">{{ month.label }}</span>
        </div>
        <div class="heatmap-body">
          <div class="weekday-labels" aria-hidden="true">
            <span/><span>一</span><span/><span>三</span><span/><span>五</span><span/>
          </div>
          <div class="heatmap-grid">
            <template v-for="week in heatmapWeeks" :key="week.key">
              <span v-for="day in week.days" :key="day.date" class="heatmap-cell"
                    :class="'level-' + day.level" :aria-label="day.label"
                    @mouseenter="showTooltip($event, day)"
                    @mousemove="moveTooltip"
                    @mouseleave="hideTooltip"/>
            </template>
          </div>
        </div>
      </div>
    </section>
    <Teleport to="body">
      <div v-if="tooltip.visible" class="heatmap-tooltip" role="tooltip"
           :style="{left: tooltip.x + 'px', top: tooltip.y + 'px'}">{{ tooltip.text }}</div>
    </Teleport>
    <div v-for="group in grouped" :key="group.year" class="archive-year">
      <h2 class="year-title">{{ group.year }}</h2>
      <div v-for="post in group.posts" :key="post.url" class="archive-item">
        <time class="archive-date">{{ formatDate(post.date) }}</time>
        <a :href="post.url" class="archive-link">{{ post.title }}</a>
        <span class="archive-category">{{ post.category }}</span>
        <span class="archive-tags">
          <span v-for="tag in post.tags" :key="tag" class="tag">#{{ tag }}</span>
        </span>
      </div>
    </div>
    <p v-if="!grouped.length" class="empty">还没有文章，敬请期待 ✨</p>
  </div>
</template>

<script setup lang="ts">
import {computed, reactive} from 'vue'
import {data as posts} from '../../posts/posts.data'

interface Post {
  title: string
  url: string
  date: string
  category: string
  tags: string[]
  excerpt: string
}

interface YearGroup {
  year: string
  posts: Post[]
}

interface HeatmapDay {
  date: string
  count: number
  level: number
  label: string
}

const tooltip = reactive({visible: false, text: '', x: 0, y: 0})
const WEEK_COUNT = 53
const DAY_MS = 24 * 60 * 60 * 1000

// 使用本地日期键，避免 YYYY-MM-DD 直接解析为 UTC 后造成日期错位。
function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Tooltip 使用中文年月日格式展示每日文章发布数量。
function formatHeatmapLabel(date: Date, count: number): string {
  return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日发布了' + count + '篇文章'
}

function moveTooltip(event: MouseEvent) {
  tooltip.x = Math.min(event.clientX + 14, window.innerWidth - 250)
  tooltip.y = Math.max(8, event.clientY - 42)
}

function showTooltip(event: MouseEvent, day: HeatmapDay) {
  tooltip.text = day.label
  tooltip.visible = true
  moveTooltip(event)
}

function hideTooltip() {
  tooltip.visible = false
}
const publishCounts = posts.reduce<Record<string, number>>((counts, post) => {
  if (post.date) counts[post.date] = (counts[post.date] || 0) + 1
  return counts
}, {})
const maxDailyCount = Math.max(0, ...Object.values(publishCounts))

// 以今天所在周为末周，生成与 GitHub contribution graph 一致的 53 周。
const heatmapWeeks = computed(() => {
  const end = new Date()
  end.setHours(0, 0, 0, 0)
  end.setDate(end.getDate() + (6 - end.getDay()))
  const start = new Date(end.getTime() - (WEEK_COUNT * 7 - 1) * DAY_MS)

  return Array.from({length: WEEK_COUNT}, (_, weekIndex) => {
    const weekStart = new Date(start.getTime() + weekIndex * 7 * DAY_MS)
    const days: HeatmapDay[] = Array.from({length: 7}, (_, dayIndex) => {
      const date = new Date(weekStart.getTime() + dayIndex * DAY_MS)
      const dateKey = toDateKey(date)
      const count = publishCounts[dateKey] || 0
      const level = count === 0 || maxDailyCount === 0
          ? 0
          : Math.max(1, Math.ceil(count / maxDailyCount * 4))
      return {date: dateKey, count, level, label: formatHeatmapLabel(date, count)}
    })
    return {key: toDateKey(weekStart), days}
  })
})

const heatmapTotal = computed(() => heatmapWeeks.value.reduce(
    (total, week) => total + week.days.reduce((sum, day) => sum + day.count, 0), 0,
))

// 月份标签从该月首次出现的周开始，延伸至下一个月份标签。
const monthLabels = computed(() => {
  const labels: Array<{ key: string; label: string; column: number; span: number }> = []
  heatmapWeeks.value.forEach((week, index) => {
    const date = new Date(`${week.days[0].date}T00:00:00`)
    const key = `${date.getFullYear()}-${date.getMonth()}`
    if (labels.at(-1)?.key !== key) {
      labels.push({key, label: `${date.getMonth() + 1}月`, column: index + 2, span: 1})
    }
  })
  labels.forEach((label, index) => {
    label.span = (labels[index + 1]?.column || WEEK_COUNT + 2) - label.column
  })
  return labels
})
const grouped = posts.reduce<YearGroup[]>((acc, post) => {
  if (!post.date) return acc
  const year = new Date(post.date).getFullYear().toString()
  const existing = acc.find(g => g.year === year)
  if (existing) {
    existing.posts.push(post)
  } else {
    acc.push({year, posts: [post]})
  }
  return acc
}, [])

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })
}
</script>

<style scoped>
.heatmap-card {
  padding: 1.25rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 1rem;
  //background: var(--vp-c-bg-soft);
  display: flex;
  justify-content: center;
}

.heatmap-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.heatmap-title {
  margin: 0;
  border: 0;
  padding: 0;
  font-size: 1rem;
  font-weight: 600;
}

.heatmap-summary {
  margin: 0.2rem 0 0;
  color: var(--vp-c-text-2);
  font-size: 0.8rem;
}

.heatmap-legend {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  color: var(--vp-c-text-3);
  font-size: 0.7rem;
}

.heatmap-legend i, .heatmap-cell {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--vp-c-text-3) 12%, var(--vp-c-bg));
}

.heatmap-tooltip {
  position: fixed;
  z-index: 100;
  max-width: 240px;
  padding: 7px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 7px;
  color: var(--vp-c-bg);
  background: var(--vp-c-text-1);
  box-shadow: var(--vp-shadow-3);
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
}
.heatmap-scroll {
  overflow-x: auto;
  padding-bottom: 0.35rem;
  scrollbar-width: thin;
}

.heatmap-scroll:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 4px;
}

.month-row {
  display: grid;
  grid-template-columns: 24px repeat(53, 11px);
  gap: 4px;
  width: max-content;
  height: 24px;
  color: var(--vp-c-text-3);
  font-size: 0.7rem;
}

.month-label {
  overflow: visible;
  white-space: nowrap;
}

.heatmap-body {
  display: flex;
  width: max-content;
  gap: 4px;
}

.weekday-labels {
  display: grid;
  width: 16px;
  grid-template-rows: repeat(7, 11px);
  gap: 4px;
  color: var(--vp-c-text-3);
  font-size: 0.65rem;
  line-height: 11px;
}

.heatmap-grid {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(7, 11px);
  grid-auto-columns: 11px;
  gap: 4px;
}

.heatmap-cell {
  display: block;
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 55%, transparent);
}

.level-1 {
  background: color-mix(in srgb, var(--vp-c-brand-1) 28%, var(--vp-c-bg));
}

.level-2 {
  background: color-mix(in srgb, var(--vp-c-brand-1) 48%, var(--vp-c-bg));
}

.level-3 {
  background: color-mix(in srgb, var(--vp-c-brand-1) 72%, var(--vp-c-bg));
}

.level-4 {
  background: var(--vp-c-brand-1);
}

.archive-year {
  margin-bottom: 2rem;
}

.year-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--vp-c-brand-soft);
}

.archive-item {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.5rem 0;
}

.archive-date {
  flex-shrink: 0;
  font-size: 0.85rem;
  color: var(--vp-c-text-3);
  font-family: monospace;
  min-width: 3.5rem;
}

.archive-link {
  text-decoration: none;
  color: var(--vp-c-text-1);
  font-size: 1rem;
  flex-shrink: 0;
  max-width: 60%;
}

.archive-link:hover {
  color: var(--vp-c-brand-1);
}

.archive-category {
  font-size: 0.75rem;
  padding: 0.1rem 0.5rem;
  border-radius: 99px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  flex-shrink: 0;
}

.archive-tags {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.archive-tags .tag {
  font-size: 0.7rem;
  padding: 0.05rem 0.5rem;
  border-radius: 99px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-3);
}

.empty {
  text-align: center;
  color: var(--vp-c-text-3);
  padding: 3rem 0;
}

@media (max-width: 640px) {
  .heatmap-card {
    margin-right: -0.5rem;
    margin-left: -0.5rem;
    padding: 1rem;
  }

  .heatmap-header {
    flex-direction: column;
  }
}
</style>
