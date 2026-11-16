/** File addresses and the bounded text read this renderer performs. */
import type { WorkspaceFilesRemote } from './context.ts'

/**
 * Largest document rendered in place. The Host's `workspaceFiles.maxBytes`
 * defaults to the same 2 MiB, so one window covers the default deployment in a
 * single round trip; a deployment that lowered it is retried at its own cap.
 */
export const READ_CAP = 2 * 1024 * 1024

/** The Session and workspace path a `dsh-resource://file/…` address names. */
export interface SessionFile {
  sessionId: string
  path: string
}

/** The Host byte read this module needs. */
export type ReadBytes = WorkspaceFilesRemote['readBytes']

type ReadResult = Awaited<ReturnType<ReadBytes>>

/** Everything the body needs to draw one settled read. */
export type LoadedDocument =
  | { status: 'ready', text: string, version: string, bytes: number, absolutePath: string }
  | { status: 'too-large', bytes?: number, limit: number }
  | { status: 'not-text' }
  | { status: 'failed', code: string, message: string }

const FILE_PREFIX = 'dsh-resource://file/'

/**
 * Read a Session file address the way the Host does, without resolving `.` or `..`.
 * @param address - a tab's `dsh-resource://file/…` address.
 * @returns its Session and path, or `undefined` for another scheme or scope.
 */
export function sessionFileOf(address: string): SessionFile | undefined {
  if (!address.startsWith(FILE_PREFIX)) return undefined
  const end = address.search(/[?#]/)
  const parts = address.slice(FILE_PREFIX.length, end === -1 ? undefined : end).split('/')
  if (parts[0] !== 'session' || parts.length < 3) return undefined
  const [, id, ...segments] = parts
  try {
    const sessionId = decodeURIComponent(id)
    const path = segments.map(decodeURIComponent).join('/')
    if (sessionId === '' || path === '') return undefined
    return { sessionId, path }
  } catch {
    return undefined
  }
}

/**
 * Build the Session address of a path relative to this document.
 * @param sessionId - Session authorizing the read.
 * @param path - absolute or workspace-relative `/`-separated path.
 * @returns the address the sidebar accepts.
 */
export function fileAddressOf(sessionId: string, path: string): string {
  const segments = path.replace(/\\/g, '/').split('/').map(segment => encodeURIComponent(segment).replace(/%3A/gi, ':'))
  return `${FILE_PREFIX}session/${encodeURIComponent(sessionId)}/${segments.join('/')}`
}

/** Decode strict UTF-8 and refuse NUL-laden content. */
function decodeText(data: Uint8Array<ArrayBuffer>): string | undefined {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
    return text.includes('\u0000') ? undefined : text
  } catch {
    return undefined
  }
}

/** The Host's own window cap, when a `too-large` failure names it. */
function namedLimit(details: unknown): number | undefined {
  if (details === null || typeof details !== 'object') return undefined
  const limit = (details as { limit?: unknown }).limit
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : undefined
}

/** Read one window, retrying once at the Host's declared cap. */
async function readWindow(
  read: ReadBytes,
  file: SessionFile,
  length: number,
  signal: AbortSignal,
): Promise<ReadResult> {
  return read(file.sessionId, file.path, { range: { offset: 0, length } }, signal)
}

/**
 * Read one document into text, or say why it cannot be drawn in place.
 * @param read - the Host byte reader.
 * @param file - the addressed Session file.
 * @param signal - the read's lifetime.
 * @param cap - largest file rendered here.
 * @returns settled content or its fixed fallback state.
 */
export async function loadDocument(
  read: ReadBytes,
  file: SessionFile,
  signal: AbortSignal,
  cap = READ_CAP,
): Promise<LoadedDocument> {
  try {
    let result = await readWindow(read, file, cap, signal)
    if (!result.ok && result.error.code === 'workspace-file/too-large') {
      const limit = namedLimit(result.error.details)
      if (limit !== undefined && limit < cap) {
        result = await readWindow(read, file, limit, signal)
      } else if (limit === undefined) {
        result = await read(file.sessionId, file.path, { range: {} }, signal)
      }
    }
    if (!result.ok) {
      if (result.error.code === 'workspace-file/too-large') return { status: 'too-large', limit: cap }
      if (result.error.code === 'workspace-file/not-text') return { status: 'not-text' }
      return { status: 'failed', code: result.error.code, message: result.error.message }
    }
    const value = result.value
    if (!value.eof || (value.bytes !== undefined && value.bytes > cap)) {
      return { status: 'too-large', bytes: value.bytes, limit: cap }
    }
    const text = decodeText(value.data)
    if (text === undefined) return { status: 'not-text' }
    return {
      status: 'ready',
      text,
      version: value.version,
      bytes: value.bytes ?? value.data.byteLength,
      absolutePath: value.absolutePath,
    }
  } catch (error) {
    if (signal.aborted) return { status: 'failed', code: 'aborted', message: 'aborted' }
    const message = error instanceof Error ? error.message : String(error)
    return { status: 'failed', code: 'workspace-file/unavailable', message }
  }
}
