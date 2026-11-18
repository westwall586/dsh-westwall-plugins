import test from 'node:test'
import assert from 'node:assert/strict'

import type { Block } from '../client/src/markdown/model.ts'
import {
  canEnterEdit,
  conflictFileName,
  lineTarget,
  MAX_EDIT_BYTES,
  sameText,
  saveOutcomeOf,
  type EditCheckResult,
  type WriteTextResult,
} from '../client/src/edit/model.ts'

test('sameText 视 CRLF 与 LF 为同一文本', () => {
  assert.equal(sameText('a\r\nb\r\n', 'a\nb\n'), true)
  assert.equal(sameText('a\nb', 'a\r\nb\r\n'), false)
  assert.equal(sameText('a\nb\n', 'a\nb\n'), true)
})

test('sameText 的末尾换行是内容的一部分', () => {
  assert.equal(sameText('a\n', 'a'), false)
  assert.equal(sameText('a\r\n', 'a\n'), true)
})

test('canEnterEdit 拒绝译文视图，先切回原文', () => {
  const gate = { check: { status: 'ok', absolutePath: '/w/a.md', version: 'v1' } as EditCheckResult, bytes: 10 }
  assert.deepEqual(canEnterEdit({ view: 'translated', pending: 0, gate }), { ok: false, reason: 'translated' })
})

test('canEnterEdit 在有未发送批注时给出条数提示的理由', () => {
  const gate = { check: { status: 'ok', absolutePath: '/w/a.md', version: 'v1' } as EditCheckResult, bytes: 10 }
  assert.deepEqual(canEnterEdit({ view: 'source', pending: 2, gate }), { ok: false, reason: 'pending' })
})

test('canEnterEdit 在检查未完成或工作区外时拒绝', () => {
  assert.deepEqual(canEnterEdit({ view: 'source', pending: 0, gate: { check: null, bytes: 10 } }), { ok: false, reason: 'unchecked' })
  assert.deepEqual(
    canEnterEdit({ view: 'source', pending: 0, gate: { check: { status: 'outside' }, bytes: 10 } }),
    { ok: false, reason: 'outside' },
  )
})

test('canEnterEdit 在只读会话与 Host 判定过大时拒绝', () => {
  assert.deepEqual(
    canEnterEdit({ view: 'source', pending: 0, gate: { check: { status: 'read-only', mode: 'read-only' }, bytes: 10 } }),
    { ok: false, reason: 'read-only' },
  )
  assert.deepEqual(
    canEnterEdit({
      view: 'source',
      pending: 0,
      gate: { check: { status: 'too-large', limit: MAX_EDIT_BYTES }, bytes: 10 },
    }),
    { ok: false, reason: 'too-large' },
  )
})

test('canEnterEdit 把无法编辑的理由透传', () => {
  assert.deepEqual(
    canEnterEdit({
      view: 'source',
      pending: 0,
      gate: { check: { status: 'unsupported', reason: 'symlink' }, bytes: 10 },
    }),
    { ok: false, reason: 'unsupported' },
  )
})

test('canEnterEdit 允许刚好 1 MiB，超过一个字节就拒绝', () => {
  const check: EditCheckResult = { status: 'ok', absolutePath: '/w/a.md', version: 'v1' }
  assert.deepEqual(canEnterEdit({ view: 'source', pending: 0, gate: { check, bytes: MAX_EDIT_BYTES } }), { ok: true })
  assert.deepEqual(
    canEnterEdit({ view: 'source', pending: 0, gate: { check, bytes: MAX_EDIT_BYTES + 1 } }),
    { ok: false, reason: 'too-large' },
  )
})

test('saveOutcomeOf 把六种写结果投影成客户端出口', () => {
  const results: WriteTextResult[] = [
    { status: 'saved', absolutePath: '/w/a.md', version: 'v2', bytes: 12 },
    { status: 'stale' },
    { status: 'exists', absolutePath: '/w/a.conflict.md' },
    { status: 'denied', mode: 'workspace-write' },
    { status: 'too-large', limit: MAX_EDIT_BYTES },
    { status: 'unsupported', reason: 'fs' },
  ]
  assert.deepEqual(results.map(saveOutcomeOf), [
    { kind: 'saved', absolutePath: '/w/a.md', version: 'v2', bytes: 12 },
    { kind: 'stale' },
    { kind: 'exists', absolutePath: '/w/a.conflict.md' },
    { kind: 'denied', mode: 'workspace-write' },
    { kind: 'too-large', limit: MAX_EDIT_BYTES },
    { kind: 'unsupported', reason: 'fs' },
  ])
})

test('conflictFileName 落在原文件同目录并带时间戳', () => {
  const stamp = new Date(2026, 10, 18, 17, 0, 0)
  assert.equal(conflictFileName('/w/docs/a.md', stamp, new Set()), '/w/docs/a.conflict-20261118-170000.md')
})

test('conflictFileName 保留原扩展名', () => {
  const stamp = new Date(2026, 10, 18, 17, 0, 0)
  assert.equal(conflictFileName('/w/notes.markdown', stamp, new Set()), '/w/notes.conflict-20261118-170000.markdown')
  assert.equal(conflictFileName('/w/README', stamp, new Set()), '/w/README.conflict-20261118-170000')
})

test('conflictFileName 撞名时追加 -2、-3', () => {
  const stamp = new Date(2026, 10, 18, 17, 0, 0)
  const first = '/w/a.conflict-20261118-170000.md'
  assert.equal(conflictFileName('/w/a.md', stamp, new Set([first])), '/w/a.conflict-20261118-170000-2.md')
  assert.equal(
    conflictFileName('/w/a.md', stamp, new Set([first, '/w/a.conflict-20261118-170000-2.md'])),
    '/w/a.conflict-20261118-170000-3.md',
  )
})

test('conflictFileName 认识反斜杠目录', () => {
  const stamp = new Date(2026, 10, 18, 17, 0, 0)
  assert.equal(
    conflictFileName('C:\\docs\\a.md', stamp, new Set()),
    'C:\\docs\\a.conflict-20261118-170000.md',
  )
})

function block(id: string, start: number, end: number): Block {
  return {
    id,
    type: 'paragraph',
    sourceStartLine: start,
    sourceEndLine: end,
    headingPath: [],
    text: id,
    inline: [],
    tight: false,
  }
}

test('lineTarget 命中首块与末块', () => {
  const blocks = [block('a', 1, 3), block('b', 5, 8)]
  assert.equal(lineTarget(blocks, 1)?.id, 'a')
  assert.equal(lineTarget(blocks, 3)?.id, 'a')
  assert.equal(lineTarget(blocks, 8)?.id, 'b')
})

test('lineTarget 对块间空行落到前一块', () => {
  const blocks = [block('a', 1, 3), block('b', 5, 8)]
  assert.equal(lineTarget(blocks, 4)?.id, 'a')
})

test('lineTarget 越界夹到首块或末块', () => {
  const blocks = [block('a', 3, 5), block('b', 7, 9)]
  assert.equal(lineTarget(blocks, 1)?.id, 'a')
  assert.equal(lineTarget(blocks, 99)?.id, 'b')
})

test('lineTarget 空文档返回 undefined', () => {
  assert.equal(lineTarget([], 1), undefined)
})
