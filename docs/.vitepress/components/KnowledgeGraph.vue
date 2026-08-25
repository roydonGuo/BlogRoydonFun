<template>
  <section class="knowledge-graph">
    <div class="toolbar">
      <label class="search"><span>⌕</span><input v-model.trim="query" type="search" placeholder="搜索文章或标签"
                                                 aria-label="搜索文章或标签"></label>
      <div class="category-picker" @focusout="closeCategoryOnBlur" @keydown.down.prevent="moveCategory(1)"
           @keydown.up.prevent="moveCategory(-1)" @keydown.esc.prevent="categoryOpen = false"
           @keydown.enter.prevent="confirmCategory">
        <button class="category-select" type="button" aria-haspopup="listbox" :aria-expanded="categoryOpen"
                @click="toggleCategory">
          <span class="category-select-icon" aria-hidden="true"><i/></span>
          <span class="category-select-copy"><small>文章分类</small><b>{{ category || '全部分类' }}</b></span>
          <svg aria-hidden="true" viewBox="0 0 20 20" :class="{ open: categoryOpen }">
            <path d="m6 8 4 4 4-4"/>
          </svg>
        </button>
        <Transition name="category-menu">
          <div v-if="categoryOpen" class="category-menu" role="listbox" aria-label="文章分类">
            <button v-for="(item, index) in categoryOptions" :key="item || 'all'" type="button" role="option"
                    class="category-option"
                    :class="{ selected: category === item, active: activeCategoryIndex === index }"
                    :aria-selected="category === item" @mouseenter="activeCategoryIndex = index"
                    @click="selectCategory(item)">
              <span class="category-option-dot" aria-hidden="true"/>
              <span class="category-option-copy"><b>{{
                  item || '全部分类'
                }}</b><small>{{ item ? categoryCount(item) : posts.length }} 篇文章</small></span>
              <svg v-if="category === item" aria-hidden="true" viewBox="0 0 20 20">
                <path d="m5 10 3 3 7-7"/>
              </svg>
            </button>
          </div>
        </Transition>
      </div>
      <button type="button" @click="resetView">重置视图</button>
    </div>
    <div class="stats"><span><b>{{ articleCount }}</b> 篇文章</span><span><b>{{
        tagCount
      }}</b> 个标签</span><span><b>{{ activeLinks.length }}</b> 条关联</span></div>
    <div ref="stage" class="stage">
      <canvas ref="canvas" aria-label="文章知识图谱。拖拽探索，滚轮缩放，点击文章节点阅读。" @pointerdown="pointerDown"
              @pointermove="pointerMove" @pointerup="pointerUp" @pointerleave="pointerUp" @wheel.prevent="wheel"/>
      <div v-if="hovered" class="tip" :style="{ left: `${pointer.x + 14}px`, top: `${pointer.y + 14}px` }"><b>{{
          hovered.label
        }}</b><small>{{
          hovered.type === 'article' ? `${hovered.category} · 点击阅读` : hovered.type === 'category' ? '文章分类' : '文章标签'
        }}</small></div>
      <div v-if="!articleCount" class="empty">没有匹配的文章</div>
      <div class="help">拖拽探索 · 滚轮缩放 · 点击文章阅读</div>
    </div>
    <div class="legend"><span><i class="article"/>文章</span><span><i class="category"/>分类</span><span><i
        class="tag"/>标签</span></div>
  </section>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import {useRouter} from 'vitepress'
import {data as posts} from '../../posts/posts.data'

type NodeType = 'article' | 'category' | 'tag'

interface Node {
  id: string;
  label: string;
  type: NodeType;
  url?: string;
  category?: string;
  x: number;
  y: number;
  vx: number;
  vy: number
}

interface Link {
  source: string;
  target: string
}

