// https://vitepress.dev/guide/custom-theme
import { h } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import PostList from '../components/PostList.vue'
import ArchiveList from '../components/ArchiveList.vue'
import PostFilter from '../components/PostFilter.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      'aside-top': () => h(PostFilter),
    })
  },
  enhanceApp({ app, router, siteData }) {
    app.component('PostList', PostList)
    app.component('ArchiveList', ArchiveList)
  }
} satisfies Theme
