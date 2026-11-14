/** Structural client contract. The plugin does not import DSH client packages. */
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

export interface ConfigFormSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value: unknown
  base: unknown
  user: unknown
  revision: number | undefined
  writable: boolean
}

export interface ConfigForm {
  getSnapshot(): ConfigFormSnapshot
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
}

export interface ConfigForms {
  get(entryId: string): ConfigForm
  whileServed?(
    namespaces: readonly string[],
    register: (served: ReadonlySet<string>) => () => void,
  ): () => void
}

export interface FileActionSource {
  url: string
  read?: (signal: AbortSignal) => Promise<Blob>
  name?: string
  mediaType?: string
}

export interface FileActions {
  save(source: FileActionSource, mode: 'download' | 'saveAs'): Promise<unknown>
}

export interface ClientContext {
  effect(execute: () => (() => void) | void, label?: string): () => void
  get(name: string): any
  inject(deps: string[], callback: (ctx: ClientContext) => void): void
  on(event: string, listener: (...args: any[]) => void): () => void
  locale: LocaleService
  slots: SlotService
  configForms?: ConfigForms
}