const canvas = ref<HTMLCanvasElement>()
const stage = ref<HTMLElement>()
const query = ref('')
const category = ref('')
const categoryOpen = ref(false)
const activeCategoryIndex = ref(0)
const hovered = ref<Node | null>(null)
const pointer = ref({x: 0, y: 0})
const router = useRouter()
const categories = [...new Set(posts.map(post => post.category))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
const categoryOptions = ['', ...categories]
const colors = {article: '#2445eb', category: '#f59e0b', tag: '#14b8a6'}
let nodes: Node[] = [], links: Link[] = [], frame = 0, observer: ResizeObserver | undefined
// 图数据在 mounted 后一次性生成，用版本号通知依赖它的计算属性重新求值。
const graphVersion = ref(0)
let width = 0, height = 0, scale = 1, offsetX = 0, offsetY = 0
let dragged: Node | null = null, panning = false, moved = false, last = {x: 0, y: 0}

const filteredPosts = computed(() => {
  const keyword = query.value.toLocaleLowerCase('zh-CN')
  return posts.filter(post => (!category.value || post.category === category.value) && (!keyword || `${post.title} ${post.category} ${post.tags.join(' ')}`.toLocaleLowerCase('zh-CN').includes(keyword)))
})
const activeIds = computed(() => {
  const ids = new Set<string>()
  filteredPosts.value.forEach(post => {
    ids.add(`a:${post.url}`);
    ids.add(`c:${post.category}`);
    post.tags.forEach(tag => ids.add(`t:${tag}`))
  })
  return ids
})
const activeNodes = computed(() => {
  graphVersion.value;
  return nodes.filter(node => activeIds.value.has(node.id))
})
const activeLinks = computed(() => {
  graphVersion.value;
  return links.filter(link => activeIds.value.has(link.source) && activeIds.value.has(link.target))
})
const articleCount = computed(() => activeNodes.value.filter(node => node.type === 'article').length)
const tagCount = computed(() => activeNodes.value.filter(node => node.type === 'tag').length)

function buildGraph() {
  const map = new Map<string, Node>()
  const add = (id: string, label: string, type: NodeType, extra: Partial<Node> = {}) => {
    if (map.has(id)) return
    // 黄金角初始排布是确定性的，避免页面刷新时节点随机跳变。
    const angle = map.size * 2.399963, radius = 70 + map.size % 8 * 18
    map.set(id, {id, label, type, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0, ...extra})
  }
  posts.forEach(post => {
    const article = `a:${post.url}`, group = `c:${post.category}`
    add(article, post.title, 'article', {url: post.url, category: post.category});
    add(group, post.category, 'category');
    links.push({source: article, target: group})
    post.tags.forEach(tag => {
      const id = `t:${tag}`;
      add(id, tag, 'tag');
      links.push({source: article, target: id})
    })
  })
  nodes = [...map.values()]
  graphVersion.value++
}

function resize() {
  if (!canvas.value || !stage.value) return
  const rect = stage.value.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2)
  width = rect.width;
  height = rect.height;
  canvas.value.width = width * ratio;
  canvas.value.height = height * ratio
  canvas.value.style.width = `${width}px`;
  canvas.value.style.height = `${height}px`;
  canvas.value.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0)
}

function simulate() {
  const list = activeNodes.value, byId = new Map(list.map(node => [node.id, node]))
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    a.vx -= a.x * .00035;
    a.vy -= a.y * .00035
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j], dx = b.x - a.x, dy = b.y - a.y, d2 = Math.max(dx * dx + dy * dy, 100), d = Math.sqrt(d2),
          f = 250 / d2
      a.vx -= dx / d * f;
      a.vy -= dy / d * f;
      b.vx += dx / d * f;
      b.vy += dy / d * f
    }
  }
  activeLinks.value.forEach(link => {
    const a = byId.get(link.source), b = byId.get(link.target);
    if (!a || !b) return
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(Math.hypot(dx, dy), 1), f = (d - 96) * .0014
    a.vx += dx / d * f;
    a.vy += dy / d * f;
    b.vx -= dx / d * f;
    b.vy -= dy / d * f
  })
  list.forEach(node => {
    if (node === dragged) return;
    node.vx *= .9;
    node.vy *= .9;
    node.x += node.vx;
    node.y += node.vy
  })
}

