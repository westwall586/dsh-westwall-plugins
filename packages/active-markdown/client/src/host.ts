/**
 * Hand-written Remote descriptors for this plugin's own Host service, and the
 * lazy bridge that resolves the mounted namespace. 0.2.2's Client Gateway
 * rejects a parameter without a strict codec, so every parameter carries one,
 * and it installs arguments positionally: a wrong order is a silent wrong call.
 * The cancel signal is not a wire parameter: `cancellation` makes the Gateway
 * append it after the business arguments, so only the bridge knows about it.
 */
import type {
  AnnotationLoadRequest,
  AnnotationSaveRequest,
  CacheGetRequest,
  CachePutRequest,
  CachedTranslation,
  ClientContext,
  DescribeView,
  HostBridge,
  LoadedTranslation,
  ReviewCommitRequest,
  ReviewCommitView,
  ReviewDetachRequest,
  ReviewDetachView,
  ReviewLatestRequest,
  ReviewLatestView,
  ReviewPrepareRequest,
  ReviewPrepareView,
  SavedTranslation,
  TranslateRequest,
  TranslationLoadRequest,
  TranslationSaveRequest,
} from './context.ts'
import type { Annotation, AnnotationDraft, AnnotationSaveView, PendingReview } from './annotate/model.ts'
import type {
  EditCheckRequest,
  EditCheckResult,
  WriteIntent,
  WriteTextRequest,
  WriteTextResult,
} from './edit/model.ts'

const JSON_CODEC = {
  mode: 'strict' as const,
  typeSymbol: 'json',
  create: () => ({ parse: (value: unknown) => value }),
}

const PARAM = (name: string) => ({ name, wire: name, source: 'json' as const, codec: JSON_CODEC })

/** Wire parameter names, in the order the Host declares them. */
const WIRE = {
  describe: [],
  translate: [
    'sessionId', 'path', 'text', 'lang', 'provider', 'model', 'promptVersion', 'extraInstruction',
    'translateComments',
  ],
  cacheGet: ['text', 'lang', 'provider', 'model', 'promptVersion', 'extraInstruction', 'translateComments'],
  cachePut: [
    'text', 'translated', 'lang', 'provider', 'model', 'promptVersion', 'extraInstruction',
    'aligned', 'sourceLines', 'translatedLines', 'translateComments',
  ],
  translationSave: [
    'sessionId', 'path', 'text', 'translated', 'lang', 'provider', 'model', 'promptVersion',
    'extraInstruction', 'aligned',
  ],
  translationLoad: ['sessionId', 'path', 'lang'],
  annotationLoad: ['sessionId', 'path'],
  annotationSave: ['sessionId', 'path', 'annotations', 'pending'],
  annotationClear: ['sessionId', 'path'],
  annotationPending: ['sessionId'],
  reviewPrepare: ['sessionId', 'path', 'roundId', 'text'],
  reviewCommit: ['sessionId', 'path', 'roundId', 'sentText'],
  reviewDetach: ['sessionId', 'path', 'roundId'],
  reviewLatest: ['sessionId', 'path'],
  editCheck: ['sessionId', 'path', 'bytes'],
  writeText: ['sessionId', 'path', 'text', 'intent'],
} as const

function descriptor(method: keyof typeof WIRE) {
  return {
    version: 1,
    id: `dsh-active-markdown/activeMarkdown.${method}`,
    service: 'activeMarkdown',
    namespace: 'activeMarkdown',
    method,
    invocation: { kind: 'direct' as const },
    parameters: WIRE[method].map(PARAM),
    result: JSON_CODEC,
    ...(method === 'translate' ? { cancellation: { parameter: 'signal' as const } } : {}),
  }
}

export const DESCRIPTORS = [
  descriptor('describe'),
  descriptor('translate'),
  descriptor('cacheGet'),
  descriptor('cachePut'),
  descriptor('translationSave'),
  descriptor('translationLoad'),
  descriptor('annotationLoad'),
  descriptor('annotationSave'),
  descriptor('annotationClear'),
  descriptor('annotationPending'),
  descriptor('reviewPrepare'),
  descriptor('reviewCommit'),
  descriptor('reviewDetach'),
  descriptor('reviewLatest'),
  descriptor('editCheck'),
  descriptor('writeText'),
]

export const CLIENT_CONTRIBUTION = { package: 'active-markdown', descriptors: DESCRIPTORS }

