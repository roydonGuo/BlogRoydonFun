<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useData } from 'vitepress'

type ThemeName = 'light' | 'dark'

interface SignalNode {
  x: number
  y: number
  angle: number
  primary: number
  spark: number
  seed: number
}

interface Palette {
  background: string
  particle: readonly [number, number, number]
  signal: readonly [number, number, number]
  vignette: readonly [number, number, number]
}

const palettes: Record<ThemeName, Palette> = {
  dark: {
    background: '#050608',
    particle: [218, 224, 235],
    signal: [92, 108, 255],
    vignette: [5, 6, 8],
  },
  light: {
    background: '#efeee9',
    particle: [49, 53, 61],
    signal: [48, 73, 220],
    vignette: [239, 238, 233],
  },
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
const { isDark } = useData()

let context: CanvasRenderingContext2D | null = null
let staticCanvas: HTMLCanvasElement | null = null
let staticContext: CanvasRenderingContext2D | null = null
let motionQuery: MediaQueryList | null = null
let signalNodes: SignalNode[] = []
let width = 0
let height = 0
let devicePixelRatio = 1
let gridGap = 10
let animationFrame = 0
let resizeFrame = 0
let reducedMotion = false
let theme: ThemeName = 'light'

const pointer = {
  x: -1000,
  y: -1000,
  targetX: -1000,
  targetY: -1000,
  active: false,
}

function seededRandom(x: number, y: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function ellipseBand(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  thickness: number,
): number {
  const normalizedX = (x - centerX) / radiusX
  const normalizedY = (y - centerY) / radiusY
  const radius = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY)
  return Math.exp(-Math.pow((radius - 1) / thickness, 2))
}

function buildField(): void {
  if (!staticCanvas || !staticContext || !width || !height) return

  const palette = palettes[theme]
  const centerX = width * (width < 700 ? 0.64 : 0.57)
  const centerY = height * (width < 700 ? 0.54 : 0.56)
  const radiusX = Math.max(width * 0.38, height * 0.46)
  const radiusY = Math.max(height * 0.43, width * 0.29)
  gridGap = width < 600 || width > 1800 ? 12 : 10
  signalNodes = []

  staticContext.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  staticContext.fillStyle = palette.background
  staticContext.fillRect(0, 0, width, height)

  for (let y = -gridGap; y < height + gridGap; y += gridGap) {
    for (let x = -gridGap; x < width + gridGap; x += gridGap) {
      const random = seededRandom(x, y)
      const primary = ellipseBand(x, y, centerX, centerY, radiusX, radiusY, 0.17)
      const echo = ellipseBand(
        x,
        y,
        centerX - radiusX * 0.5,
        centerY + radiusY * 0.02,
        radiusX * 0.66,
        radiusY * 0.74,
        0.12,
      ) * 0.28
      const base = primary * 0.34 + echo
      const spark = random > 0.991 ? 0.55 + seededRandom(y, x) * 0.45 : 0
      if (base < 0.025 && !spark) continue

      const [particleRed, particleGreen, particleBlue] = palette.particle
      const particleAlpha = theme === 'light' ? 0.04 + base * 0.25 : 0.03 + base * 0.29
      staticContext.beginPath()
      staticContext.arc(x, y, 0.58 + base * 0.54, 0, Math.PI * 2)
      staticContext.fillStyle = `rgba(${particleRed}, ${particleGreen}, ${particleBlue}, ${particleAlpha})`
      staticContext.fill()

      const isSignal = Boolean(spark) || (primary > 0.1 && seededRandom(x + 31, y - 17) > 0.52)
      if (isSignal) {
        signalNodes.push({
          x,
          y,
          angle: Math.atan2((y - centerY) / radiusY, (x - centerX) / radiusX),
          primary,
          spark,
          seed: random * Math.PI * 2,
        })
      }
    }
  }

  const vignette = staticContext.createRadialGradient(
    width * 0.53,
    height * 0.52,
    height * 0.08,
    width * 0.53,
    height * 0.52,
    Math.max(width, height) * 0.78,
  )
  const [vignetteRed, vignetteGreen, vignetteBlue] = palette.vignette
  vignette.addColorStop(0, `rgba(${vignetteRed}, ${vignetteGreen}, ${vignetteBlue}, 0)`)
  vignette.addColorStop(0.67, `rgba(${vignetteRed}, ${vignetteGreen}, ${vignetteBlue}, 0.18)`)
  vignette.addColorStop(1, `rgba(${vignetteRed}, ${vignetteGreen}, ${vignetteBlue}, ${theme === 'light' ? 0.58 : 0.76})`)
  staticContext.fillStyle = vignette
  staticContext.fillRect(0, 0, width, height)
}

function drawPointerSignal(time: number, palette: Palette): void {
  if (!context || !pointer.active) return

  const radius = 145
  const rippleRadius = (time * 0.075) % 150
  const startX = Math.floor((pointer.x - radius) / gridGap) * gridGap
  const startY = Math.floor((pointer.y - radius) / gridGap) * gridGap
  const [signalRed, signalGreen, signalBlue] = palette.signal

  for (let y = startY; y <= pointer.y + radius; y += gridGap) {
    for (let x = startX; x <= pointer.x + radius; x += gridGap) {
      const deltaX = x - pointer.x
      const deltaY = y - pointer.y
      const distanceSquared = deltaX * deltaX + deltaY * deltaY
      if (distanceSquared > radius * radius) continue

      const distance = Math.sqrt(distanceSquared)
      const proximity = Math.exp(-distance / 72)
      const ripple = Math.exp(-Math.pow((distance - rippleRadius) / 12, 2)) * 0.4
      const signal = Math.min(1, proximity * 0.78 + ripple)
      if (signal < 0.08) continue

      context.beginPath()
      context.arc(x, y, 0.65 + signal * 1.08, 0, Math.PI * 2)
      context.fillStyle = `rgba(${signalRed}, ${signalGreen}, ${signalBlue}, ${0.08 + signal * 0.58})`
      context.fill()
    }
  }
}

function draw(time: number): void {
  if (!context || !staticCanvas) return

  const palette = palettes[theme]
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.drawImage(staticCanvas, 0, 0)
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)

  pointer.x += (pointer.targetX - pointer.x) * 0.09
  pointer.y += (pointer.targetY - pointer.y) * 0.09

  const [signalRed, signalGreen, signalBlue] = palette.signal
  for (const node of signalNodes) {
    const wave = Math.sin(node.angle * 2.25 - time * 0.00062 + node.seed * 0.06)
    const pulse = wave > 0.42 ? Math.pow(wave, 12) : 0
    const sparkPulse = node.spark
      ? node.spark * Math.max(0, Math.sin(time * 0.0027 + node.seed))
      : 0
    const signal = Math.min(1, node.primary * pulse + sparkPulse)
    if (signal < 0.08) continue

    context.beginPath()
    context.arc(node.x, node.y, 0.72 + signal * 1.2, 0, Math.PI * 2)
    const signalAlpha = theme === 'light' ? 0.16 + signal * 0.68 : 0.18 + signal * 0.72
    context.fillStyle = `rgba(${signalRed}, ${signalGreen}, ${signalBlue}, ${signalAlpha})`
    context.fill()
  }

  drawPointerSignal(time, palette)
}

