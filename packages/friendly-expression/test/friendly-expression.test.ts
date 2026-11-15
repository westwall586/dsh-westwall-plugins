import test from 'node:test'
import assert from 'node:assert/strict'

import { Config, apply, inject, name, readStylePrompt } from '../src/index.ts'
import {
  DEFAULT_STYLE_PROMPT, MAX_PROMPT_CHARS, MAX_SECTION_CHARS, renderSection, SECTION_PREFIX,
} from '../src/prompt.ts'
import {
  createMemorySnapshotStore, openSnapshotStore, promptSnapshotDomain, shouldCapture,
} from '../src/snapshot.ts'

const STYLE_PROMPT = '先给结论。'

function quiet<T>(run: () => Promise<T>): Promise<T> {
  const original = console.warn
  console.warn = () => {}
  return run().finally(() => { console.warn = original })
}

test('插件导出形状合法', () => {
  assert.equal(name, 'friendly-expression')
  assert.deepEqual(inject, ['systemPrompt', 'storageDomain'])
  assert.equal(typeof apply, 'function')
  assert.notEqual(Config, undefined)
})

test('默认提示词是 164 字符正文且在 800 上限内', () => {
  assert.equal(DEFAULT_STYLE_PROMPT.length, 164)
  assert.ok(DEFAULT_STYLE_PROMPT.length <= MAX_PROMPT_CHARS)
  assert.equal(MAX_PROMPT_CHARS, 800)
})

test('注册文本是隐藏英文前缀加正文', () => {
  assert.equal(
    renderSection(DEFAULT_STYLE_PROMPT),
    'When talking with the user, follow these principles:\n' + DEFAULT_STYLE_PROMPT,
  )
  assert.equal(renderSection('先给结论。'), 'When talking with the user, follow these principles:\n先给结论。')
  assert.equal(SECTION_PREFIX, 'When talking with the user, follow these principles:')
})

test('空正文不渲染 section，也不带前缀', () => {
  assert.equal(renderSection(''), '')
})

test('最长正文的快照仍能通过存储校验', () => {
  const longest = renderSection('x'.repeat(MAX_PROMPT_CHARS))
  assert.equal(longest.length, MAX_SECTION_CHARS)
  const schema = promptSnapshotDomain.tables.sessions.valueSchema
  assert.doesNotThrow(() => schema.parse({ prompt: longest, capturedAt: 0 }))
  assert.doesNotThrow(() => schema.parse({ prompt: 'x'.repeat(MAX_PROMPT_CHARS), capturedAt: 0 }))
})

test('volatile 配置默认值和 getter 都可读取', () => {
  const defaults = Config({})
  assert.equal(readStylePrompt(defaults.stylePrompt), DEFAULT_STYLE_PROMPT)
  const custom = Config({ stylePrompt: STYLE_PROMPT })
  assert.equal(readStylePrompt(custom.stylePrompt), STYLE_PROMPT)
  assert.equal(readStylePrompt(STYLE_PROMPT), STYLE_PROMPT)
})

test('超过 800 字符的配置被拒绝', () => {
  assert.throws(() => Config({ stylePrompt: 'x'.repeat(MAX_PROMPT_CHARS + 1) }))
})

test('shouldCapture 只在三个条件都为 false 时为真', () => {
  for (const isSubagent of [false, true]) {
    for (const isSeeded of [false, true]) {
      for (const hasMessages of [false, true]) {
        const expected = !isSubagent && !isSeeded && !hasMessages
        assert.equal(shouldCapture({ isSubagent, isSeeded, hasMessages }), expected)
      }
    }
  }
})

test('内存快照在捕获后立即可读，空字符串也可读', async () => {
  const store = createMemorySnapshotStore(() => 1234)
  assert.equal(store.get('s1'), undefined)
  const pending = store.capture('s1', STYLE_PROMPT)
  assert.equal(store.get('s1'), STYLE_PROMPT)
  await pending
  await store.capture('s2', '')
  assert.equal(store.get('s2'), '')
  await store.close()
  assert.equal(store.get('s1'), undefined)
})

test('没有 storageDomain 时退回内存快照', async () => {
  const store = await quiet(() => openSnapshotStore({ get: () => undefined }))
  await store.capture('s1', STYLE_PROMPT)
  assert.equal(store.get('s1'), STYLE_PROMPT)
  await store.close()
})

test('存储域打开失败时退回内存快照', async () => {
  const ctx = {
    get: (service: string) => service === 'storageDomain'
      ? { open: async () => { throw new Error('backend offline') } }
      : undefined,
  }
  const store = await quiet(() => openSnapshotStore(ctx))
  await store.capture('s1', STYLE_PROMPT)
  assert.equal(store.get('s1'), STYLE_PROMPT)
})

test('存储域写入失败时内存值保留', async () => {
  const table = new Map<string, { prompt: string; capturedAt: number }>()
  let failPut = true
  const ctx = {
    get: (service: string) => service === 'storageDomain'
      ? {
        open: async () => ({
          table: () => ({
            get: (key: string) => table.get(key),
            put: async (key: string, value: { prompt: string; capturedAt: number }) => {
              if (failPut) throw new Error('disk full')
              table.set(key, value)
            },
          }),
          close: async () => {},
        }),
      }
      : undefined,
  }
  const store = await quiet(() => openSnapshotStore(ctx))
  await quiet(async () => {
    await assert.rejects(store.capture('s1', STYLE_PROMPT), /disk full/)
  })
  assert.equal(store.get('s1'), STYLE_PROMPT)
  failPut = false
  await store.capture('s2', '正常写入')
  assert.equal(table.get('s2')?.prompt, '正常写入')
  await store.close()
})

test('快照域声明符合设计', () => {
  assert.equal(promptSnapshotDomain.name, 'friendly_expression')
  assert.equal(promptSnapshotDomain.version, 1)
  assert.equal(promptSnapshotDomain.layout, 'per-record')
  assert.equal(promptSnapshotDomain.invalidRecords, 'backup-and-skip')
  assert.deepEqual(Object.keys(promptSnapshotDomain.tables), ['sessions'])
})
