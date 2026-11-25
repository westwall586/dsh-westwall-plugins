/** Structural client contract. The plugin does not import DSH client packages. */
import type { ComponentType } from 'react'
import type { Annotation, AnnotationDraft, AnnotationSaveView, PendingReview } from './annotate/model.ts'
import type { EditCheckRequest, EditCheckResult, WriteTextRequest, WriteTextResult } from './edit/model.ts'

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

/** One provider/model pair the Host resolved from the plugin settings. */
export interface ModelChoice {
  provider: string
  model: string
}

/** The target language as a code for paths and the wire, with a label for the prompt. */
export interface LanguageOption {
  code: string
  label: string
}

/** What the Host's settings resolve to for the next run. */
export interface TranslationSettings {
  lang: string
  /** null means the Host resolves the session default. */
  model: ModelChoice | null
  translateComments: boolean
}

/** The Host's prompt identity plus the effective settings the client must use. */
export interface DescribeView {
  promptVersion: string
  settings: TranslationSettings
  languages: readonly LanguageOption[]
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
  translateComments: boolean
}

/** What identifies one translation's cached result; an absent instruction and '' are the same on the wire. */
export interface PromptInput {
  promptVersion: string
  extraInstruction?: string
}

/** An automatic-cache lookup for one run. */
export interface CacheGetRequest extends PromptInput {
  text: string
  lang: string
  provider?: string
  model?: string
  translateComments: boolean
}

/** One finished translation, stored under the same key `cacheGet` will use. */
export interface CachePutRequest extends CacheGetRequest {
  translated: string
  aligned: boolean
  sourceLines: number
  translatedLines: number
}

/** The mirrored file pair to write for one finished translation. */
export interface TranslationSaveRequest extends PromptInput {
  sessionId: string
  path: string
  text: string
  translated: string
  lang: string
  provider?: string
  model?: string
  aligned: boolean
}

/** The mirrored file pair to read back for one document. */
export interface TranslationLoadRequest {
  sessionId: string
  path: string
  lang: string
}

/** One annotation draft's identity; the path is the canonical absolute document path. */
export interface AnnotationLoadRequest {
  sessionId: string
  path: string
}

/** The full draft to persist; `pending` is the P2a-3 attachment slot. */
export interface AnnotationSaveRequest extends AnnotationLoadRequest {
  annotations: readonly Annotation[]
  pending: PendingReview | null
}

/** Write the pending full-text snapshot for one review round. */
export interface ReviewPrepareRequest extends AnnotationLoadRequest {
  roundId: string
  text: string
}

export interface ReviewPrepareView {
  sourceHash: string
  snapshotWritten: boolean
  bytes: number
}

/** Promote the pending snapshot and finish one review round. */
export interface ReviewCommitRequest extends AnnotationLoadRequest {
  roundId: string
  sentText: string
}

export interface ReviewCommitView {
  roundId: string
  committed: boolean
  snapshotMissing: boolean
}

/** Clear one round's pending record and snapshot without touching annotations. */
export interface ReviewDetachRequest extends AnnotationLoadRequest {
  roundId: string
}

export interface ReviewDetachView {
  detached: boolean
}

/** The newest committed review round for one document, used as a diff baseline. */
export interface ReviewLatestRequest {
  sessionId: string
  path: string
}

export interface ReviewLatestView {
  roundId: string
  createdAt: string
  /** The full document text that round was based on. */
  text: string
}

/** The input submit plane this plugin observes. */
export type InputPhase = 'plain' | 'adjudicating' | 'claimed' | 'submitting' | 'sending'

export interface InputStateView {
  readonly draft: string
  readonly attachmentIds: readonly string[]
  readonly phase: InputPhase
}

export type UseInput = <T>(selector: (state: InputStateView) => T) => T

/** The public input actions this plugin calls; never `submit()`. */
export interface InputActionsView {
  addAttachments(ids: readonly string[]): boolean
  removeAttachment?(id: string): boolean | void
}

/** The concrete conversation service, declared structurally and fail-closed. */
export interface ConversationPort {
  createDrafts(sessionId: string, files: readonly File[], uploadImages: boolean): readonly unknown[]
  releaseDraftAttachments(drafts: readonly unknown[]): void
  releaseDraftAttachment?(id: string): void
  resolveDraftAttachments?(ids: readonly string[]): readonly unknown[]
}

export interface FileReferenceView {
  readonly attachmentId: string
  readonly name: string
  readonly bytes: number
}

/** A `FileBlock` inside a finalized user message. */
export interface FileBlockView {
  readonly type: 'file'
  readonly attachment: FileReferenceView
}

