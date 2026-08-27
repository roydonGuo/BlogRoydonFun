<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import {useData} from 'vitepress'

const {page} = useData()
const voices = ref<SpeechSynthesisVoice[]>([])
const voiceUri = ref('')
const rate = ref(1)
const state = ref<'idle' | 'speaking' | 'paused'>('idle')
const supported = ref(true)
const voicePicker = ref<HTMLDetailsElement>()
let parts: string[] = []
let partIndex = 0
let session = 0

const visible = computed(() => {
  const path = page.value.relativePath.replace(/\\/g, '/')
  return path.startsWith('posts/') && path !== 'posts/index.md'
})
const stateText = computed(() => !supported.value ? '当前浏览器不支持语音朗读'
    : state.value === 'speaking' ? '正在朗读' : state.value === 'paused' ? '已暂停' : '准备朗读')
const selectedVoiceName = computed(() => voices.value.find(item => item.voiceURI === voiceUri.value)?.name ?? '系统默认')
const rateProgress = computed(() => String((rate.value - 0.5) / 2.5 * 100) + '%')

// 优先选择中文音色，同时保留系统提供的全部音色。
function loadVoices() {
  voices.value = speechSynthesis.getVoices().slice().sort((a, b) =>
      Number(!a.lang.toLowerCase().startsWith('zh')) - Number(!b.lang.toLowerCase().startsWith('zh'))
      || a.name.localeCompare(b.name))
  if (!voices.value.some(item => item.voiceURI === voiceUri.value))
    voiceUri.value = voices.value.find(item => item.lang.toLowerCase().startsWith('zh'))?.voiceURI ?? voices.value[0]?.voiceURI ?? ''
}

// 拆分长文章，降低浏览器中途终止超长语音任务的概率。
function splitText(text: string, limit = 180) {
  const result: string[] = []
  let current = ''
  for (const sentence of text.replace(/\s+/g, ' ').trim().split(/(?<=[。！？；.!?;])\s*/).filter(Boolean)) {
    if (sentence.length > limit) {
      if (current) result.push(current)
      for (let offset = 0; offset < sentence.length; offset += limit)
        result.push(sentence.slice(offset, offset + limit))
      current = ''
    } else if (current && current.length + sentence.length > limit) {
      result.push(current)
      current = sentence
    } else current += sentence
  }
  if (current) result.push(current)
  return result
}

// 只读取正文文字，跳过代码块、标题锚点和交互控件。
function articleText() {
  const article = document.querySelector<HTMLElement>('.VPDoc .vp-doc')
  if (!article) return ''
  const clone = article.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.article-reader, .article-metadata, pre, code, script, style, button, .header-anchor, .footnotes').forEach(node => node.remove())
  return clone.textContent ?? ''
}

function speakPart(currentSession: number) {
  if (currentSession !== session || partIndex >= parts.length) {
    state.value = 'idle'
    return
  }
  const utterance = new SpeechSynthesisUtterance(parts[partIndex])
  const voice = voices.value.find(item => item.voiceURI === voiceUri.value)
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  } else utterance.lang = page.value.frontmatter.lang ?? 'zh-CN'
  utterance.rate = rate.value
  utterance.onend = () => {
    if (currentSession !== session) return
    partIndex += 1
    speakPart(currentSession)
  }
  utterance.onerror = (event) => {
    // 主动停止产生的 cancel/interrupted 不作为朗读错误处理。
    if (currentSession === session && !['canceled', 'interrupted'].includes(event.error))
      state.value = 'idle'
  }
  state.value = 'speaking'
  speechSynthesis.speak(utterance)
}

function start() {
  if (!supported.value) return
  stop()
  parts = splitText(articleText())
  if (parts.length) speakPart(session)
}

function toggle() {
  if (state.value === 'speaking') {
    speechSynthesis.pause()
    state.value = 'paused'
  } else if (state.value === 'paused') {
    speechSynthesis.resume()
    state.value = 'speaking'
  }
}

function toggleReading() {
  if (state.value === 'idle') start()
  else toggle()
}

function chooseVoice(uri: string) {
  voiceUri.value = uri
  if (voicePicker.value) voicePicker.value.open = false
}