function draw() {
  const ctx = canvas.value?.getContext('2d');
  if (!ctx) return
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
  ctx.scale(scale, scale)
  const byId = new Map(activeNodes.value.map(node => [node.id, node]));
  ctx.strokeStyle = css('--vp-c-divider', '#d8dee9');
  ctx.lineWidth = 1 / scale;
  ctx.globalAlpha = .55
  activeLinks.value.forEach(link => {
    const a = byId.get(link.source), b = byId.get(link.target);
    if (!a || !b) return;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke()
  })
  ctx.globalAlpha = 1
  activeNodes.value.forEach(node => {
    const r = radius(node);
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = colors[node.type];
    ctx.fill()
    if (node === hovered.value) {
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = css('--vp-c-bg', '#fff');
      ctx.stroke()
    }
    if (scale >= .72 || node.type !== 'tag') {
      ctx.font = `${node.type === 'article' ? 600 : 500} ${node.type === 'article' ? 12 : 11}px PingFang,sans-serif`;
      ctx.fillStyle = css('--vp-c-text-1', '#1b1b1f');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(short(node.label, node.type === 'article' ? 18 : 12), node.x, node.y + r + 5, 150)
    }
  })
  ctx.restore()
}

function animate() {
  simulate();
  draw();
  frame = requestAnimationFrame(animate)
}

function canvasPoint(event: PointerEvent | WheelEvent) {
  const rect = canvas.value!.getBoundingClientRect();
  return {x: event.clientX - rect.left, y: event.clientY - rect.top}
}

function graphPoint(point: { x: number; y: number }) {
  return {x: (point.x - width / 2 - offsetX) / scale, y: (point.y - height / 2 - offsetY) / scale}
}

function findNode(point: { x: number; y: number }) {
  const p = graphPoint(point);
  return [...activeNodes.value].reverse().find(node => Math.hypot(node.x - p.x, node.y - p.y) <= radius(node) + 5 / scale) || null
}

function pointerDown(event: PointerEvent) {
  const p = canvasPoint(event);
  dragged = findNode(p);
  panning = !dragged;
  moved = false;
  last = p;
  canvas.value?.setPointerCapture(event.pointerId)
}

function pointerMove(event: PointerEvent) {
  const p = canvasPoint(event);
  pointer.value = p;
  hovered.value = findNode(p);
  if (!dragged && !panning) return
  const dx = p.x - last.x, dy = p.y - last.y;
  moved ||= Math.abs(dx) + Math.abs(dy) > 2
  if (dragged) {
    const target = graphPoint(p);
    dragged.x = target.x;
    dragged.y = target.y;
    dragged.vx = dragged.vy = 0
  } else {
    offsetX += dx;
    offsetY += dy
  }
  last = p
}

function pointerUp() {
  if (dragged && !moved && dragged.type === 'article' && dragged.url) router.go(dragged.url);
  dragged = null;
  panning = false
}

function wheel(event: WheelEvent) {
  const p = canvasPoint(event), before = graphPoint(p);
  scale = Math.min(2.6, Math.max(.42, scale * Math.exp(-event.deltaY * .001)));
  offsetX = p.x - width / 2 - before.x * scale;
  offsetY = p.y - height / 2 - before.y * scale
}

function toggleCategory() {
  categoryOpen.value = !categoryOpen.value
  activeCategoryIndex.value = Math.max(0, categoryOptions.indexOf(category.value))
}

function selectCategory(value: string) {
  category.value = value;
  categoryOpen.value = false
}

function moveCategory(step: number) {
  if (!categoryOpen.value) {
    categoryOpen.value = true;
    return
  }
  activeCategoryIndex.value = (activeCategoryIndex.value + step + categoryOptions.length) % categoryOptions.length
}

