import test from 'node:test'
import assert from 'node:assert/strict'

import { loadDocument, sessionFileOf, type ReadBytes } from '../client/src/source.ts'
import type { RemoteResult, WorkspaceFileBytes } from '../client/src/context.ts'

const bytes = (data: number[] | string, eof = true, extra: Partial<WorkspaceFileBytes> = {}): RemoteResult<WorkspaceFileBytes> => ({
  ok: true,
  value: {
    data: new Uint8Array(typeof data === 'string' ? [...new TextEncoder().encode(data)] : data),
    eof,
    version: 'v1',
    absolutePath: '/docs/a.md',
    ...extra,
  },
})

test('会话文件地址解析出会话与路径', () => {
  assert.deepEqual(sessionFileOf('dsh-resource://file/session/s1/docs/a.md'), { sessionId: 's1', path: 'docs/a.md' })
  assert.deepEqual(sessionFileOf('dsh-resource://file/session/s%201/a%20b.md'), { sessionId: 's 1', path: 'a b.md' })
  assert.deepEqual(sessionFileOf('dsh-resource://file/session/s1//etc/hosts'), { sessionId: 's1', path: '/etc/hosts' })
  assert.equal(sessionFileOf('dsh-resource://file/session/s1/a.md?x=1#y')?.path, 'a.md')
})

test('非会话地址与损坏的地址不认领', () => {
  assert.equal(sessionFileOf('dsh-resource://file/absolute/a.md'), undefined)
  assert.equal(sessionFileOf('https://example.com/a.md'), undefined)
  assert.equal(sessionFileOf('dsh-resource://file/session/s1'), undefined)
  assert.equal(sessionFileOf('dsh-resource://file/session/s1/%E0%A4%A'), undefined)
})

test('小文件读出文本与版本', async () => {
  const read: ReadBytes = async () => bytes('# 标题\n')
  const loaded = await loadDocument(read, { sessionId: 's1', path: 'a.md' }, new AbortController().signal, 1024)
  assert.deepEqual(loaded, { status: 'ready', text: '# 标题\n', version: 'v1', bytes: 9, absolutePath: '/docs/a.md' })
})

test('窗口未到文件末尾即判定为超大', async () => {
  const read: ReadBytes = async () => bytes('a'.repeat(1024), false, { bytes: 9999 })
  const loaded = await loadDocument(read, { sessionId: 's1', path: 'a.md' }, new AbortController().signal, 1024)
  assert.deepEqual(loaded, { status: 'too-large', bytes: 9999, limit: 1024 })
})

test('宿主报出更小的窗口上限时按上限重试', async () => {
  const lengths: number[] = []
  const read: ReadBytes = async (_session, _path, options) => {
    lengths.push(options.range?.length ?? -1)
    return options.range?.length === 1024
      ? { ok: false, error: { code: 'workspace-file/too-large', message: 'too large', details: { limit: 256 } } }
      : bytes('x'.repeat(256), true, { bytes: 256 })
  }
  const loaded = await loadDocument(read, { sessionId: 's1', path: 'a.md' }, new AbortController().signal, 1024)
  assert.deepEqual(lengths, [1024, 256])
  assert.equal(loaded.status, 'ready')
})

test('非 UTF-8 与含 NUL 的内容不按文本渲染', async () => {
  const invalid = await loadDocument(async () => bytes([0xff, 0xfe]), { sessionId: 's1', path: 'a.md' }, new AbortController().signal)
  assert.equal(invalid.status, 'not-text')
  const nul = await loadDocument(async () => bytes([0x61, 0x00]), { sessionId: 's1', path: 'a.md' }, new AbortController().signal)
  assert.equal(nul.status, 'not-text')
  const host = await loadDocument(async () => ({ ok: false, error: { code: 'workspace-file/not-text', message: 'binary' } }), { sessionId: 's1', path: 'a.md' }, new AbortController().signal)
  assert.equal(host.status, 'not-text')
})

test('读取失败保留可显示的码与消息', async () => {
  const loaded = await loadDocument(async () => ({ ok: false, error: { code: 'workspace-file/not-found', message: 'gone' } }), { sessionId: 's1', path: 'a.md' }, new AbortController().signal)
  assert.deepEqual(loaded, { status: 'failed', code: 'workspace-file/not-found', message: 'gone' })
})

test('取消后的异常不冒充读取失败', async () => {
  const controller = new AbortController()
  controller.abort()
  const loaded = await loadDocument(async () => { throw new Error('aborted') }, { sessionId: 's1', path: 'a.md' }, controller.signal)
  assert.deepEqual(loaded, { status: 'failed', code: 'aborted', message: 'aborted' })
})
