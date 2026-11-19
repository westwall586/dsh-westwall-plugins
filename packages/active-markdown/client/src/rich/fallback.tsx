/** Source-plus-error fallback shared by the Mermaid and mind-map views. */
import * as React from 'react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { RichLabels } from './labels.ts'

/** Full error text; first line for the one-line summary. */
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.trim() === '' ? 'Unknown error' : text
}

export function errorLine(error: unknown): string {
  const line = errorText(error).split('\n').map(part => part.trim()).find(part => part !== '')
  return line ?? errorText(error)
}

export interface RichErrorProps {
  code: string
  error: unknown
  labels: RichLabels
}

/**
 * Show the fence body untouched beside one line of the failure, with a copy button.
 * The component frame still owns copying the source itself.
 * @param props - the original source, the thrown error, and localized copy.
 * @returns the fallback body.
 */
export function RichError({ code, error, labels }: RichErrorProps): ReactNode {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = (): void => {
    void navigator.clipboard?.writeText(errorText(error)).then(() => {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1600)
    }).catch(() => {})
  }
  return (
    <div className="am-rich-error" role="alert">
      <pre className="am-rich-source"><code>{code}</code></pre>
      <div className="am-rich-error-foot">
        <span className="am-rich-error-line" title={errorText(error)}>{errorLine(error)}</span>
        <button type="button" className="am-component-action" onClick={copy}>{copied ? labels.copied : labels.copyError}</button>
      </div>
    </div>
  )
}
