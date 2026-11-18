import * as React from 'react'
import type { ReactNode } from 'react'
import type { TocRow } from './toc-model.ts'

export interface MarkdownTocProps {
  rows: readonly TocRow[]
  collapsed: ReadonlySet<string>
  updated: ReadonlySet<string>
  label: string
  updatedLabel: string
  expandLabel: string
  collapseLabel: string
  onJump(anchor: string): void
  onToggle(anchor: string): void
}

function ChevronIcon(): ReactNode {
  return (
    <svg
      className="am-toc-chevron"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  )
}

/**
 * Render the contents panel. It is navigation, not a diff view: it stays
 * usable with no updates and only adds a dot and an accessible note to the
 * sections a diff marked.
 */
export function MarkdownToc({
  rows,
  collapsed,
  updated,
  label,
  updatedLabel,
  expandLabel,
  collapseLabel,
  onJump,
  onToggle,
}: MarkdownTocProps): ReactNode {
  return (
    <nav className="am-toc" aria-label={label}>
      {rows.map((row) => {
        const isUpdated = updated.has(row.anchor)
        const expanded = !collapsed.has(row.anchor)
        return (
          <div
            key={row.anchor}
            className={row.isCurrent ? 'am-toc-row am-toc-row-current' : 'am-toc-row'}
            data-toc-anchor={row.anchor}
            style={{ paddingLeft: 10 + (row.level - 1) * 14 }}
          >
            {row.hasChildren ? (
              <button
                type="button"
                className="am-toc-toggle"
                aria-expanded={expanded}
                aria-label={`${expanded ? collapseLabel : expandLabel} ${row.text}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onToggle(row.anchor)
                }}
              >
                <ChevronIcon />
              </button>
            ) : (
              <span className="am-toc-toggle-space" aria-hidden="true" />
            )}
            <button
              type="button"
              className={isUpdated ? 'am-toc-entry am-toc-entry-updated' : 'am-toc-entry'}
              aria-current={row.isCurrent ? 'location' : undefined}
              {...(isUpdated ? { title: updatedLabel, 'aria-label': `${row.text} · ${updatedLabel}` } : {})}
              onClick={() => onJump(row.anchor)}
            >
              {isUpdated ? <span className="am-toc-dot" aria-hidden="true" /> : null}
              <span className="am-toc-text">{row.text}</span>
            </button>
          </div>
        )
      })}
    </nav>
  )
}