function tick(time: number): void {
  draw(time)
  animationFrame = window.requestAnimationFrame(tick)
}

function stopAnimation(): void {
  if (!animationFrame) return
  window.cancelAnimationFrame(animationFrame)
  animationFrame = 0
}

function syncAnimation(): void {
  stopAnimation()
  draw(performance.now())
  if (!reducedMotion && !document.hidden) {
    animationFrame = window.requestAnimationFrame(tick)
  }
}

function resize(): void {
  const canvas = canvasRef.value
  if (!canvas || !context || !staticCanvas) return

  width = window.innerWidth
  height = window.innerHeight
  devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2)

  canvas.width = Math.round(width * devicePixelRatio)
  canvas.height = Math.round(height * devicePixelRatio)
  staticCanvas.width = canvas.width
  staticCanvas.height = canvas.height
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  buildField()
  draw(performance.now())
}

function queueResize(): void {
  if (resizeFrame) window.cancelAnimationFrame(resizeFrame)
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = 0
    resize()
  })
}

function updatePointer(event: PointerEvent): void {
  pointer.targetX = event.clientX
  pointer.targetY = event.clientY
  if (!pointer.active) {
    pointer.x = event.clientX
    pointer.y = event.clientY
  }
  pointer.active = true
}

function deactivatePointer(): void {
  pointer.active = false
}

function handleMotionPreference(event: MediaQueryListEvent): void {
  reducedMotion = event.matches
  syncAnimation()
}

function handleVisibilityChange(): void {
  syncAnimation()
}

watch(isDark, (dark) => {
  theme = dark ? 'dark' : 'light'
  buildField()
  draw(performance.now())
})

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return

  context = canvas.getContext('2d', { alpha: false })
  staticCanvas = document.createElement('canvas')
  staticContext = staticCanvas.getContext('2d', { alpha: false })
  if (!context || !staticContext) return

  theme = isDark.value ? 'dark' : 'light'
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion = motionQuery.matches

  window.addEventListener('resize', queueResize, { passive: true })
  window.addEventListener('pointermove', updatePointer, { passive: true })
  window.addEventListener('pointerdown', updatePointer, { passive: true })
  window.addEventListener('pointerleave', deactivatePointer)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  motionQuery.addEventListener('change', handleMotionPreference)

  resize()
  syncAnimation()
})

onBeforeUnmount(() => {
  stopAnimation()
  if (resizeFrame) window.cancelAnimationFrame(resizeFrame)
  window.removeEventListener('resize', queueResize)
  window.removeEventListener('pointermove', updatePointer)
  window.removeEventListener('pointerdown', updatePointer)
  window.removeEventListener('pointerleave', deactivatePointer)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  motionQuery?.removeEventListener('change', handleMotionPreference)
  signalNodes = []
  context = null
  staticCanvas = null
  staticContext = null
})
</script>

<template>
  <div class="home-signal-field" aria-hidden="true">
    <canvas ref="canvasRef" class="home-signal-field__canvas" />
    <div class="home-signal-field__grain" />
  </div>
</template>

<style scoped>
.home-signal-field,
.home-signal-field__canvas,
.home-signal-field__grain {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.home-signal-field {
  z-index: 0;
  overflow: hidden;
}

.home-signal-field__canvas {
  display: block;
}

.home-signal-field__grain {
  opacity: 0.045;
  background-image:
    radial-gradient(circle, rgba(255, 255, 255, 0.8) 0 0.45px, transparent 0.65px),
    radial-gradient(circle, rgba(0, 0, 0, 0.7) 0 0.4px, transparent 0.62px);
  background-position: 0 0, 3px 2px;
  background-size: 7px 7px, 9px 9px;
  mix-blend-mode: soft-light;
}

@media (prefers-reduced-motion: reduce) {
  .home-signal-field__grain {
    opacity: 0.03;
  }
}
</style>
