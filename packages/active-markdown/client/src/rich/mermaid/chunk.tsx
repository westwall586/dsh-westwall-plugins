/** Mermaid renderer loaded on demand; the entry bundle never carries mermaid code. */
import mermaid from 'mermaid'

/** Bounded one-theme SVG cache; a theme change clears it. */
const CACHE_LIMIT = 24
const cache = new Map<string, string>()
let configured = ''
let counter = 0
let queue: Promise<void> = Promise.resolve()

/** Identity of one palette; equal keys mean mermaid needs no reconfiguration. */
function paletteKey(palette: Record<string, string>): string {
  return Object.keys(palette).sort().map(name => `${name}=${palette[name]}`).join(';')
}

/** Initialize mermaid lazily, and again only when the host palette moved. */
function configure(palette: Record<string, string>): string {
  const key = paletteKey(palette)
  if (key !== configured) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'base',
      maxTextSize: 20000,
      maxEdges: 500,
      themeVariables: palette,
    })
    configured = key
    cache.clear()
  }
  return key
}

/**
 * Mermaid can emit HTML labels that XML parses as mismatched. Reparse those as
 * HTML, then pin width and height to the viewBox so CSS scaling keeps the ratio.
 */
function normalize(svg: string): string {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return svg
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const broken = parsed.querySelector('parsererror') !== null
  const root = broken
    ? new DOMParser().parseFromString(svg, 'text/html').querySelector('svg')
    : parsed.documentElement
  if (root === null) return svg
  const box = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (box !== undefined && box.length === 4 && box.every(Number.isFinite)) {
    root.setAttribute('width', String(Math.ceil(box[2]!)))
    root.setAttribute('height', String(Math.ceil(box[3]!)))
  }
  root.removeAttribute('style')
  return new XMLSerializer().serializeToString(root)
}

async function renderNow(code: string, palette: Record<string, string>): Promise<string> {
  const theme = configure(palette)
  const key = `${theme}\u0000${code}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  counter += 1
  const { svg } = await mermaid.render(`am-mermaid-${counter}`, code)
  if (typeof svg !== 'string' || svg.length === 0) throw new Error('Mermaid returned an empty diagram')
  const normalized = normalize(svg)
  if (cache.has(key)) cache.delete(key)
  else if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, normalized)
  return normalized
}

export default {
  /**
   * Render one diagram as standalone SVG text.
   * @param code - the fence body.
   * @param palette - resolved theme tokens for mermaid's `themeVariables`.
   * @returns the SVG document text.
   */
  async render(code: string, palette: Record<string, string>): Promise<string> {
    const run = queue.then(() => renderNow(code, palette))
    queue = run.then(() => undefined, () => undefined)
    return run
  },
}
