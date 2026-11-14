/** Per-session prompt snapshots stay durable when storage is present and in memory otherwise. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { MAX_PROMPT_CHARS } from './prompt.ts'

const WARNING_PREFIX = '[dsh-friendly-expression]'

/** One frozen prompt plus its capture time, stored per session. */
export interface PromptSnapshot {
  prompt: string
  capturedAt: number
}

/** Read a prompt by session id and persist one capture. */
export interface SnapshotStore {
  get(sessionId: string): string | undefined
  capture(sessionId: string, prompt: string): Promise<void>
  close(): Promise<void>
}

const promptSnapshotSchema = z.object({
  prompt: z.string().max(MAX_PROMPT_CHARS),
  capturedAt: z.number().int().nonnegative(),
}).strict()

export const promptSnapshotDomain = defineDomain({
  name: 'friendly_expression',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: {
    sessions: domainTable<string, PromptSnapshot>(promptSnapshotSchema),
  },
})

interface SnapshotTable {
  get(key: string): PromptSnapshot | undefined
  put(key: string, value: PromptSnapshot): Promise<void>
}

interface SnapshotDomain {
  table(name: 'sessions'): SnapshotTable
  close(): Promise<void>
}

interface StorageDomainFacility {
  open(spec: typeof promptSnapshotDomain): Promise<SnapshotDomain>
}

interface SnapshotContext {
  get(name: string): unknown
}

function warn(message: string, error?: unknown): void {
  if (error === undefined) console.warn(`${WARNING_PREFIX} ${message}`)
  else console.warn(`${WARNING_PREFIX} ${message}`, error)
}

function createCachedStore(now: () => number, table?: SnapshotTable, closeDomain?: () => Promise<void>): SnapshotStore {
  const cache = new Map<string, PromptSnapshot>()
  return {
    get(sessionId) {
      const cached = cache.get(sessionId)
      if (cached !== undefined) return cached.prompt
      const stored = table?.get(sessionId)
      if (stored !== undefined) cache.set(sessionId, stored)
      return stored?.prompt
    },
    async capture(sessionId, prompt) {
      const snapshot = { prompt, capturedAt: now() }
      cache.set(sessionId, snapshot)
      if (table === undefined) return
      try {
        await table.put(sessionId, snapshot)
      } catch (error) {
        warn(`failed to persist the prompt snapshot for session ${sessionId}`, error)
        throw error
      }
    },
    async close() {
      cache.clear()
      await closeDomain?.()
    },
  }
}

/** Process-local fallback. A capture is readable before its returned promise settles. */
export function createMemorySnapshotStore(now: () => number = Date.now): SnapshotStore {
  return createCachedStore(now)
}

/** Open the durable domain when the Host provides it, otherwise keep snapshots for this run. */
export async function openSnapshotStore(ctx: SnapshotContext): Promise<SnapshotStore> {
  const facility = ctx.get('storageDomain') as StorageDomainFacility | undefined
  if (facility === undefined) {
    warn('storageDomain unavailable; keeping prompt snapshots in memory for this run')
    return createMemorySnapshotStore()
  }
  try {
    const domain = await facility.open(promptSnapshotDomain)
    return createCachedStore(Date.now, domain.table('sessions'), () => domain.close())
  } catch (error) {
    warn('failed to open the friendly_expression snapshot domain; keeping prompt snapshots in memory for this run', error)
    return createMemorySnapshotStore()
  }
}

/** Only a brand new, non-subagent, non-seeded, empty session captures a prompt. */
export function shouldCapture(input: {
  isSubagent: boolean
  isSeeded: boolean
  hasMessages: boolean
}): boolean {
  return !input.isSubagent && !input.isSeeded && !input.hasMessages
}
