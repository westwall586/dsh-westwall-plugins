/** The callout dialect: 13 canonical types over 7 visual families. */

/** Visual family a callout type maps onto; each family owns one semantic token. */
export type CalloutFamily = 'info' | 'abstract' | 'success' | 'warning' | 'danger' | 'example' | 'quote'

/** One canonical callout type. */
export interface CalloutType {
  id: string
  /** Canonical label, used when the locale dictionary has no entry. */
  label: string
  family: CalloutFamily
  /** Alternate words that resolve to this type, matched case-insensitively. */
  aliases: readonly string[]
  /** Inline 24-unit SVG path set, painted with `currentColor`. */
  icon: string
}

/** Every canonical type, in spec order. */
export const CALLOUT_TYPES: readonly CalloutType[] = [
  { id: 'note', label: '说明', family: 'info', aliases: [], icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' },
  { id: 'abstract', label: '摘要', family: 'abstract', aliases: [ 'summary', 'tldr' ], icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/></svg>' },
  { id: 'info', label: '信息', family: 'info', aliases: [], icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>' },
  { id: 'todo', label: '待办', family: 'info', aliases: [], icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/></svg>' },
  { id: 'tip', label: '建议', family: 'success', aliases: [ 'hint', 'important' ], icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/></svg>' },
  { id: 'success', label: '成功', family: 'success', aliases: [ 'check', 'done' ], icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>' },
  { id: 'question', label: '问题', family: 'warning', aliases: [ 'help', 'faq' ], icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4"/><path d="M12 17h.01"/></svg>' },
  { id: 'warning', label: '注意', family: 'warning', aliases: [ 'caution', 'attention' ], icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>' },
  { id: 'failure', label: '失败', family: 'danger', aliases: [ 'fail', 'missing' ], icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>' },
  { id: 'danger', label: '危险', family: 'danger', aliases: [ 'error' ], icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg>' },
  { id: 'bug', label: '缺陷', family: 'danger', aliases: [], icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M8 12H4M20 12h-4M8 18l-3 2M16 18l3 2M8 8 5 6M16 8l3-2"/></svg>' },
  { id: 'example', label: '示例', family: 'example', aliases: [], icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>' },
  { id: 'quote', label: '引用', family: 'quote', aliases: [ 'cite' ], icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21c3 0 5-2 5-5V7H3v6h3c0 2-1 3-3 3v5Z"/><path d="M14 21c3 0 5-2 5-5V7h-5v6h3c0 2-1 3-3 3v5Z"/></svg>' },
]

/**
 * Resolve a `[!type]` marker to its canonical type.
 * @param word - the bare marker word, without brackets.
 * @returns the canonical type, or undefined when the word is not a type or alias.
 */
export function resolveCallout(word: string): CalloutType | undefined {
  const needle = word.toLowerCase()
  return CALLOUT_TYPES.find(type => type.id === needle)
    ?? CALLOUT_TYPES.find(type => type.aliases.some(alias => alias === needle))
}

/**
 * Resolve one type's user-facing label.
 * @param type - the canonical type.
 * @param format - the namespace translator; a missing key returns itself.
 * @returns the localized label, or the canonical one when the key is missing.
 */
export function calloutLabel(type: CalloutType, format: (key: string) => string): string {
  const key = `callout.${type.id}`
  const localized = format(key)
  return localized === key ? type.label : localized
}

/**
 * The one line a callout head shows. The type icon already carries the family, so
 * the head reads as the author's title; a bare `> [!warning]` falls back to the
 * type name instead of showing an empty head.
 * @param title - the marker line's remaining text, possibly empty.
 * @param typeLabel - the localized type name.
 * @returns the title, or the type name when the marker carries no title.
 */
export function calloutHeadTitle(title: string, typeLabel: string): string {
  const trimmed = title.trim()
  return trimmed === '' ? typeLabel : trimmed
}
