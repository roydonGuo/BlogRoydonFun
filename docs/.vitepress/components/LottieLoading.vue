<template>
  <div class="lottie-loading" aria-hidden="true">
    <div ref="animationContainer" class="lottie-loading__animation" />
  </div>
</template>

<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref} from 'vue'

const animationContainer = ref<HTMLElement | null>(null)
let destroyAnimation: (() => void) | undefined
let visibilityObserver: IntersectionObserver | undefined
let disposed = false

onMounted(async () => {
  const {default: lottie} = await import('lottie-web')
  const container = animationContainer.value
  if (disposed || !container) return

  const animation = lottie.loadAnimation({
    container,
    renderer: 'svg',
    loop: true,
    autoplay: false,
    path: '/lottie/loading.json',
    rendererSettings: {
      preserveAspectRatio: 'xMidYMid meet',
    },
  })

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduceMotion) {
    animation.goToAndStop(0, true)
  } else if (typeof IntersectionObserver === 'undefined') {
    animation.play()
  } else {
    visibilityObserver = new IntersectionObserver(([entry]) => {
      entry?.isIntersecting ? animation.play() : animation.pause()
    }, {rootMargin: '120px'})
    visibilityObserver.observe(container)
  }

  destroyAnimation = () => {
    visibilityObserver?.disconnect()
    animation.destroy()
  }
})

onBeforeUnmount(() => {
  disposed = true
  visibilityObserver?.disconnect()
  destroyAnimation?.()
})
</script>

<style scoped>
.lottie-loading {
  display: grid;
  width: 100%;
  height: 100%;
  min-height: 72px;
  place-items: center;
}

.lottie-loading__animation {
  width: clamp(64px, 32%, 112px);
  aspect-ratio: 1;
}

@media (prefers-reduced-motion: reduce) {
  .lottie-loading__animation {
    opacity: .85;
  }
}
</style>
