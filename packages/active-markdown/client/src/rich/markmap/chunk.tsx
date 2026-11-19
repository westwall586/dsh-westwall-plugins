/** Markmap renderer loaded on demand; the entry bundle never carries markmap code. */
import type { INode, IPureNode } from 'markmap-common'
import { Markmap } from 'markmap-view'
import type { MarkmapNode } from '../tree.ts'
import { MAX_SCALE, MIN_SCALE } from '../stage-math.ts'
import { interactionOptions, type MarkmapInteraction } from './options.ts'

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
  /** d3 scale the last fit produced, which the footer shows as 100%. */
  fitScale(): number
  /** Zoom about the viewport center, as a factor of the current scale. */
  rescale(scale: number): void
  /** Fit every node into the viewport and adopt that scale as 100%. */
  fit(): void
}

export default {
  /**
   * Mount one interactive mind map into an empty SVG element.
   * @param svg - the element markmap draws into.
   * @param tree - nodes derived from the fence body.
   * @param palette - resolved theme tokens; branch colors and text come from it.
   * @param mode - the fence in place, or the expanded panel; it decides wheel and drag.
   * @param onScale - receives the scale after every pan and zoom.
   * @returns the controls the expanded panel drives, plus teardown.
   */
  mount(
    svg: SVGSVGElement,
    tree: MarkmapNode,
    palette: Record<string, string>,
    mode: MarkmapInteraction,
    onScale?: (scale: number) => void,
  ): MarkmapHandle {
    const colors = colorsOf(palette)
    const fallback = palette.primaryTextColor ?? 'currentColor'
    const map = Markmap.create(svg, {
      autoFit: true,
      duration: 0,
      initialExpandLevel: 2,
      color: (node: INode) => (colors.length === 0 ? fallback : colors[node.state.depth % colors.length]!),
      ...interactionOptions(mode),
    }, toPure(tree))
    // d3 keeps the live transform on the element and re-emits zoom through the
    // behavior rather than the element, so the scale hook rides that dispatch
    // under its own name and leaves markmap's 'zoom' listener painting.
    const current = (): number => (svg as SVGSVGElement & { __zoom?: { k?: number } }).__zoom?.k ?? 1
    const emit = (): void => { onScale?.(current()) }
    map.zoom.on('zoom.scale-track', emit).scaleExtent([MIN_SCALE, MAX_SCALE])
    // autoFit and this fit settle on the same transform; running it here is what
    // lets the handle record the fitted scale as the footer's 100%.
    let fitScale = current()
    const adoptFit = (): void => {
      fitScale = current()
      emit()
    }
    const fit = (): void => { void map.fit().then(adoptFit) }
    fit()
    return {
      dispose: () => {
        map.zoom.on('zoom.scale-track', null)
        map.destroy()
      },
      scale: current,
      fitScale: () => fitScale,
      rescale: (scale) => { void map.rescale(scale) },
      fit,
    }
  },
}
