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
  /**
   * 这份偏好的身份。同一个路径上的 crate 会被丢弃再建（切会话、页签关闭再打开），
   * 等价于 `===` 的对象同一性，让订阅者分辨“同一个 crate”与“同路径的新 crate”。
   */
  readonly clock: object
  getCollapsed(): ReadonlySet<string>
  /**
   * 只在“换了文档或换了视图”时清空折叠。判断由 port 记住，不放在调用方的 ref 里：
   * 重建出来的 body（切会话回来时元素被整体替换）会带着空 ref，把刚恢复的折叠
   * 状态当成第一次运行清掉。
   * @param identity - 文档身份；`null` 表示地址还不完整，下一帧再说。
   * @param key - 视图与内容身份，同一个文档换内容或换视图都要重来。
   */
  resetCollapsedOn(identity: object | null, key: string): void
  /** 更新游标的归零，判据与 `resetCollapsedOn` 相同。 */
  resetCursorOn(identity: object | null, key: string): void
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
  const clock: object = {}
  /** 上一次清空时依据的（文档身份, 视图）；`null` 表示还没清过。 */
  let folded: { readonly identity: object | null, readonly key: string } | null = null
  /** 同上，给更新游标用。 */
  let cursor: { readonly identity: object | null, readonly key: string } | null = null
  const notify = (): void => {
    for (const listener of [...slot.listeners]) listener()
  }

  return {
    clock,
    getCollapsed: () => slot.collapsed ?? EMPTY_COLLAPSED,
    resetCollapsedOn(identity, key) {
      if (identity === null) return
      if (folded !== null && folded.identity === identity && folded.key === key) return
      folded = { identity, key }
      slot.collapsed = EMPTY_COLLAPSED
      notify()
    },
    resetCursorOn(identity, key) {
      if (identity === null) return
      if (cursor !== null && cursor.identity === identity && cursor.key === key) return
      cursor = { identity, key }
      if (slot.updateCursor === 0) return
      slot.updateCursor = 0
      notify()
    },
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
