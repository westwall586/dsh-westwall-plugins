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

/** What the view drives after the map is mounted. */
export interface MarkmapHandle {
  /** Remove the map and every listener it added. */
  dispose(): void
  /** Current d3 zoom scale. */
  scale(): number
  /** Zoom about the viewport center. */
  rescale(scale: number): void
  /** Fit every node into the viewport. */
  fit(): void
}

export default {
  /**
   * Mount one interactive mind map into an empty SVG element.
   * @param svg - the element markmap draws into.
   * @param tree - nodes derived from the fence body.
   * @param palette - resolved theme tokens; branch colors and text come from it.
   * @param onScale - receives the scale after every pan and zoom.
   * @returns the controls the expanded panel drives, plus teardown.
   */
  mount(
    svg: SVGSVGElement,
    tree: MarkmapNode,
    palette: Record<string, string>,
    onScale?: (scale: number) => void,
  ): MarkmapHandle {
    const colors = colorsOf(palette)
    const fallback = palette.primaryTextColor ?? 'currentColor'
    const map = Markmap.create(svg, {
      autoFit: true,
      duration: 0,
      initialExpandLevel: 2,
      color: (node: INode) => (colors.length === 0 ? fallback : colors[node.state.depth % colors.length]!),
    }, toPure(tree))
    // d3 keeps the live transform on the element; its own selection dispatch is
    // the only reliable signal, so the scale hook rides that listener.
    const current = (): number => (svg as SVGSVGElement & { __zoom?: { k?: number } }).__zoom?.k ?? 1
    const emit = (): void => { onScale?.(current()) }
    map.svg.on('zoom.scale-track', emit)
    emit()
    // The view drives the map through the element it already owns, so the handle
    // survives React re-renders without another ref handoff.
    const api: MarkmapHandle = {
      dispose: () => {
        map.svg.on('zoom.scale-track', null)
        delete (svg as SVGSVGElement & { __markmapHandle?: MarkmapHandle }).__markmapHandle
        map.destroy()
      },
      scale: current,
      rescale: (scale) => { void map.rescale(scale) },
      fit: () => { void map.fit() },
    }
    ;(svg as SVGSVGElement & { __markmapHandle?: MarkmapHandle }).__markmapHandle = api
    return api
  },
}