export interface ChatMessageView {
  readonly kind: string
  /** Durable ConversationNode content (legacy slice). */
  readonly content?: readonly { readonly type: string }[]
  /** Chat view payload content, when the node comes from the keyed store. */
  readonly data?: { readonly content?: readonly { readonly type: string }[] }
}

/** The Chat target this plugin reads for the sent-file fallback. */
export interface ChatSnapshotView {
  readonly legacy?: { readonly nodes?: readonly ChatMessageView[] }
  readonly nodes?: { values?: () => readonly ChatMessageView[] }
}

/** The target-neutral Conversation assembly; views.get('chat') is the Chat snapshot. */
export interface ConversationAssemblyView {
  readonly views: { get(target: string): ChatSnapshotView | undefined }
}

export type UseConversation = <T>(selector: (state: ConversationAssemblyView) => T) => T

/** The stored metadata fields this Body reads. */
export interface TranslationMeta {
  promptVersion: string
  lang: string
  provider: string
  model: string
}

export interface CachedTranslation {
  text: string
  meta: TranslationMeta
}

export interface SavedTranslation {
  /** Relative to the workspace, `/`-separated: where the Markdown mirror landed. */
  file: string
  meta: TranslationMeta
}

export interface LoadedTranslation {
  text: string
  meta: TranslationMeta
  /** The source moved on since this pair was saved; the text is still readable. */
  stale: boolean
  /** Workspace-relative path of the markdown mirror, for the toolbar tooltip. */
  file: string
}

/** The Host half as the Body sees it. */
export interface HostBridge {
  translate(request: TranslateRequest, signal?: AbortSignal): Promise<string>
  describe(): Promise<DescribeView>
  cacheGet(request: CacheGetRequest): Promise<CachedTranslation | null>
  cachePut(request: CachePutRequest): Promise<void>
  save(request: TranslationSaveRequest): Promise<SavedTranslation>
  load(request: TranslationLoadRequest): Promise<LoadedTranslation | null>
  annotationLoad(request: AnnotationLoadRequest): Promise<AnnotationDraft | null>
  annotationSave(request: AnnotationSaveRequest): Promise<AnnotationSaveView>
  annotationClear(request: AnnotationLoadRequest): Promise<void>
  annotationPending(sessionId: string): Promise<AnnotationDraft[]>
  reviewPrepare(request: ReviewPrepareRequest): Promise<ReviewPrepareView>
  reviewCommit(request: ReviewCommitRequest): Promise<ReviewCommitView>
  reviewDetach(request: ReviewDetachRequest): Promise<ReviewDetachView>
  reviewLatest(request: ReviewLatestRequest): Promise<ReviewLatestView | null>
  /** Whether this session may edit the document, and its version token. */
  editCheck(request: EditCheckRequest): Promise<EditCheckResult>
  /** Write the editor's draft behind the caller's intent. */
  writeText(request: WriteTextRequest): Promise<WriteTextResult>
}

/** The plugin-page config form surface, declared structurally. */
export type SettingsOp =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

export interface ConfigFormSnapshotLike {
  status: 'loading' | 'ready' | 'unavailable'
  value: Record<string, unknown> | undefined
  user?: unknown
  revision?: number
  writable: boolean
}

export interface ConfigFormLike {
  getSnapshot(): ConfigFormSnapshotLike
  subscribe(listener: () => void): () => void
  mutate(ops: readonly SettingsOp[], revision?: number): Promise<boolean>
}

export interface ConfigFormsService {
  get(entryId: string): ConfigFormLike
  whileServed?(ids: readonly string[], register: () => () => void): () => void
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

/** One open tab's metadata, independent of which one is on screen. */
export interface OpenTabView {
  readonly sessionId: string
  readonly tabId: string
  readonly kind: string
  /** The address opened; a file resource's address is the document's. */
  readonly contentId: string
}

/** The sidebar service used to open an addressed file or one of its page types. */
export interface SidebarRight {
  openResource(address: string): void
  /**
   * Every open tab across sessions. The close observer needs it while this
   * document's body is unmounted; optional because a host may predate it.
   */
  openTabs?: {
    getSnapshot(): readonly OpenTabView[]
    subscribe(listener: () => void): () => void
  }
  /**
   * Open one registered page type, such as the browser. Optional because a host
   * may predate the method, or never register the page type; callers fall back
   * to a plain new tab then.
   */
  openTab?(kind: string, options?: { params?: Record<string, unknown> }): void
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
  configForms?: ConfigFormsService
}
