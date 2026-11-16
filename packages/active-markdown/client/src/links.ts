/** Classify a Markdown link and resolve the ones that address a file. */
import { fileAddressOf } from './source.ts'

/** Where one link should go, decided before any DOM action. */
export type LinkTarget =
  | { kind: 'anchor', id: string }
  | { kind: 'external', url: string }
  | { kind: 'resource', address: string }
  | { kind: 'file', address: string }
  | { kind: 'blocked' }

const EXTERNAL_PROTOCOLS = new Set(['http', 'https', 'mailto'])

function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Resolve a relative path against the directory of `documentPath`.
 * @param documentPath - absolute or workspace-relative source path.
 * @param relative - decoded relative path, possibly absolute.
 * @returns the normalized path, or `undefined` when `..` escapes the base.
 */
export function resolvePath(documentPath: string, relative: string): string | undefined {
  const normalized = relative.replace(/\\/g, '/')
  const document = documentPath.replace(/\\/g, '/')
  const base = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
    ? normalized
    : (document.includes('/') ? `${document.slice(0, document.lastIndexOf('/'))}/${normalized}` : normalized)
  const absolute = base.startsWith('/')
  const drive = /^[A-Za-z]:/.exec(base)?.[0]
  const body = drive === undefined ? base : base.slice(drive.length)
  const stack: string[] = []
  for (const segment of body.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (stack.length === 0) return undefined
      stack.pop()
      continue
    }
    stack.push(segment)
  }
  if (stack.length === 0) return undefined
  const joined = stack.join('/')
  if (drive !== undefined) return `${drive}/${joined}`
  return absolute ? `/${joined}` : joined
}

/**
 * Decide where one authored link points.
 * @param href - the authored destination.
 * @param sessionId - Session authorizing a file read.
 * @param documentPath - the source file that relative paths resolve from.
 * @returns the target kind; unsupported protocols and escaping paths are blocked.
 */
export function classifyLink(href: string, sessionId: string, documentPath: string): LinkTarget {
  const raw = href.trim()
  if (raw === '') return { kind: 'blocked' }
  if (raw.startsWith('#')) {
    const id = safeDecode(raw.slice(1))
    return id === undefined || id === '' ? { kind: 'blocked' } : { kind: 'anchor', id }
  }
  if (/^dsh-resource:\/\//i.test(raw)) return { kind: 'resource', address: raw }
  if (raw.startsWith('//')) return { kind: 'external', url: `https:${raw}` }
  const windowsDrive = /^[A-Za-z]:[\\/]/.test(raw)
  const scheme = windowsDrive ? null : /^([a-z][a-z0-9+.-]*):/i.exec(raw)
  if (scheme !== null) {
    const protocol = scheme[1].toLowerCase()
    return EXTERNAL_PROTOCOLS.has(protocol) ? { kind: 'external', url: raw } : { kind: 'blocked' }
  }
  const clean = raw.split(/[?#]/)[0]
  const decoded = safeDecode(clean)
  if (decoded === undefined || decoded === '') return { kind: 'blocked' }
  const path = resolvePath(documentPath, decoded)
  if (path === undefined) return { kind: 'blocked' }
  return { kind: 'file', address: fileAddressOf(sessionId, path) }
}
