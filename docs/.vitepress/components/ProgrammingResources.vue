<template>
  <div class="resource-page">
    <PageHero
      eyebrow="DEVELOPER TOOLBOX"
      title="把好工具，放在触手可及的地方"
      description="精选开发文档、效率工具与学习站点，减少寻找，把时间留给创造。"
    />

    <div class="resource-toolbar" role="search">
      <label class="search-box">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
        <input v-model.trim="keyword" type="search" placeholder="搜索资源名称或简介" aria-label="搜索编程资源">
        <span v-if="keyword" class="result-count">{{ filteredResources.length }} 项</span>
      </label>
      <div class="category-tabs" aria-label="资源分类">
        <button
          v-for="category in categories"
          :key="category"
          :class="{ active: activeCategory === category }"
          type="button"
          @click="activeCategory = category"
        >{{ category }}</button>
      </div>
    </div>

    <div v-if="filteredResources.length" class="resource-grid">
      <a
        v-for="resource in filteredResources"
        :key="resource.name"
        class="resource-card"
        :href="resource.url"
        target="_blank"
        rel="noopener noreferrer"
      >
        <div class="resource-icon" :style="{ '--accent': resource.color }">{{ resource.icon }}</div>
        <div class="resource-content">
          <div class="resource-heading">
            <h2>{{ resource.name }}</h2>
            <span>{{ resource.category }}</span>
          </div>
          <p>{{ resource.description }}</p>
          <div class="resource-footer">
            <code>{{ hostOf(resource.url) }}</code>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>
          </div>
        </div>
      </a>
    </div>
    <div v-else class="empty-state">
      <span>⌕</span>
      <strong>没有找到匹配的资源</strong>
      <button type="button" @click="resetFilters">清除筛选</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import PageHero from './PageHero.vue'

interface Resource {
  name: string
  description: string
  url: string
  category: string
  icon: string
  color: string
}

const resources: Resource[] = [
  { name: 'MDN Web Docs', description: '前端开发者必备的 Web 标准与 API 权威文档。', url: 'https://developer.mozilla.org/zh-CN/', category: '前端', icon: 'M', color: '#111827' },
  { name: 'Vue.js', description: '易学易用、性能出色且适用场景丰富的 Web 框架。', url: 'https://cn.vuejs.org/', category: '前端', icon: 'V', color: '#42b883' },
  { name: 'React', description: '用于构建 Web 和原生用户界面的 JavaScript 库。', url: 'https://react.dev/', category: '前端', icon: 'R', color: '#149eca' },
  { name: 'Can I Use', description: '快速查询 Web 特性的浏览器兼容性与使用情况。', url: 'https://caniuse.com/', category: '前端', icon: 'C', color: '#c75000' },
  { name: 'Spring', description: 'Java 企业应用开发生态的官方文档与指南。', url: 'https://spring.io/', category: '后端', icon: 'S', color: '#6db33f' },
  { name: 'Node.js', description: '跨平台 JavaScript 运行时的文档与学习资源。', url: 'https://nodejs.org/zh-cn', category: '后端', icon: 'N', color: '#5fa04e' },
  { name: 'Docker Docs', description: '容器、镜像、Compose 与部署实践的官方文档。', url: 'https://docs.docker.com/', category: '后端', icon: 'D', color: '#2496ed' },
  { name: 'Redis Docs', description: '数据结构、命令、客户端与运维指南。', url: 'https://redis.io/docs/latest/', category: '后端', icon: 'R', color: '#dc382d' },
  { name: 'OpenAI Docs', description: '模型、API、Agents 与应用开发的官方指南。', url: 'https://platform.openai.com/docs/', category: 'AI', icon: 'O', color: '#10a37f' },
  { name: 'Hugging Face', description: '开源模型、数据集、Demo 与机器学习社区。', url: 'https://huggingface.co/', category: 'AI', icon: 'H', color: '#ff9d00' },
  { name: 'Papers with Code', description: '连接机器学习论文、代码实现和评测数据。', url: 'https://paperswithcode.com/', category: 'AI', icon: 'P', color: '#21cbce' },
  { name: 'GitHub', description: '托管代码、协作开发并探索优秀开源项目。', url: 'https://github.com/', category: '工具', icon: 'G', color: '#24292f' },
  { name: 'Stack Overflow', description: '面向开发者的技术问答与经验知识库。', url: 'https://stackoverflow.com/', category: '社区', icon: 'S', color: '#f48024' },
  { name: 'DevDocs', description: '将多种开发文档聚合在一个快速检索界面中。', url: 'https://devdocs.io/', category: '工具', icon: 'D', color: '#3b82f6' },
  { name: 'Regex101', description: '可视化编写、调试和解释正则表达式。', url: 'https://regex101.com/', category: '工具', icon: '.*', color: '#9c27b0' },
  { name: 'Roadmap.sh', description: '按岗位和技术主题整理的开发者学习路线。', url: 'https://roadmap.sh/', category: '学习', icon: 'R', color: '#6366f1' },
  { name: 'freeCodeCamp', description: '通过课程和项目免费学习编程与计算机科学。', url: 'https://www.freecodecamp.org/chinese/', category: '学习', icon: 'F', color: '#0a0a23' },
  { name: 'LeetCode', description: '通过算法题训练编程、数据结构与解题能力。', url: 'https://leetcode.cn/', category: '学习', icon: 'L', color: '#ffa116' },
]

