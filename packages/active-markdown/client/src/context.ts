/** Structural client contract. The plugin does not import DSH client packages. */
import type { ComponentType } from 'react'

/** Namespace-bound translator. */
export interface Translate {
  (key: string, params?: Record<string, string | number>): string
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
  locale?: string
  inject?: unknown
  [option: string]: unknown
}

export interface SlotService {
  inject(name: string, register: () => (() => void) | void): () => void
  register(options: SlotOptions, component: ComponentType<any>): () => void
}

/** One renderer implementation in the document preview registry. */
export interface DocumentPreviewDefinition {
  id: string
  extensions: readonly string[]
  priority?: 'builtin' | 'extension'
  title: () => string
  loading: 'text-pages' | 'bytes-complete' | 'renderer'
  wrap?: boolean
}

export interface DocumentPreviews {
  register(definition: DocumentPreviewDefinition): () => void
}

/** A settled Remote failure. */
export interface RemoteFailure {
  code: string
  message: string
  details?: unknown
}

export type RemoteResult<T> = { ok: true, value: T } | { ok: false, error: RemoteFailure }

/** One byte window or complete file. */
export interface WorkspaceFileBytes {
  data: Uint8Array<ArrayBuffer>
  eof: boolean
  version: string
  absolutePath: string
  bytes?: number
}

export interface WorkspaceFileReadOptions {
  range?: { offset?: number, length?: number }
  baseFile?: string
}

export interface WorkspaceFilesRemote {
  readBytes(
    sessionId: string,
    path: string,
    options: WorkspaceFileReadOptions,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkspaceFileBytes>>
}

/** One translation request the Body hands to the Host half. */
export interface TranslateRequest {
  sessionId: string
  path: string
  text: string
  lang: string
  provider?: string
  model?: string
  promptVersion: string
  extraInstruction?: string
}

/** The Host half as the Body sees it. */
export interface HostBridge {
  translate(request: TranslateRequest): Promise<string>
  describePrompt(): Promise<string>
}

/** One captured right-click target; the shared menu resolves actions for its kind. */
export interface ContextMenuTarget {
  readonly kind: string
  readonly value: unknown
}

/** One action the shared menu can show for our target family. */
export interface MenuAction {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
  readonly danger?: boolean
  readonly separatorBefore?: boolean
  readonly run?: () => void | Promise<void>
}

/** The shared context menu, declared structurally: the plugin imports no DSH client package. */
export interface ContextMenusService {
  open(target: ContextMenuTarget, point: { x: number, y: number }): void
  register(contribution: {
    id: string
    target: string
    order: number
    resolve(target: any, signal: AbortSignal): readonly MenuAction[] | Promise<readonly MenuAction[]>
  }): () => void
}

/** The sidebar service used to open an addressed file. */
export interface SidebarRight {
  openResource(address: string): void
}

export interface ClientContext {
  effect(execute: () => (() => void) | void, label?: string): () => void
  get(name: string): any
  inject(deps: string[], callback: (ctx: ClientContext) => void): () => void
  locale: LocaleService
  slots: SlotService
  documentPreviews: DocumentPreviews
  remote: { workspaceFiles: WorkspaceFilesRemote }
  contextMenus: ContextMenusService
}
