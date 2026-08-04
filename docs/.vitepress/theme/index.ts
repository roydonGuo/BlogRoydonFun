// https://vitepress.dev/guide/custom-theme
import { h } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import PostList from '../components/PostList.vue'
import ArchiveList from '../components/ArchiveList.vue'
import LinksList from '../components/LinksList.vue'
import PostFilter from '../components/PostFilter.vue'
import PostPrevNext from '../components/PostPrevNext.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      'aside-top': () => h(PostFilter),
      // Post pages have no sidebar, so provide pagination from the post data source.
      'doc-after': () => h(PostPrevNext),
    })
  },
  enhanceApp({ app, router, siteData }) {
    app.component('PostList', PostList)
    app.component('ArchiveList', ArchiveList)
    app.component('LinksList', LinksList)
  }
} satisfies Theme
