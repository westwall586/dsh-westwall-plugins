/** Markmap renderer loaded on demand; the entry bundle never carries markmap code. */
import type { INode, IPureNode } from 'markmap-common'
import { Markmap } from 'markmap-view'
import type { MarkmapNode } from '../tree.ts'

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Node content is inner HTML, so escape markup and keep the tree's line break. */
function toHtml(content: string): string {
  return content.replace(/[&<>"']/g, character => ESCAPES[character]!).replace(/\n/g, '<br>')
}

function toPure(node: MarkmapNode): IPureNode {
  return { content: toHtml(node.content), children: node.children.map(toPure) }
}

/** Branch colors taken from the host palette, cycled by depth. */
function colorsOf(palette: Record<string, string>): string[] {
  return [
    palette.accentBusiness,
    palette.accentSuccess,
    palette.accentWarn,
    palette.accentError,
    palette.accentDone,
    palette.primaryBorderColor,
  ].filter((color): color is string => typeof color === 'string' && color !== '')
}

export default {
  /**
   * Mount one interactive mind map into an empty SVG element.
   * @param svg - the element markmap draws into.
   * @param tree - nodes derived from the fence body.
   * @param palette - resolved theme tokens; branch colors and text come from it.
   * @returns a teardown that removes every node and listener markmap added.
   */
  mount(svg: SVGSVGElement, tree: MarkmapNode, palette: Record<string, string>): () => void {
    const colors = colorsOf(palette)
    const fallback = palette.primaryTextColor ?? 'currentColor'
    const map = Markmap.create(svg, {
      autoFit: true,
      duration: 0,
      initialExpandLevel: 2,
      color: (node: INode) => (colors.length === 0 ? fallback : colors[node.state.depth % colors.length]!),
    }, toPure(tree))
    return () => { map.destroy() }
  },
}