function stop() {
  session += 1
  parts = []
  partIndex = 0
  state.value = 'idle'
  if (supported.value) speechSynthesis.cancel()
}

onMounted(() => {
  supported.value = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
  if (!supported.value) return
  loadVoices()
  speechSynthesis.addEventListener('voiceschanged', loadVoices)
})
onBeforeUnmount(() => {
  stop()
  if (supported.value) speechSynthesis.removeEventListener('voiceschanged', loadVoices)
})
// 客户端切换文章时停止上一页的朗读。
watch(() => page.value.relativePath, stop)
</script>

<template>
  <section v-if="visible" class="article-reader" :class="'is-' + state" aria-label="文章语音朗读">
    <div class="reader-heading">
      <span class="reader-icon" aria-hidden="true"><i/><i/><i/><i/></span>
      <div><strong>语音阅读</strong><span aria-live="polite">{{ stateText }}</span></div>
    </div>
    <div class="reader-controls">
      <div class="transport">
        <button class="icon-button primary" type="button" :disabled="!supported"
                :aria-label="state === 'speaking' ? '暂停朗读' : state === 'paused' ? '继续朗读' : '开始朗读'"
                :data-tooltip="state === 'speaking' ? '暂停' : state === 'paused' ? '继续' : '播放'"
                @click="toggleReading">
          <svg v-if="state === 'speaking'" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 5h3v14H7zm7 0h3v14h-3z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true">
            <path d="m8 5 11 7-11 7z"/>
          </svg>
        </button>
        <button class="icon-button" type="button" :disabled="state === 'idle'" aria-label="重新朗读"
                data-tooltip="重新开始" @click="start">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18.6 6.4A9 9 0 1 0 21 12h-2.2a6.8 6.8 0 1 1-2-4.8L13 11h8V3z"/>
          </svg>
        </button>
        <button class="icon-button" type="button" :disabled="state === 'idle'" aria-label="停止朗读" data-tooltip="停止"
                @click="stop">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
        </button>
      </div>

      <details ref="voicePicker" class="voice-picker">
        <summary :aria-label="'选择音色，当前为 ' + selectedVoiceName">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M12 15a4 4 0 0 0 4-4V5a4 4 0 1 0-8 0v6a4 4 0 0 0 4 4zm7-4a7 7 0 0 1-6 6.92V21h3v2H8v-2h3v-3.08A7 7 0 0 1 5 11h2a5 5 0 0 0 10 0z"/>
          </svg>
          <span>{{ selectedVoiceName }}</span>
          <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m7 10 5 5 5-5z"/>
          </svg>
        </summary>
        <div class="voice-menu" role="radiogroup" aria-label="选择朗读音色">
          <p>选择音色</p>
          <button v-for="voice in voices" :key="voice.voiceURI" type="button" role="radio"
                  :aria-checked="voice.voiceURI === voiceUri" @click="chooseVoice(voice.voiceURI)">
            <span class="radio-dot" aria-hidden="true"/>
            <span class="voice-name">{{ voice.name }}<small>{{ voice.lang }}</small></span>
          </button>
          <span v-if="!voices.length" class="voice-empty">暂无可用音色</span>
        </div>
      </details>

      <label class="rate-control">
        <span class="rate-value">{{ rate.toFixed(1) }}×</span>
        <span class="slider-wrap">
          <input v-model.number="rate" type="range" min="0.5" max="3.0" step="0.1" aria-label="朗读语速"
                 :style="{ '--rate-progress': rateProgress }">
          <span class="rate-marks" aria-hidden="true"><i/><i/><i/><i/><i/></span>
        </span>
      </label>
    </div>
  </section>
</template>

<style scoped>
.article-reader {
  position: relative;
  display: flex;
  gap: 20px;
  align-items: center;
  justify-content: space-between;
  margin: 1rem 0;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 14%, var(--vp-c-divider));
  border-radius: 9rem;
  background: linear-gradient(135deg, color-mix(in srgb, var(--vp-c-brand-soft) 45%, var(--vp-c-bg)) 0%, var(--vp-c-bg-soft) 100%);
  box-shadow: 0 8px 30px rgba(15, 23, 42, .05);
  transition: border-color .25s ease, box-shadow .25s ease
}

