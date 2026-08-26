import { ref, computed } from 'vue'
import { data as rawPosts } from '../../posts/posts.data'

export interface PostItem {
  title: string
  url: string
  date: string
  category: string
  tags: string[]
  cover: string
  excerpt: string
}

export interface CategoryFeature {
  title: string
  category: string
  description: string
  count: number
  primaryColor: string
  iconGradient: string
  icon: string
}

export interface MonthlyArticleStat {
  key: string
  year: number
  month: number
  monthLabel: string
  count: number
}

type CategoryFeatureConfig = Pick<CategoryFeature, 'description' | 'primaryColor' | 'iconGradient' | 'icon'>

// 分类展示配置统一放在文章领域层，新增分类时只需在这里补充专属视觉信息。
const categoryFeatureConfig: Record<string, CategoryFeatureConfig> = {
  '后端开发': {description: 'Java、Spring、网络与服务端工程实践', primaryColor: '#536df6', iconGradient: 'linear-gradient(135deg, #4266ff, #7044f7)', icon: '/category/java.svg'},
  '前端开发': {description: 'Vue、CSS、浏览器与前端工程化', primaryColor: '#3fcba2', iconGradient: 'linear-gradient(135deg, #3ed8aa, #29b987)', icon: '/category/html.svg'},
  AI: {description: 'Agent、RAG、大模型应用与智能工程', primaryColor: '#8b5cf6', iconGradient: 'linear-gradient(135deg, #7c3aed, #a855f7)', icon: '/category/gpt.svg'},
  MySQL: {description: '索引、事务、锁与数据库内核', primaryColor: '#2496ed', iconGradient: 'linear-gradient(135deg, #1676bd, #39a9ef)', icon: '/category/mysql.svg'},
  Redis: {description: '数据结构、持久化与高可用实践', primaryColor: '#ef5350', iconGradient: 'linear-gradient(135deg, #dc382d, #f56b61)', icon: '/category/redis.svg'},
  '随笔': {description: '阅读记录、生活观察与思考碎片', primaryColor: '#ff7598', iconGradient: 'linear-gradient(135deg, #ff879d, #ff668d)', icon: '/category/sb.svg'},
  MQ: {description: '消息可靠性、异步架构与中间件实践', primaryColor: '#f59e0b', iconGradient: 'linear-gradient(135deg, #e88b00, #ffc247)', icon: '/category/mq.svg'},
}

const defaultCategoryFeatureConfig: CategoryFeatureConfig = {
  description: '该分类下的技术文章与实践记录',
  primaryColor: '#64748b',
  iconGradient: 'linear-gradient(135deg, #64748b, #94a3b8)',
  icon: '/favicon.svg',
}

export const posts = rawPosts as PostItem[]

/* ---- Filter state (shared singleton) ---- */
export const selectedCategory = ref<string | null>(null)
export const selectedTag = ref<string | null>(null)

/* ---- Derived data ---- */
export const categories = computed(() => {
  return Array.from(new Set(posts.map(p => p.category)))
})

// 按文章发布日期聚合有内容的月份，供首页月度归档统计复用。
export const monthlyArticleStats = computed<MonthlyArticleStat[]>(() => {
  const counts = new Map<string, number>()
  posts.forEach(post => {
    const key = post.date.slice(0, 7)
    if (/^\d{4}-\d{2}$/.test(key)) counts.set(key, (counts.get(key) || 0) + 1)
  })

  return Array.from(counts, ([key, count]) => {
    const [year, month] = key.split('-').map(Number)
    return {key, year, month, monthLabel: `${month}月`, count}
  }).sort((a, b) => b.key.localeCompare(a.key))
})

// 从文章数据动态生成首页分类特性，确保分类集合和文章数量不会写死。
export const features = computed<CategoryFeature[]>(() => {
  const counts = new Map<string, number>()
  posts.forEach(post => counts.set(post.category, (counts.get(post.category) || 0) + 1))

  return Array.from(counts, ([category, count]) => ({
    title: category,
    category,
    count,
    ...(categoryFeatureConfig[category] || defaultCategoryFeatureConfig),
  })).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'zh-CN'))
})

export const tags = computed(() => {
  const set = new Set<string>()
  posts.forEach(p => p.tags.forEach(t => set.add(t)))
  return Array.from(set).sort()
})

export const tagArticleCounts = computed<Record<string, number>>(() => {
  return posts.reduce<Record<string, number>>((counts, post) => {
    new Set(post.tags).forEach(tag => {
      counts[tag] = (counts[tag] || 0) + 1
    })
    return counts
  }, {})
})

export const filteredPosts = computed(() => {
  return posts.filter(p => {
    if (selectedCategory.value && p.category !== selectedCategory.value) return false
    if (selectedTag.value && !p.tags.includes(selectedTag.value)) return false
    return true
  })
})

export const activeFilter = computed(() => selectedCategory.value || selectedTag.value)

export const activeFilterLabel = computed(() => {
  if (selectedCategory.value && selectedTag.value) {
    return `${selectedCategory.value} · #${selectedTag.value}`
  }
  if (selectedCategory.value) return `分类：${selectedCategory.value}`
  if (selectedTag.value) return `标签：#${selectedTag.value}`
  return ''
})

/* ---- Methods ---- */
export function filterByCategory(cat: string) {
  selectedCategory.value = selectedCategory.value === cat ? null : cat
  selectedTag.value = null
}

export function filterByTag(tag: string) {
  selectedTag.value = selectedTag.value === tag ? null : tag
  selectedCategory.value = null
}

export function clearFilter() {
  selectedCategory.value = null
  selectedTag.value = null
}
