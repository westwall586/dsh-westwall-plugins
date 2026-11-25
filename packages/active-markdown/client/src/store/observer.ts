/**
 * 关闭页签的常驻观察者。宿主切走文档会把 body 卸载，body 里监听 `tab.signal`
 * 的代码随之消失，所以隐藏状态下关闭页签没人听见；插件又无法为 `text` 这个页签
 * 类型注册关闭钩子。观察者坐在 `apply` 层，它的寿命覆盖整个插件，订阅宿主的
 * `openTabs` 就能在没有任何 body 挂载时看到页签消失。
 *
 * 登记的是 `(session, path) -> 页签地址`，不是页签：同一个文件开两个页签共用一个
 * crate，只有最后一个页签消失才算关闭。
 *
 * `tab.signal` 的 abort 有两个来源：页签记录消失与插件卸载。把卸载当成关闭会在
 * 每次重载时清空全部磁盘批注，所以卸载时先置 `disposed`，此后不再把 abort 当成
 * 关闭；尚未确认关闭的 crate 一律按 `unload` 处理（只清内存，不动磁盘）。
 */
import type { DocumentStore } from './document.ts'
import { crateId, type DocumentRef } from './ref.ts'

export interface DocumentMount {
  readonly ref: DocumentRef
  /** 这个页签生命周期结束时 abort；插件卸载也会 abort。 */
  readonly signal: AbortSignal
  /** 页签记录的 `contentId`，即文档地址。 */
  readonly address: string
}

export interface Registration {
  /** 撤销一次登记；页签正常关闭时由 body 的 effect 清理调用。 */
  release(): void
}

export interface CloseObserverDeps {
  documents: DocumentStore
  /** 宿主当前开着的页签地址。 */
  openAddresses(): ReadonlySet<string>
  /** 一次关闭的全部处置，含磁盘清理；返回的承诺在清理完成时结束。 */
  dispose(session: string, path: string): Promise<void> | void
}

export interface CloseObserver {
  register(mount: DocumentMount): Registration
  /** 页签快照变了；插件已经卸载时什么都不做。 */
  check(): void
  /** 插件卸载：此后不再把 abort 当成关闭，剩下的 crate 只清内存。 */
  dispose(): void
}

interface Held {
  readonly address: string
  /** 还活着的挂载；它为空就是这条登记该收掉了。 */
  readonly mounts: Set<DocumentMount>
}

export function createCloseObserver(deps: CloseObserverDeps): CloseObserver {
  const held = new Map<string, Held>()
  /** 已确认关闭、正在做磁盘清理的 crate；开回来的同一文档不再归属旧那次处置。 */
  const closing = new Set<string>()
  let disposed = false

  const close = (session: string, path: string): void => {
    const id = crateId({ session, path })
    if (closing.has(id)) return
    closing.add(id)
    void deps.dispose(session, path)
  }

  return {
    register(mount) {
      if (disposed) {
        // 卸载后 body 还能短暂挂回来一次，别让它复活一个 crate。
        void deps.documents.dispose(mount.ref.session, mount.ref.path, 'unload')
        return { release: () => {} }
      }
      const id = crateId(mount.ref)
      // 页签关掉又马上开回同一个文件：上一次的关闭处置作废，crate 归新页签。
      closing.delete(id)
      // 先入 map 再碰 store：store.mount 可能同步触发一次 check()，它必须已经看到这一条。
      const entry = held.get(id) ?? { address: mount.address, mounts: new Set() }
      entry.mounts.add(mount)
      held.set(id, entry)
      deps.documents.mount(mount.ref)
      return {
        release: () => {
          // 等到这里才挂上，是为了让上一行同步触发的 check() 仍看到这次登记。
          deps.documents.unmount(mount.ref)
          if (!entry.mounts.delete(mount)) return
          if (entry.mounts.size > 0) return
          held.delete(id)
        },
      }
    },

    check() {
      if (disposed) return
      const open = deps.openAddresses()
      const gone = new Set<string>()
      for (const [id, entry] of [...held]) {
        if (open.has(entry.address)) continue
        held.delete(id)
        gone.add(id)
      }
      // 一个页签都没有时，没有登记的 crate（来自某个已不在快照里的会话）同样就是关闭。
      // 只在快照为空时扫：快照非空说明它只覆盖一部分会话，扫会把还开着的文档误判成关闭。
      if (open.size === 0) deps.documents.touch((session, path) => { gone.add(crateId({ session, path })) })
      // 磁盘清理在本轮中途就会改 store，先把要关的收齐再动手。
      for (const id of gone) {
        const at = id.indexOf('\u0000')
        close(id.slice(0, at), id.slice(at + 1))
      }
    },

    dispose() {
      if (disposed) return
      disposed = true
      held.clear()
      deps.documents.disposeAll('unload')
    },
  }
}