.article-reader:hover {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 30%, var(--vp-c-divider));
  box-shadow: 0 12px 36px rgba(36, 69, 235, .09)
}

.article-reader.is-speaking {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 42%, var(--vp-c-divider));
  box-shadow: 0 12px 36px rgba(36, 69, 235, .12)
}

.reader-heading {
  display: flex;
  flex: 0 0 auto;
  gap: 11px;
  align-items: center
}

.reader-heading div {
  display: grid;
  gap: 2px
}

.reader-heading strong {
  font-size: 14px
}

.reader-heading div span {
  color: var(--vp-c-text-2);
  font-size: 11px
}

.reader-icon {
  display: flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-radius: 9rem;
  background: var(--vp-c-brand-soft)
}

.reader-icon i {
  width: 3px;
  height: 10px;
  border-radius: 5px;
  background: var(--vp-c-brand-1);
  transform-origin: center
}

.reader-icon i:nth-child(2), .reader-icon i:nth-child(3) {
  height: 18px
}

.reader-icon i:nth-child(4) {
  height: 7px
}

.is-speaking .reader-icon i {
  animation: sound-wave .75s ease-in-out infinite alternate
}

.is-speaking .reader-icon i:nth-child(2) {
  animation-delay: -.5s
}

.is-speaking .reader-icon i:nth-child(3) {
  animation-delay: -.25s
}

.is-speaking .reader-icon i:nth-child(4) {
  animation-delay: -.65s
}

@keyframes sound-wave {
  from {
    transform: scaleY(.45)
  }
  to {
    transform: scaleY(1.15)
  }
}

.reader-controls, .transport {
  display: flex;
  align-items: center
}

.reader-controls {
  flex-wrap: wrap;
  gap: 12px;
  justify-content: flex-end
}

.transport {
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 9rem;
  background: var(--vp-c-bg)
}

.icon-button {
  position: relative;
  display: grid;
  width: 34px;
  height: 34px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 9rem;
  color: var(--vp-c-text-2);
  background: transparent;
  cursor: pointer;
  transition: color .18s ease, background .18s ease, transform .18s cubic-bezier(.2, .8, .2, 1)
}

.icon-button svg {
  width: 17px;
  height: 17px;
  fill: currentColor
}

.icon-button:hover:not(:disabled) {
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.icon-button:active:not(:disabled) {
  transform: scale(.88)
}

.icon-button.primary {
  color: #fff;
  background: var(--vp-c-brand-1);
  box-shadow: 0 5px 14px rgba(36, 69, 235, .28)
}

.icon-button.primary:hover:not(:disabled) {
  color: #fff;
  background: var(--vp-c-brand-2)
}

.icon-button:disabled {
  cursor: not-allowed;
  opacity: .28
}

.icon-button::after {
  position: absolute;
  z-index: 10;
  bottom: calc(100% + 8px);
  left: 50%;
  padding: 5px 8px;
  border-radius: 6px;
  color: #fff;
  background: #111827;
  content: attr(data-tooltip);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 5px);
  transition: opacity .16s ease, transform .16s ease
}

.icon-button:hover::after, .icon-button:focus-visible::after {
  opacity: 1;
  transform: translate(-50%, 0)
}

.voice-picker {
  position: relative
}

.voice-picker summary {
  display: flex;
  width: 200px;
  height: 42px;
  box-sizing: border-box;
  gap: 8px;
  align-items: center;
  padding: 0 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 9rem;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  cursor: pointer;
  list-style: none;
  transition: border-color .2s ease, box-shadow .2s ease, transform .2s ease
}

.voice-picker summary::-webkit-details-marker {
  display: none
}

.voice-picker summary:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-1px)
}

.voice-picker[open] summary {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 0 0 3px var(--vp-c-brand-soft)
}

.voice-picker summary svg {
  flex: 0 0 auto;
  width: 17px;
  height: 17px;
  fill: var(--vp-c-brand-1)
}

.voice-picker summary span {
  overflow: hidden;
  flex: 1;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap
}

.voice-picker .chevron {
  width: 14px;
  fill: var(--vp-c-text-3);
  transition: transform .2s ease
}

.voice-picker[open] .chevron {
  transform: rotate(180deg)
}

