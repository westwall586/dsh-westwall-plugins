// T01 判定用例：存储域仓库两表（PLAN「存储域仓库」单元，域版本 1）。
// 内存替身驱动核心逻辑；DomainSpec 与真实 json per-record 后端往返直验（dsh-feed-reader 先例）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { descriptorOf } from '@deepseek-ai/dsh-storage-domain'
import {
  createWorklogsStore, jiraWorklogsDomain, openWorklogsStore,
  type OutboxDayRecord, type NotesDayRecord, type TableLike,
} from '../src/store/domain.ts'

function memTable<V>(): TableLike<V> {
  const m = new Map<string, V>()
  return {
    get: k => m.get(k),
    put: async (k, v) => { m.set(k, v) },
    delete: async k => m.delete(k),
    entries: () => [...m.entries()],
  }
}

function makeStore() {
  return createWorklogsStore({ outbox_day: memTable<OutboxDayRecord>(), notes_day: memTable<NotesDayRecord>() })
}

const NOW = '2026-10-15T09:00:00+08:00'

function outboxDay(date: string, n = 1): OutboxDayRecord {
  return {
    date,
    entries: Array.from({ length: n }, (_, i) => ({
      issueKey: `PROJ-${i + 1}`, taskName: `任务${i + 1}`, start: '09:00', end: '10:00',
      comment: '做某事', userEdited: false, lastStatus: 'failed' as const,
    })),
    createdAt: NOW, updatedAt: NOW,
  }
}

function notesDay(date: string, texts: string[]): NotesDayRecord {
  return {
    date,
    items: texts.map((text, i) => ({
      id: `n-${date}-${i + 1}`, issueKey: `PROJ-${i + 1}`, taskName: `任务${i + 1}`,
      text, createdAt: NOW, updatedAt: NOW,
    })),
    createdAt: NOW, updatedAt: NOW,
  }
}

test('域声明：版本 1、两表、backup-and-skip', () => {
  assert.equal(jiraWorklogsDomain.version, 1)
  assert.deepEqual(Object.keys(jiraWorklogsDomain.tables).sort(), ['notes_day', 'outbox_day'])
  assert.equal((jiraWorklogsDomain as unknown as { invalidRecords: string }).invalidRecords, 'backup-and-skip')
})

test('outbox：按日 put/get、同日整记录替换、delete 幂等返回', async () => {
  const store = makeStore()
  await store.putOutbox(outboxDay('2026-10-14', 2))
  assert.equal(store.getOutbox('2026-10-14')?.entries.length, 2)
  await store.putOutbox(outboxDay('2026-10-14', 1)) // 替换语义：后写即该日全集
  assert.equal(store.getOutbox('2026-10-14')?.entries.length, 1)
  assert.equal(store.getOutbox('2026-10-13'), undefined)
  assert.equal(await store.deleteOutbox('2026-10-14'), true)
  assert.equal(await store.deleteOutbox('2026-10-14'), false, '再删返回 false（已缺席）')
  assert.equal(store.getOutbox('2026-10-14'), undefined)
})

test('outboxSummary：多日聚合计数按日期升序', async () => {
  const store = makeStore()
  await store.putOutbox(outboxDay('2026-10-15', 3))
  await store.putOutbox(outboxDay('2026-10-13', 1))
  assert.deepEqual(store.outboxSummary(), [
    { date: '2026-10-13', count: 1 },
    { date: '2026-10-15', count: 3 },
  ])
})

test('notes：按日读写、空 items 整存即清空', async () => {
  const store = makeStore()
  await store.putNotes(notesDay('2026-10-14', ['上午架构评审', '下午跨组沟通']))
  assert.equal(store.getNotes('2026-10-14')?.items.length, 2)
  await store.putNotes(notesDay('2026-10-14', []))
  assert.equal(store.getNotes('2026-10-14')?.items.length, 0, '空数组＝清空该日素材（合法态）')
})

test('open 后门：JWL_DEBUG_STORE_FAIL=open 开域即抛错', async () => {
  const prev = process.env.JWL_DEBUG_STORE_FAIL
  process.env.JWL_DEBUG_STORE_FAIL = 'open'
  try {
    await assert.rejects(openWorklogsStore({} as never), /存储域调试故障/)
  } finally {
    if (prev === undefined) delete process.env.JWL_DEBUG_STORE_FAIL
    else process.env.JWL_DEBUG_STORE_FAIL = prev
  }
})

test('openWorklogsStore：storageDomain 缺席按可读错误拒绝', async () => {
  await assert.rejects(openWorklogsStore({} as never), /storageDomain/)
})

test('真实后端：两表往返（域 v1 per-record）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jwl-store-'))
  const backend = new JsonStorageBackend(dir)
  const unit = await backend.kv.open(descriptorOf(jiraWorklogsDomain))
  await unit.putRecord('outbox_day', '2026-10-14', outboxDay('2026-10-14', 2))
  await unit.putRecord('notes_day', '2026-10-14', notesDay('2026-10-14', ['素材一']))
  const snap = await unit.loadAll()
  const tables = snap.tables as Record<string, Record<string, unknown>>
  const out = tables.outbox_day['2026-10-14'] as OutboxDayRecord
  assert.equal(out.entries[0]?.lastStatus, 'failed', 'outbox_day 往返')
  const notes = tables.notes_day['2026-10-14'] as NotesDayRecord
  assert.equal(notes.items[0]?.text, '素材一', 'notes_day 往返')
  await unit.close()
  await backend.close()
  rmSync(dir, { recursive: true, force: true })
})
