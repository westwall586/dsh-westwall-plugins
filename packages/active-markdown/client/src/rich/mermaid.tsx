/** A Mermaid fence rendered inside the component frame, with an opt-in fullscreen view. */
import * as React from 'react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { loadChunk } from '../chunks.ts'
import { RichError } from './fallback.tsx'
import { RichFullscreen } from './fullscreen.tsx'
import type { RichLabels } from './labels.ts'
import { paletteKey, usePalette } from './palette.ts'

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
}

/**
 * Render one mermaid source and let it be inspected fullscreen.
 * @param props - the fence body and localized copy.
 * @returns the diagram, its loading state, or the source fallback.
 */
export function MermaidView({ code, labels }: MermaidViewProps): ReactNode {
  const palette = usePalette()
  const identity = paletteKey(palette)
  const [state, setState] = useState<RenderState>({ kind: 'loading' })
  const [expanded, setExpanded] = useState(false)
  const expandRef = useRef<HTMLButtonElement | null>(null)

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

  return (
    <div className="am-rich-view">
      {state.kind === 'loading'
        ? <div className="am-rich-state" aria-busy="true">{labels.rendering}</div>
        : (
          <div className="am-rich-diagram am-rich-mermaid">
            <div className="am-rich-figure" dangerouslySetInnerHTML={{ __html: state.svg }} />
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
            {expanded
              ? (
                <RichFullscreen labels={labels} returnFocus={expandRef} onClose={() => setExpanded(false)}>
                  <div className="am-rich-figure" dangerouslySetInnerHTML={{ __html: state.svg }} />
                </RichFullscreen>
              )
              : null}
          </div>
        )}
    </div>
  )
}
