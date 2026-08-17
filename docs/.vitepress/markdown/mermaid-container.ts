import type MarkdownIt from 'markdown-it'
import type { RuleBlock } from 'markdown-it/lib/parser_block.mjs'

/**
 * 将 :::mermaid 容器转换为 Vue 组件，同时保留容器内部的原始 Mermaid 文本。
 * 不依赖特定 VitePress 版本，避免第三方插件的 peer dependency 冲突。
 */
export function mermaidContainerPlugin(md: MarkdownIt): void {
  const renderMermaidContainer: RuleBlock = (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine]
    const max = state.eMarks[startLine]
    if (state.src.slice(start, max).trim() !== ':::mermaid') return false
    if (silent) return true

    let nextLine = startLine + 1
    while (nextLine < endLine) {
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
      const lineEnd = state.eMarks[nextLine]
      if (state.src.slice(lineStart, lineEnd).trim() === ':::') break
      nextLine++
    }
    if (nextLine >= endLine) return false

    const source = state.getLines(startLine + 1, nextLine, 0, false).trim()
    const token = state.push('html_block', '', 0)
    token.map = [startLine, nextLine + 1]
    // URI 编码可安全穿过 HTML 属性，组件端再恢复原始图表源码。
    token.content = `<MermaidDiagram encoded-code="${encodeURIComponent(source)}" />\n`
    state.line = nextLine + 1
    return true
  }

  md.block.ruler.before('fence', 'mermaid_container', renderMermaidContainer, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  })
}
