/**
 * 说明注入默认关；打开时只在真正启用过的工作区里出现，并且按 Agent 去重。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import type { Context } from '@deepseek-ai/cordis'
import { createMemoryStore } from '../src/state.ts'
import { registerReminder, SECTION_NAME } from '../src/reminder.ts'
import type { CodegraphDeps } from '../src/deps.ts'

type Assembly = { sections: Array<{ name: string; text: string }>; contexts: unknown[]; variables: Record<string, string | undefined> }

interface Harness {
  run(input: Assembly): Promise<Assembly>
  store: ReturnType<typeof createMemoryStore>
}

function harness(directory: string, reminder: boolean): Harness {
  const listeners: Array<(assembly: Assembly, context: { agent: unknown }, next: () => Promise<Assembly>) => Promise<Assembly>> = []
  const ctx = {
    on: (_event: string, listener: (typeof listeners)[number]) => { listeners.push(listener); return () => {} },
    workingDirectory: { get: () => directory },
  } as unknown as Context
  const store = createMemoryStore()
  const deps = { config: { reminder, initOnEnable: true, initTimeoutMs: 1, warnGlobalInstall: true, startupTimeoutMs: 1, closeTimeoutMs: 1 } } as unknown as CodegraphDeps
  registerReminder(ctx, deps, store)
  return {
    async run(input) {
      if (listeners.length === 0) return input
      return listeners[0]!(input, { agent: { session: { id: 's1' } } }, async () => input)
    },
    store,
  }
}

const EMPTY: Assembly = { sections: [], contexts: [], variables: {} }

test('disabled by default adds nothing', async () => {
  const h = harness('/repo', false)
  assert.deepEqual(await h.run(EMPTY), EMPTY)
})

test('enabled but no recorded workspace adds nothing', async () => {
  const h = harness('/repo', true)
  assert.deepEqual(await h.run(EMPTY), EMPTY)
})

test('enabled workspace gets the block once, even from a subdirectory', async () => {
  const h = harness('/repo/pkg/deep', true)
  await h.store.put({ path: '/repo', enabled: true, state: { kind: 'ready', verifiedAt: 1 }, updatedAt: 1 })
  const first = await h.run(EMPTY)
  assert.equal(first.sections.length, 1)
  assert.equal(first.sections[0]!.name, SECTION_NAME)
  assert.match(first.sections[0]!.text, /^<system-reminder>[\s\S]*codegraph_explore[\s\S]*<\/system-reminder>$/)
  const second = await h.run(first)
  assert.equal(second.sections.length, 1)
})

test('a disabled workspace gets nothing', async () => {
  const h = harness('/repo', true)
  await h.store.put({ path: '/repo', enabled: false, state: { kind: 'disabled' }, updatedAt: 1 })
  assert.deepEqual(await h.run(EMPTY), EMPTY)
})
