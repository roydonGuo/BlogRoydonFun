<template>
  <div class="post-pager-comments">
    <Giscus
        id="comments"
        :key="route.path"
        repo="roydonGuo/BlogRoydonFun"
        repo-id="R_kgDOS4G3UA"
        category="General"
        category-id="DIC_kwDOS4G3UM4DEfLx"
        mapping="pathname"
        strict="1"
        term="欢迎来到我的博客!"
        reactions-enabled="1"
        emit-metadata="1"
        input-position="top"
        lang="zh-CN"
        loading="lazy"
        :theme="isDark ? 'dark_tritanopia' : 'light_tritanopia'"
    ></Giscus>
  </div>
</template>

<script setup>
import Giscus from '@giscus/vue'
import {watch} from 'vue'
import {inBrowser, useData, useRoute} from 'vitepress'

const {isDark} = useData()
const route = useRoute()

watch(isDark, (dark) => {
  if (!inBrowser) return

  const iframe = document.querySelector('giscus-widget')?.shadowRoot?.querySelector('iframe')

  iframe?.contentWindow?.postMessage({giscus: {setConfig: {theme: dark ? 'dark_tritanopia' : 'light_tritanopia'}}}, 'https://giscus.app')
})
</script>
<style scoped>
.post-pager-comments {
  width: 100%;
  margin-top: 2rem;
}
</style>
