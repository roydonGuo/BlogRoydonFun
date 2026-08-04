import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Roydon',
  description: 'Thoughts on code, design & life',

  // Read each page timestamp from its latest Git commit.
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', href: '/favicon.svg' }],
  ],

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '文章', link: '/posts/' },
      { text: '归档', link: '/archive/' },
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
      copyright: 'Copyright © 2026 Roydon',
    },
  },
})
