/** KaTeX formulas rendered through the on-demand chunk, with a source fallback. */
import * as React from 'react'
import { useEffect, useState, type ReactNode } from 'react'
import { loadChunk } from '../chunks.ts'
import { errorLine, RichError } from './fallback.tsx'
import type { RichLabels } from './labels.ts'

interface MathChunk {
  render(tex: string, display: boolean): string
}

type RenderState =
  | { kind: 'loading' }
  | { kind: 'ready', html: string }
  | { kind: 'error', error: unknown }

let loaded: Promise<MathChunk> | undefined

/** The chunk is loaded once; a failed load is forgotten so the next formula retries. */
function loadMath(): Promise<MathChunk> {
  loaded ??= loadChunk('client.math.js')
    .then(module => module as unknown as MathChunk)
    .catch((error: unknown) => {
      loaded = undefined
      throw error
    })
  return loaded
}

/**
 * Render one formula off the main bundle and keep the result for this source.
 * @param tex - the TeX source.
 * @param display - whether this is a block formula.
 * @returns the loading, ready, or failed render state.
 */
function useMathRender(tex: string, display: boolean): RenderState {
  const [state, setState] = useState<RenderState>({ kind: 'loading' })
  useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    loadMath()
      .then(chunk => chunk.render(tex, display))
      .then((html) => { if (alive) setState({ kind: 'ready', html }) })
      .catch((error: unknown) => { if (alive) setState({ kind: 'error', error }) })
    return () => { alive = false }
  }, [tex, display])
  return state
}

export interface MathViewProps {
  tex: string
  labels: RichLabels
}

/**
 * Render one block formula inside the component shell.
 * @param props - the TeX source and the localized copy.
 * @returns the formula, or the source plus one line of the failure.
 */
export function MathView({ tex, labels }: MathViewProps): ReactNode {
  const state = useMathRender(tex, true)
  if (state.kind === 'error') return <RichError code={tex} error={state.error} labels={labels} />
  if (state.kind === 'loading') return <div className="am-rich-state" aria-busy="true">{labels.rendering}</div>
  return <div className="am-math-block" dangerouslySetInnerHTML={{ __html: state.html }} />
}

export interface MathInlineProps {
  tex: string
}

/**
 * Render one inline formula. A formula that fails keeps its source text in
 * place, so a broken line never blanks the paragraph it sits in.
 * @param props - the TeX source.
 * @returns the formula span, or the source between its delimiters.
 */
export function MathInline({ tex }: MathInlineProps): ReactNode {
  const state = useMathRender(tex, false)
  if (state.kind === 'ready') {
    return <span className="am-math-inline" dangerouslySetInnerHTML={{ __html: state.html }} />
  }
  const source = `$${tex}$`
  if (state.kind === 'loading') {
    return <span className="am-math-inline am-math-source" aria-busy="true">{source}</span>
  }
  return <span className="am-math-inline am-math-source" title={errorLine(state.error)}>{source}</span>
}
