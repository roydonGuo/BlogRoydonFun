<template>
  <div class="links-page">
    <section v-for="group in linkGroups" :key="group.title" class="link-group">
      <h2 class="group-title">{{ group.title }}</h2>
      <div class="link-grid">
        <a
          v-for="link in group.links"
          :key="link.name"
          :href="link.url"
          class="link-card"
          target="_blank"
          rel="noopener noreferrer"
        >
          <div class="link-icon">{{ link.icon }}</div>
          <div class="link-info">
            <span class="link-name">{{ link.name }}</span>
            <span class="link-desc">{{ link.desc }}</span>
          </div>
          <svg class="link-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17l9.2-9.2M17 17V7H7"/></svg>
        </a>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
interface Link {
  name: string
  desc: string
  url: string
  icon: string
}

interface LinkGroup {
  title: string
  links: Link[]
}

const linkGroups: LinkGroup[] = [
  {
    title: '🔧 开发工具',
    links: [
      { name: 'GitHub', desc: '代码托管与协作平台', url: 'https://github.com', icon: '🐙' },
      { name: 'Stack Overflow', desc: '开发者问答社区', url: 'https://stackoverflow.com', icon: '📚' },
      { name: 'npm', desc: 'Node.js 包管理器', url: 'https://www.npmjs.com', icon: '📦' },
      { name: 'MDN Web Docs', desc: 'Web 技术权威文档', url: 'https://developer.mozilla.org/zh-CN/', icon: '🌐' },
      { name: 'Can I Use', desc: '浏览器兼容性查询', url: 'https://caniuse.com', icon: '🔍' },
    ],
  },
  {
    title: '🎨 设计 & 灵感',
    links: [
      { name: 'Dribbble', desc: '设计师作品展示平台', url: 'https://dribbble.com', icon: '🏀' },
      { name: 'Unsplash', desc: '高质量免费图库', url: 'https://unsplash.com', icon: '📷' },
      { name: 'Coolors', desc: '在线配色方案生成', url: 'https://coolors.co', icon: '🎨' },
      { name: 'Iconify', desc: '海量图标库', url: 'https://iconify.design', icon: '✨' },
    ],
  },
  {
    title: '📖 学习资源',
    links: [
      { name: 'Vue.js', desc: '渐进式 JavaScript 框架', url: 'https://vuejs.org', icon: '💚' },
      { name: 'VitePress', desc: 'Vite & Vue 驱动的静态站点生成器', url: 'https://vitepress.dev', icon: '📝' },
      { name: 'TypeScript', desc: 'JavaScript 的类型超集', url: 'https://www.typescriptlang.org', icon: '🔷' },
      { name: 'Node.js', desc: 'JavaScript 运行时环境', url: 'https://nodejs.org', icon: '🟢' },
    ],
  },
  {
    title: '💬 社区 & 资讯',
    links: [
      { name: '掘金', desc: '中文技术社区', url: 'https://juejin.cn', icon: '⛏️' },
      { name: '知乎', desc: '问答与知识分享', url: 'https://www.zhihu.com', icon: '💡' },
      { name: 'Hacker News', desc: '国际科技资讯', url: 'https://news.ycombinator.com', icon: '📰' },
      { name: 'Product Hunt', desc: '发现新产品和工具', url: 'https://www.producthunt.com', icon: '🚀' },
    ],
  },
]
</script>

<style scoped>
.links-page {
  margin: 1.5rem 0;
}

.link-group {
  margin-bottom: 2.5rem;
}

.group-title {
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin: 0 0 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--vp-c-brand-soft);
}

.link-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.75rem;
}

.link-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border-radius: 10px;
  text-decoration: none;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  transition: all 0.2s;
}

.link-card:hover {
  border-color: var(--vp-c-brand-soft);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transform: translateY(-2px);
}

.link-icon {
  font-size: 1.5rem;
  width: 2.2rem;
  height: 2.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 8px;
  background: var(--vp-c-bg);
}

.link-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.link-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  line-height: 1.3;
}

.link-desc {
  font-size: 0.78rem;
  color: var(--vp-c-text-3);
  line-height: 1.3;
  margin-top: 0.1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-arrow {
  flex-shrink: 0;
  opacity: 0;
  transform: translateX(-4px);
  transition: all 0.2s;
  color: var(--vp-c-brand-1);
}

.link-card:hover .link-arrow {
  opacity: 1;
  transform: translateX(0);
}

@media (max-width: 640px) {
  .link-grid {
    grid-template-columns: 1fr;
  }
}
</style>
