<template>
  <div
      class="loading-image"
      :class="[`is-${status}`, containerClass]"
      :style="aspectRatio ? {aspectRatio} : undefined"
      :aria-busy="status === 'loading'"
  >
    <LottieLoading v-if="status === 'loading'" class="loading-image__feedback" />
    <img
        ref="imageElement"
        class="loading-image__image"
        :class="imageClass"
        :src="src"
        :alt="alt"
        :loading="loading"
        :decoding="decoding"
        @load="handleLoad"
        @error="handleError"
    >
    <div v-if="status === 'error'" class="loading-image__feedback loading-image__error" role="status">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM7 16l3.2-3.6 2.4 2.6 1.7-1.8L17 16M8.5 9.5h.01" />
      </svg>
      <span>{{ errorText }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import {nextTick, onMounted, ref, watch} from 'vue'
import LottieLoading from './LottieLoading.vue'

const props = withDefaults(defineProps<{
  src: string;
  alt?: string;
  loading?: 'eager' | 'lazy';
  decoding?: 'sync' | 'async' | 'auto';
  containerClass?: string;
  imageClass?: string;
  aspectRatio?: string;
  errorText?: string;
}>(), {
  alt: '',
  loading: 'lazy',
  decoding: 'async',
  containerClass: '',
  imageClass: '',
  aspectRatio: '',
  errorText: '图片加载失败',
})

const emit = defineEmits<{
  load: [event: Event];
  error: [event: Event];
}>()

type ImageStatus = 'loading' | 'loaded' | 'error'

const imageElement = ref<HTMLImageElement | null>(null)
const status = ref<ImageStatus>('loading')

function syncCompletedImage() {
  const image = imageElement.value
  if (!image?.complete) return
  status.value = image.naturalWidth > 0 ? 'loaded' : 'error'
}

function handleLoad(event: Event) {
  status.value = 'loaded'
  emit('load', event)
}

function handleError(event: Event) {
  status.value = 'error'
  emit('error', event)
}

watch(() => props.src, async () => {
  status.value = 'loading'
  await nextTick()
  syncCompletedImage()
})

onMounted(syncCompletedImage)
</script>

<style scoped>
.loading-image {
  position: relative;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
}

.loading-image__image {
  opacity: 1;
  transition: opacity .25s ease;
}

.loading-image.is-loading .loading-image__image,
.loading-image.is-error .loading-image__image {
  opacity: 0;
}

.loading-image__feedback {
  position: absolute;
  z-index: 2;
  inset: 0;
}

.loading-image__error {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 7px;
  color: var(--vp-c-text-3);
  font-size: 11px;
  font-weight: 700;
}

.loading-image__error svg {
  width: 28px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.5;
}
</style>
