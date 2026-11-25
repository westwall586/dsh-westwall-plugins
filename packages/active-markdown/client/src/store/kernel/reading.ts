/**
 * 一篇文档的阅读位置，按视图分开记：原文和译文行数不同，共用一个数字会让
 * 来回切换时跳位。滚动容器归 body（`.am-root`），这里只记数字。
 *
 * 写入走节流而不是逐像素：滚动事件每帧都来，而位置只在切走时被读一次。
 */
import type { View } from './view.ts'
import { trace } from '../trace.ts'

export interface ReadingSlot {
  source: number
  translated: number
  listeners: Set<() => void>
}

export interface Reading {
  /**
   * 这份端口的身份。同一个路径上的 crate 可以被丢弃再建（关掉页签又重开），
   * 等价于 `===` 的对象同一性，让订阅者能分辨“同一个 crate”与“同路径的新 crate”。
   */
  readonly clock: object
  /** 当前记录的像素位置，只用于落值与判断“是否有值”。 */
  get(view: View): number
  /** 节流写入；切走前必须先 flush，否则最后一段滚动会丢。 */
  record(view: View, top: number): void
  /** 立刻写出挂起的值，让下一次 get 读到它。 */
  flush(): void
  clear(): void
  /** 停止节流定时器；不碰订阅者，那是 crate 的事。 */
  dispose(): void
}

export interface ReadingDeps {
  /** 节流窗口；测试传 0 让写入同步生效。 */
  delayMs?: number
  slot: ReadingSlot
}

export const DEFAULT_READING_DELAY_MS = 120

export function createReadingSlot(): ReadingSlot {
  return { source: 0, translated: 0, listeners: new Set() }
}

export function createReading(deps: ReadingDeps): Reading {
  const delay = deps.delayMs ?? DEFAULT_READING_DELAY_MS
  const slot = deps.slot
  let pending: { view: View, top: number } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const notify = (): void => {
    for (const listener of [...slot.listeners]) listener()
  }

  const write = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (pending === null) return
    const { view, top } = pending
    pending = null
    trace('reading.write', { view, top, previous: slot[view] })
    if (slot[view] === top) return
    slot[view] = top
    notify()
  }

  const schedule = (): void => {
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      write()
    }, delay)
  }

  const clock: object = {}
  return {
    clock,
    get(view) {
      if (pending !== null && pending.view === view) return pending.top
      return slot[view]
    },
    record(view, top) {
      const current = pending !== null && pending.view === view ? pending.top : slot[view]
      if (current === top) return
      pending = { view, top }
      // 0 毫秒只是让同一轮里的多次滚动合并成一次，不是延后一个真实的窗口。
      if (delay <= 0) {
        write()
        return
      }
      schedule()
    },
    flush: write,
    clear() {
      pending = null
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (slot.source === 0 && slot.translated === 0) return
      slot.source = 0
      slot.translated = 0
      notify()
    },
    dispose() {
      // 订阅者归 crate 清；crate 被丢弃时监听集合还要能被读到，所以这里只停定时器。
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      pending = null
    },
  }
}
