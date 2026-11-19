/** Resolve the host's theme tokens into the palettes the diagram chunks consume. */
import { useMemo, useSyncExternalStore } from 'react'

/** Theme tokens, keyed by the names Mermaid uses in `themeVariables`. */
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
  // Mind-map branch colors. Mermaid ignores names it does not know.
  accentBusiness: '--dsw-alias-state-business-primary',
  accentSuccess: '--dsw-alias-state-success-primary',
  accentWarn: '--dsw-alias-state-warn-primary',
  accentError: '--dsw-alias-state-error-primary',
  accentDone: '--dsw-alias-state-done-primary',
}

/** Read every mapped token from the host body, skipping tokens the theme does not define. */
export function readPalette(): Record<string, string> {
  if (typeof document === 'undefined') return {}
  const style = getComputedStyle(document.body)
  const palette: Record<string, string> = {}
  for (const [name, token] of Object.entries(TOKENS)) {
    const value = style.getPropertyValue(token).trim()
    if (value !== '') palette[name] = value
  }
  const font = style.fontFamily.trim()
  if (font !== '') palette.fontFamily = font
  palette.fontSize = '14px'
  return palette
}

/** Order-independent identity of one palette, used to invalidate rendered diagrams. */
export function paletteKey(palette: Record<string, string>): string {
  return Object.keys(palette).sort().map(name => `${name}=${palette[name]}`).join(';')
}

let key = ''
const listeners = new Set<() => void>()
let observer: MutationObserver | undefined
let scheme: MediaQueryList | undefined

/** Re-read the palette and wake subscribers only when a token value actually moved. */
function refresh(): void {
  const next = paletteKey(readPalette())
  if (next === key) return
  key = next
  for (const listener of listeners) listener()
}

/** Seed the identity before React asks for it; an already resolved palette keeps its value. */
function snapshot(): string {
  if (key === '') key = paletteKey(readPalette())
  return key
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (observer === undefined && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(refresh)
    for (const target of [document.body, document.documentElement]) {
      observer.observe(target, { attributes: true, attributeFilter: ['class', 'style', 'data-ds-dark-theme', 'data-theme'] })
    }
  }
  if (scheme === undefined && typeof matchMedia !== 'undefined') {
    scheme = matchMedia('(prefers-color-scheme: dark)')
    scheme.addEventListener('change', refresh)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    observer?.disconnect()
    observer = undefined
    scheme?.removeEventListener('change', refresh)
    scheme = undefined
  }
}

/**
 * The palette of the current theme, re-read whenever the host restyles.
 * @returns resolved token values, stable until the theme changes.
 */
export function usePalette(): Record<string, string> {
  const identity = useSyncExternalStore(subscribe, snapshot, () => '')
  return useMemo(readPalette, [identity])
}
