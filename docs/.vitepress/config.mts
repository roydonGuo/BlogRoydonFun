import { defineConfig } from 'vitepress'
import tailwindcss from '@tailwindcss/vite'
import { groupIconMdPlugin, groupIconVitePlugin } from 'vitepress-plugin-group-icons'
import { mermaidContainerPlugin } from './markdown/mermaid-container'
import { collectRssPost, rssDevPlugin, writeRssFeed } from './rss'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Ethan',
  description: 'Thoughts on code, design & life',

  // 中文作为默认语言，英文内容统一放在 /en/ 路径下。
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/',
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      title: 'Ethan',
      description: 'Thoughts on code, design & life',
      themeConfig: {
        outline: {
          level: [2, 4],
          label: 'On this page',
        },
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Articles', link: '/en/posts/' },
          { text: 'About', link: '/en/about/' },
        ],
        lastUpdated: {
          text: 'Last updated',
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
        darkModeSwitchLabel: 'Appearance',
        lightModeSwitchTitle: 'Switch to light theme',
        darkModeSwitchTitle: 'Switch to dark theme',
        sidebarMenuLabel: 'Menu',
        returnToTopLabel: 'Return to top',
        langMenuLabel: 'Change language',
        skipToContentLabel: 'Skip to content',
      },
    },
  },

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
      // 开发模式即时提供 /feed.xml，生产模式仍由 buildEnd 输出文件。
      rssDevPlugin(),
    ],
  },

  // Read each page timestamp from its latest Git commit.
  lastUpdated: true,

  // 收集文章 frontmatter，并在静态构建结束后生成 feed.xml。
  transformPageData(pageData) {
    collectRssPost(pageData)
  },
  async buildEnd(siteConfig) {
    await writeRssFeed(siteConfig)
  },

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    // 让浏览器与 RSS 阅读器自动发现站点订阅地址。
    ['link', { rel: 'alternate', type: 'application/rss+xml', title: 'Ethan RSS Feed', href: '/feed.xml' }],
  ],

  themeConfig: {
    // 未翻译的文章不做同路径语言映射，切换语言时返回对应语言首页。
    i18nRouting: false,
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
        locales: {
          en: {
            translations: {
              button: {
                buttonText: 'Search articles',
                buttonAriaLabel: 'Search articles',
              },
              modal: {
                resetButtonTitle: 'Reset search',
                backButtonTitle: 'Close search',
                noResultsText: 'No relevant results found',
              },
            },
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

    // 非空占位分组用于启用 /posts/ 下的侧边栏布局，实际内容由 PostSidebar 渲染。
    sidebar: {
      '/posts/': [
        { text: '文章导航', items: [] },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/roydonGuo' },
      // 顶部导航提供显式 RSS 订阅入口。
      { icon: { svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.18 17.82a2.18 2.18 0 1 1-4.36 0 2.18 2.18 0 0 1 4.36 0ZM1.82 8.55v3.1A10.53 10.53 0 0 1 12.35 22.18h3.1A13.63 13.63 0 0 0 1.82 8.55Zm0-6.73v3.1A17.26 17.26 0 0 1 19.08 22.18h3.1A20.36 20.36 0 0 0 1.82 1.82Z"/></svg>' }, link: '/feed.xml', ariaLabel: 'RSS Feed' },
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
