const PROCESSED_ATTRIBUTE = 'data-link-icon-processed'

/**
 * 为文章正文中的外部链接设置 favicon.im 图标。
 * 内部链接、锚点、图片链接和显式标记为 .not 的链接不会被处理。
 */
export function initLinkIcons(): void {
  if (typeof window === 'undefined') return

  const selector = `.vp-doc a[href]:not([${PROCESSED_ATTRIBUTE}])`
  const links = document.querySelectorAll<HTMLAnchorElement>(selector)

  links.forEach((link) => {
    // 标题锚点、图片链接和代码区域不应出现 favicon。
    if (
      link.classList.contains('not')
      || link.classList.contains('header-anchor')
      || link.querySelector('img')
      || link.closest('pre, code')
    ) {
      link.setAttribute(PROCESSED_ATTRIBUTE, 'true')
      return
    }

    const href = link.getAttribute('href')
    if (!href || href.startsWith('#') || href.startsWith('/') || href.startsWith('.')) {
      link.setAttribute(PROCESSED_ATTRIBUTE, 'true')
      return
    }

    try {
      const url = new URL(href, window.location.origin)
      const isExternalHttpLink = (url.protocol === 'http:' || url.protocol === 'https:')
        && url.hostname !== window.location.hostname

      if (isExternalHttpLink) {
        const faviconUrl = `https://favicon.im/${encodeURIComponent(url.hostname)}`
        link.style.setProperty('--link-favicon', `url("${faviconUrl}")`)
        link.classList.add('has-link-favicon')
      }
    } catch {
      // 无效 URL 保持 VitePress 默认链接样式，不阻断其他链接处理。
    } finally {
      link.setAttribute(PROCESSED_ATTRIBUTE, 'true')
    }
  })
}
