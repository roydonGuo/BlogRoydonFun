<template>
  <section class="knowledge-graph knowledge-graph-shell">
    <aside class="graph-sidebar" aria-label="知识图谱筛选">
      <div class="graph-sidebar-orb" aria-hidden="true"/>
      <div class="graph-sidebar-content">
        <p class="graph-eyebrow"><span aria-hidden="true"/>KNOWLEDGE CONSTELLATION · {{ currentYear }}</p>
        <h1 class="graph-title">在文章之间<br>发现连接<span>。</span></h1>
        <p class="graph-description">每篇文章都是一个节点，分类与标签把散落的思考连接成一张持续生长的知识网络。</p>

        <dl class="graph-stats" aria-label="知识图谱统计">
          <div><dt>{{ articleCount }}</dt><dd>篇文章</dd></div>
          <div><dt>{{ tagCount }}</dt><dd>个标签</dd></div>
          <div><dt>{{ activeLinks.length }}</dt><dd>条关联</dd></div>
        </dl>

        <label class="graph-search">
          <span aria-hidden="true">⌕</span>
          <input v-model.trim="query" type="search" placeholder="搜索文章或标签" aria-label="搜索文章或标签">
        </label>

        <div class="graph-filter-section">
          <p>EXPLORE BY CATEGORY</p>
          <div class="graph-category-list" role="group" aria-label="文章分类筛选">
            <button
                v-for="item in categoryOptions"
                :key="item || 'all'"
                type="button"
                :class="{ selected: category === item }"
                :aria-pressed="category === item"
                @click="selectCategory(item)"
            >{{ item || '全部' }} {{ item ? categoryCount(item) : posts.length }}
            </button>
          </div>
        </div>

        <div class="legend graph-sidebar-legend"><span><i class="article"/>文章</span><span><i
            class="category"/>分类</span><span><i class="tag"/>标签</span><span><i
            class="relation-line category-link"/>文章—分类</span><span><i
            class="relation-line tag-link"/>文章—标签</span></div>
      </div>
    </aside>

    <section class="graph-workspace" aria-label="文章知识图谱">
      <header class="graph-workspace-header">
        <p>KNOWLEDGE SIGNALS</p>
        <button type="button" @click="resetView">重置视图</button>
      </header>

      <div ref="stage" class="stage graph-stage">
        <canvas ref="canvas" aria-label="文章知识图谱。拖拽探索，滚轮缩放，点击文章节点阅读。" @pointerdown="pointerDown"
                @pointermove="pointerMove" @pointerup="pointerUp" @pointerleave="pointerLeave" @wheel.prevent="wheel"/>
        <div v-if="hovered" class="tip" :style="{ left: `${pointer.x + 14}px`, top: `${pointer.y + 14}px` }"><b>{{
            hovered.label
          }}</b><small>{{
            hovered.type === 'article' ? `${hovered.category} · 点击阅读` : hovered.type === 'category' ? '文章分类' : '文章标签'
          }}</small></div>
        <div v-if="!articleCount" class="empty">没有匹配的文章</div>
        <div class="help">悬停查看关联 · 拖拽探索 · 滚轮缩放 · 点击文章阅读</div>
      </div>
    </section>
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
const hovered = ref<Node | null>(null)
const pointer = ref({x: 0, y: 0})
const router = useRouter()
const currentYear = new Date().getFullYear()
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
  const dark = document.documentElement.classList.contains('dark')
  const linkColors = dark
      ? {category: '#fbbf24', tag: '#2dd4bf'}
      : {category: '#d97706', tag: '#0f9f91'}
  const highlightedNodeId = hovered.value?.id
  ctx.lineCap = 'round'
  activeLinks.value.forEach(link => {
    const a = byId.get(link.source), b = byId.get(link.target);
    if (!a || !b) return;
    const relationType = b.type === 'category' ? 'category' : 'tag'
    const highlighted = Boolean(highlightedNodeId)
        && (link.source === highlightedNodeId || link.target === highlightedNodeId)
    const hasHoveredNode = Boolean(highlightedNodeId)
    ctx.strokeStyle = linkColors[relationType]
    ctx.globalAlpha = hasHoveredNode
        ? (highlighted ? 1 : .12)
        : (relationType === 'category' ? (dark ? .84 : .74) : (dark ? .62 : .52))
    ctx.lineWidth = (highlighted ? 2.8 : relationType === 'category' ? 1.55 : 1.15) / scale
    ctx.shadowColor = highlighted ? linkColors[relationType] : 'transparent'
    ctx.shadowBlur = highlighted ? 8 / scale : 0
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke()
  })
  ctx.globalAlpha = 1;
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0
  const textColor = css('--vp-c-text-1', '#1b1b1f')
  const hoverOutline = css('--vp-c-bg', '#fff')
  activeNodes.value.forEach(node => {
    const r = radius(node);
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = colors[node.type];
    ctx.fill()
    if (node === hovered.value) {
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = hoverOutline;
      ctx.stroke()
    }
    if (scale >= .72 || node.type !== 'tag') {
      ctx.font = `${node.type === 'article' ? 600 : 500} ${node.type === 'article' ? 12 : 11}px PingFang,sans-serif`;
      ctx.fillStyle = textColor;
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

function pointerLeave() {
  dragged = null;
  panning = false;
  hovered.value = null
}

function wheel(event: WheelEvent) {
  const p = canvasPoint(event), before = graphPoint(p);
  scale = Math.min(2.6, Math.max(.42, scale * Math.exp(-event.deltaY * .001)));
  offsetX = p.x - width / 2 - before.x * scale;
  offsetY = p.y - height / 2 - before.y * scale
}

function selectCategory(value: string) {
  category.value = value
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
  document.body.classList.add('knowledge-graph-page-active')
  buildGraph();
  observer = new ResizeObserver(resize);
  observer.observe(stage.value!);
  resize();
  animate()
})
onBeforeUnmount(() => {
  document.body.classList.remove('knowledge-graph-page-active')
  cancelAnimationFrame(frame);
  observer?.disconnect()
})
</script>

<style scoped>
:global(body.knowledge-graph-page-active .VPFooter) {
  display: none;
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
  flex-wrap: wrap;
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

.legend .relation-line {
  width: 22px;
  height: 3px;
  border-radius: 999px
}

.legend .category-link {
  background: #d97706;
  box-shadow: 0 0 7px rgba(217, 119, 6, .25)
}

.legend .tag-link {
  height: 2px;
  background: #0f9f91;
  box-shadow: 0 0 7px rgba(15, 159, 145, .22)
}

/* 复用项目页的全屏工作台结构：左侧负责信息与筛选，右侧专注图谱探索。 */
.knowledge-graph-shell {
  position: fixed;
  z-index: 20;
  inset: var(--vp-nav-height) 0 0;
  display: grid;
  width: auto;
  max-width: none;
  grid-template-columns: 340px minmax(0, 1fr);
  margin: 0;
  overflow: hidden;
  border-top: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
}

.graph-sidebar {
  position: relative;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  border-right: 1px solid color-mix(in srgb, var(--vp-c-text-1) 10%, transparent);
  background: transparent;
}

.graph-sidebar-orb {
  position: absolute;
  top: 30px;
  left: -86px;
  width: 230px;
  height: 230px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--vp-c-brand-1) 24%, transparent);
  filter: blur(58px);
  pointer-events: none;
}

.graph-sidebar-content {
  position: relative;
  z-index: 1;
  height: 100%;
  padding: 32px 38px 26px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.graph-eyebrow {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0 0 18px;
  color: var(--vp-c-text-1);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .18em;
}

.graph-eyebrow span {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 0 5px var(--vp-c-brand-soft);
}

.graph-title {
  margin: 0;
  border: 0;
  font-size: 44px;
  font-weight: 900;
  letter-spacing: -.065em;
  line-height: 1.02;
}

.graph-title span {
  color: var(--vp-c-brand-1);
}

.graph-description {
  max-width: 240px;
  margin: 18px 0 0;
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.75;
  opacity: .68;
}

.graph-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin: 26px 0 0;
}

.graph-stats div {
  min-width: 0;
}

.graph-stats dt {
  color: var(--vp-c-text-1);
  font-size: 24px;
  font-weight: 900;
  line-height: 1;
}

.graph-stats dd {
  margin: 7px 0 0;
  color: var(--vp-c-text-3);
  font-size: 10px;
  font-weight: 700;
}

.graph-search {
  position: relative;
  display: block;
  margin-top: 26px;
}

.graph-search > span {
  position: absolute;
  top: 50%;
  left: 13px;
  color: var(--vp-c-text-3);
  font-size: 22px;
  transform: translateY(-54%);
  pointer-events: none;
}

.graph-search input {
  width: 100%;
  height: 42px;
  padding: 0 13px 0 39px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  outline: 0;
  background: color-mix(in srgb, var(--vp-c-bg) 82%, transparent);
  color: var(--vp-c-text-1);
  font: inherit;
  font-size: 12px;
  transition: border-color .2s ease, box-shadow .2s ease, background-color .2s ease;
}

.graph-search input:focus {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg);
  box-shadow: 0 0 0 3px var(--vp-c-brand-soft);
}

