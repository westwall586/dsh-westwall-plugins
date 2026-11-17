/**
 * 审阅轮次的全文快照与元数据：加入输入框时把批注所看的原文写进
 * `reviews/pending/<roundId>.md`，发送成功后再 rename 到
 * `reviews/<镜像路径>/<roundId>.md`，并在旁边写同名 JSON。所有写入先落同目录
 * 临时文件再 rename，半截文件不会变成一轮合法的旧版。
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AnnotationError, canonicalDocumentPath, requireRoundId, requireSessionId } from './paths.ts'
import { reviewRoundSchema, type PendingReview, type ReviewRound } from './schema.ts'
import { mirrorOf, STORE_GITIGNORE, STORE_ROOT, type MirrorPath } from '../translate/store.ts'

export const REVIEWS_DIR = 'reviews'
export const PENDING_DIR = 'pending'

/** 快照需要的文件操作；测试用内存实现，生产用 node 实现。 */
export interface ReviewFilePort {
  read(path: string): Promise<string | null>
  write(path: string, content: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
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
}

export interface ReviewStoreDeps {
  readonly files: ReviewFilePort
  readonly workspaceOf: (sessionId: string) => Promise<string | null> | string | null
  readonly now?: () => Date
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

export interface ReviewStore {
  prepare(input: ReviewPrepareInput): Promise<ReviewPrepareView>
  commit(input: ReviewCommitInput): Promise<ReviewCommitView>
  /** Remove one round's pending snapshot; the draft record is the caller's. */
  detach(input: ReviewDetachInput): Promise<ReviewDetachView>
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

export function createReviewStore(deps: ReviewStoreDeps): ReviewStore {
  const now = deps.now ?? (() => new Date())

  const workspaceOf = async (sessionId: string): Promise<string> => {
    const workspace = await deps.workspaceOf(sessionId)
    if (workspace === null || workspace === '') {
      throw new AnnotationError('unknown-session', `未知会话：${sessionId}`)
    }
    return workspace
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
        return { roundId, committed: false, snapshotMissing: false }
      }

      let snapshotMissing = false
      try {
        await deps.files.mkdir(directory)
        const pendingPath = pendingFileOf(root, roundId)
        if (await deps.files.exists(pendingPath)) await deps.files.rename(pendingPath, markdownPath)
        else snapshotMissing = true
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
      return { roundId, committed: true, snapshotMissing }
    },

    async detach(input) {
      const sessionId = requireSessionId(input.sessionId)
      const roundId = requireRoundId(input.roundId)
      const workspace = await workspaceOf(sessionId)
      const root = rootsOf(workspace)
      try {
        await deps.files.remove(pendingFileOf(root, roundId))
      } catch (error) {
        throw new AnnotationError('write-failed', `删除 pending 快照失败（${roundId}）：${String(error)}`)
      }
      return { detached: true }
    },
  }
}
