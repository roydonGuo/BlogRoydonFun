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

export const posts = rawPosts as PostItem[]

/* ---- Filter state (shared singleton) ---- */
export const selectedCategory = ref<string | null>(null)
export const selectedTag = ref<string | null>(null)

/* ---- Derived data ---- */
export const categories = computed(() => {
  return Array.from(new Set(posts.map(p => p.category)))
})

export const tags = computed(() => {
  const set = new Set<string>()
  posts.forEach(p => p.tags.forEach(t => set.add(t)))
  return Array.from(set).sort()
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
