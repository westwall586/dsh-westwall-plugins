/**
 * Hand-written Remote descriptors for this plugin's own Host service, and the
 * lazy bridge that resolves the mounted namespace. 0.2.2's Client Gateway
 * rejects a parameter without a strict codec, so every parameter carries one.
 */
import type { ClientContext, HostBridge, TranslateRequest } from './context.ts'

const JSON_CODEC = {
  mode: 'strict' as const,
  typeSymbol: 'json',
  create: () => ({ parse: (value: unknown) => value }),
}

const PARAM = (name: string) => ({ name, wire: name, source: 'json' as const, codec: JSON_CODEC })

const TRANSLATE_PARAMETERS = [
  'sessionId', 'path', 'text', 'lang', 'provider', 'model', 'promptVersion', 'extraInstruction',
]

export const DESCRIPTORS = [
  {
    version: 1,
    id: 'dsh-active-markdown/activeMarkdown.describe',
    service: 'activeMarkdown',
    namespace: 'activeMarkdown',
    method: 'describe',
    invocation: { kind: 'direct' as const },
    parameters: [],
    result: JSON_CODEC,
  },
  {
    version: 1,
    id: 'dsh-active-markdown/activeMarkdown.translate',
    service: 'activeMarkdown',
    namespace: 'activeMarkdown',
    method: 'translate',
    invocation: { kind: 'direct' as const },
    parameters: TRANSLATE_PARAMETERS.map(PARAM),
    result: JSON_CODEC,
  },
]

export const CLIENT_CONTRIBUTION = { package: 'active-markdown', descriptors: DESCRIPTORS }

/** A Remote failure carried into a thrown error that keeps the Host code. */
export interface RemoteError extends Error {
  code?: string
}

function unwrap<T>(result: RemoteOutcome<T>): T {
  if (result.ok) return result.value as T
  const error = new Error(result.error?.message ?? 'unknown error') as RemoteError
  error.code = result.error?.code
  throw error
}

interface RemoteOutcome<T> {
  ok: boolean
  value?: T
  error?: { code?: string, message?: string }
}

/** The gateway installs remote methods positionally and rejects an arity mismatch. */
interface Namespace {
  describe(): Promise<RemoteOutcome<{ promptVersion: string }>>
  translate(
    sessionId: string,
    path: string,
    text: string,
    lang: string,
    provider: string,
    model: string,
    promptVersion: string,
    extraInstruction: string,
  ): Promise<RemoteOutcome<{ text: string }>>
}

/** Value-level facade so the Body never touches wire shapes. */
function createBridge(namespace: Namespace): HostBridge {
  const translate = async (request: TranslateRequest): Promise<string> => {
    const result = await namespace.translate(
      request.sessionId,
      request.path,
      request.text,
      request.lang,
      request.provider ?? '',
      request.model ?? '',
      request.promptVersion,
      request.extraInstruction ?? '',
    )
    return unwrap(result).text
  }
  const describePrompt = async (): Promise<string> => unwrap(await namespace.describe()).promptVersion
  return { translate, describePrompt }
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
