/** The minimal H1-H6 table of contents: jump entries plus updated-section dots. */
import * as React from 'react'
import type { ReactNode } from 'react'
import type { TocEntry } from './diff.ts'

export interface MarkdownTocProps {
  entries: readonly TocEntry[]
  updated: ReadonlySet<string>
  label: string
  updatedLabel: string
  onJump(anchor: string): void
}

/**
 * Render the contents panel. It is navigation, not a diff view: it stays
 * usable with no updates and only adds a dot and an accessible note to the
 * sections a diff marked.
 */
export function MarkdownToc({ entries, updated, label, updatedLabel, onJump }: MarkdownTocProps): ReactNode {
  return (
    <nav className="am-toc" aria-label={label}>
      {entries.map((entry) => {
        const isUpdated = updated.has(entry.anchor)
        return (
          <button
            key={entry.anchor}
            type="button"
            className={isUpdated ? 'am-toc-entry am-toc-entry-updated' : 'am-toc-entry'}
            style={{ paddingLeft: 10 + (entry.level - 1) * 14 }}
            {...(isUpdated ? { title: updatedLabel, 'aria-label': `${entry.text} · ${updatedLabel}` } : {})}
            onClick={() => onJump(entry.anchor)}
          >
            {isUpdated ? <span className="am-toc-dot" aria-hidden="true" /> : null}
            <span className="am-toc-text">{entry.text}</span>
          </button>
        )
      })}
    </nav>
  )
}
