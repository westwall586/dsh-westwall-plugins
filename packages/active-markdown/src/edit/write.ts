/**
 * The guarded write channel for the preview's source editor. The Host owns the
 * session's sandbox policy and version token; the client only picks an intent.
 * Every refusal is a return value, because a thrown error would reach the wire
 * as a Remote code the client cannot branch on.
 */
import { Buffer } from 'node:buffer'

/** The largest document the source editor accepts, client and Host alike. */
export const MAX_EDIT_BYTES = 1024 * 1024

export type EditMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export type EditUnsupportedReason = 'session' | 'symlink' | 'not-file' | 'fs'

export type WriteIntent =
  | { kind: 'replace', version: string }
  | { kind: 'overwrite' }
  | { kind: 'create' }

export interface WriteTextRequest {
  sessionId: string
  path: string
  text: string
  intent: WriteIntent
}

export type WriteTextResult =
  | { status: 'saved', absolutePath: string, version: string, bytes: number }
  | { status: 'stale' }
  | { status: 'exists', absolutePath: string }
  | { status: 'denied', mode: EditMode }
  | { status: 'too-large', limit: number }
  | { status: 'unsupported', reason: EditUnsupportedReason }

export interface EditCheckRequest {
  sessionId: string
  path: string
  bytes: number
}

export type EditCheckResult =
  | { status: 'ok', absolutePath: string, version: string }
  | { status: 'outside' }
  | { status: 'read-only', mode: 'read-only' }
  | { status: 'too-large', limit: number }
  | { status: 'unsupported', reason: EditUnsupportedReason }

interface EditTargetLike {
  readonly targetKey: unknown
  readonly displayPath: string
}

interface EditPathInfoLike {
  readonly type: 'file' | 'directory' | 'symlink' | 'other'
  readonly size?: number
}

interface EditInfoLike {
  readonly type: 'file' | 'directory' | 'other'
  readonly size?: number
  readonly version: string
}

interface EditWriteOutcomeLike {
  readonly version: string
  readonly after: string
}

type EditExpectedLike = { kind: 'createIfAbsent' } | { kind: 'replaceIfVersion', version: string }

/** The sandbox policy the plugin passes back to `writeText`, declared structurally. */
export interface EditSandboxPolicyLike {
  readonly mode: EditMode
  readonly workspaceRoot: string
}

/** The subset of `ctx.fs` the edit channel uses. */
export interface EditFsLike {
  resolve(path: string, opts?: { cwd?: string, signal?: AbortSignal }): Promise<EditTargetLike>
  lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<EditPathInfoLike | undefined>
  stat(target: EditTargetLike, signal?: AbortSignal): Promise<EditInfoLike | undefined>
  contains(parent: EditTargetLike, child: EditTargetLike): boolean
  writeText(
    target: EditTargetLike,
    content: string,
    expected?: EditExpectedLike,
    signal?: AbortSignal,
    sandboxPolicy?: EditSandboxPolicyLike,
  ): Promise<EditWriteOutcomeLike>
}

export interface EditSandboxLike {
  resolve(request: { session: unknown }): EditSandboxPolicyLike
}

export interface EditSessionsLike {
  get(id: string): unknown | undefined
}

/** The three Host services the edit channel consumes; tests pass a fake. */
export interface EditFacility {
  readonly fs: EditFsLike
  readonly sandbox: EditSandboxLike
  readonly sessions: EditSessionsLike
}

function unsupported(reason: EditUnsupportedReason): { status: 'unsupported', reason: EditUnsupportedReason } {
  return { status: 'unsupported', reason }
}

