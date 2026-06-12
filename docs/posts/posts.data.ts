import { createContentLoader } from 'vitepress'

function getDefaultCover(category?: string): string {
  const map: Record<string, string> = {
    '后端开发': '/covers/backend.svg',
    '前端开发': '/covers/frontend.svg',
    '随笔': '/covers/life.svg',
  }
  return map[category || ''] || '/covers/life.svg'
}

export default createContentLoader('posts/*.md', {
  exclude: ['posts/index.md'],
  transform(raw) {
    return raw
      .filter(page => !page.url.endsWith('/posts/'))
      .map(page => {
        const rawDate = page.frontmatter.date
        const dateStr = rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : (rawDate || '')
        return {
          title: page.frontmatter.title || page.url,
          url: page.url,
          date: dateStr,
          category: page.frontmatter.category || '未分类',
          tags: page.frontmatter.tags || [],
          cover: page.frontmatter.cover || getDefaultCover(page.frontmatter.category),
          excerpt: page.frontmatter.excerpt || page.excerpt || '',
        }
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  },
})
