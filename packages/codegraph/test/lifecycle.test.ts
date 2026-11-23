/**
 * 开启是一次三关验证：索引、连接、首调。每一关失败都要落成 `failed` 并带原因，
 * 且失败不许抛给调用方。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createWorkspaceOps } from '../src/lifecycle.ts'
import type { LifecycleIo } from '../src/lifecycle.ts'
import { createMemoryStore } from '../src/state.ts'
import type { WorkspaceRecord } from '../src/state.ts'
import type { CodegraphDeps } from '../src/deps.ts'

const record: WorkspaceRecord = { path: '/repo', enabled: false, state: { kind: 'disabled' }, updatedAt: 0 }

function deps(): CodegraphDeps {
  return {
    ctx: {} as never,
    config: { initOnEnable: true, initTimeoutMs: 1000, reminder: false, warnGlobalInstall: true, startupTimeoutMs: 8000, closeTimeoutMs: 1500 },
    openMcpClient: () => { throw new Error('unused') },
    globalInstall: async () => undefined,
    probe: async () => ({ ok: false, reason: 'unused' }),
  }
}

function io(overrides: Partial<LifecycleIo>): LifecycleIo {
  return {
    init: async () => ({ ok: true, stdout: '' }),
    probe: async () => ({ ok: true, file: 'src/a.ts' }),
    hasIndex: () => true,
    pickProbeSymbol: () => 'alphaOnlySymbol',
    ...overrides,
  }
}

test('enable walks indexing → verifying → ready and remembers the probe symbol', async () => {
  const store = createMemoryStore()
  const seen: string[] = []
  const ops = createWorkspaceOps(store, deps(), io({
    hasIndex: () => false,
    init: async () => { seen.push('init'); return { ok: true, stdout: '' } },
    probe: async (_root, _command, symbol) => { seen.push(`probe:${symbol}`); return { ok: true, file: 'src/a.ts' } },
  }))
  const state = await ops.enable(record, '/usr/local/bin/codegraph')
  assert.deepEqual(seen, ['init', 'probe:alphaOnlySymbol'])
  assert.equal(state.kind, 'ready')
  assert.equal(store.get('/repo')?.enabled, true)
  assert.equal(store.get('/repo')?.probeSymbol, 'alphaOnlySymbol')
})

test('a failing init records failed and never reaches the probe', async () => {
  const store = createMemoryStore()
  let probed = false
  const ops = createWorkspaceOps(store, deps(), io({
    hasIndex: () => false,
    init: async () => ({ ok: false, reason: 'codegraph init 退出码 1：boom' }),
    probe: async () => { probed = true; return { ok: true, file: 'src/a.ts' } },
  }))
  const state = await ops.enable(record, 'codegraph')
  assert.equal(probed, false)
  assert.deepEqual(state, { kind: 'failed', reason: 'codegraph init 退出码 1：boom' })
})

test('a probe that answers the wrong project records failed', async () => {
  const store = createMemoryStore()
  const ops = createWorkspaceOps(store, deps(), io({
    probe: async () => ({ ok: false, reason: '查询「alphaOnlySymbol」没有返回它的定义' }),
  }))
  const state = await ops.enable(record, 'codegraph')
  assert.equal(state.kind, 'failed')
  assert.match(state.kind === 'failed' ? state.reason : '', /没有返回它的定义/)
})

test('an empty workspace fails with a reason instead of hanging', async () => {
  const store = createMemoryStore()
  const ops = createWorkspaceOps(store, deps(), io({ pickProbeSymbol: () => undefined }))
  const state = await ops.enable(record, 'codegraph')
  assert.deepEqual(state, { kind: 'failed', reason: '这个工作区没有找到可索引的源码' })
})

test('disable only flips the switch', async () => {
  const store = createMemoryStore()
  await store.put({ ...record, enabled: true, state: { kind: 'ready', verifiedAt: 1 }, probeSymbol: 'alphaOnlySymbol' })
  const ops = createWorkspaceOps(store, deps(), io({}))
  await ops.disable(store.get('/repo')!)
  const after = store.get('/repo')!
  assert.equal(after.enabled, false)
  assert.equal(after.state.kind, 'disabled')
})

test('two enables on one workspace run one after the other', async () => {
  const store = createMemoryStore()
  const order: string[] = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const ops = createWorkspaceOps(store, deps(), io({
    hasIndex: () => false,
    init: async () => { order.push('first'); await gate; return { ok: true, stdout: '' } },
  }))
  const first = ops.enable({ ...record, enabled: true, state: { kind: 'failed', reason: 'x' } }, 'codegraph')
  await Promise.resolve()
  const second = ops.enable({ ...record, enabled: true, state: { kind: 'failed', reason: 'x' } }, 'codegraph')
  await new Promise(resolve => setTimeout(resolve, 10))
  release()
  await Promise.all([first, second])
  assert.deepEqual(order, ['first', 'first'])
  assert.equal(store.get('/repo')?.state.kind, 'ready')
})
