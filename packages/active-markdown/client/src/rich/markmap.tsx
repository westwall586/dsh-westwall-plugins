/** A mind-map fence rendered inside the component frame, with an opt-in fullscreen view. */
import * as React from 'react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { loadChunk } from '../chunks.ts'
import { parseDocument } from '../markdown/blocks.ts'
import { RichError } from './fallback.tsx'
import { RichFullscreen } from './fullscreen.tsx'
import type { RichLabels } from './labels.ts'
import { usePalette } from './palette.ts'
import { outlineToTree, type MarkmapNode } from './tree.ts'

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
}

/**
 * Render one mind map from the fence's Markdown outline and let it be inspected fullscreen.
 * @param props - the fence body and localized copy.
 * @returns the map, its loading state, or the source fallback.
 */
export function MarkmapView({ code, labels }: MarkmapViewProps): ReactNode {
  const palette = usePalette()
  // A lone top heading becomes the root itself; otherwise the map would open on
  // an empty node just above it.
  const tree = useMemo(() => {
    const full = outlineToTree(parseDocument(code).blocks)
    return full.children.length === 1 ? full.children[0]! : full
  }, [code])
  const [state, setState] = useState<MountState>({ kind: 'loading' })
  const [expanded, setExpanded] = useState(false)
  const [overlayState, setOverlayState] = useState<MountState>({ kind: 'loading' })
  const expandRef = useRef<HTMLButtonElement | null>(null)

  if (state.kind === 'error') return <RichError code={code} error={state.error} labels={labels} />

  return (
    <div className="am-rich-view">
      <div className="am-rich-diagram am-rich-markmap" data-state={state.kind}>
        <MarkmapCanvas tree={tree} palette={palette} className="am-markmap-canvas" onState={setState} />
        {state.kind === 'loading' ? <div className="am-rich-state" aria-busy="true">{labels.rendering}</div> : null}
        {state.kind === 'ready'
          ? (
            <button
              ref={expandRef}
              type="button"
              className="am-rich-expand"
              aria-label={labels.expand}
              title={labels.expand}
              onClick={() => setExpanded(true)}
            >
              {labels.expand}
            </button>
          )
          : null}
      </div>
      {expanded && state.kind === 'ready'
        ? (
          <RichFullscreen labels={labels} returnFocus={expandRef} onClose={() => setExpanded(false)}>
            <MarkmapCanvas tree={tree} palette={palette} className="am-markmap-canvas" onState={setOverlayState} />
            {overlayState.kind === 'error' ? <RichError code={code} error={overlayState.error} labels={labels} /> : null}
          </RichFullscreen>
        )
        : null}
    </div>
  )
}
