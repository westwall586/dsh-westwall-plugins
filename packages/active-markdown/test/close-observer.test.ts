import test from 'node:test'
import assert from 'node:assert/strict'

import type { HostBridge } from '../client/src/context.ts'
import { createDocumentStore } from '../client/src/store/document.ts'
import { createCloseObserver, type CloseObserver, type DocumentMount } from '../client/src/store/observer.ts'
import { fileAddressOf } from '../client/src/source.ts'

const SESSION = 's1'
/** 宿主给 body 的地址路径是相对工作区的，crate 的键用的就是它。 */
const PATH = 'a.md'
const ADDRESS = fileAddressOf(SESSION, PATH)

interface Harness {
  documents: ReturnType<typeof createDocumentStore>
  observer: CloseObserver
  open: Set<string>
  clears: string[]
  /** Release one pending annotation clear; the disk stays untouched until then. */
  releaseClear(): void
  /** The host published a new `openTabs` snapshot. */
  publish(): void
  /** Settle every pending microtask. */
  flush(): Promise<void>
}

function flush(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

function harness(): Harness {
  const open = new Set<string>([ADDRESS])
  /** 宿主每次发布快照才会调 `check()`；登记与撤销本身不触发检查。 */
  const publish = (): void => { h.observer.check() }
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
  const h: Harness = {} as Harness
  const observer = createCloseObserver({
    documents,
    openAddresses: () => open,
    dispose: (session, path) => { void documents.dispose(session, path, 'close') },
  })
  Object.assign(h, {
    documents,
    observer,
    open,
    publish,
    clears,
    releaseClear() {
      const resolve = pending.shift()
      assert.ok(resolve !== undefined, '没有挂起的磁盘清理')
      resolve()
    },
    flush,
  })
  return h
}

function mount(_h: Harness, signal = new AbortController().signal): DocumentMount {
  // 页签地址就是宿主给 body 的那个：相对工作区的路径，没有前导斜杠。
  return { ref: { session: SESSION, compose: SESSION, path: PATH }, signal, address: ADDRESS }
}

test('切走再切回（页签还在）不动状态', () => {
  const h = harness()
  const registration = h.observer.register(mount(h))
  h.documents.editFor(SESSION, PATH)?.reduce({ type: 'enter', text: '原文', version: 'v1', line: 1 })

  // 切走：body 卸载。页签还在，所以宿主这次不会发布新的快照；观测者自己也不会把
  // 没有登记的 crate 判成关闭，否则刷新的时刻差就会把还开着的文档清掉。
  registration.release()
  h.publish()
  assert.equal(h.clears.length, 0, '页签还开着就不清')
  assert.equal(h.documents.editFor(SESSION, PATH)?.getState().status, 'editing')

  // 切回来：再登记一次，草稿还在。页签一直开着，所以宿主不会为这次挂载发布快照。
  h.observer.register(mount(h))
  const draft = h.documents.editFor(SESSION, PATH)
  assert.equal(h.clears.length, 0, '没有发布就没有关闭')
  assert.equal(draft?.getState().status, 'editing')
})


test('隐藏状态下关闭页签：登记已撤销也能从快照里发现', async () => {
  const h = harness()
  const registration = h.observer.register(mount(h))
  h.documents.editFor(SESSION, PATH)?.reduce({ type: 'enter', text: '原文', version: 'v1', line: 1 })
  // body 卸载了：登记撤销，页签记录随后消失。
  registration.release()
  h.open.delete(ADDRESS)
  h.publish()
  await h.flush()

  assert.deepEqual(h.clears, [`${SESSION}:${PATH}`], '磁盘批注被清掉')
  assert.equal(h.documents.has(SESSION, PATH), false)
})

test('同一文件两个页签：关掉一个不算关闭', async () => {
  const h = harness()
  const first = h.observer.register(mount(h))
  const second = h.observer.register(mount(h))
  first.release()
  h.publish()
  assert.equal(h.clears.length, 0, '还有一个页签开着')

  // 最后一个页签关掉后，两条登记都已撤销，crate 也没有页签了。
  second.release()
  h.open.delete(ADDRESS)
  h.publish()
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
  h.publish()
  await h.flush()

  assert.deepEqual(h.clears, [], '磁盘批注不被清空')
})

test('关闭后又马上开回同一文件：新 crate 读到的是清空后的磁盘', async () => {
  const h = harness()
  const registration = h.observer.register(mount(h))
  registration.release()
  h.open.delete(ADDRESS)
  h.publish()

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

test('宿主还没发布过快照（空）时不算关闭', async () => {
  const h = harness()
  const registration = h.observer.register(mount(h))
  h.open.clear()
  // 应用启动、窗口重建时页签库还是空的；这时关掉一个刚恢复的文档是数据丢失。
  h.publish()
  assert.equal(h.clears.length, 0)
  // 刚恢复的文档还没挂上来，内存里也没有它的 crate；这时发布空快照不能清掉任何东西。
  assert.equal(h.clears.length, 0)
  registration.release()
  h.publish()
  assert.equal(h.clears.length, 0)
})

test('页签没了、快照非空时才算关闭', async () => {
  const h = harness()
  h.observer.register(mount(h))
  h.open.clear()
  h.open.add('dsh-resource://file/session/s1/other.md')
  h.publish()
  await h.flush()
  assert.equal(h.clears.length, 1)
})

test('快照非空时，没有登记的 crate 也算关闭', async () => {
  const h = harness()
  // 会话被删掉后它的页签记录已经不在快照里，别的页签还开着，body 也没机会再挂上来。
  h.open.clear()
  h.open.add('dsh-resource://file/session/s1/other.md')
  // 会话没了：body 不会再挂上来，但 crate 还在。
  h.documents.mount({ session: SESSION, compose: SESSION, path: PATH })
  h.documents.editFor(SESSION, PATH)?.reduce({ type: 'enter', text: '原文', version: 'v1', line: 1 })

  h.publish()
  await h.flush()
  // 清理发出后 crate 才被丢掉；落盘那一步由挂起的 annotationClear 收尾。
  assert.equal(h.clears.length, 1)
  h.releaseClear()
  await h.flush()
  assert.equal(h.documents.has(SESSION, PATH), false)
})

test('正文路径是相对路径时，快照用绝对路径，仍在开着的文档不会被当成关闭', async () => {
  const h = harness()
  // A 文档：crate 键是相对路径，但宿主给页签的地址按绝对路径拼，所以快照里
  // 只有绝对路径那一条，相对路径拼出来的那条并不在快照里。
  const ABSOLUTE = '/Users/me/w/a.md'
  const absoluteAddress = fileAddressOf(SESSION, ABSOLUTE)
  h.open.clear()
  h.open.add(absoluteAddress)
  h.documents.rememberPath(SESSION, PATH, ABSOLUTE)
  h.documents.mount({ session: SESSION, compose: SESSION, path: PATH })

  // B 文档出现在快照里，触发一次发布；A 此刻没有登记（body 被卸载）。
  h.open.add(fileAddressOf(SESSION, '/Users/me/w/b.md'))
  h.documents.unmount({ session: SESSION, compose: SESSION, path: PATH })
  h.publish()
  await h.flush()

  assert.deepEqual(h.clears, [], 'A 的页签还在，不能清')
  assert.equal(h.documents.has(SESSION, PATH), true)
})
