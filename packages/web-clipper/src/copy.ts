/**
 * Durable readable copies for the web clipper.
 *
 * The conversation attachment is owned by DSH's attachment store. This module
 * writes the same Markdown beside it as a plain file the user can open and
 * manage. It is deliberately independent from Cordis so the path and file
 * behavior can be tested without a running Host.
 */
import { spawn as nodeSpawn } from 'node:child_process'
import { link, mkdir, open, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const DEFAULT_FOLDER_NAME = 'dsh-web-clipper'
export const MAX_COPY_BYTES = 8 * 1024 * 1024

export type CopyErrorCode =
  | 'invalid-directory'
  | 'too-large'
  | 'write-failed'
  | 'open-failed'

export interface CopyFailure {
  ok: false
  code: CopyErrorCode
  detail: string
}

export interface CopyDirectory {
  configured: string
  resolved: string
  isDefault: boolean
}

export type CopyDirectoryResult = ({ ok: true } & CopyDirectory) | CopyFailure

export interface CopySaveResult {
  ok: true
  path: string
  directory: string
  isDefault: boolean
}

export type CopySaveOutcome = CopySaveResult | CopyFailure

export interface OpenDirectoryResult {
  ok: true
  path: string
}

export type OpenDirectoryOutcome = OpenDirectoryResult | CopyFailure

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g
const MAX_NAME = 180
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

/** The folder used when the setting is empty. */
export function defaultDirectory(): string {
  return path.join(tmpdir(), DEFAULT_FOLDER_NAME)
}

/** Expand a leading `~` without invoking a shell. */
export function expandHome(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(homedir(), value.slice(2))
  return value
}

/**
 * Resolve the effective folder. A relative path is refused: a configuration
 * value that depends on the current process directory is not predictable.
 */
export function resolveDirectory(configured: string | undefined | null): CopyDirectoryResult {
  const raw = String(configured ?? '').trim()
  if (raw === '') {
    return { ok: true, configured: '', resolved: defaultDirectory(), isDefault: true }
  }
  const expanded = expandHome(raw)
  if (!path.isAbsolute(expanded)) {
    return {
      ok: false,
      code: 'invalid-directory',
      detail: 'The copy folder must be an absolute path.',
    }
  }
  return { ok: true, configured: raw, resolved: path.normalize(expanded), isDefault: false }
}

/** Keep only a base name, one supported extension, and characters every platform accepts. */
export function safeFileName(requested: string): string {
  const base = path.basename(String(requested ?? '').replaceAll('\\', '/'))
  const extension = path.extname(base).toLowerCase()
  const allowed = extension === '.html' ? '.html' : '.md'
  const stem = (extension === '.html' || extension === '.md' ? base.slice(0, -extension.length) : base)
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  const safeStem = stem === '' ? 'clip' : stem
  const guarded = WINDOWS_RESERVED.test(safeStem) ? `_${safeStem}` : safeStem
  const maxStem = MAX_NAME - allowed.length
  return `${guarded.slice(0, maxStem).trim() || 'clip'}${allowed}`
}

async function existingFile(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

async function uniqueTarget(directory: string, name: string): Promise<string> {
  const extension = path.extname(name)
  const stem = name.slice(0, -extension.length)
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = path.join(directory, index === 1 ? name : `${stem} (${index})${extension}`)
    if (!(await existingFile(candidate))) return candidate
  }
  throw new Error('could not find a free file name')
}

/**
 * Write one copy atomically enough for this feature: stage a sibling file,
 * publish it with an exclusive hard link, then remove the staged name. The
 * hard link fails instead of replacing a file another process just created.
 */
export async function saveCopy(
  configured: string | undefined | null,
  requestedName: string,
  content: string,
): Promise<CopySaveOutcome> {
  const resolved = resolveDirectory(configured)
  if (!resolved.ok) return resolved
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > MAX_COPY_BYTES) {
    return { ok: false, code: 'too-large', detail: `The copy is ${bytes} bytes; the limit is ${MAX_COPY_BYTES}.` }
  }
  const name = safeFileName(requestedName)
  try {
    try {
      await mkdir(resolved.resolved, { recursive: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return { ok: false, code: 'invalid-directory', detail: 'The copy folder is not a directory.' }
      }
      throw error
    }
    const info = await stat(resolved.resolved)
    if (!info.isDirectory()) {
      return { ok: false, code: 'invalid-directory', detail: 'The copy folder is not a directory.' }
    }
    const target = await uniqueTarget(resolved.resolved, name)
    const temporary = path.join(resolved.resolved, `.${name}.${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, 'wx')
      try {
        await handle.writeFile(content, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      let published = false
      try {
        await link(temporary, target)
        published = true
      } catch {
        // Some Windows filesystems refuse hard links. Falling back to an
        // exclusive write keeps the copy working without replacing a file.
        await writeFile(target, content, { encoding: 'utf8', flag: 'wx' })
        published = true
      } finally {
        if (published) await rm(temporary, { force: true })
      }
    } finally {
      await rm(temporary, { force: true })
    }
    return { ok: true, path: target, directory: resolved.resolved, isDefault: resolved.isDefault }
  } catch (error) {
    return {
      ok: false,
      code: 'write-failed',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

/** The opener command for the current platform. */
export function openerFor(platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [] }
  if (platform === 'win32') return { command: 'explorer.exe', args: [] }
  return { command: 'xdg-open', args: [] }
}

export interface OpenDeps {
  platform?: NodeJS.Platform
  spawn?: typeof nodeSpawn
}

/** Create the effective folder if needed, then hand it to the desktop file manager. */
export async function openDirectory(
  configured: string | undefined | null,
  deps: OpenDeps = {},
): Promise<OpenDirectoryOutcome> {
  const resolved = resolveDirectory(configured)
  if (!resolved.ok) return resolved
  try {
    try {
      await mkdir(resolved.resolved, { recursive: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return { ok: false, code: 'invalid-directory', detail: 'The copy folder is not a directory.' }
      }
      throw error
    }
    const info = await stat(resolved.resolved)
    if (!info.isDirectory()) {
      return { ok: false, code: 'invalid-directory', detail: 'The copy folder is not a directory.' }
    }
    const command = openerFor(deps.platform ?? process.platform)
    const spawn = deps.spawn ?? nodeSpawn
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command.command, [...command.args, resolved.resolved], {
        detached: true,
        stdio: 'ignore',
      })
      child.once('error', reject)
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    })
    return { ok: true, path: resolved.resolved }
  } catch (error) {
    return {
      ok: false,
      code: 'open-failed',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}