function errorCodeOf(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/**
 * Map the client intent onto the filesystem guard. `overwrite` maps to an
 * absent intent, which is the provider's unconditional write.
 */
export function writeIntentOf(intent: WriteIntent): EditExpectedLike | undefined {
  switch (intent.kind) {
    case 'replace':
      return { kind: 'replaceIfVersion', version: intent.version }
    case 'create':
      return { kind: 'createIfAbsent' }
    case 'overwrite':
      return undefined
    default:
      throw new Error(`unknown write intent: ${String((intent as { kind?: unknown }).kind)}`)
  }
}

/**
 * Map one provider failure onto the wire contract. `FS_NOT_OBSERVED` is the
 * local backend's answer to `createIfAbsent` against an existing file, so it
 * shares the `exists` arm with `FS_ALREADY_EXISTS`.
 */
export function writeResultOf(error: unknown, mode: EditMode, absolutePath: string): WriteTextResult {
  switch (errorCodeOf(error)) {
    case 'FS_STALE_VERSION':
      return { status: 'stale' }
    case 'FS_ALREADY_EXISTS':
    case 'FS_NOT_OBSERVED':
      return { status: 'exists', absolutePath }
    case 'FS_SANDBOX_DENIED':
      return { status: 'denied', mode }
    default:
      return unsupported('fs')
  }
}

function policyOf(face: EditFacility, session: unknown): EditSandboxPolicyLike | null {
  try {
    return face.sandbox.resolve({ session })
  } catch {
    return null
  }
}

/**
 * Answer whether the session may edit this file, without writing anything.
 * The version returned here is the token a later guarded save must send back.
 */
export async function editCheck(face: EditFacility, request: EditCheckRequest): Promise<EditCheckResult> {
  const session = face.sessions.get(request.sessionId)
  if (session === undefined) return unsupported('session')
  const policy = policyOf(face, session)
  if (policy === null) return unsupported('fs')
  if (policy.mode === 'read-only') return { status: 'read-only', mode: 'read-only' }

  try {
    const root = policy.workspaceRoot
    const rootTarget = await face.fs.resolve(root)
    const target = await face.fs.resolve(request.path, { cwd: root })
    if (!face.fs.contains(rootTarget, target)) return { status: 'outside' }
    const entry = await face.fs.lstat(request.path, { cwd: root })
    if (entry === undefined) return unsupported('not-file')
    if (entry.type === 'symlink') return unsupported('symlink')
    if (entry.type !== 'file') return unsupported('not-file')
    const info = await face.fs.stat(target)
    if (info === undefined || info.type !== 'file') return unsupported('not-file')
    if ((info.size ?? request.bytes) > MAX_EDIT_BYTES) return { status: 'too-large', limit: MAX_EDIT_BYTES }
    return { status: 'ok', absolutePath: target.displayPath, version: info.version }
  } catch {
    return unsupported('fs')
  }
}

/** Write one document behind its intent; every refusal is a typed result. */
export async function writeText(face: EditFacility, request: WriteTextRequest): Promise<WriteTextResult> {
  const session = face.sessions.get(request.sessionId)
  if (session === undefined) return unsupported('session')
  const policy = policyOf(face, session)
  if (policy === null) return unsupported('fs')
  if (policy.mode === 'read-only') return { status: 'denied', mode: policy.mode }
  if (Buffer.byteLength(request.text, 'utf8') > MAX_EDIT_BYTES) {
    return { status: 'too-large', limit: MAX_EDIT_BYTES }
  }

  let displayPath = request.path
  try {
    const expected = writeIntentOf(request.intent)
    const root = policy.workspaceRoot
    const rootTarget = await face.fs.resolve(root)
    const target = await face.fs.resolve(request.path, { cwd: root })
    displayPath = target.displayPath
    if (!face.fs.contains(rootTarget, target)) return { status: 'denied', mode: policy.mode }
    const entry = await face.fs.lstat(request.path, { cwd: root })
    if (entry?.type === 'symlink') return unsupported('symlink')
    if (entry !== undefined && entry.type !== 'file') return unsupported('not-file')
    // A save-as has no file yet; every other intent writes a file that was read.
    if (entry === undefined && request.intent.kind !== 'create') return unsupported('not-file')
    const outcome = await face.fs.writeText(target, request.text, expected, undefined, policy)
    return {
      status: 'saved',
      absolutePath: target.displayPath,
      version: outcome.version,
      bytes: Buffer.byteLength(outcome.after, 'utf8'),
    }
  } catch (error) {
    return writeResultOf(error, policy.mode, displayPath)
  }
}
