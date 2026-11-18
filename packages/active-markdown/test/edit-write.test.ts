import test from 'node:test'
import assert from 'node:assert/strict'

import {
  editCheck,
  MAX_EDIT_BYTES,
  writeIntentOf,
  writeResultOf,
  writeText,
  type EditFacility,
  type EditFsLike,
  type EditMode,
  type WriteIntent,
} from '../src/edit/write.ts'

const ROOT = '/w'
const FILE = '/w/docs/a.md'

function fsError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

interface FakeWrite {
  content: string
  expected: unknown
  policy: unknown
  displayPath: string
}

interface FakeOptions {
  mode?: EditMode
  contained?: boolean
  entry?: { type: 'file' | 'directory' | 'symlink' | 'other', size?: number }
  entryMissing?: boolean
  info?: { type: 'file' | 'directory' | 'other', size?: number, version: string } | undefined
  write?: (content: string, expected: unknown) => Promise<{ version: string, after: string }>
}

function fakeFacility(options: FakeOptions = {}): { face: EditFacility, writes: FakeWrite[] } {
  const writes: FakeWrite[] = []
  const fs: EditFsLike = {
    async resolve(path) {
      return { targetKey: path, displayPath: path }
    },
    async lstat() {
      if (options.entryMissing === true) return undefined
      return options.entry ?? { type: 'file', size: 10 }
    },
    async stat() {
      return options.info ?? { type: 'file', size: 10, version: 'v1' }
    },
    contains() {
      return options.contained ?? true
    },
    async writeText(target, content, expected, _signal, policy) {
      writes.push({ content, expected, policy, displayPath: target.displayPath })
      if (options.write !== undefined) return options.write(content, expected)
      return { version: 'v2', after: content }
    },
  }
  return {
    face: {
      fs,
      sandbox: { resolve: () => ({ mode: options.mode ?? 'workspace-write', workspaceRoot: ROOT }) },
      sessions: { get: id => (id === 's1' ? { header: { cwd: ROOT } } : undefined) },
    },
    writes,
  }
}

function checkRequest(bytes = 10) {
  return { sessionId: 's1', path: 'docs/a.md', bytes }
}

function writeRequest(text: string, intent: WriteIntent = { kind: 'overwrite' }) {
  return { sessionId: 's1', path: 'docs/a.md', text, intent }
}

test('editCheck 在会话缺失时返回 unsupported/session', async () => {
  const { face } = fakeFacility()
  assert.deepEqual(await editCheck(face, { ...checkRequest(), sessionId: 'missing' }), {
    status: 'unsupported',
    reason: 'session',
  })
})

test('editCheck 在工作区外返回 outside', async () => {
  const { face } = fakeFacility({ contained: false })
  assert.deepEqual(await editCheck(face, checkRequest()), { status: 'outside' })
})

test('editCheck 对符号链接返回 unsupported/symlink', async () => {
  const { face } = fakeFacility({ entry: { type: 'symlink' } })
  assert.deepEqual(await editCheck(face, checkRequest()), { status: 'unsupported', reason: 'symlink' })
})

test('editCheck 对目录与缺失路径返回 unsupported/not-file', async () => {
  const directory = fakeFacility({ entry: { type: 'directory' } }).face
  assert.deepEqual(await editCheck(directory, checkRequest()), { status: 'unsupported', reason: 'not-file' })
  const missing = fakeFacility({ entryMissing: true }).face
  assert.deepEqual(await editCheck(missing, checkRequest()), { status: 'unsupported', reason: 'not-file' })
})

test('editCheck 拒绝只读会话与超过 1 MiB 的文件', async () => {
  const readOnly = fakeFacility({ mode: 'read-only' }).face
  assert.deepEqual(await editCheck(readOnly, checkRequest()), { status: 'read-only', mode: 'read-only' })
  const large = fakeFacility({ info: { type: 'file', size: MAX_EDIT_BYTES + 1, version: 'v1' } }).face
  assert.deepEqual(await editCheck(large, checkRequest(1)), { status: 'too-large', limit: MAX_EDIT_BYTES })
})

test('editCheck 允许刚好 1 MiB 并回版本', async () => {
  const { face } = fakeFacility({ info: { type: 'file', size: MAX_EDIT_BYTES, version: 'v7' } })
  assert.deepEqual(await editCheck(face, checkRequest(1)), {
    status: 'ok',
    absolutePath: 'docs/a.md',
    version: 'v7',
  })
})

test('editCheck 在文件系统异常时返回 unsupported/fs', async () => {
  const { face } = fakeFacility({ entry: { type: 'file' } })
  face.fs.lstat = async () => {
    throw fsError('FS_IO_ERROR')
  }
  assert.deepEqual(await editCheck(face, checkRequest()), { status: 'unsupported', reason: 'fs' })
})

test('writeText 成功时写回版本与 after 的字节数', async () => {
  const { face, writes } = fakeFacility({ write: async content => ({ version: 'v9', after: `${content}！` }) })
  const result = await writeText(face, writeRequest('你好'))
  assert.deepEqual(result, {
    status: 'saved',
    absolutePath: 'docs/a.md',
    version: 'v9',
    bytes: Buffer.byteLength('你好！', 'utf8'),
  })
  assert.equal(writes.length, 1)
  assert.equal(writes[0]!.content, '你好')
})

