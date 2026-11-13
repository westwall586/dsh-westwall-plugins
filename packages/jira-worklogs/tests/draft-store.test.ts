// T02 判定用例：草稿上下文缓存（draftId → date/taskKeys）＋候选映射缓存（20261015 Wave）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDraftStore, createCandidateStore } from '../src/draft-store.ts'

const ctx = (date: string) => ({ date, taskKeys: new Map([[1, { key: 'DEMO-745', name: '插件设置迁移' }]]) })

test('put/get 往返：返回 draftId 且可取回上下文', () => {
  const store = createDraftStore()
  const id = store.put(ctx('2026-09-21'))
  assert.equal(typeof id, 'string')
  assert.ok(id.length > 0)
  const got = store.get(id)!
  assert.equal(got.date, '2026-09-21')
  assert.equal(got.taskKeys.get(1)!.key, 'DEMO-745')
  assert.equal(got.taskKeys.get(1)!.name, '插件设置迁移')
})

test('同日再生成替换旧草稿：旧 draftId 失效，他日不受影响', () => {
  const store = createDraftStore()
  const id1 = store.put(ctx('2026-09-21'))
  const id2 = store.put(ctx('2026-09-21'))
  assert.notEqual(id1, id2)
  assert.equal(store.get(id1), undefined)
  assert.equal(store.get(id2)!.date, '2026-09-21')
  const id3 = store.put(ctx('2026-09-22'))
  assert.equal(store.get(id3)!.date, '2026-09-22')
  assert.ok(store.get(id2))
})

test('容量 LRU 淘汰，get 续期', () => {
  const store = createDraftStore(2)
  const a = store.put(ctx('2026-09-18'))
  const b = store.put(ctx('2026-09-21'))
  assert.ok(store.get(a)) // a 续期：最近使用
  const c = store.put(ctx('2026-09-22')) // 超容量 → 淘汰最久未用的 b
  assert.equal(store.get(b), undefined)
  assert.ok(store.get(a))
  assert.ok(store.get(c))
})

// —— 20261015 Wave：候选映射缓存与 outboxDate 携带 ——

test('CandidateStore：同日 put 替换重建（dayDetail 每次调用刷新），不合并', () => {
  const store = createCandidateStore()
  store.put('2026-10-15', new Map([[1, { key: 'A-1', name: '任务一' }]]))
  assert.equal(store.get('2026-10-15')!.get(1)!.key, 'A-1')
  store.put('2026-10-15', new Map([[1, { key: 'B-2', name: '新任务' }], [2, { key: 'B-3', name: '另一任务' }]]))
  const map = store.get('2026-10-15')!
  assert.equal(map.size, 2, '同日替换而非合并')
  assert.equal(map.get(1)!.key, 'B-2')
})

test('CandidateStore：容量 LRU 淘汰，get 续期', () => {
  const store = createCandidateStore(2)
  store.put('2026-10-13', new Map())
  store.put('2026-10-14', new Map())
  assert.ok(store.get('2026-10-13')) // 续期
  store.put('2026-10-15', new Map()) // 淘汰最久未用的 10-14
  assert.equal(store.get('2026-10-14'), undefined)
  assert.ok(store.get('2026-10-15'))
})

test('DraftContext 携带 outboxDate：put/get 往返不丢（暂存回显注册）', () => {
  const store = createDraftStore()
  const id = store.put({ date: '2026-10-14', taskKeys: new Map(), outboxDate: '2026-10-14' })
  assert.equal(store.get(id)!.outboxDate, '2026-10-14')
  const plain = store.put({ date: '2026-10-15', taskKeys: new Map() })
  assert.equal(store.get(plain)!.outboxDate, undefined, '普通生成不带 outboxDate')
})
