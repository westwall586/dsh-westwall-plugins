/** 浏览器半体的结构化契约。插件不 import 任何 DSH client 包，只按形状对话。 */
import type { ComponentType } from 'react'

export interface Translate {
  (key: string, params?: Record<string, unknown>): string
}

export interface LocaleService {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
  bind(namespace: string): Translate
}

export interface SlotOptions {
  name: string
  id?: string
  key?: string
  order?: number
  label?: string | (() => string)
  locale?: string
  [option: string]: unknown
}

export interface SlotService {
  inject(name: string, register: () => (() => void) | void): () => void
  register(options: SlotOptions, component: ComponentType<any>): () => void
}

/** 一条工作区开关的对外形状；Host 侧是同一个字段集。 */
export interface WorkspaceRow {
  path: string
  enabled: boolean
  state: string
  reason?: string
}

export interface WorkspaceStateView {
  workspaces: WorkspaceRow[]
  durable: boolean
  cliMissing: boolean
  globalInstall?: string
}

/** Host 远程服务 `codegraphAdmin` 的客户端面；失败以异常表达。 */
export interface CodegraphAdmin {
  describe(): Promise<WorkspaceStateView>
  setEnabled(path: string, enabled: boolean): Promise<WorkspaceStateView>
  retry(path: string): Promise<WorkspaceStateView>
  /** 最近一次成功读取的状态；菜单解析是同步的，不能等网络。 */
  snapshot(): WorkspaceStateView | undefined
  /** 读一次并刷新缓存，供订阅者重新渲染。 */
  refresh(): Promise<WorkspaceStateView>
}

export interface RemoteService {
  $mount?(contribution: unknown): Promise<void> | void
  codegraphAdmin?: CodegraphAdmin
}

/** 一条工作区右键菜单项；`run` 由插件自己执行。 */
export interface WorkspaceMenuItem {
  id: string
  label: string
  danger?: boolean
  separatorBefore?: boolean
  run?: () => void | Promise<void>
}

export interface ContextMenus {
  register(contribution: {
    id: string
    target: 'workspace'
    order: number
    resolve: (target: { workspaceId: string; path: string; displayTitle: string }, signal: AbortSignal) => WorkspaceMenuItem[] | Promise<WorkspaceMenuItem[]>
  }): () => void
}

export interface ClientContext {
  effect(execute: () => (() => void) | void, label?: string): () => void
  get(name: string): any
  inject(deps: string[], callback: (ctx: ClientContext) => void): () => void
  locale: LocaleService
  slots: SlotService
  readonly remote: RemoteService
  readonly contextMenus: ContextMenus
}
