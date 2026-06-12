import { createContentLoader } from 'vitepress'

export default createContentLoader('posts/*.md', {
  exclude: ['posts/index.md'],
  transform(raw) {
    return raw
      .filter(page => !page.url.endsWith('/posts/'))
      .map(page => ({
        title: page.frontmatter.title || page.url,
        url: page.url,
        date: page.frontmatter.date,
        category: page.frontmatter.category || '未分类',
        tags: page.frontmatter.tags || [],
        excerpt: page.frontmatter.excerpt || page.excerpt || '',
      }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  },
})
