/**
 * 工作区的开启与关闭。开启是一次三关验证（索引、连接、首调），每关的结论都落成
 * 状态；关闭只改开关，CodeGraph 自己的 `.codegraph/` 留给用户。
 *
 * 开与关都按 realpath 串行：同一工作区同时跑两次 init 会互相踩索引。
 */
import type { CodegraphStore, WorkspaceRecord, WorkspaceState } from './state.ts'
import { hasIndex, pickProbeSymbol, runInit } from './cli.ts'
import type { CliResult } from './cli.ts'
import type { CodegraphDeps } from './deps.ts'

/** 三关验证里可替换的外部动作，单测不必真的起进程。 */
export interface LifecycleIo {
  init(command: string, root: string, timeoutMs: number): Promise<CliResult>
  probe(root: string, command: string, symbol: string): ReturnType<CodegraphDeps['probe']>
  hasIndex(root: string): boolean
  pickProbeSymbol(root: string): string | undefined
}

/** 生产路径的外部动作；首调探针由插件入口注入真实的连接探针。 */
function defaultIo(deps: CodegraphDeps): LifecycleIo {
  return { init: runInit, probe: deps.probe, hasIndex, pickProbeSymbol }
}

/** 一个工作区的开关动作面。`enable` 不抛错，失败会体现在返回的状态里。 */
export interface WorkspaceOps {
  enable(record: WorkspaceRecord, command: string): Promise<WorkspaceState>
  disable(record: WorkspaceRecord): Promise<void>
}

export function createWorkspaceOps(store: CodegraphStore, deps: CodegraphDeps, io: LifecycleIo = defaultIo(deps)): WorkspaceOps {
  const queues = new Map<string, Promise<unknown>>()

  /** 同一 realpath 上的动作排队；不同工作区互不阻塞。 */
  const serialize = <T>(path: string, action: () => Promise<T>): Promise<T> => {
    const previous = queues.get(path) ?? Promise.resolve()
    const next = previous.then(action, action)
    queues.set(path, next.catch(() => {}))
    return next
  }

  const save = async (record: WorkspaceRecord, enabled: boolean, state: WorkspaceState, probeSymbol?: string): Promise<WorkspaceRecord> => {
    const next: WorkspaceRecord = {
      path: record.path,
      enabled,
      state,
      ...probeSymbol === undefined ? {} : { probeSymbol },
      updatedAt: Date.now(),
    }
    await store.put(next)
    return next
  }

  return {
    enable(record, command) {
      return serialize(record.path, async () => {
        if (!io.hasIndex(record.path)) {
          const indexing = await save(record, true, { kind: 'indexing' })
          void indexing
          const init = await io.init(command, record.path, deps.config.initTimeoutMs)
          if (!init.ok) {
            const failed = await save(record, true, { kind: 'failed', reason: init.reason })
            return failed.state
          }
        }
        const probeSymbol = record.probeSymbol ?? io.pickProbeSymbol(record.path)
        if (probeSymbol === undefined) {
          const failed = await save(record, true, { kind: 'failed', reason: '这个工作区没有找到可索引的源码' })
          return failed.state
        }
        await save(record, true, { kind: 'verifying' }, probeSymbol)
        const verdict = await io.probe(record.path, command, probeSymbol)
        const failed = verdict.ok
          ? undefined
          : await save(record, true, { kind: 'failed', reason: verdict.reason }, probeSymbol)
        if (failed !== undefined) return failed.state
        const ready = await save(record, true, { kind: 'ready', verifiedAt: Date.now() }, probeSymbol)
        return ready.state
      })
    },
    disable(record) {
      return serialize(record.path, async () => {
        await save(record, false, { kind: 'disabled' })
      })
    },
  }
}