.graph-filter-section {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid color-mix(in srgb, var(--vp-c-text-1) 10%, transparent);
}

.graph-filter-section > p {
  margin: 0 0 11px;
  color: var(--vp-c-text-3);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .16em;
}

.graph-category-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.graph-category-list button {
  display: inline-flex;
  min-height: 0;
  align-items: center;
  justify-content: center;
  width: auto;
  padding: 5px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
  white-space: nowrap;
  cursor: pointer;
  transition: color .2s ease, background-color .2s ease, border-color .2s ease, transform .2s ease;
}

.graph-category-list button:hover {
  border-color: var(--vp-c-text-1);
  transform: translateY(-2px);
}

.graph-category-list button:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.graph-category-list button.selected {
  border-color: var(--vp-c-text-1);
  background: var(--vp-c-text-1);
  color: var(--vp-c-bg);
}

.graph-sidebar-legend {
  justify-content: flex-start;
  gap: 10px 16px;
  padding-top: 22px;
  font-size: 11px;
}

.graph-workspace {
  display: grid;
  min-width: 0;
  height: 100%;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 16px;
  padding: 22px clamp(22px, 3vw, 48px) 28px;
  overflow: hidden;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 54%, transparent);
}

.graph-workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.graph-workspace-header p {
  margin: 0;
  color: var(--vp-c-text-3);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .2em;
}

