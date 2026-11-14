/** Resolved host palette, lazy Mermaid loader, serial render queue, and a bounded SVG cache. */
import * as React from 'react'
import { cacheKey, type ThemeFingerprint } from './core.ts'
import type { ClientContext } from './context.ts'

const TOKENS: Record<string, string> = {
  background: '--dsw-alias-bg-layer-1',
  primaryColor: '--dsw-alias-bg-layer-2',
  secondaryColor: '--dsw-alias-bg-layer-3',
  tertiaryColor: '--dsw-alias-bg-layer-1',
  primaryTextColor: '--dsw-alias-label-primary',
  secondaryTextColor: '--dsw-alias-label-secondary',
  tertiaryTextColor: '--dsw-alias-label-tertiary',
  textColor: '--dsw-alias-label-primary',
  titleColor: '--dsw-alias-label-primary',
  mainBkg: '--dsw-alias-bg-layer-2',
  nodeBorder: '--dsw-alias-brand-primary',
  primaryBorderColor: '--dsw-alias-brand-primary',
  secondaryBorderColor: '--dsw-alias-border-l1',
  tertiaryBorderColor: '--dsw-alias-border-l2',
  lineColor: '--dsw-alias-border-l2',
  edgeLabelBackground: '--dsw-alias-bg-layer-1',
  clusterBkg: '--dsw-alias-bg-layer-2',
  clusterBorder: '--dsw-alias-border-l2',
  actorBkg: '--dsw-alias-bg-layer-2',
  actorBorder: '--dsw-alias-border-l1',
  actorTextColor: '--dsw-alias-label-primary',
  actorLineColor: '--dsw-alias-border-l2',
  signalColor: '--dsw-alias-label-secondary',
  signalTextColor: '--dsw-alias-label-primary',
  labelBoxBkgColor: '--dsw-alias-bg-layer-2',
  labelBoxBorderColor: '--dsw-alias-border-l1',
  labelTextColor: '--dsw-alias-label-primary',
  loopTextColor: '--dsw-alias-label-primary',
  noteBkgColor: '--dsw-alias-bg-layer-3',
  noteTextColor: '--dsw-alias-label-primary',
  noteBorderColor: '--dsw-alias-border-l2',
  activationBkgColor: '--dsw-alias-bg-layer-3',
  activationBorderColor: '--dsw-alias-border-l2',
  sequenceNumberColor: '--dsw-alias-label-secondary',
  sectionBkgColor: '--dsw-alias-bg-layer-2',
  altSectionBkgColor: '--dsw-alias-bg-layer-1',
  sectionBkgColor2: '--dsw-alias-bg-layer-3',
  taskBkgColor: '--dsw-alias-bg-layer-2',
  taskBorderColor: '--dsw-alias-border-l1',
  taskTextColor: '--dsw-alias-label-primary',
  taskTextDarkColor: '--dsw-alias-label-primary',
  taskTextOutsideColor: '--dsw-alias-label-secondary',
  gridColor: '--dsw-alias-border-l1',
  doneTaskBkgColor: '--dsw-alias-bg-layer-3',
  doneTaskBorderColor: '--dsw-alias-border-l2',
  critBkgColor: '--dsw-alias-bg-layer-3',
  critBorderColor: '--dsw-alias-brand-primary',
  todayLineColor: '--dsw-alias-brand-primary',
  quadrant1Fill: '--dsw-alias-bg-layer-2',
  quadrant2Fill: '--dsw-alias-bg-layer-1',
  quadrant3Fill: '--dsw-alias-bg-layer-3',
  quadrant4Fill: '--dsw-alias-bg-layer-2',
  quadrant1TextFill: '--dsw-alias-label-primary',
  quadrant2TextFill: '--dsw-alias-label-primary',
  quadrant3TextFill: '--dsw-alias-label-primary',
  quadrant4TextFill: '--dsw-alias-label-primary',
  quadrantPointFill: '--dsw-alias-brand-primary',
  quadrantTitleFill: '--dsw-alias-label-secondary',
  git0: '--dsw-alias-brand-primary',
  git1: '--dsw-alias-label-secondary',
  git2: '--dsw-alias-border-l1',
  git3: '--dsw-alias-bg-layer-3',
  gitBranchLabel0: '--dsw-alias-label-primary',
  gitBranchLabel1: '--dsw-alias-label-secondary',
  gitBranchLabel2: '--dsw-alias-label-tertiary',
  gitBranchLabel3: '--dsw-alias-label-primary',
  pie1: '--dsw-alias-brand-primary',
  pie2: '--dsw-alias-bg-layer-2',
  pie3: '--dsw-alias-bg-layer-3',
  pie4: '--dsw-alias-border-l1',
  pieStrokeColor: '--dsw-alias-bg-layer-1',
  pieOuterStrokeColor: '--dsw-alias-border-l2',
  pieTitleTextColor: '--dsw-alias-label-primary',
  pieSectionTextColor: '--dsw-alias-label-primary',
  pieLegendTextColor: '--dsw-alias-label-secondary',
}