test('writeText 把覆盖意图映射成不带守卫的写入', async () => {
  const { face, writes } = fakeFacility()
  await writeText(face, writeRequest('x', { kind: 'overwrite' }))
  assert.equal(writes[0]!.expected, undefined)
})

test('writeText 陈旧版本返回 stale', async () => {
  const { face } = fakeFacility({
    write: async () => {
      throw fsError('FS_STALE_VERSION')
    },
  })
  assert.deepEqual(await writeText(face, writeRequest('x', { kind: 'replace', version: 'v1' })), { status: 'stale' })
})

test('writeText 已存在返回 exists，覆盖本地后端的 FS_NOT_OBSERVED', async () => {
  for (const code of ['FS_ALREADY_EXISTS', 'FS_NOT_OBSERVED']) {
    const { face } = fakeFacility({
      write: async () => {
        throw fsError(code)
      },
    })
    assert.deepEqual(await writeText(face, writeRequest('x', { kind: 'create' })), {
      status: 'exists',
      absolutePath: 'docs/a.md',
    })
  }
})

test('writeText 沙箱拒绝返回 denied 与当时的模式', async () => {
  const { face } = fakeFacility({
    write: async () => {
      throw fsError('FS_SANDBOX_DENIED')
    },
  })
  assert.deepEqual(await writeText(face, writeRequest('x')), { status: 'denied', mode: 'workspace-write' })

  const readOnlyWrites = fakeFacility({ mode: 'read-only' })
  assert.deepEqual(await writeText(readOnlyWrites.face, writeRequest('x')), { status: 'denied', mode: 'read-only' })
  assert.equal(readOnlyWrites.writes.length, 0)
})

test('writeText 的 create 意图允许目标还不存在', async () => {
  const { face, writes } = fakeFacility({ entryMissing: true })
  const result = await writeText(face, writeRequest('新文件', { kind: 'create' }))
  assert.equal(result.status, 'saved')
  assert.deepEqual(writes[0]!.expected, { kind: 'createIfAbsent' })
})

test('writeText 的覆盖与替换意图不接受缺失的文件', async () => {
  const { face, writes } = fakeFacility({ entryMissing: true })
  assert.deepEqual(await writeText(face, writeRequest('x', { kind: 'replace', version: 'v1' })), {
    status: 'unsupported',
    reason: 'not-file',
  })
  assert.deepEqual(await writeText(face, writeRequest('x')), { status: 'unsupported', reason: 'not-file' })
  assert.equal(writes.length, 0)
})

test('writeText 在文本超过 1 MiB 时拒绝且不写盘', async () => {
  const { face, writes } = fakeFacility()
  assert.deepEqual(await writeText(face, writeRequest('a'.repeat(MAX_EDIT_BYTES + 1))), {
    status: 'too-large',
    limit: MAX_EDIT_BYTES,
  })
  assert.equal(writes.length, 0)
})

test('writeText 对符号链接与未知错误给出 unsupported', async () => {
  const linked = fakeFacility({ entry: { type: 'symlink' } }).face
  assert.deepEqual(await writeText(linked, writeRequest('x')), { status: 'unsupported', reason: 'symlink' })

  const failed = fakeFacility({
    write: async () => {
      throw fsError('FS_IO_ERROR')
    },
  }).face
  assert.deepEqual(await writeText(failed, writeRequest('x')), { status: 'unsupported', reason: 'fs' })
})

test('writeText 拒绝未知的写入意图', async () => {
  const { face, writes } = fakeFacility()
  assert.deepEqual(
    await writeText(face, writeRequest('x', { kind: 'nope' } as unknown as WriteIntent)),
    { status: 'unsupported', reason: 'fs' },
  )
  assert.equal(writes.length, 0)
})

test('writeIntentOf 映射三种入口', () => {
  assert.deepEqual(writeIntentOf({ kind: 'replace', version: 'v1' }), {
    kind: 'replaceIfVersion',
    version: 'v1',
  })
  assert.deepEqual(writeIntentOf({ kind: 'create' }), { kind: 'createIfAbsent' })
  assert.equal(writeIntentOf({ kind: 'overwrite' }), undefined)
})

test('writeResultOf 按错误码映射写结果', () => {
  assert.deepEqual(writeResultOf(fsError('FS_STALE_VERSION'), 'workspace-write', FILE), { status: 'stale' })
  assert.deepEqual(writeResultOf(fsError('FS_SANDBOX_DENIED'), 'workspace-write', FILE), {
    status: 'denied',
    mode: 'workspace-write',
  })
  assert.deepEqual(writeResultOf(fsError('FS_ALREADY_EXISTS'), 'workspace-write', FILE), {
    status: 'exists',
    absolutePath: FILE,
  })
  assert.deepEqual(writeResultOf(fsError('FS_NOT_OBSERVED'), 'workspace-write', FILE), {
    status: 'exists',
    absolutePath: FILE,
  })
  assert.deepEqual(writeResultOf(fsError('FS_IO_ERROR'), 'workspace-write', FILE), {
    status: 'unsupported',
    reason: 'fs',
  })
  assert.deepEqual(writeResultOf(new Error('plain'), 'read-only', FILE), { status: 'unsupported', reason: 'fs' })
})
