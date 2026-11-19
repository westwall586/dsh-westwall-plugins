/** A mind-map fence rendered inside the component frame, with a zoomable expanded view. */
import * as React from 'react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { loadChunk } from '../chunks.ts'
import { parseDocument } from '../markdown/blocks.ts'
import { RichError } from './fallback.tsx'
import type { RichLabels } from './labels.ts'
import { usePalette } from './palette.ts'
import { actualFactor, fitPercent } from './stage-math.ts'
import { StageFooter } from './stage.tsx'
import { outlineToTree, type MarkmapNode } from './tree.ts'

/** The panel controls the chunk exposes once a map is mounted. */
interface MarkmapHandle {
  dispose(): void
  scale(): number
  /** The scale the last fit produced; the footer reads percent against it. */
  fitScale(): number
  rescale(scale: number): void
  fit(): void
}

interface MarkmapChunk {
  mount(
    svg: SVGSVGElement,
    tree: MarkmapNode,
    palette: Record<string, string>,
    onScale?: (scale: number) => void,
  ): MarkmapHandle
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
  /** Expanded copy only: the live handle and the scale markmap reports after a gesture. */
  onHandle?: (handle: MarkmapHandle | undefined) => void
  onScale?: (scale: number) => void
}

/** Mount one markmap instance and tear it down whenever the data or theme changes. */
function MarkmapCanvas({ tree, palette, className, onState, onHandle, onScale }: MarkmapCanvasProps): ReactNode {
  const holder = useRef<SVGSVGElement | null>(null)
  const state = useRef(onState)
  state.current = onState
  const handle = useRef(onHandle)
  handle.current = onHandle
  const scale = useRef(onScale)
  scale.current = onScale

  useEffect(() => {
    const svg = holder.current
    if (svg === null) return
    let alive = true
    let mounted: MarkmapHandle | undefined
    state.current({ kind: 'loading' })
    loadMarkmap().then((chunk) => {
      if (!alive) return
      try {
        mounted = chunk.mount(svg, tree, palette, value => { scale.current?.(value) })
        handle.current?.(mounted)
        state.current({ kind: 'ready' })
      } catch (error) {
        state.current({ kind: 'error', error })
      }
    }).catch((error: unknown) => {
      if (alive) state.current({ kind: 'error', error })
    })
    return () => {
      alive = false
      handle.current?.(undefined)
      mounted?.dispose()
    }
  }, [tree, palette])

  return <svg ref={holder} className={className} />
}

export interface MarkmapViewProps {
  code: string
  labels: RichLabels
  /** Set on the panel's copy, which carries its own footer. */
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
  const [panelScale, setPanelScale] = useState(1)
  const [handle, setHandle] = useState<MarkmapHandle | undefined>(undefined)

  if (state.kind === 'error') return <RichError code={code} error={state.error} labels={labels} />

  if (expanded) {
    const fitScale = handle?.fitScale() ?? panelScale
    return (
      <div className="am-rich-panel">
        <div className="am-rich-panel-body am-rich-scene am-rich-scene-native">
          <MarkmapCanvas
            tree={tree}
            palette={palette}
            className="am-markmap-canvas"
            onState={setPanelState}
            onHandle={setHandle}
            onScale={setPanelScale}
          />
          {panelState.kind === 'loading' ? <div className="am-rich-state" aria-busy="true">{labels.rendering}</div> : null}
          {panelState.kind === 'error' ? <RichError code={code} error={panelState.error} labels={labels} /> : null}
        </div>
        <StageFooter
          percent={fitPercent(panelScale, fitScale)}
          labels={labels}
          onZoom={(factor) => { handle?.rescale(factor) }}
          onFit={() => { handle?.fit() }}
          onActual={() => {
            if (handle === undefined) return
            // The chunk's rescale is a relative factor, so actual size is fit over live scale.
            handle.rescale(actualFactor(handle.scale(), handle.fitScale()))
          }}
        />
      </div>
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
