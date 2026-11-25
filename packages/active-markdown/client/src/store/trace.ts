/**
 * 诊断日志：记录“决定文档状态存亡”的判断，用于复现只在特定宿主时序里出现的
 * 问题（切会话回来阅读进度丢失、关闭页签没清状态之类）。
 *
 * 默认开启：桌面版是 Electron，打开 DevTools 的控制台就能直接看到，不需要
 * 先去翻插件设置。记录同时进环形缓冲，控制台里执行 `__AM_TRACE_DUMP__()`
 * 可以把整段复现一次性取成文本。
 *
 * 长期运行不想刷屏时，在控制台执行 `__AM_TRACE_OFF__()`；`__AM_TRACE_ON__()`
 * 再打开。设置只影响当前页面。
 *
 * 这里记的是判断与闸门，不是滚动像素的流水：滚动每帧都来，只会淹没关键几行。
 */

const CAPACITY = 2000

interface Entry {
  at: number
  /** 单调递增，用来还原顺序（毫秒时间戳会撞）。 */
  seq: number
  event: string
  details: Record<string, unknown>
}

const entries: Entry[] = []
let seq = 0
/** 默认开启；控制台可以用 __AM_TRACE_OFF__ 临时关掉。 */
let enabled = true

/**
 * 是否需要记录。
 * @returns 打开时为 true。
 */
function active(): boolean {
  return enabled
}

/**
 * 记一条诊断事件。
 * @param event - 事件名，用 `域.动作` 的形式，便于按前缀筛。
 * @param details - 与判断相关的字段；应当足够小，能直接读。
 */
export function trace(event: string, details: Record<string, unknown> = {}): void {
  if (!active()) return
  seq += 1
  const entry: Entry = { at: Date.now(), seq, event, details }
  entries.push(entry)
  if (entries.length > CAPACITY) entries.shift()
  // 控制台里能直接看到顺序；缓冲是为了事后一次性取。
  console.log(`[am-trace ${seq}] ${event}`, details)
}

/**
 * 把缓冲里的记录拼成一段文本。
 * @returns 每行一条，带序号、相对时间与字段。
 */
export function dumpTrace(): string {
  if (entries.length === 0) return '[am-trace] 没有记录（是否已打开开关？）'
  const start = entries[0]!.at
  return entries
    .map((entry) => {
      const fields = Object.entries(entry.details)
        .map(([key, value]) => `${key}=${format(value)}`)
        .join(' ')
      return `+${String(entry.at - start).padStart(6)}ms #${entry.seq} ${entry.event} ${fields}`
    })
    .join('\n')
}

function format(value: unknown): string {
  if (typeof value === 'string') return value === '' ? '""' : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** 清空缓冲，方便一次干净的复现。 */
export function resetTrace(): void {
  entries.length = 0
  seq = 0
}

/** 在控制台暴露取日志的入口，不必让用户去翻 React 内部。 */
export function installTraceHelpers(): void {
  if (typeof window === 'undefined') return
  const target = window as {
    __AM_TRACE_DUMP__?: () => string
    __AM_TRACE_RESET__?: () => void
    __AM_TRACE_ON__?: () => void
    __AM_TRACE_OFF__?: () => void
  }
  target.__AM_TRACE_DUMP__ = () => dumpTrace()
  target.__AM_TRACE_RESET__ = () => { resetTrace() }
  target.__AM_TRACE_OFF__ = () => { enabled = false; console.log('[am-trace] 已关闭') }
  target.__AM_TRACE_ON__ = () => { enabled = true; console.log('[am-trace] 已打开') }
}