/** A Remote failure carried into a thrown error that keeps the Host code. */
export interface RemoteError extends Error {
  code?: string
}

interface RemoteOutcome<T> {
  ok: boolean
  value?: T
  error?: { code?: string, message?: string }
}

function unwrap<T>(result: RemoteOutcome<T>): T {
  if (result.ok) return result.value as T
  const error = new Error(result.error?.message ?? 'unknown error') as RemoteError
  error.code = result.error?.code
  throw error
}

/** The gateway installs remote methods positionally and rejects an arity mismatch. */
export interface Namespace {
  describe(): Promise<RemoteOutcome<DescribeView>>
  translate(
    sessionId: string,
    path: string,
    text: string,
    lang: string,
    provider: string,
    model: string,
    promptVersion: string,
    extraInstruction: string,
    translateComments: boolean,
    signal?: AbortSignal,
  ): Promise<RemoteOutcome<{ text: string }>>
  cacheGet(
    text: string,
    lang: string,
    provider: string,
    model: string,
    promptVersion: string,
    extraInstruction: string,
    translateComments: boolean,
  ): Promise<RemoteOutcome<CachedTranslation | null>>
  cachePut(
    text: string,
    translated: string,
    lang: string,
    provider: string,
    model: string,
    promptVersion: string,
    extraInstruction: string,
    aligned: boolean,
    sourceLines: number,
    translatedLines: number,
    translateComments: boolean,
  ): Promise<RemoteOutcome<Record<string, never>>>
  translationSave(
    sessionId: string,
    path: string,
    text: string,
    translated: string,
    lang: string,
    provider: string,
    model: string,
    promptVersion: string,
    extraInstruction: string,
    aligned: boolean,
  ): Promise<RemoteOutcome<SavedTranslation>>
  translationLoad(
    sessionId: string,
    path: string,
    lang: string,
  ): Promise<RemoteOutcome<LoadedTranslation | null>>
  annotationLoad(
    sessionId: string,
    path: string,
  ): Promise<RemoteOutcome<AnnotationDraft | null>>
  annotationSave(
    sessionId: string,
    path: string,
    annotations: readonly Annotation[],
    pending: PendingReview | null,
  ): Promise<RemoteOutcome<AnnotationSaveView>>
  annotationClear(
    sessionId: string,
    path: string,
  ): Promise<RemoteOutcome<Record<string, never>>>
  annotationPending(
    sessionId: string,
  ): Promise<RemoteOutcome<AnnotationDraft[]>>
  reviewPrepare(
    sessionId: string,
    path: string,
    roundId: string,
    text: string,
  ): Promise<RemoteOutcome<ReviewPrepareView>>
  reviewCommit(
    sessionId: string,
    path: string,
    roundId: string,
    sentText: string,
  ): Promise<RemoteOutcome<ReviewCommitView>>
  reviewDetach(
    sessionId: string,
    path: string,
    roundId: string,
  ): Promise<RemoteOutcome<ReviewDetachView>>
  reviewLatest(
    sessionId: string,
    path: string,
  ): Promise<RemoteOutcome<ReviewLatestView | null>>
  editCheck(
    sessionId: string,
    path: string,
    bytes: number,
  ): Promise<RemoteOutcome<EditCheckResult>>
  writeText(
    sessionId: string,
    path: string,
    text: string,
    intent: WriteIntent,
  ): Promise<RemoteOutcome<WriteTextResult>>
}

