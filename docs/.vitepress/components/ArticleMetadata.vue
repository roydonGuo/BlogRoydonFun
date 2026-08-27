<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from 'vue'
import {useData} from 'vitepress'

const {page} = useData()
const wordCount = ref(0)
const statsReady = ref(false)
const tagList = ref<HTMLElement>()
const draggingTags = ref(false)
let tagPointerId: number | undefined
let tagDragStartX = 0
let tagDragStartScroll = 0

const visible = computed(() => {
  const path = page.value.relativePath.replace(/\\/g, '/')
  return path.startsWith('posts/') && path !== 'posts/index.md'
})

const category = computed(() => String(page.value.frontmatter.category || '未分类'))
const tags = computed(() => {
  const value = page.value.frontmatter.tags
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean)
  return []
})

function seededPublishedTime(seedSource: string): [string, string, string] {
  let seed = 2166136261
  for (const character of seedSource) {
    seed ^= character.charCodeAt(0)
    seed = Math.imul(seed, 16777619)
  }
  seed >>>= 0
  const hour = 8 + seed % 15
  const minute = Math.floor(seed / 15) % 60
  const second = Math.floor(seed / 900) % 60
  return [hour, minute, second].map(value => String(value).padStart(2, '0')) as [string, string, string]
}

function formatPublishedAt(value: unknown, seedSource: string): string {
  if (!value) return '未标注'
  const raw = String(value).trim()
  const matched = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (matched) {
    const [, year, month, day, matchedHour, matchedMinute, matchedSecond] = matched
    const [randomHour, randomMinute, randomSecond] = seededPublishedTime(`${seedSource}:${year}-${month}-${day}`)
    const hour = matchedHour ?? randomHour
    const minute = matchedMinute ?? randomMinute
    const second = matchedSecond ?? randomSecond
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`
  }
  return raw
}

const publishedAt = computed(() => {
  return formatPublishedAt(page.value.frontmatter.date, page.value.relativePath)
})
const readingMinutes = computed(() => Math.max(1, Math.ceil(wordCount.value / 300)))

function scrollTags(event: WheelEvent) {
  const list = tagList.value
  if (!list || list.scrollWidth <= list.clientWidth) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  const nextScroll = Math.max(0, Math.min(list.scrollWidth - list.clientWidth, list.scrollLeft + delta))
  if (nextScroll === list.scrollLeft) return
  event.preventDefault()
  list.scrollLeft = nextScroll
}

function startTagDrag(event: PointerEvent) {
  const list = tagList.value
  if (!list || event.button !== 0 || list.scrollWidth <= list.clientWidth) return
  tagPointerId = event.pointerId
  tagDragStartX = event.clientX
  tagDragStartScroll = list.scrollLeft
  list.setPointerCapture(event.pointerId)
}

function dragTags(event: PointerEvent) {
  const list = tagList.value
  if (!list || event.pointerId !== tagPointerId) return
  const distance = tagDragStartX - event.clientX
  if (Math.abs(distance) > 3) draggingTags.value = true
  if (!draggingTags.value) return
  event.preventDefault()
  list.scrollLeft = tagDragStartScroll + distance
}

function stopTagDrag(event: PointerEvent) {
  const list = tagList.value
  if (!list || event.pointerId !== tagPointerId) return
  if (list.hasPointerCapture(event.pointerId)) list.releasePointerCapture(event.pointerId)
  tagPointerId = undefined
  draggingTags.value = false
}

function countArticleWords(text: string): number {
  const chineseCharacters = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  const latinWords = text
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, ' ')
    .match(/[a-zA-Z0-9]+(?:['’-][a-zA-Z0-9]+)*/g)?.length ?? 0
  return chineseCharacters + latinWords
}

function updateArticleStats() {
  const article = document.querySelector<HTMLElement>('.VPDoc .vp-doc')
  if (!article) return
  const clone = article.cloneNode(true) as HTMLElement
  clone.querySelectorAll([
    '.article-reader',
    '.article-metadata',
    '.post-prev-next',
    'pre',
    'code',
    'script',
    'style',
    'button',
    '.header-anchor',
    '.footnotes',
  ].join(',')).forEach(node => node.remove())
  wordCount.value = countArticleWords(clone.textContent ?? '')
  statsReady.value = true
}

async function refreshArticleStats() {
  statsReady.value = false
  await nextTick()
  window.requestAnimationFrame(updateArticleStats)
}

onMounted(refreshArticleStats)
watch(() => page.value.relativePath, refreshArticleStats)
</script>

<template>
  <aside v-if="visible" class="article-metadata" aria-label="文章元数据">
    <dl>
      <div class="meta-item">
        <dt>发布日期</dt>
        <dd>{{ publishedAt }}</dd>
      </div>
      <div class="meta-item">
        <dt>分类</dt>
        <dd>
          <span class="category-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h4l2 2h6A2.5 2.5 0 0 1 20.5 8.5v8A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z"/>
            </svg>
            {{ category }}
          </span>
        </dd>
      </div>
      <div class="meta-item tags-item">
        <dt>标签</dt>
        <dd v-if="tags.length" ref="tagList" class="tag-list" :class="{'is-dragging': draggingTags}"
            @wheel="scrollTags" @pointerdown="startTagDrag" @pointermove="dragTags"
            @pointerup="stopTagDrag" @pointercancel="stopTagDrag">
          <span v-for="tag in tags" :key="tag"># {{ tag }}</span>
        </dd>
        <dd v-else>暂无标签</dd>
      </div>
      <div class="meta-item stat-item">
        <dt>字数</dt>
        <dd>{{ statsReady ? `${wordCount.toLocaleString('zh-CN')} 字` : '统计中' }}</dd>
      </div>
      <div class="meta-item stat-item">
        <dt>阅读时长</dt>
        <dd>{{ statsReady ? `约 ${readingMinutes} 分钟` : '统计中' }}</dd>
      </div>
    </dl>
  </aside>
</template>

<style scoped>
.article-metadata {
  margin: 0 0 1.5rem;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 14%, var(--vp-c-divider));
  border-radius: 9rem;
  background: transparent;
  box-shadow: 0 8px 20px rgba(15, 23, 42, .05);
  transition: border-color .25s ease, box-shadow .25s ease;
}

.article-metadata:hover {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 30%, var(--vp-c-divider));
  box-shadow: 0 12px 36px rgba(36, 69, 235, .09);
}

.article-metadata dl {
  display: flex;
  flex-wrap: wrap;
  gap: 14px 28px;
  align-items: flex-start;
  margin: 0;
}

.meta-item {
  display: grid;
  flex: 0 0 auto;
  gap: 5px;
  margin: 0;
}

.meta-item dt {
  color: var(--vp-c-text-3);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
}

.meta-item dd {
  margin: 0;
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.6;
}

.tags-item {
  min-width: 180px;
  overflow: hidden;
  flex: 1 1 260px;
}

.tag-list {
  display: flex;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  flex-wrap: nowrap;
  gap: 6px;
  cursor: grab;
  scrollbar-width: none;
  -ms-overflow-style: none;
  overscroll-behavior-inline: contain;
  touch-action: pan-y;
  user-select: none;
}

.tag-list::-webkit-scrollbar {
  display: none;
}

.tag-list.is-dragging {
  cursor: grabbing;
}

.tag-list span,
.category-chip {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  min-height: 24px;
  box-sizing: border-box;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  font-size: 11px;
  font-weight: 650;
}

.tag-list span {
  flex: 0 0 auto;
  white-space: nowrap;
}

.category-chip svg {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
}

.stat-item dd {
  font-variant-numeric: tabular-nums;
}

@media (max-width: 640px) {
  .article-metadata {
    padding: 14px;
  }

  .article-metadata dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .tags-item {
    min-width: 0;
    grid-column: 1 / -1;
  }
}
</style>
