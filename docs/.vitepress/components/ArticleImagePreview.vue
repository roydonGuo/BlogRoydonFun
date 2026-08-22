<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const opened = ref(false)
const imageSrc = ref('')
const imageAlt = ref('')
const scale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const dragging = ref(false)
const MIN_SCALE = 0.5
const MAX_SCALE = 4
const SCALE_STEP = 0.25
let dragStartX = 0
let dragStartY = 0
let dragOriginX = 0
let dragOriginY = 0

const imageTransform = computed(() =>
  `translate3d(${offsetX.value}px, ${offsetY.value}px, 0) scale(${scale.value})`)

function closePreview() {
  opened.value = false
  document.documentElement.classList.remove('image-preview-open')
}

function openPreview(image: HTMLImageElement) {
  imageSrc.value = image.currentSrc || image.src
  imageAlt.value = image.alt
  scale.value = 1
  offsetX.value = 0
  offsetY.value = 0
  opened.value = true
  document.documentElement.classList.add('image-preview-open')
}

function changeScale(nextScale: number) {
  scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(nextScale.toFixed(2))))
  if (scale.value <= 1) {
    offsetX.value = 0
    offsetY.value = 0
  }
}

// 放大后使用 Pointer Events 统一支持鼠标和触摸拖动。
function startDrag(event: PointerEvent) {
  if (scale.value <= 1 || event.button !== 0) return
  dragging.value = true
  dragStartX = event.clientX
  dragStartY = event.clientY
  dragOriginX = offsetX.value
  dragOriginY = offsetY.value
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function moveDrag(event: PointerEvent) {
  if (!dragging.value) return
  offsetX.value = dragOriginX + event.clientX - dragStartX
  offsetY.value = dragOriginY + event.clientY - dragStartY
}

function stopDrag(event: PointerEvent) {
  dragging.value = false
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
}

// 阻止页面滚动，并将滚轮方向映射为大图缩放。
function handleWheel(event: WheelEvent) {
  changeScale(scale.value + (event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP))
}

// 使用事件委托兼容 VitePress 客户端路由切换后动态更新的文章正文。
function handleArticleClick(event: MouseEvent) {
  const image = (event.target as HTMLElement).closest<HTMLImageElement>('.VPDoc .vp-doc img')
  if (!image || image.closest('a')) return
  openPreview(image)
}

function handleKeydown(event: KeyboardEvent) {
  if (opened.value && event.key === 'Escape') closePreview()
}

onMounted(() => {
  document.documentElement.classList.add('article-image-preview-enabled')
  document.addEventListener('click', handleArticleClick)
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleArticleClick)
  document.removeEventListener('keydown', handleKeydown)
  document.documentElement.classList.remove('article-image-preview-enabled', 'image-preview-open')
})
</script>

<template>
  <Teleport to="body">
    <Transition name="image-preview">
      <div v-if="opened" class="image-preview-overlay" role="dialog" aria-modal="true"
           :aria-label="imageAlt ? `查看大图：${imageAlt}` : '查看文章大图'" @click.self="closePreview"
           @wheel.prevent="handleWheel">
        <button type="button" class="image-preview-close" aria-label="关闭大图" @click="closePreview">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 4.9 12 10.6l5.6-5.7 1.5 1.5-5.7 5.6 5.7 5.6-1.5 1.5-5.6-5.7-5.6 5.7-1.5-1.5 5.7-5.6-5.7-5.6z"/></svg>
        </button>
        <img class="image-preview-content" :class="{ 'is-draggable': scale > 1, 'is-dragging': dragging }"
             :src="imageSrc" :alt="imageAlt" :style="{ transform: imageTransform }" draggable="false"
             @click.stop @dblclick.stop="changeScale(scale === 1 ? 2 : 1)"
             @pointerdown.stop="startDrag" @pointermove.stop="moveDrag"
             @pointerup.stop="stopDrag" @pointercancel.stop="stopDrag">
        <div class="image-preview-toolbar" aria-label="图片缩放控制" @click.stop>
          <button type="button" aria-label="缩小图片" :disabled="scale <= MIN_SCALE"
                  @click="changeScale(scale - SCALE_STEP)">−</button>
          <button type="button" class="image-preview-scale" aria-label="恢复图片原始缩放"
                  @click="changeScale(1)">{{ Math.round(scale * 100) }}%</button>
          <button type="button" aria-label="放大图片" :disabled="scale >= MAX_SCALE"
                  @click="changeScale(scale + SCALE_STEP)">+</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
html.article-image-preview-enabled .VPDoc .vp-doc img:not(a img) { cursor: zoom-in; }
html.image-preview-open { overflow: hidden; }
.image-preview-overlay { position: fixed; z-index: 1000; inset: 0; display: grid; overflow: hidden; padding: 56px 24px 72px; place-items: center; background: rgba(8, 12, 24, .88); backdrop-filter: blur(8px); }
.image-preview-content { max-width: min(94vw, 1600px); max-height: calc(100vh - 128px); object-fit: contain; border-radius: 8px; box-shadow: 0 24px 80px rgba(0, 0, 0, .45); cursor: zoom-in; transform-origin: center; transition: transform .18s ease; }
.image-preview-content.is-draggable { cursor: grab; touch-action: none; user-select: none; }
.image-preview-content.is-dragging { cursor: grabbing; transition: none; }
.image-preview-close { position: fixed; z-index: 1; top: 16px; right: 18px; display: grid; width: 40px; height: 40px; padding: 0; place-items: center; border: 1px solid rgba(255, 255, 255, .24); border-radius: 50%; color: #fff; background: rgba(255, 255, 255, .1); cursor: pointer; }
.image-preview-close svg { width: 22px; height: 22px; fill: currentColor; }
.image-preview-toolbar { position: fixed; z-index: 1; bottom: 20px; left: 50%; display: flex; overflow: hidden; border: 1px solid rgba(255, 255, 255, .24); border-radius: 10px; background: rgba(18, 23, 36, .82); box-shadow: 0 8px 30px rgba(0, 0, 0, .24); transform: translateX(-50%); backdrop-filter: blur(10px); }
.image-preview-toolbar button { min-width: 42px; height: 40px; padding: 0 12px; border: 0; border-right: 1px solid rgba(255, 255, 255, .16); color: #fff; background: transparent; font-size: 20px; cursor: pointer; }
.image-preview-toolbar button:last-child { border-right: 0; }
.image-preview-toolbar button:hover:not(:disabled) { background: rgba(255, 255, 255, .12); }
.image-preview-toolbar button:disabled { opacity: .35; cursor: not-allowed; }
.image-preview-toolbar .image-preview-scale { min-width: 72px; font-size: 13px; }
.image-preview-enter-active, .image-preview-leave-active { transition: opacity .2s ease; }
.image-preview-enter-active .image-preview-content, .image-preview-leave-active .image-preview-content { transition: transform .2s ease; }
.image-preview-enter-from, .image-preview-leave-to { opacity: 0; }
.image-preview-enter-from .image-preview-content, .image-preview-leave-to .image-preview-content { transform: scale(.96); }
@media (prefers-reduced-motion: reduce) {
  .image-preview-content, .image-preview-enter-active, .image-preview-leave-active,
  .image-preview-enter-active .image-preview-content, .image-preview-leave-active .image-preview-content { transition: none; }
}
</style>
