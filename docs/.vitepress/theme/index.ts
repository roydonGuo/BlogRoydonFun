// https://vitepress.dev/guide/custom-theme
import { defineComponent, h, nextTick, provide } from 'vue'
import { useData } from 'vitepress'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import PostList from '../components/PostList.vue'
import ArchiveList from '../components/ArchiveList.vue'
import LinksList from '../components/LinksList.vue'
import PostFilter from '../components/PostFilter.vue'
import PostPrevNext from '../components/PostPrevNext.vue'
import KnowledgeGraph from '../components/KnowledgeGraph.vue'
import { initLinkIcons } from './link-icons'
// 插件生成的语言/文件类型图标样式。
import 'virtual:group-icons.css'
// Tailwind v4 主题令牌与工具类。
import './tailwind.css'
// 基于教程改写的原生 CSS 代码块窗口样式。
import './code.css'
import './style.css'
// 自定义容器、引用和徽标的统一视觉样式。
import './block.css'
// 主题切换时从点击位置扩散的 View Transition 动画。
import './dark-transition.css'
// 方案二：通过 favicon.im 为文章外链动态添加站点图标。
import './link-icons.css'
// Mermaid 图表容器尺寸与主题背景样式。
import './mermaid.css'

interface ThemeViewTransition {
  ready: Promise<void>
}

interface ThemeTransitionDocument extends Document {
  startViewTransition(callback: () => Promise<void>): ThemeViewTransition
}

// 仅在浏览器支持 View Transitions 且用户未要求减少动态时启用动画。
function canAnimateThemeChange(): boolean {
  return typeof document !== 'undefined'
    && typeof window !== 'undefined'
    && 'startViewTransition' in document
    && window.matchMedia('(prefers-reduced-motion: no-preference)').matches
}

const AnimatedLayout = defineComponent({
  setup() {
    const { isDark } = useData()

    // 覆盖默认主题切换行为，让新主题从用户点击的位置向外扩散。
    provide('toggle-appearance', async (event: MouseEvent) => {
      if (!canAnimateThemeChange()) {
        isDark.value = !isDark.value
        return
      }

      const x = event.clientX
      const y = event.clientY
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      )
      const root = document.documentElement
      root.style.setProperty('--theme-transition-x', `${x}px`)
      root.style.setProperty('--theme-transition-y', `${y}px`)
      root.style.setProperty('--theme-transition-radius', `${radius}px`)

      const transition = (document as ThemeTransitionDocument).startViewTransition(async () => {
        isDark.value = !isDark.value
        await nextTick()
      })
      await transition.ready
    })

    return () => h(DefaultTheme.Layout, null, {
      'aside-top': () => h(PostFilter),
      // Post pages have no sidebar, so provide pagination from the post data source.
      'doc-after': () => h(PostPrevNext),
    })
  },
})

export default {
  extends: DefaultTheme,
  Layout: AnimatedLayout,
  enhanceApp({ app, router }) {
    app.component('PostList', PostList)
    app.component('ArchiveList', ArchiveList)
    app.component('LinksList', LinksList)
    app.component('KnowledgeGraph', KnowledgeGraph)

    // VitePress 客户端路由复用页面，需要在每次文章切换后处理新链接。
    if (typeof window !== 'undefined') {
      router.onAfterRouteChange = () => {
        window.requestAnimationFrame(initLinkIcons)
      }
    }
  },
  mounted() {
    // 首次水合结束后处理当前文章中的外部链接。
    initLinkIcons()
  },
} satisfies Theme
