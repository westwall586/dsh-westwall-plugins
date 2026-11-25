import type { View } from './view.ts'

/**
 * 一份文档的视图偏好：停在哪个视图、目录折叠锚点集与“更新 N 处”的游标。
 * 锚点来自标题锚点，所以同一份文档在原文与译文之间切换时它们仍然对得上；
 * 但换文档就要清空，而切页签、切会话不清。
 */
export interface ViewPreferencesSlot {
  /**
   * 当前停在哪一侧。宿主切走文档会把 body 卸载，视图若只活在 body 的
   * `useState` 里，切会话回来就会退回原文，而阅读位置是按视图分开记的，
   * 于是读的是另一份、看上去像位置丢了。所以它跟着 crate 走。
   */
  view: View
  /** 是否已经有 body 为这份文档跑过打开流程。 */
  opened: boolean
  /** null 表示从未折叠过任何一节，读出来是共用的空集合。 */
  collapsed: ReadonlySet<string> | null
  updateCursor: number
  listeners: Set<() => void>
}

export interface ViewPreferences {
  /** 当前停在哪一侧；切会话回来时 body 据此恢复。 */
  getView(): View
  setView(next: View): void
  /**
   * 这份 crate 是否已经被某个 body 走过一次“打开文档”。
   *
   * 宿主每次切页签、切会话都会卸载并重建 body，重建出来的 body 自己的 ref 全是空的，
   * 它无法靠自身分辨“同一份文档回来了”和“另一份文档占了阅读区”。这条标记归 crate：
   * 第一次打开时返回 false 并置位，之后（重建的 body）返回 true。关闭与外部更改会丢掉
   * 整个 crate，所以重新打开会重新走一次初始化。
   */
  takeFirstOpen(): boolean
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
  return { view: 'source', opened: false, collapsed: null, updateCursor: 0, listeners: new Set() }
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
    getView: () => slot.view,
    takeFirstOpen() {
      if (slot.opened) return false
      slot.opened = true
      return true
    },
    setView(next) {
      if (slot.view === next) return
      slot.view = next
      notify()
    },
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
