/**
 * 审阅轮次的全文快照与元数据：加入输入框时把批注所看的原文写进
 * `reviews/pending/<roundId>.md`，发送成功后再 rename 到
 * `reviews/<镜像路径>/<roundId>.md`，并在旁边写同名 JSON。所有写入先落同目录
 * 临时文件再 rename，半截文件不会变成一轮合法的旧版。
 *
 * 清理只在 prepare/commit 时顺手做：pending 30 天，轮次按文档最近 5 轮、
 * 30 天、全局 50 MiB；每个文档最新一轮永不淘汰。
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AnnotationError, canonicalDocumentPath, requireRoundId, requireSessionId } from './paths.ts'
import { reviewRoundSchema, type PendingReview, type ReviewRound } from './schema.ts'
import { mirrorOf, STORE_GITIGNORE, STORE_ROOT, type MirrorPath } from '../translate/store.ts'

export const REVIEWS_DIR = 'reviews'
export const PENDING_DIR = 'pending'
export const REVIEW_LIMITS = {
  maxRoundsPerDocument: 5,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxTotalBytes: 50 * 1024 * 1024,
} as const
export const PENDING_TTL_MS = REVIEW_LIMITS.maxAgeMs

export interface ReviewFileEntry {
  readonly name: string
  readonly path: string
  readonly directory: boolean
  readonly size: number
  readonly mtimeMs: number
}

/** 快照需要的文件操作；测试用内存实现，生产用 node 实现。 */
export interface ReviewFilePort {
  read(path: string): Promise<string | null>
  write(path: string, content: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
  list(path: string): Promise<readonly ReviewFileEntry[]>
}

async function missing(error: unknown): Promise<boolean> {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

export const nodeReviewFiles: ReviewFilePort = {
  async read(path) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if (await missing(error)) return null
      throw error
    }
  },
  async write(path, content) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
  },
  async rename(from, to) {
    await mkdir(dirname(to), { recursive: true })
    await rename(from, to)
  },
  async remove(path) {
    try {
      await rm(path, { force: true })
    } catch (error) {
      if (!(await missing(error))) throw error
    }
  },
  async exists(path) {
    try {
      await stat(path)
      return true
    } catch (error) {
      if (await missing(error)) return false
      throw error
    }
  },
  async mkdir(path) {
    await mkdir(path, { recursive: true })
  },
  async list(path) {
    let names: string[]
    try {
      names = await readdir(path)
    } catch (error) {
      if (await missing(error)) return []
      throw error
    }
    const entries: ReviewFileEntry[] = []
    for (const name of names) {
      const child = join(path, name)
      try {
        const info = await stat(child)
        entries.push({ name, path: child, directory: info.isDirectory(), size: info.size, mtimeMs: info.mtimeMs })
      } catch (error) {
        if (!(await missing(error))) throw error
      }
    }
    return entries
  },
}

export interface ReviewStoreDeps {
  readonly files: ReviewFilePort
  readonly workspaceOf: (sessionId: string) => Promise<string | null> | string | null
  readonly now?: () => Date
  readonly limits?: Partial<typeof REVIEW_LIMITS>
  readonly warn?: (message: string, error: unknown) => void
}

export interface ReviewPrepareInput {
  readonly sessionId: string
  readonly path: string
  readonly roundId: string
  readonly text: string
}

export interface ReviewPrepareView {
  readonly sourceHash: string
  readonly snapshotWritten: boolean
  readonly bytes: number
}

export interface ReviewCommitInput {
  readonly sessionId: string
  readonly path: string
  readonly roundId: string
  readonly pending: PendingReview | null
  readonly sentText: string
}

export interface ReviewCommitView {
  readonly roundId: string
  readonly committed: boolean
  readonly snapshotMissing: boolean
}

export interface ReviewDetachInput {
  readonly sessionId: string
  readonly roundId: string
}

export interface ReviewDetachView {
  readonly detached: boolean
}

export interface ReviewLatestInput {
  readonly sessionId: string
  readonly path: string
}

export interface ReviewLatestView {
  readonly roundId: string
  readonly createdAt: string
  /** The full document text that round was based on. */
  readonly text: string
}

export interface ReviewStore {
  prepare(input: ReviewPrepareInput): Promise<ReviewPrepareView>
  commit(input: ReviewCommitInput): Promise<ReviewCommitView>
  /** Remove one round's pending snapshot; the draft record is the caller's. */
  detach(input: ReviewDetachInput): Promise<ReviewDetachView>
  /**
   * The newest committed round's snapshot for one document, or null when that
   * round cannot serve as a baseline. An unusable newest round never falls
   * back to an older one: the user already reviewed everything before it.
   */
  latest(input: ReviewLatestInput): Promise<ReviewLatestView | null>
  /** Prune pending and committed snapshots for one workspace. */
  prune(sessionId: string): Promise<number>
}

