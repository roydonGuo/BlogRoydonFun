import { defineConfig } from 'vitepress'
import tailwindcss from '@tailwindcss/vite'
import { groupIconMdPlugin, groupIconVitePlugin } from 'vitepress-plugin-group-icons'
import { mermaidContainerPlugin } from './markdown/mermaid-container'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Ethan',
  description: 'Thoughts on code, design & life',

  // 为代码组标签和带文件名的代码块生成对应的文件类型图标。
  markdown: {
    // 所有代码块默认显示行号，单个代码块仍可用 :no-line-numbers 关闭。
    lineNumbers: true,
    config(md) {
      md.use(groupIconMdPlugin)
      // 本地解析 :::mermaid 容器，避免绑定特定 VitePress alpha 版本。
      md.use(mermaidContainerPlugin)
    },
  },

  // 配套的 Vite 插件负责生成主题使用的虚拟图标样式。
  vite: {
    plugins: [
      // Tailwind v4 通过 Vite 插件扫描并生成主题工具类。
      tailwindcss(),
      groupIconVitePlugin(),
    ],
  },

  // Read each page timestamp from its latest Git commit.
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
  ],

  themeConfig: {
    // public 目录资源使用根路径，图标会显示在顶部站点名称 Ethan 前。
    logo: '/1fad0.svg',
    // 文章侧栏目录展示二至四级标题，并保留标题树层级。
    outline: {
      level: [2, 4],
      label: '文章目录',
    },
    nav: [
      { text: '首页', link: '/' },
      { text: '文章', link: '/posts/' },
      { text: '归档', link: '/archive/' },
      { text: '知识图谱', link: '/knowledge-graph/' },
      { text: '链接', link: '/links/' },
      { text: '关于', link: '/about/' },
      // 简历使用独立 Markdown 页面，方便后续直接维护内容。
      { text: '简历', link: '/resume/' },
    ],

    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '\u641c\u7d22\u6587\u7ae0',
            buttonAriaLabel: '\u641c\u7d22\u6587\u7ae0',
          },
          modal: {
            resetButtonTitle: '\u6e05\u9664\u641c\u7d22',
            backButtonTitle: '\u5173\u95ed\u641c\u7d22',
            noResultsText: '\u672a\u627e\u5230\u76f8\u5173\u6587\u7ae0',
          },
        },
        async _render(src, env, md) {
          const html = await md.renderAsync(src, env)
          const relativePath = env.relativePath.replace(/\\/g, '/')

          // Only article detail pages should be included in the local search index.
          if (!relativePath.startsWith('posts/') || relativePath === 'posts/index.md') {
            return ''
          }

          return html
        },
      },
    },

    sidebar: [],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/roydonGuo' },
    ],

    // Keep the update timestamp label and date format consistent in Chinese.
    lastUpdated: {
      text: '\u6700\u540e\u66f4\u65b0\u4e8e',
      formatOptions: {
        dateStyle: 'long',
        timeStyle: 'short',
        forceLocale: true,
      },
    },

    footer: {
      message: 'Thoughts on code, design & life',
      copyright: 'Copyright © 2026 Ethan',
    },
  },
})
