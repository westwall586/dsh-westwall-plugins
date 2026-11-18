import type { TocEntry } from './diff.ts'

export interface TocRow {
  readonly anchor: string
  readonly text: string
  readonly level: number
  readonly hasChildren: boolean
  readonly isCurrent: boolean
}

export function tocRows(
  entries: readonly TocEntry[],
  collapsed: ReadonlySet<string>,
  active: string | undefined,
): readonly TocRow[] {
  const stack: { level: number, collapsed: boolean }[] = []
  const visible: boolean[] = []
  for (const entry of entries) {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= entry.level) stack.pop()
    visible.push(!stack.some(node => node.collapsed))
    stack.push({ level: entry.level, collapsed: collapsed.has(entry.anchor) })
  }

  let currentIndex = -1
  const activeIndex = active === undefined ? -1 : entries.findIndex(entry => entry.anchor === active)
  if (visible[activeIndex] === true) {
    currentIndex = activeIndex
  } else if (activeIndex !== -1) {
    const activeLevel = entries[activeIndex]!.level
    for (let index = activeIndex - 1; index >= 0; index -= 1) {
      if (entries[index]!.level < activeLevel && visible[index] === true) {
        currentIndex = index
        break
      }
    }
  }

  const rows: TocRow[] = []
  for (let index = 0; index < entries.length; index += 1) {
    if (visible[index] !== true) continue
    const entry = entries[index]!
    const next = entries[index + 1]
    rows.push({
      anchor: entry.anchor,
      text: entry.text,
      level: entry.level,
      hasChildren: next !== undefined && next.level > entry.level,
      isCurrent: index === currentIndex,
    })
  }
  return rows
}

export function activeAnchorOf(
  entries: readonly TocEntry[],
  tops: ReadonlyMap<string, number>,
  threshold: number,
): string | undefined {
  let active: string | undefined
  for (const entry of entries) {
    const top = tops.get(entry.anchor)
    if (top === undefined || !Number.isFinite(top) || top > threshold) continue
    active = entry.anchor
  }
  return active
}