/** Value-level facade so the Body never touches wire shapes. */
export function createBridge(namespace: Namespace): HostBridge {
  const translate = async (request: TranslateRequest, signal?: AbortSignal): Promise<string> => {
    const args = [
      request.sessionId,
      request.path,
      request.text,
      request.lang,
      request.provider ?? '',
      request.model ?? '',
      request.promptVersion,
      request.extraInstruction ?? '',
      request.translateComments,
    ] as const
    const result = await (signal === undefined ? namespace.translate(...args) : namespace.translate(...args, signal))
    return unwrap(result).text
  }
  const describe = async (): Promise<DescribeView> => unwrap(await namespace.describe())
  const cacheGet = async (request: CacheGetRequest): Promise<CachedTranslation | null> => {
    const result = await namespace.cacheGet(
      request.text,
      request.lang,
      request.provider ?? '',
      request.model ?? '',
      request.promptVersion,
      request.extraInstruction ?? '',
      request.translateComments,
    )
    return unwrap(result) ?? null
  }
  const cachePut = async (request: CachePutRequest): Promise<void> => {
    unwrap(await namespace.cachePut(
      request.text,
      request.translated,
      request.lang,
      request.provider ?? '',
      request.model ?? '',
      request.promptVersion,
      request.extraInstruction ?? '',
      request.aligned,
      request.sourceLines,
      request.translatedLines,
      request.translateComments,
    ))
  }
  const save = async (request: TranslationSaveRequest): Promise<SavedTranslation> => unwrap(await namespace.translationSave(
    request.sessionId,
    request.path,
    request.text,
    request.translated,
    request.lang,
    request.provider ?? '',
    request.model ?? '',
    request.promptVersion,
    request.extraInstruction ?? '',
    request.aligned,
  ))
  const load = async (request: TranslationLoadRequest): Promise<LoadedTranslation | null> =>
    unwrap(await namespace.translationLoad(request.sessionId, request.path, request.lang)) ?? null
  const annotationLoad = async (request: AnnotationLoadRequest): Promise<AnnotationDraft | null> =>
    unwrap(await namespace.annotationLoad(request.sessionId, request.path)) ?? null
  const annotationSave = async (request: AnnotationSaveRequest): Promise<AnnotationSaveView> =>
    unwrap(await namespace.annotationSave(
      request.sessionId,
      request.path,
      request.annotations,
      request.pending,
    ))
  const annotationClear = async (request: AnnotationLoadRequest): Promise<void> => {
    unwrap(await namespace.annotationClear(request.sessionId, request.path))
  }
  const annotationPending = async (sessionId: string): Promise<AnnotationDraft[]> =>
    unwrap(await namespace.annotationPending(sessionId))
  const reviewPrepare = async (request: ReviewPrepareRequest): Promise<ReviewPrepareView> =>
    unwrap(await namespace.reviewPrepare(request.sessionId, request.path, request.roundId, request.text))
  const reviewCommit = async (request: ReviewCommitRequest): Promise<ReviewCommitView> =>
    unwrap(await namespace.reviewCommit(request.sessionId, request.path, request.roundId, request.sentText))
  const reviewDetach = async (request: ReviewDetachRequest): Promise<ReviewDetachView> =>
    unwrap(await namespace.reviewDetach(request.sessionId, request.path, request.roundId))
  const reviewLatest = async (request: ReviewLatestRequest): Promise<ReviewLatestView | null> =>
    unwrap(await namespace.reviewLatest(request.sessionId, request.path)) ?? null
  const editCheck = async (request: EditCheckRequest): Promise<EditCheckResult> =>
    unwrap(await namespace.editCheck(request.sessionId, request.path, request.bytes))
  const writeText = async (request: WriteTextRequest): Promise<WriteTextResult> =>
    unwrap(await namespace.writeText(request.sessionId, request.path, request.text, request.intent))
  return {
    translate,
    describe,
    cacheGet,
    cachePut,
    save,
    load,
    annotationLoad,
    annotationSave,
    annotationClear,
    annotationPending,
    reviewPrepare,
    reviewCommit,
    reviewDetach,
    reviewLatest,
    editCheck,
    writeText,
  }
}

const MOUNT_TIMEOUT_MS = 4000

interface MountableRemote {
  $mount?(contribution: unknown): Promise<void> | void
}

/**
 * Mount the descriptor set and resolve the namespace once it appears. Cordis
 * refuses `ctx.remote.<name>` on a context that did not declare the dependency,
 * so the namespace is read inside `ctx.inject`.
 * @param ctx - the plugin context that owns the mount.
 * @returns the bridge, or a rejection when the Host half is absent.
 */
export function mountHostBridge(ctx: ClientContext): Promise<HostBridge> {
  const remote = ctx.get('remote') as MountableRemote | undefined
  if (remote?.$mount === undefined) return Promise.reject(new Error('remote unavailable'))
  const mounted = Promise.resolve(remote.$mount(CLIENT_CONTRIBUTION))
  return mounted.then(() => new Promise<HostBridge>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('activeMarkdown namespace did not mount')), MOUNT_TIMEOUT_MS)
    ctx.inject(['remote.activeMarkdown'], (scoped) => {
      clearTimeout(deadline)
      const namespace = (scoped as unknown as { remote?: { activeMarkdown?: Namespace } }).remote?.activeMarkdown
      if (namespace === undefined) {
        reject(new Error('activeMarkdown namespace did not mount'))
        return
      }
      resolve(createBridge(namespace))
    })
  }))
}
