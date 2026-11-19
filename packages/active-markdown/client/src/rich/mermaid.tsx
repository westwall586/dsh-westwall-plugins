/** A Mermaid fence rendered inside the component frame, with a zoomable expanded view. */
import * as React from 'react'
import { useEffect, useState, type ReactNode } from 'react'
import { loadChunk } from '../chunks.ts'
import { RichError } from './fallback.tsx'
import type { RichLabels } from './labels.ts'
import { paletteKey, usePalette } from './palette.ts'
import { ZoomPanel } from './zoom-panel.tsx'

interface MermaidChunk {
  render(code: string, palette: Record<string, string>): Promise<string>
}

type RenderState =
  | { kind: 'loading' }
  | { kind: 'ready', svg: string }
  | { kind: 'error', error: unknown }

let loaded: Promise<MermaidChunk> | undefined

/** The chunk is loaded once and its API kept for every later diagram. */
function loadMermaid(): Promise<MermaidChunk> {
  loaded ??= loadChunk('client.mermaid.js')
    .then(module => module as unknown as MermaidChunk)
    .catch((error: unknown) => {
      loaded = undefined
      throw error
    })
  return loaded
}

export interface MermaidViewProps {
  code: string
  labels: RichLabels
  /** Set on the panel's copy, which carries its own zoom bar. */
  expanded: boolean
}

/**
 * Render one mermaid source, in place or filling the expanded panel.
 * @param props - the fence body, localized copy, and whether this is the panel copy.
 * @returns the diagram, its loading state, or the source fallback.
 */
export function MermaidView({ code, labels, expanded }: MermaidViewProps): ReactNode {
  const palette = usePalette()
  const identity = paletteKey(palette)
  const [state, setState] = useState<RenderState>({ kind: 'loading' })

  useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    loadMermaid()
      .then(chunk => chunk.render(code, palette))
      .then((svg) => { if (alive) setState({ kind: 'ready', svg }) })
      .catch((error: unknown) => { if (alive) setState({ kind: 'error', error }) })
    return () => { alive = false }
  }, [code, identity, palette])

  if (state.kind === 'error') return <RichError code={code} error={state.error} labels={labels} />

  const diagram = state.kind === 'loading'
    ? <div className="am-rich-state" aria-busy="true">{labels.rendering}</div>
    : (
      <div className="am-rich-diagram am-rich-mermaid">
        <div className="am-rich-figure" dangerouslySetInnerHTML={{ __html: state.svg }} />
      </div>
    )

  if (expanded) return <ZoomPanel labels={labels}>{diagram}</ZoomPanel>
  return <div className="am-rich-view">{diagram}</div>
}
