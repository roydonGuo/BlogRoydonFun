import { createContentLoader } from 'vitepress'

function countWords(markdown?: string): number {
  if (!markdown) return 0

  // 去除 Markdown 结构和代码片段，只统计正文中的中日韩字符与英文/数字单词。
  const plainText = markdown
    .replace(/^---[\s\S]*?---\s*/u, '')
    .replace(/```[\s\S]*?```/gu, '')
    .replace(/`[^`]*`/gu, '')
    .replace(/!\[[^\]]*]\([^)]*\)/gu, '')
    .replace(/\[([^\]]+)]\([^)]*\)/gu, '$1')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/[#>*_~|=-]/gu, ' ')

  const cjkCount = plainText.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu)?.length || 0
  const wordCount = plainText.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/gu)?.length || 0
  return cjkCount + wordCount
}

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
          // 仅接受布尔值 true，避免字符串 "true" 等非标准 frontmatter 值被误判为置顶。
          top: page.frontmatter.top === true,
        }
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  },
})