const categories = ['全部', ...new Set(resources.map(resource => resource.category))]
const keyword = ref('')
const activeCategory = ref('全部')

const filteredResources = computed(() => {
  const query = keyword.value.toLocaleLowerCase()
  return resources.filter((resource) => {
    const inCategory = activeCategory.value === '全部' || resource.category === activeCategory.value
    const matchesQuery = !query || `${resource.name} ${resource.description}`.toLocaleLowerCase().includes(query)
    return inCategory && matchesQuery
  })
})

function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '')
}

function resetFilters() {
  keyword.value = ''
  activeCategory.value = '全部'
}
</script>

<style scoped>
.resource-toolbar { position: sticky; z-index: 5; top: calc(var(--vp-nav-height) + 12px); margin: 24px 0; padding: 12px; border: 1px solid var(--vp-c-divider); border-radius: 16px; background: color-mix(in srgb, var(--vp-c-bg) 88%, transparent); box-shadow: 0 10px 32px rgba(15,23,42,.06); backdrop-filter: blur(14px); }
.search-box { display: flex; align-items: center; gap: 10px; padding: 0 12px; border: 1px solid var(--vp-c-divider); border-radius: 11px; background: var(--vp-c-bg-soft); }
.search-box svg { width: 18px; fill: none; stroke: var(--vp-c-text-3); stroke-width: 2; }
.search-box input { flex: 1; min-width: 0; padding: 11px 0; border: 0; outline: 0; color: var(--vp-c-text-1); background: transparent; font: inherit; }
.result-count { color: var(--vp-c-text-3); font-size: 12px; }
.category-tabs { display: flex; gap: 6px; margin-top: 10px; overflow-x: auto; scrollbar-width: none; }
.category-tabs button { flex: 0 0 auto; padding: 7px 13px; border: 0; border-radius: 999px; color: var(--vp-c-text-2); background: transparent; cursor: pointer; font: 600 13px/1.2 inherit; transition: .2s; }
.category-tabs button:hover { color: var(--vp-c-brand-1); background: var(--vp-c-brand-soft); }
.category-tabs button.active { color: white; background: var(--vp-c-brand-1); }
.resource-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.resource-card { display: flex; gap: 15px; padding: 18px; border: 1px solid var(--vp-c-divider); border-radius: 16px; color: inherit; background: var(--vp-c-bg); text-decoration: none; transition: transform .2s, border-color .2s, box-shadow .2s; }
.resource-card:hover { border-color: color-mix(in srgb, var(--accent) 55%, var(--vp-c-divider)); box-shadow: 0 12px 30px rgba(15,23,42,.08); transform: translateY(-3px); }
.resource-icon { display: grid; flex: 0 0 44px; height: 44px; place-items: center; border-radius: 13px; color: white; background: var(--accent); font: 800 16px/1 monospace; box-shadow: 0 8px 18px color-mix(in srgb, var(--accent) 24%, transparent); }
.resource-content { min-width: 0; flex: 1; }
.resource-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.resource-heading h2 { margin: 1px 0 0; border: 0; font-size: 16px; line-height: 1.4; }
.resource-heading span { padding: 3px 8px; border-radius: 999px; color: var(--vp-c-brand-1); background: var(--vp-c-brand-soft); font-size: 11px; white-space: nowrap; }
.resource-content p { min-height: 42px; margin: 8px 0 12px; color: var(--vp-c-text-2); font-size: 13px; line-height: 1.65; }
.resource-footer { display: flex; align-items: center; justify-content: space-between; color: var(--vp-c-text-3); }
.resource-footer code { padding: 0; color: inherit; background: none; font-size: 11px; }
.resource-footer svg { width: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; transition: transform .2s; }
.resource-card:hover .resource-footer svg { color: var(--vp-c-brand-1); transform: translate(2px,-2px); }
.empty-state { display: grid; min-height: 260px; place-items: center; align-content: center; gap: 10px; color: var(--vp-c-text-2); }
.empty-state span { font-size: 46px; color: var(--vp-c-text-3); }
.empty-state button { border: 0; color: var(--vp-c-brand-1); background: transparent; cursor: pointer; }
@media (max-width: 700px) { .resource-grid { grid-template-columns: 1fr; } .resource-toolbar { top: calc(var(--vp-nav-height) + 6px); } }
</style>