const CACHE_LIMIT = 24
const cache = new Map<string, string>()
let queue: Promise<void> = Promise.resolve()
let loader: Promise<typeof import('mermaid')> | undefined
let renderCounter = 0

let themeRevision = 0
const themeListeners = new Set<() => void>()

export function resolveTheme(): ThemeFingerprint {
  const style = getComputedStyle(document.body)
  const variables: Record<string, string> = {}
  for (const [name, token] of Object.entries(TOKENS)) {
    const value = style.getPropertyValue(token).trim()
    if (value.length > 0) variables[name] = value
  }
  const fontFamily = style.fontFamily.trim()
  if (fontFamily.length > 0) variables.fontFamily = fontFamily
  variables.fontSize = '14px'
  return {
    scheme: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light',
    variables,
  }
}

function notifyTheme(): void {
  themeRevision += 1
  for (const listener of themeListeners) listener()
}

export function watchTheme(ctx: ClientContext): void {
  ctx.effect(() => {
    const off = ctx.on('theme/change', notifyTheme)
    if (typeof MutationObserver === 'undefined') return off
    const observer = new MutationObserver(notifyTheme)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => {
      off()
      observer.disconnect()
    }
  }, 'friendly-expression theme changes')
}

function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener)
  return () => { themeListeners.delete(listener) }
}

function getThemeRevision(): number {
  return themeRevision
}

export function useResolvedTheme(): ThemeFingerprint {
  const revision = React.useSyncExternalStore(subscribeTheme, getThemeRevision, () => 0)
  return React.useMemo(() => resolveTheme(), [revision])
}

function readCache(key: string): string | undefined {
  const value = cache.get(key)
  if (value === undefined) return undefined
  cache.delete(key)
  cache.set(key, value)
  return value
}

function writeCache(key: string, svg: string): void {
  if (cache.has(key)) cache.delete(key)
  else if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, svg)
}

/**
 * Mermaid can emit HTML labels that XML parses as mismatched (`<p>` closed by
 * `<br>`). Reparse those as HTML so the image decoder accepts them, and pin
 * width/height to the viewBox so the image keeps its intrinsic aspect ratio.
 */
function normalizeSvg(svg: string): string {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return svg
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const broken = parsed.querySelector('parsererror') !== null
  const root = broken
    ? new DOMParser().parseFromString(svg, 'text/html').querySelector('svg')
    : parsed.documentElement
  if (root === null) return svg
  const box = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (box !== undefined && box.length === 4 && box.every(Number.isFinite)) {
    root.setAttribute('width', String(Math.ceil(box[2])))
    root.setAttribute('height', String(Math.ceil(box[3])))
  }
  root.removeAttribute('style')
  return new XMLSerializer().serializeToString(root)
}

async function renderNow(code: string, theme: ThemeFingerprint): Promise<string> {
  const key = cacheKey(code, theme)
  const cached = readCache(key)
  if (cached !== undefined) return cached
  loader ??= import('mermaid')
  const module = await loader
  const mermaid = module.default
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    maxTextSize: 20000,
    maxEdges: 500,
    suppressErrorRendering: true,
    theme: 'base',
    layout: 'dagre',
    themeVariables: theme.variables,
  })
  renderCounter += 1
  const { svg } = await mermaid.render(`dfe-mermaid-${renderCounter}`, code)
  if (typeof svg !== 'string' || svg.length === 0) throw new Error('Mermaid returned an empty diagram')
  const normalized = normalizeSvg(svg)
  writeCache(key, normalized)
  return normalized
}

/** One render at a time, cache included, so many fences cannot stack up parser work. */
export function renderMermaid(code: string, theme: ThemeFingerprint): Promise<string> {
  const run = queue.then(
    () => renderNow(code, theme),
    () => renderNow(code, theme),
  )
  queue = run.then(() => undefined, () => undefined)
  return run
}
