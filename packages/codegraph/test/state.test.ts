/** 存储键必须满足域对 per-record 键的路径安全要求，且记录按真实路径索引。 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createMemoryStore, storageKey } from '../src/state.ts'

const SAFE = /^[a-zA-Z0-9_-]+$/
const PATH = '/home/example/project-name'

test('a workspace path maps to a path-safe storage key', () => {
  assert.match(storageKey(PATH), SAFE)
  assert.notEqual(storageKey(PATH), storageKey(`${PATH}-other`))
})

test('the store indexes records by their real path', async () => {
  const store = createMemoryStore()
  await store.put({ path: PATH, enabled: true, state: { kind: 'ready', verifiedAt: 1 }, updatedAt: 1 })
  assert.equal(store.get(PATH)?.enabled, true)
  assert.deepEqual(store.list().map(record => record.path), [PATH])
})
