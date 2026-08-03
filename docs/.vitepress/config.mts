import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Roydon',
  description: 'Thoughts on code, design & life',

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

    sidebar: [],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/roydonGuo' },
    ],

    footer: {
      message: 'Thoughts on code, design & life',
      copyright: 'Copyright © 2026 Roydon',
    },
  },
})
