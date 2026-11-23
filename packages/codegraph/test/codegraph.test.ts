/**
 * 骨架的行为边界：插件的两种故障都不许打到宿主身上。
 *
 * 一条测 `agent/created` 监听不外抛（抛错会让会话创建整体失败），一条测存储域
 * 打不开时退化为内存。两条都断言调用方观察到的行为，不碰内部结构。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createSessionMounts } from '../src/sessions.ts'
import { createMemoryStore, openCodegraphStore } from '../src/state.ts'
import type { CodegraphStore } from '../src/state.ts'
import type { CodegraphDeps, OpenMcpClient } from '../src/deps.ts'

const ROOT = '/repo'

/** `agent.ctx` 只需要能被 `createScope` 转成子作用域；用真实 createScope 保持形状真实。 */
function fakeAgentCtx(): Context {
  return {
    plugin: (plugin: unknown, config?: unknown) => {
      const fiber = {
        ctx: fakeAgentCtx(),
        await: () => Promise.resolve(fiber),
        dispose: () => Promise.resolve(),
        _config: { plugin, config },
      }
      return fiber
    },
  } as unknown as Context
}

function fakeAgent(sessionId = 'session-1'): Agent {
  return { session: { id: sessionId }, ctx: fakeAgentCtx() } as unknown as Agent
}

/** 只实现 `workingDirectory.get`：监听体只该走这条纯读路径。 */
function fakeContext(directory: string, failGet = false): Context {
  return {
    workingDirectory: {
      get() {
        if (failGet) throw new Error('projection unavailable')
        return directory
      },
    },
  } as unknown as Context
}

function depsWith(openMcpClient: OpenMcpClient): CodegraphDeps {
  return {
    ctx: {} as Context,
    config: {
      command: '/usr/local/bin/codegraph',
      initOnEnable: true,
      initTimeoutMs: 600_000,
      reminder: false,
      warnGlobalInstall: true,
      startupTimeoutMs: 8_000,
      closeTimeoutMs: 1_500,
    },
    openMcpClient,
    globalInstall: async () => undefined,
  }
}

/** 内存存储同步落表，`put` 的 promise 不必等。 */
async function storeEnabledAt(path: string): Promise<CodegraphStore> {
  const store = createMemoryStore()
  await store.put({ path, enabled: true, state: { kind: 'verifying' }, updatedAt: 1 })
  return store
}

test('agent/created 的挂载在依赖抛错时不向外抛', async () => {
  const mounting: OpenMcpClient = () => ({
    await: () => Promise.reject(new Error('spawn failed')),
    dispose: () => Promise.resolve(),
  })
  const ctx = fakeContext(ROOT)
  const store = await storeEnabledAt(ROOT)
  const mounts = createSessionMounts(ctx, depsWith(mounting), store)

  await assert.doesNotReject(mounts.attach(fakeAgent()))

  assert.equal(mounts.size, 0, '失败后不保留半挂的连接')
  assert.equal(store.get(ROOT)?.state.kind, 'failed')
})

test('工作目录读失败时向外仍不抛', async () => {
  const ctx = fakeContext(ROOT, true)
  const store = await storeEnabledAt(ROOT)
  const mounts = createSessionMounts(ctx, depsWith(() => {
    throw new Error('must not be called')
  }), store)

  await assert.doesNotReject(mounts.attach(fakeAgent()))
  assert.equal(mounts.size, 0)
})

test('存储域打不开时退化为内存且不抛', async () => {
  const store = await openCodegraphStore({
    open: async () => { throw new Error('backend down') },
  })

  assert.equal(store.durable, false)
  await assert.doesNotReject(store.put({
    path: ROOT, enabled: true, state: { kind: 'ready', verifiedAt: 7 }, updatedAt: 7,
  }))
  assert.equal(store.get(ROOT)?.state.kind, 'ready', '本进程内仍可读写')
})

test('没有 storageDomain 时同样退化为内存', async () => {
  const store = await openCodegraphStore(undefined)
  assert.equal(store.durable, false)
  assert.deepEqual(store.list(), [])
})