.graph-workspace-header button {
  min-width: 104px;
  height: 38px;
  padding: 0 17px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: color-mix(in srgb, var(--vp-c-bg) 76%, transparent);
  color: var(--vp-c-brand-1);
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  transition: border-color .2s ease, transform .2s ease, background-color .2s ease;
}

.graph-workspace-header button:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg);
  transform: translateY(-2px);
}

.graph-workspace-header button:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 3px;
}

.graph-stage {
  width: 100%;
  height: 100%;
  min-height: 0;
  border-radius: 24px;
  background-color: color-mix(in srgb, var(--vp-c-bg) 10%, transparent);
  box-shadow: 0 18px 50px color-mix(in srgb, var(--vp-c-brand-1) 8%, transparent);
}

@media (max-width: 980px) {
  .knowledge-graph-shell {
    grid-template-columns: 300px minmax(0, 1fr);
  }

  .graph-sidebar-content {
    padding-inline: 26px;
  }

  .graph-title {
    font-size: 38px;
  }
}

@media (max-width: 760px) {
  .knowledge-graph-shell {
    display: block;
    overflow-y: auto;
  }

  .graph-sidebar {
    height: auto;
    overflow: visible;
    border-right: 0;
    border-bottom: 1px solid var(--vp-c-divider);
  }

  .graph-sidebar-content {
    height: auto;
    padding: 30px 22px 26px;
    overflow: visible;
  }

  .graph-title {
    font-size: 40px;
  }

  .graph-description {
    max-width: 480px;
  }

  .graph-stats {
    max-width: 360px;
  }

  .graph-workspace {
    height: max(680px, calc(100svh - var(--vp-nav-height)));
    padding: 24px 16px 28px;
    overflow: visible;
  }

  .graph-workspace-header {
    align-items: center;
  }

  .graph-stage {
    height: 100%;
    min-height: 480px;
    border-radius: 18px;
  }

  .help {
    display: none;
  }
}

@media (max-width: 440px) {
  .graph-workspace-header button {
    min-width: auto;
    padding-inline: 13px;
  }
}
</style>