function confirmCategory() {
  categoryOpen.value ? selectCategory(categoryOptions[activeCategoryIndex.value]) : toggleCategory()
}

function closeCategoryOnBlur(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as globalThis.Node | null)) categoryOpen.value = false
}

function categoryCount(value: string) {
  return posts.filter(post => post.category === value).length
}

function resetView() {
  scale = 1;
  offsetX = offsetY = 0;
  nodes.forEach((node, i) => {
    const angle = i * 2.399963, r = 70 + i % 8 * 18;
    node.x = Math.cos(angle) * r;
    node.y = Math.sin(angle) * r;
    node.vx = node.vy = 0
  })
}

function radius(node: Node) {
  return node.type === 'article' ? 7 : node.type === 'category' ? 10 : 5
}

function short(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function css(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

watch([query, category], () => {
  hovered.value = null;
  resetView()
})
onMounted(() => {
  buildGraph();
  observer = new ResizeObserver(resize);
  observer.observe(stage.value!);
  resize();
  animate()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  observer?.disconnect()
})
</script>

<style scoped>
.knowledge-graph {
  margin: 0 auto;
  max-width: 1180px
}

.toolbar {
  display: grid;
  grid-template-columns:minmax(220px, 1fr) 180px auto;
  gap: 10px;
  margin-bottom: 12px
}

.search {
  position: relative
}

.search span {
  position: absolute;
  top: 7px;
  left: 13px;
  color: var(--vp-c-text-3);
  font-size: 24px
}

.toolbar input, .toolbar select, .toolbar button {
  height: 42px;
  border: 1px solid var(--vp-c-border-1);
  border-radius: 10px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit
}

.toolbar input {
  width: 100%;
  padding: 0 14px 0 40px
}

.toolbar select {
  padding: 0 12px
}

.toolbar button {
  padding: 0 16px;
  color: var(--vp-c-brand-1);
  cursor: pointer
}

.toolbar input:focus, .toolbar select:focus, .toolbar button:focus-visible {
  border-color: var(--vp-c-brand-1);
  outline: 3px solid var(--vp-c-brand-soft)
}

.stats {
  display: flex;
  gap: 20px;
  margin: 0 2px 12px;
  color: var(--vp-c-text-3);
  font-size: 13px
}

.stats b {
  color: var(--vp-c-text-1);
  font-size: 15px
}

.stage {
  position: relative;
  height: min(68vh, 720px);
  min-height: 500px;
  overflow: hidden;
  border: 1px solid var(--vp-c-border-1);
  border-radius: 18px;
  background-color: var(--vp-c-bg-soft);
  background-image: radial-gradient(var(--vp-c-divider) .75px, transparent .75px);
  background-size: 18px 18px;
  box-shadow: 0 18px 50px rgba(36, 69, 235, .07)
}

canvas {
  display: block;
  cursor: grab;
  touch-action: none
}

canvas:active {
  cursor: grabbing
}

.tip {
  position: absolute;
  z-index: 2;
  display: flex;
  max-width: 280px;
  flex-direction: column;
  gap: 3px;
  padding: 9px 12px;
  border: 1px solid var(--vp-c-border-1);
  border-radius: 9px;
  background: var(--vp-c-bg);
  box-shadow: var(--vp-shadow-3);
  pointer-events: none
}

.tip b {
  color: var(--vp-c-text-1);
  font-size: 13px
}

.tip small, .help {
  color: var(--vp-c-text-3);
  font-size: 11px
}

.help {
  position: absolute;
  right: 14px;
  bottom: 12px;
  padding: 5px 9px;
  border-radius: 6px;
  background: var(--vp-c-bg);
  opacity: .8;
  pointer-events: none
}

.empty {
  position: absolute;
  top: 50%;
  left: 50%;
  color: var(--vp-c-text-3);
  transform: translate(-50%, -50%)
}

.legend {
  display: flex;
  justify-content: center;
  gap: 22px;
  padding: 16px 0 0;
  color: var(--vp-c-text-2);
  font-size: 13px
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 7px
}

.legend i {
  width: 9px;
  height: 9px;
  border-radius: 50%
}

.legend .article {
  background: #2445eb
}

.legend .category {
  background: #f59e0b
}

.legend .tag {
  background: #14b8a6
}

.category-select {
  position: relative;
  display: grid;
  height: 42px;
  grid-template-columns:34px 1fr 18px;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border: 1px solid var(--vp-c-border-1);
  border-radius: 12px;
  background: linear-gradient(135deg, var(--vp-c-bg), var(--vp-c-bg-soft));
  box-shadow: 0 1px 2px rgba(36, 69, 235, .04);
  cursor: pointer;
  transition: border-color .2s, box-shadow .2s, transform .2s
}

.category-select:hover {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 40%, var(--vp-c-border-1));
  box-shadow: 0 6px 18px rgba(36, 69, 235, .09);
  transform: translateY(-1px)
}

.category-select:focus-within {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 0 0 3px var(--vp-c-brand-soft)
}

.category-select-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 9px;
  background: linear-gradient(135deg, rgba(245, 158, 11, .18), rgba(245, 158, 11, .07))
}