.voice-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 8px);
  right: 0;
  width: 500px;
  max-height: 360px;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg);
  box-shadow: 0 18px 50px rgba(15, 23, 42, .16);
  transform-origin: top right;
  animation: menu-in .18s cubic-bezier(.2, .8, .2, 1)
}

@keyframes menu-in {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(.97)
  }
  to {
    opacity: 1;
    transform: none
  }
}

.voice-menu p {
  margin: 3px 8px 7px;
  color: var(--vp-c-text-3);
  font-size: 11px;
  font-weight: 600
}

.voice-menu button {
  display: flex;
  width: 100%;
  gap: 10px;
  align-items: center;
  padding: 9px 8px;
  border: 0;
  border-radius: 9px;
  color: var(--vp-c-text-1);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background .15s ease
}

.voice-menu button:hover {
  background: var(--vp-c-bg-soft)
}

.radio-dot {
  width: 15px;
  height: 15px;
  box-sizing: border-box;
  border: 1.5px solid var(--vp-c-text-3);
  border-radius: 50%;
  transition: border .15s ease, box-shadow .15s ease
}

.voice-menu button[aria-checked=true] .radio-dot {
  border: 4px solid var(--vp-c-brand-1);
  box-shadow: 0 0 0 3px var(--vp-c-brand-soft)
}

.voice-name {
  display: flex;
  min-width: 0;
  flex: 1;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px
}

.voice-name small {
  color: var(--vp-c-text-3)
}

.voice-empty {
  display: block;
  padding: 12px;
  color: var(--vp-c-text-3);
  font-size: 12px;
  text-align: center
}

.rate-control {
  display: flex;
  gap: 9px;
  align-items: center;
  padding: 0 6px;
  height: 42px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 9rem;
  background: var(--vp-c-bg)
}

.rate-value {
  min-width: 34px;
  padding: 3px 6px;
  border-radius: 9rem;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  font-size: 11px;
  font-weight: 700;
  text-align: center
}

.slider-wrap {
  position: relative;
  display: flex;
  width: 104px;
  align-items: center
}

.slider-wrap input {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 18px;
  margin: 0;
  appearance: none;
  background: transparent;
  cursor: pointer
}

.slider-wrap input::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--vp-c-brand-1) var(--rate-progress), var(--vp-c-divider) var(--rate-progress))
}

.slider-wrap input::-webkit-slider-thumb {
  width: 15px;
  height: 15px;
  margin-top: -5.5px;
  appearance: none;
  border: 3px solid var(--vp-c-bg);
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  box-shadow: 0 2px 7px rgba(36, 69, 235, .35);
  transition: transform .15s ease
}

.slider-wrap input:hover::-webkit-slider-thumb {
  transform: scale(1.22)
}

.slider-wrap input::-moz-range-track {
  height: 4px;
  border-radius: 4px;
  background: var(--vp-c-divider)
}

.slider-wrap input::-moz-range-progress {
  height: 4px;
  border-radius: 4px;
  background: var(--vp-c-brand-1)
}

.slider-wrap input::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border: 3px solid var(--vp-c-bg);
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  box-shadow: 0 2px 7px rgba(36, 69, 235, .35)
}

.rate-marks {
  position: absolute;
  right: 2px;
  bottom: -2px;
  left: 2px;
  display: flex;
  justify-content: space-between;
  pointer-events: none
}

.rate-marks i {
  width: 1px;
  height: 3px;
  background: var(--vp-c-text-3);
  opacity: .5
}

@media (max-width: 768px) {
  .article-reader {
    align-items: flex-start;
    flex-direction: column
  }

  .reader-controls {
    width: 100%;
    justify-content: flex-start
  }

  .voice-picker {
    flex: 1
  }

  .voice-picker summary {
    width: 100%
  }

  .voice-menu {
    right: auto;
    left: 0
  }

  .rate-control {
    flex: 1
  }

  .slider-wrap {
    width: auto;
    flex: 1
  }
}

@media (prefers-reduced-motion: reduce) {
  .article-reader, .icon-button, .voice-picker summary, .voice-picker .chevron, .slider-wrap input::-webkit-slider-thumb {
    transition: none
  }

  .is-speaking .reader-icon i, .voice-menu {
    animation: none
  }
}
</style>