interface Roots {
  workspace: string
  reviews: string
  pending: string
}

function rootsOf(workspace: string): Roots {
  const reviews = resolve(workspace, STORE_ROOT, REVIEWS_DIR)
  return { workspace, reviews, pending: resolve(reviews, PENDING_DIR) }
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

/** One document's mirror path, accepting the canonical absolute path annotations use. */
export function documentMirror(workspace: string, path: string): MirrorPath {
  const absolute = resolve(path)
  const inside = relative(resolve(workspace), absolute)
  if (inside !== '' && !inside.startsWith(`..${sep}`) && inside !== '..' && !isAbsolute(inside)) {
    return mirrorOf({ path: inside.split(sep).join('/'), workspace })
  }
  return mirrorOf({ path: absolute, workspace })
}

function roundDirectory(root: Roots, mirror: MirrorPath): string {
  const directory = resolve(root.reviews, mirror.relative)
  if (!isInside(root.reviews, directory) || directory === root.reviews) {
    throw new AnnotationError('invalid-path', `轮次目录越出 reviews：${mirror.relative}`)
  }
  return directory
}

function pendingFileOf(root: Roots, roundId: string): string {
  return resolve(root.pending, `${roundId}.md`)
}

function normalizedSourceText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '')
}

async function sha256Of(text: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

let tempCounter = 0

/** Write beside the target, then rename so a reader never sees a half file. */
async function writeAtomic(files: ReviewFilePort, target: string, content: string): Promise<void> {
  const temp = `${target}.${process.pid}.${(tempCounter += 1).toString(36)}.tmp`
  await files.write(temp, content)
  try {
    await files.rename(temp, target)
  } catch (error) {
    await files.remove(temp)
    throw error
  }
}

async function ensureGitignore(files: ReviewFilePort, workspace: string): Promise<void> {
  const path = resolve(workspace, STORE_ROOT, '.gitignore')
  if (await files.exists(path)) return
  await files.write(path, STORE_GITIGNORE)
}

interface RoundRecord {
  readonly metaPath: string
  readonly markdownPath: string
  readonly meta: ReviewRound
  readonly bytes: number
  readonly createdAt: number
}

async function walk(files: ReviewFilePort, directory: string): Promise<readonly ReviewFileEntry[]> {
  const entries = await files.list(directory)
  const all: ReviewFileEntry[] = []
  for (const entry of entries) {
    if (entry.directory) all.push(...await walk(files, entry.path))
    else all.push(entry)
  }
  return all
}

function timeOf(meta: ReviewRound, fallback: number): number {
  const time = Date.parse(meta.createdAt)
  return Number.isFinite(time) ? time : fallback
}

async function collectRounds(files: ReviewFilePort, root: Roots): Promise<RoundRecord[]> {
  const entries = await walk(files, root.reviews)
  const byStem = new Map<string, { metaPath: string, markdownPath: string, meta: ReviewRound, metaBytes: number }>()
  for (const entry of entries) {
    if (!entry.path.endsWith('.json')) continue
    const raw = await files.read(entry.path)
    if (raw === null) continue
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      continue
    }
    const parsed = reviewRoundSchema.safeParse(value)
    if (!parsed.success) continue
    const base = entry.path.slice(0, -'.json'.length)
    byStem.set(base, {
      metaPath: entry.path,
      markdownPath: `${base}.md`,
      meta: parsed.data,
      metaBytes: entry.size,
    })
  }
  const records: RoundRecord[] = []
  for (const item of byStem.values()) {
    const md = entries.find(entry => entry.path === item.markdownPath)
    records.push({
      metaPath: item.metaPath,
      markdownPath: item.markdownPath,
      meta: item.meta,
      bytes: item.metaBytes + (md?.size ?? 0),
      createdAt: timeOf(item.meta, 0),
    })
  }
  return records
}

interface LatestRecord {
  readonly meta: ReviewRound
  readonly markdownPath: string
  readonly createdAt: number
  readonly mtimeMs: number
}

/**
 * The newest committed round in one document's mirror directory. A corrupt
 * metadata file is not a round this read can rank, so it is skipped; a round
 * that ranks newest but has no snapshot turns into null in the caller instead
 * of handing back the one before it.
 */
