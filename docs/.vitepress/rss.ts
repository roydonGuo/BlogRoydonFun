import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createContentLoader } from 'vitepress'
import type { ContentData, PageData, SiteConfig } from 'vitepress'
import type { Plugin } from 'vite'

const SITE_URL = 'https://blog.roydon.fun'
const FEED_PATH = '/feed.xml'

interface RssPost {
  title: string
  link: string
  description: string
  date: Date
  categories: string[]
}

const rssPosts = new Map<string, RssPost>()

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function parsePostDate(rawDate: unknown, fallback?: number): Date | undefined {
  const date = rawDate instanceof Date
    ? rawDate
    : rawDate
      ? new Date(`${rawDate}T00:00:00+08:00`)
      : fallback
        ? new Date(fallback)
        : undefined

  return date && !Number.isNaN(date.getTime()) ? date : undefined
}

function createRssPost(url: string, frontmatter: Record<string, any>, fallbackTitle = '', fallbackDate?: number): RssPost | undefined {
  const date = parsePostDate(frontmatter.date, fallbackDate)
  if (!date) return undefined

  const category = frontmatter.category || '未分类'
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : []

  return {
    title: frontmatter.title || fallbackTitle || url,
    link: `${SITE_URL}${url}`,
    description: frontmatter.excerpt || '',
    date,
    categories: [category, ...tags],
  }
}

// 构建每篇 Markdown 时收集 RSS 元数据，避免再次解析 frontmatter。
export function collectRssPost(pageData: PageData): void {
  const relativePath = pageData.relativePath.replace(/\\/g, '/')
  if (!relativePath.startsWith('posts/') || relativePath === 'posts/index.md') return

  const url = `/${relativePath.replace(/\.md$/, '.html')}`
  const post = createRssPost(url, pageData.frontmatter, pageData.title, pageData.lastUpdated)
  if (post) rssPosts.set(relativePath, post)
}

function renderRssItem(post: RssPost): string {
  const categories = post.categories
    .map(category => `      <category>${escapeXml(category)}</category>`)
    .join('\n')

  return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(post.link)}</link>
      <guid isPermaLink="true">${escapeXml(post.link)}</guid>
      <pubDate>${post.date.toUTCString()}</pubDate>
      <description>${escapeXml(post.description)}</description>
${categories}
    </item>`
}

function renderRssFeed(posts: RssPost[]): string {
  const sortedPosts = [...posts].sort((a, b) => b.date.getTime() - a.date.getTime())
  const items = sortedPosts.map(renderRssItem).join('\n')
  const buildDate = sortedPosts[0]?.date || new Date()

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Ethan</title>
    <link>${SITE_URL}/</link>
    <description>Thoughts on code, design &amp; life</description>
    <language>zh-CN</language>
    <lastBuildDate>${buildDate.toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}${FEED_PATH}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`
}

function createPostsFromContent(pages: ContentData[]): RssPost[] {
  return pages.flatMap((page) => {
    if (page.url === '/posts/') return []
    const post = createRssPost(page.url, page.frontmatter)
    return post ? [post] : []
  })
}

// 开发服务器不会执行 buildEnd，因此通过中间件即时返回 RSS，避免 /feed.xml 落入 HTML 回退路由。
export function rssDevPlugin(): Plugin {
  return {
    name: 'ethan-rss-dev',
    apply: 'serve',
    configureServer(server) {
      const loader = createContentLoader('posts/*.md')

      server.middlewares.use(async (request, response, next) => {
        const requestPath = request.url?.split('?', 1)[0]
        if (requestPath !== FEED_PATH) {
          next()
          return
        }

        try {
          const pages = await loader.load()
          const xml = renderRssFeed(createPostsFromContent(pages))
          response.statusCode = 200
          response.setHeader('Content-Type', 'application/rss+xml; charset=utf-8')
          response.end(xml)
        }
        catch (error) {
          server.config.logger.error(`RSS generation failed: ${String(error)}`)
          response.statusCode = 500
          response.end('RSS generation failed')
        }
      })
    },
  }
}

// SSG 完成后将文章元数据输出为标准 RSS 2.0 文件。
export async function writeRssFeed(siteConfig: SiteConfig): Promise<void> {
  const xml = renderRssFeed(Array.from(rssPosts.values()))
  await writeFile(join(siteConfig.outDir, 'feed.xml'), xml, 'utf8')
}