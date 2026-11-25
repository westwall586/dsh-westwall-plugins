/**
 * 一份文档的视图偏好：目录折叠锚点集与“更新 N 处”的游标。锚点来自标题锚点，
 * 所以同一份文档在原文与译文之间切换时它们仍然对得上；但换文档就要清空，
 * 而切页签、切会话不清。
 */
export interface ViewPreferencesSlot {
  /** null 表示从未折叠过任何一节，读出来是共用的空集合。 */
  collapsed: ReadonlySet<string> | null
  updateCursor: number
  listeners: Set<() => void>
}

export interface ViewPreferences {
  getCollapsed(): ReadonlySet<string>
  setCollapsed(next: ReadonlySet<string>): void
  toggleCollapsed(anchor: string): void
  getUpdateCursor(): number
  setUpdateCursor(next: number): void
  subscribe(listener: () => void): () => void
}

export const EMPTY_COLLAPSED: ReadonlySet<string> = new Set()

export function createPreferencesSlot(): ViewPreferencesSlot {
  return { collapsed: null, updateCursor: 0, listeners: new Set() }
}

export function createPreferences(slot: ViewPreferencesSlot): ViewPreferences {
  const notify = (): void => {
    for (const listener of [...slot.listeners]) listener()
  }

  return {
    getCollapsed: () => slot.collapsed ?? EMPTY_COLLAPSED,
    setCollapsed(next) {
      slot.collapsed = next
      notify()
    },
    toggleCollapsed(anchor) {
      // 新集合而不是原地改：快照要换身份，订阅者才会重渲染。
      const next = new Set(slot.collapsed ?? EMPTY_COLLAPSED)
      if (!next.delete(anchor)) next.add(anchor)
      slot.collapsed = next
      notify()
    },
    getUpdateCursor: () => slot.updateCursor,
    setUpdateCursor(next) {
      if (slot.updateCursor === next) return
      slot.updateCursor = next
      notify()
    },
    subscribe(listener) {
      slot.listeners.add(listener)
      return () => {
        slot.listeners.delete(listener)
      }
    },
  }
}