async function newestRound(
  files: ReviewFilePort,
  directory: string,
  sourcePath: string,
): Promise<LatestRecord | null> {
  let entries: readonly ReviewFileEntry[]
  try {
    entries = await files.list(directory)
  } catch (error) {
    throw new AnnotationError('read-failed', `读取轮次目录失败：${String(error)}`)
  }
  const records: LatestRecord[] = []
  for (const entry of entries) {
    if (entry.directory || !entry.path.endsWith('.json')) continue
    let raw: string | null
    try {
      raw = await files.read(entry.path)
    } catch (error) {
      throw new AnnotationError('read-failed', `读取审阅元数据失败：${String(error)}`)
    }
    if (raw === null) continue
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      continue
    }
    const parsed = reviewRoundSchema.safeParse(value)
    if (!parsed.success) continue
    if (parsed.data.sourcePath !== sourcePath) continue
    records.push({
      meta: parsed.data,
      markdownPath: `${entry.path.slice(0, -'.json'.length)}.md`,
      createdAt: timeOf(parsed.data, entry.mtimeMs),
      mtimeMs: entry.mtimeMs,
    })
  }
  records.sort((left, right) => right.createdAt - left.createdAt || right.mtimeMs - left.mtimeMs)
  return records[0] ?? null
}

export function createReviewStore(deps: ReviewStoreDeps): ReviewStore {
  const now = deps.now ?? (() => new Date())
  const limits = { ...REVIEW_LIMITS, ...deps.limits }
  const warn = deps.warn ?? ((message: string, error: unknown): void => console.warn(message, error))

  const workspaceOf = async (sessionId: string): Promise<string> => {
    const workspace = await deps.workspaceOf(sessionId)
    if (workspace === null || workspace === '') {
      throw new AnnotationError('unknown-session', `未知会话：${sessionId}`)
    }
    return workspace
  }

  const removeRound = async (files: ReviewFilePort, record: RoundRecord): Promise<void> => {
    await files.remove(record.markdownPath)
    await files.remove(record.metaPath)
  }

  const prune = async (sessionId: string): Promise<number> => {
    const workspace = await workspaceOf(sessionId)
    const root = rootsOf(workspace)
    const current = now().getTime()
    let removed = 0

    for (const entry of await deps.files.list(root.pending)) {
      if (entry.directory) continue
      if (current - entry.mtimeMs > PENDING_TTL_MS) {
        await deps.files.remove(entry.path)
        removed += 1
      }
    }

    const records = await collectRounds(deps.files, root)
    if (records.length === 0) return removed

    const sorted = [...records].sort((left, right) => right.createdAt - left.createdAt)
    const protectedRounds = new Set<string>()
    const groups = new Map<string, RoundRecord[]>()
    for (const record of sorted) {
      const source = record.meta.sourcePath
      const group = groups.get(source) ?? []
      if (group.length === 0) protectedRounds.add(record.metaPath)
      group.push(record)
      groups.set(source, group)
    }

    const doomed = new Set<string>()
    for (const record of sorted) {
      if (protectedRounds.has(record.metaPath)) continue
      if (current - record.createdAt > limits.maxAgeMs) doomed.add(record.metaPath)
    }
    for (const group of groups.values()) {
      for (const record of group.slice(limits.maxRoundsPerDocument)) {
        if (!protectedRounds.has(record.metaPath)) doomed.add(record.metaPath)
      }
    }

    let total = 0
    for (const record of sorted) {
      if (!doomed.has(record.metaPath)) total += record.bytes
    }
    if (total > limits.maxTotalBytes) {
      for (let index = sorted.length - 1; index >= 0 && total > limits.maxTotalBytes; index -= 1) {
        const record = sorted[index]!
        if (protectedRounds.has(record.metaPath) || doomed.has(record.metaPath)) continue
        doomed.add(record.metaPath)
        total -= record.bytes
      }
    }

    for (const record of sorted) {
      if (!doomed.has(record.metaPath)) continue
      await removeRound(deps.files, record)
      removed += 1
    }
    return removed
  }

  return {
    async prepare(input) {
      const sessionId = requireSessionId(input.sessionId)
      const documentPath = canonicalDocumentPath(input.path)
      const roundId = requireRoundId(input.roundId)
      if (typeof input.text !== 'string') throw new AnnotationError('invalid-request', '缺少原文')
      const workspace = await workspaceOf(sessionId)
      const root = rootsOf(workspace)
      // Validate the document mirror before writing: an unmappable path must
      // not leave a pending snapshot no commit could promote.
      documentMirror(workspace, documentPath)
      try {
        await ensureGitignore(deps.files, workspace)
        await deps.files.mkdir(root.pending)
        await writeAtomic(deps.files, pendingFileOf(root, roundId), input.text)
      } catch (error) {
        throw new AnnotationError('write-failed', `写入 pending 快照失败（${roundId}）：${String(error)}`)
      }
      const sourceHash = await sha256Of(normalizedSourceText(input.text))
      await prune(sessionId).catch(error => warn('[dsh-active-markdown] 清理审阅快照失败', error))
      return { sourceHash, snapshotWritten: true, bytes: Buffer.byteLength(input.text, 'utf8') }
    },

    async commit(input) {
      const sessionId = requireSessionId(input.sessionId)
      const documentPath = canonicalDocumentPath(input.path)
      const roundId = requireRoundId(input.roundId)
      const workspace = await workspaceOf(sessionId)
      const root = rootsOf(workspace)
      const mirror = documentMirror(workspace, documentPath)
      const directory = roundDirectory(root, mirror)
      const markdownPath = resolve(directory, `${roundId}.md`)
      const metaPath = resolve(directory, `${roundId}.json`)
      const pending = input.pending

      if (pending === null || pending.roundId !== roundId) {
        // A retry after the draft was already deleted is answered by the meta file.
        const existing = await deps.files.exists(metaPath)
        return { roundId, committed: existing, snapshotMissing: false }
      }

      let snapshotMissing = false
      try {
        await deps.files.mkdir(directory)
        const pendingPath = pendingFileOf(root, roundId)
        if (await deps.files.exists(pendingPath)) {
          if (await deps.files.exists(markdownPath)) await deps.files.remove(pendingPath)
          else await deps.files.rename(pendingPath, markdownPath)
        } else if (!(await deps.files.exists(markdownPath))) {
          snapshotMissing = true
        }
      } catch (error) {
        throw new AnnotationError('write-failed', `转正 pending 快照失败（${roundId}）：${String(error)}`)
      }

      const meta: ReviewRound = {
        roundId,
        sessionId,
        sourcePath: mirror.sourcePath,
        sourceHash: pending.sourceHash,
        feedback: pending.feedback,
        sentText: input.sentText,
        fileName: pending.fileName,
        annotations: pending.annotations,
        ...(snapshotMissing ? { snapshotMissing: true as const } : {}),
        createdAt: now().toISOString(),
      }
      const parsed = reviewRoundSchema.safeParse(meta)
      if (!parsed.success) {
        throw new AnnotationError('invalid-request', `审阅元数据不正确：${parsed.error.message}`)
      }
      try {
        await writeAtomic(deps.files, metaPath, `${JSON.stringify(parsed.data, null, 2)}\n`)
      } catch (error) {
        throw new AnnotationError('write-failed', `写入审阅元数据失败（${roundId}）：${String(error)}`)
      }
      await prune(sessionId).catch(error => warn('[dsh-active-markdown] 清理审阅快照失败', error))
      return { roundId, committed: true, snapshotMissing }
    },

    async detach(input) {
      const sessionId = requireSessionId(input.sessionId)
      const roundId = requireRoundId(input.roundId)
      const workspace = await workspaceOf(sessionId)
      const root = rootsOf(workspace)
      const pendingPath = pendingFileOf(root, roundId)
      let existed: boolean
      try {
        existed = await deps.files.exists(pendingPath)
        await deps.files.remove(pendingPath)
      } catch (error) {
        throw new AnnotationError('write-failed', `删除 pending 快照失败（${roundId}）：${String(error)}`)
      }
      return { detached: existed }
    },

    async latest(input) {
      const sessionId = requireSessionId(input.sessionId)
      const documentPath = canonicalDocumentPath(input.path)
      const workspace = await workspaceOf(sessionId)
      const root = rootsOf(workspace)
      const mirror = documentMirror(workspace, documentPath)
      const directory = roundDirectory(root, mirror)
      const newest = await newestRound(deps.files, directory, mirror.sourcePath)
      if (newest === null) return null
      if (newest.meta.snapshotMissing === true) return null
      let text: string | null
      try {
        text = await deps.files.read(newest.markdownPath)
      } catch (error) {
        throw new AnnotationError('read-failed', `读取轮次快照失败：${String(error)}`)
      }
      if (text === null) return null
      return { roundId: newest.meta.roundId, createdAt: newest.meta.createdAt, text }
    },

    prune,
  }
}
