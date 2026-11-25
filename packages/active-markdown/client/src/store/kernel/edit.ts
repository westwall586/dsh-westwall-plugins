/**
 * 一篇文档的编辑草稿。草稿属于文档而不是 body：切页签会让 body 卸载，而
 * 没保存的编辑必须留下。槽里还有两个文档级的辅助值：`seq` 是强制重建
 * CodeMirror 的计数器（重新进入编辑态要换一个编辑器实例），`restoreLine`
 * 是编辑器关闭后要滚回的行（0 表示没有）。
 */
import type { EditEvent, EditState } from '../../edit/state.ts'
import { editReduce } from '../../edit/state.ts'

export interface EditSlot {
  state: EditState
  /** 每次进入编辑态递增，作为 CodeMirror 的 key。 */
  seq: number
  /** 保持旧标记的行号，没有时是 0 而不是 undefined，这里只需要一个“有没有”。 */
  restoreLine: number
  listeners: Set<() => void>
}

/** 编辑器关闭后要滚回哪一行；`undefined` 表示不需要滚。 */
export interface EditRestoreLine {
  peek(): number | undefined
  take(): number | undefined
  set(line: number | undefined): void
}

export interface Edit {
  /** 当前的序列号，作为 CodeMirror 的 key：每进入一次编辑态就换一个。 */
  readonly seq: number
  getState(): EditState
  subscribe(listener: () => void): () => void
  /** 派发一次编辑事件；返回落定后的状态。 */
  reduce(event: EditEvent): EditState
  /** 进入编辑态要一个新的编辑器实例。 */
  nextSeq(): number
  readonly restoreLine: EditRestoreLine
}

export function createEditSlot(): EditSlot {
  return { state: { status: 'reading' }, seq: 0, restoreLine: 0, listeners: new Set() }
}

export function createEdit(slot: EditSlot): Edit {
  const notify = (): void => {
    for (const listener of [...slot.listeners]) listener()
  }

  return {
    get seq() {
      return slot.seq
    },
    getState: () => slot.state,
    subscribe(listener) {
      slot.listeners.add(listener)
      return () => {
        slot.listeners.delete(listener)
      }
    },
    reduce(event) {
      const next = editReduce(slot.state, event)
      if (next !== slot.state) {
        slot.state = next
        notify()
      }
      return next
    },
    nextSeq() {
      slot.seq += 1
      return slot.seq
    },
    restoreLine: {
      peek: () => (slot.restoreLine === 0 ? undefined : slot.restoreLine),
      take() {
        const line = slot.restoreLine
        slot.restoreLine = 0
        return line === 0 ? undefined : line
      },
      set(line) {
        slot.restoreLine = line ?? 0
      },
    },
  }
}
