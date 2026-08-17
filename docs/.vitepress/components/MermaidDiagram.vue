<template>
  <figure class="mermaid-diagram" :class="{ 'is-loading': loading, 'has-error': error }">
    <div v-if="loading" class="mermaid-status">图表渲染中…</div>
    <div v-else-if="error" class="mermaid-status mermaid-error" role="alert">
      <strong>图表渲染失败</strong>
      <span>{{ error }}</span>
    </div>
    <div v-else class="mermaid-svg" v-html="svg" />
  </figure>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useData } from 'vitepress'

const props = defineProps<{ encodedCode: string }>()
const { isDark } = useData()
const svg = ref('')
const error = ref('')
const loading = ref(true)
const code = computed(() => decodeURIComponent(props.encodedCode))
let renderVersion = 0

/** 根据当前主题重新生成 SVG，防止深色模式下文字和连线对比度不足。 */
async function renderDiagram(): Promise<void> {
  const currentVersion = ++renderVersion
  loading.value = true
  error.value = ''

  try {
    // Mermaid 体积较大，仅在实际存在图表的文章页面中加载。
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isDark.value ? 'dark' : 'default',
      fontFamily: 'PingFang, sans-serif',
    })
    const id = `mermaid-${crypto.randomUUID().replaceAll('-', '')}`
    const result = await mermaid.render(id, code.value)
    if (currentVersion === renderVersion) svg.value = result.svg
  } catch (cause) {
    if (currentVersion === renderVersion) {
      error.value = cause instanceof Error ? cause.message : '未知错误'
    }
  } finally {
    if (currentVersion === renderVersion) loading.value = false
  }
}

watch([code, isDark], renderDiagram, { immediate: true })
</script>