.category-select-icon i {
  width: 9px;
  height: 9px;
  border: 2px solid #f59e0b;
  border-radius: 50%;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, .12)
}

.category-select-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  line-height: 1.05
}

.category-select-copy small {
  color: var(--vp-c-text-3);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: .08em
}

.category-select-copy b {
  overflow: hidden;
  margin-top: 4px;
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap
}

.category-select svg {
  width: 18px;
  fill: none;
  stroke: var(--vp-c-text-3);
  stroke-width: 1.8;
  transition: transform .2s
}

.category-select:hover svg {
  stroke: var(--vp-c-brand-1);
  transform: translateY(1px)
}

.category-select select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer
}

.category-select select:focus {
  outline: 0
}

.category-picker {
  position: relative;
  z-index: 4
}

.category-picker > .category-select {
  width: 100%;
  padding: 0 10px;
  text-align: left
}

.category-select svg.open {
  transform: rotate(180deg)
}

.category-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 9px);
  left: 0;
  width: max(100%, 220px);
  padding: 7px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 18%, var(--vp-c-border-1));
  border-radius: 14px;
  background: color-mix(in srgb, var(--vp-c-bg) 96%, transparent);
  box-shadow: 0 18px 45px rgba(15, 23, 42, .16), 0 3px 12px rgba(36, 69, 235, .08);
  backdrop-filter: blur(18px)
}

.toolbar .category-option {
  display: grid;
  width: 100%;
  height: auto;
  min-height: 48px;
  grid-template-columns:12px 1fr 18px;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--vp-c-text-1);
  text-align: left;
  cursor: pointer;
  transition: background .15s, color .15s, transform .15s
}

.toolbar .category-option:hover, .toolbar .category-option.active {
  background: var(--vp-c-bg-soft);
  transform: translateX(2px)
}

.toolbar .category-option.selected {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1)
}

.category-option-dot {
  width: 8px;
  height: 8px;
  border: 2px solid #f59e0b;
  border-radius: 50%;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, .1)
}

.category-option-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.category-option-copy b {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap
}

.category-option-copy small {
  color: var(--vp-c-text-3);
  font-size: 10px;
  line-height: 1.25;
}

.category-option svg {
  width: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2
}

.category-menu-enter-active, .category-menu-leave-active {
  transition: opacity .16s ease, transform .16s ease
}

.category-menu-enter-from, .category-menu-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(.98)
}

@media (max-width: 640px) {
  .toolbar {
    grid-template-columns:1fr 1fr
  }

  .search {
    grid-column: 1/-1
  }

  .stats {
    justify-content: space-between;
    gap: 8px
  }

  .stage {
    height: 62vh;
    min-height: 430px;
    border-radius: 14px
  }

  .help {
    display: none
  }
}
</style>
