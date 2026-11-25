import test from 'node:test'
import assert from 'node:assert/strict'

import type { HostBridge } from '../client/src/context.ts'
import { createDocumentStore } from '../client/src/store/document.ts'
import { createCloseObserver, type CloseObserver, type DocumentMount } from '../client/src/store/observer.ts'

const SESSION = 's1'
const PATH = '/w/a.md'
const ADDRESS = `dsh-resource://file/session/${SESSION}${PATH}`

interface Harness {
  documents: ReturnType<typeof createDocumentStore>
  observer: CloseObserver
  open: Set<string>
  clears: string[]
  /** Release one pending annotation clear; the disk stays untouched until then. */
  releaseClear(): void
  /** Settle every pending microtask. */
  flush(): Promise<void>
}

function flush(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

function harness(): Harness {
  const open = new Set<string>([ADDRESS])
  const clears: string[] = []
  const pending: Array<() => void> = []
  const bridge = {
    async annotationClear(request: { sessionId: string, path: string }) {
      clears.push(`${request.sessionId}:${request.path}`)
      await new Promise<void>((resolve) => { pending.push(resolve) })
    },
    async annotationLoad() {
      return { annotations: [], pending: null, nextSeq: 1 }
    },
    // 磁盘上的批注还没清掉；它由上面挂起的那次 annotationClear 决定何时算清完。
    async annotationSave() {
      return { status: 'saved', durable: true }
    },
  }
  // 这里的 host 只服务磁盘清理：批注读取不参与本轮测试。
  const documents = createDocumentStore({
    host: async () => bridge as unknown as HostBridge,
    readingDelayMs: 0,
  })
  const observer = createCloseObserver({
    documents,
    openAddresses: () => open,
    dispose: (session, path) => { void documents.dispose(session, path, 'close') },
  })
  return {
    documents,
    observer,
    open,
    clears,
    releaseClear() {
      const resolve = pending.shift()
      assert.ok(resolve !== undefined, '没有挂起的磁盘清理')
      resolve()
    },
    flush,
  }
}

function mount(h: Harness, signal = new AbortController().signal): DocumentMount {
  return { ref: { session: SESSION, compose: SESSION, path: PATH }, signal, address: ADDRESS }
}

test('切走再切回（页签还在）不动状态', () => {
  const h = harness()
  const registration = h.observer.register(mount(h))
  h.documents.editFor(SESSION, PATH)?.reduce({ type: 'enter', text: '原文', version: 'v1', line: 1 })

  // 切走：body 卸载，登记撤销，页签还在。
  registration.release()
  h.observer.check()
  assert.equal(h.clears.length, 0, '页签还开着就不清')
  assert.equal(h.documents.editFor(SESSION, PATH)?.getState().status, 'editing')

  // 切回来：再登记一次，草稿还在。
  h.observer.register(mount(h))
  h.observer.check()
  assert.equal(h.clears.length, 0)
  assert.equal(h.documents.editFor(SESSION, PATH)?.getState().status, 'editing')
})

test('隐藏状态下关闭页签：登记已撤销也能从快照里发现', async () => {
  const h = harness()
  const registration = h.observer.register(mount(h))
  h.documents.editFor(SESSION, PATH)?.reduce({ type: 'enter', text: '原文', version: 'v1', line: 1 })
  // body 卸载了：登记撤销，页签记录随后消失。
  registration.release()
  h.open.delete(ADDRESS)
  h.observer.check()
  await h.flush()

  assert.deepEqual(h.clears, [`${SESSION}:${PATH}`], '磁盘批注被清掉')
  assert.equal(h.documents.has(SESSION, PATH), false)
})

test('同一文件两个页签：关掉一个不算关闭', async () => {
  const h = harness()
  const first = h.observer.register(mount(h))
  const second = h.observer.register(mount(h))
  first.release()
  h.observer.check()
  assert.equal(h.clears.length, 0, '还有一个页签开着')

  // 最后一个页签关掉后，两条登记都已撤销，crate 也没有页签了。
  second.release()
  h.open.delete(ADDRESS)
  h.observer.check()
  await h.flush()
  assert.deepEqual(h.clears, [`${SESSION}:${PATH}`])
})

test('插件卸载不算关闭：abort 了也不清磁盘', async () => {
  const h = harness()
  const controller = new AbortController()
  h.observer.register(mount(h, controller.signal))

  // 宿主先 abort，再让插件的 effect 清理跑（先置 disposed 再让 abort 回调看见它）。
  h.observer.dispose()
  controller.abort()
  h.observer.check()
  await h.flush()

  assert.deepEqual(h.clears, [], '磁盘批注不被清空')
})

test('关闭后又马上开回同一文件：新 crate 读到的是清空后的磁盘', async () => {
  const h = harness()
  const registration = h.observer.register(mount(h))
  registration.release()
  h.open.delete(ADDRESS)
  h.observer.check()

  // 清理还没落地，reader 已经点开了同一个文件。
  h.open.add(ADDRESS)
  h.observer.register(mount(h))
  // 读磁盘要排在清理之后：先等清理开始（说明它已排到队列里），这一轮不释放它。
  await h.flush()
  assert.equal(h.clears.length, 1, '清理已发出')
  const notes = h.documents.notesFor(SESSION, PATH, SESSION)
  notes.notes.load()
  await h.flush()
  assert.equal(notes.notes.getSnapshot().status, 'loading', '清理没跑完之前不读磁盘')

  h.releaseClear()
  await h.flush()
  await h.flush()
  assert.equal(notes.notes.getSnapshot().status, 'ready')
  assert.deepEqual(notes.notes.getSnapshot().annotations, [])
})

test('快照为空时，没有登记的 crate 也算关闭', async () => {
  const h = harness()
  // 会话被删掉后它的页签记录已经不在快照里，body 也没机会再挂上来。
  h.open.clear()
  // 会话没了：body 不会再挂上来，但 crate 还在。
  h.documents.mount({ session: SESSION, compose: SESSION, path: PATH })
  h.documents.editFor(SESSION, PATH)?.reduce({ type: 'enter', text: '原文', version: 'v1', line: 1 })

  h.observer.check()
  await h.flush()
  // 清理发出后 crate 才被丢掉；落盘那一步由挂起的 annotationClear 收尾。
  assert.equal(h.clears.length, 1)
  h.releaseClear()
  await h.flush()
  assert.equal(h.documents.has(SESSION, PATH), false)
})
