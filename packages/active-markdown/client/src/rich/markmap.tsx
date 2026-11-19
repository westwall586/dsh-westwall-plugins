/** A mind-map fence rendered inside the component frame, with a zoomable expanded view. */
import * as React from 'react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { loadChunk } from '../chunks.ts'
import { parseDocument } from '../markdown/blocks.ts'
import { RichError } from './fallback.tsx'
import type { RichLabels } from './labels.ts'
import { usePalette } from './palette.ts'
import { outlineToTree, type MarkmapNode } from './tree.ts'
import { ZoomPanel } from './zoom-panel.tsx'

interface MarkmapChunk {
  mount(svg: SVGSVGElement, tree: MarkmapNode, palette: Record<string, string>): () => void
}

type MountState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error', error: unknown }

let loaded: Promise<MarkmapChunk> | undefined

/** The chunk is loaded once and its API kept for every later diagram. */
function loadMarkmap(): Promise<MarkmapChunk> {
  loaded ??= loadChunk('client.markmap.js')
    .then(module => module as unknown as MarkmapChunk)
    .catch((error: unknown) => {
      loaded = undefined
      throw error
    })
  return loaded
}

interface MarkmapCanvasProps {
  tree: MarkmapNode
  palette: Record<string, string>
  className: string
  onState: (state: MountState) => void
}

/** Mount one markmap instance and tear it down whenever the data or theme changes. */
function MarkmapCanvas({ tree, palette, className, onState }: MarkmapCanvasProps): ReactNode {
  const holder = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    const svg = holder.current
    if (svg === null) return
    let alive = true
    let dispose: (() => void) | undefined
    onState({ kind: 'loading' })
    loadMarkmap().then((chunk) => {
      if (!alive) return
      try {
        dispose = chunk.mount(svg, tree, palette)
        onState({ kind: 'ready' })
      } catch (error) {
        onState({ kind: 'error', error })
      }
    }).catch((error: unknown) => {
      if (alive) onState({ kind: 'error', error })
    })
    return () => {
      alive = false
      dispose?.()
    }
  }, [tree, palette, onState])

  return <svg ref={holder} className={className} />
}

export interface MarkmapViewProps {
  code: string
  labels: RichLabels
  /** Set on the panel's copy, which carries its own zoom bar. */
  expanded: boolean
}

/**
 * Render one mind map from the fence's Markdown outline, in place or filling the expanded panel.
 * @param props - the fence body, localized copy, and whether this is the panel copy.
 * @returns the map, its loading state, or the source fallback.
 */
export function MarkmapView({ code, labels, expanded }: MarkmapViewProps): ReactNode {
  const palette = usePalette()
  // A lone top heading becomes the root itself; otherwise the map would open on
  // an empty node just above it.
  const tree = useMemo(() => {
    const full = outlineToTree(parseDocument(code).blocks)
    return full.children.length === 1 ? full.children[0]! : full
  }, [code])
  const [state, setState] = useState<MountState>({ kind: 'loading' })
  const [panelState, setPanelState] = useState<MountState>({ kind: 'loading' })

  if (state.kind === 'error') return <RichError code={code} error={state.error} labels={labels} />

  if (expanded) {
    return (
      <ZoomPanel labels={labels}>
        <MarkmapCanvas tree={tree} palette={palette} className="am-markmap-canvas" onState={setPanelState} />
        {panelState.kind === 'loading' ? <div className="am-rich-state" aria-busy="true">{labels.rendering}</div> : null}
        {panelState.kind === 'error' ? <RichError code={code} error={panelState.error} labels={labels} /> : null}
      </ZoomPanel>
    )
  }

  return (
    <div className="am-rich-view">
      <div className="am-rich-diagram am-rich-markmap" data-state={state.kind}>
        <MarkmapCanvas tree={tree} palette={palette} className="am-markmap-canvas" onState={setState} />
        {state.kind === 'loading' ? <div className="am-rich-state" aria-busy="true">{labels.rendering}</div> : null}
      </div>
    </div>
  )
}
