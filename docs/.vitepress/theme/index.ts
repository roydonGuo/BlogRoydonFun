// https://vitepress.dev/guide/custom-theme
import { defineComponent, h, nextTick, provide } from 'vue'
import { useData } from 'vitepress'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import PostList from '../components/PostList.vue'
import ArchiveList from '../components/ArchiveList.vue'
import LinksList from '../components/LinksList.vue'
import ProjectGallery from '../components/ProjectGallery.vue'
import PostFilter from '../components/PostFilter.vue'
import PostPrevNext from '../components/PostPrevNext.vue'
import PostSidebar from '../components/PostSidebar.vue'
import KnowledgeGraph from '../components/KnowledgeGraph.vue'
import MermaidDiagram from '../components/MermaidDiagram.vue'
import ArticleReader from '../components/ArticleReader.vue'
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
      // 文章页左侧栏复用 posts.data.ts，自动按分类展示全部文章。
      'sidebar-nav-before': () => h(PostSidebar),
      'aside-top': () => h(PostFilter),
      // 在文章正文前提供浏览器原生语音朗读控件。
      'doc-before': () => h(ArticleReader),
      // 文章详情页继续复用文章数据源提供上一篇和下一篇导航。
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
    // 项目页使用独立组件承载瀑布流、筛选与详情弹窗交互。
    app.component('ProjectGallery', ProjectGallery)
    app.component('KnowledgeGraph', KnowledgeGraph)
    app.component('MermaidDiagram', MermaidDiagram)

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
