/**
 * 用户保存：把一份译文写成工作区里的镜像文件对，Markdown 给读，JSON 给机器。
 * 路径从源路径直接算出，不维护中央清单：`docs/a/README.md` 落到
 * `.dsh-active-markdown/translate/docs/a/README.<lang>.md`，不同目录的同名文档
 * 因此不会互相覆盖。工作区外的文档没有相对路径可镜像，按路径 sha1 收进
 * `_external/<前 8 位>/`，完整路径记在元数据里。
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { countSourceLines, extraInstructionHash, normalizeSource, sha1Hex, sha256Hex } from './digest.ts'
import { errorText, requireLanguage, requireSessionId, requireText } from './boundary.ts'
import { resolveModel, TranslateError, type ModelSelection } from './request.ts'

export const STORE_ROOT = '.dsh-active-markdown'
export const TRANSLATE_ROOT = `${STORE_ROOT}/translate`
export const EXTERNAL_ROOT = '_external'
export const STORE_GITIGNORE = '*\n!.gitignore\n'

const translationMetaSchema = z.object({
  sourcePath: z.string().min(1),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  sourceLines: z.number().int().nonnegative(),
  lang: z.string().min(1),
  model: z.string().min(1),
  provider: z.string().min(1),
  promptVersion: z.string(),
  extraInstructionHash: z.string(),
  aligned: z.boolean(),
  savedAt: z.string(),
}).strict()

export interface TranslationMeta {
  readonly sourcePath: string
  readonly sourceHash: string
  readonly sourceLines: number
  readonly lang: string
  readonly model: string
  readonly provider: string
  readonly promptVersion: string
  readonly extraInstructionHash: string
  readonly aligned: boolean
  readonly savedAt: string
}

export interface TranslationSaveInput {
  readonly sessionId: string
  readonly path: string
  readonly text: string
  readonly translated: string
  readonly lang: string
  readonly provider?: string
  readonly model?: string
  readonly promptVersion: string
  readonly extraInstruction?: string
  readonly aligned: boolean
}

export interface TranslationSaveView {
  /** 相对工作区、以 `/` 分隔的 Markdown 镜像路径。 */
  readonly file: string
  readonly meta: TranslationMeta
}

export interface TranslationLoadInput {
  readonly sessionId: string
  readonly path: string
  readonly lang: string
}

export interface TranslationLoadView {
  readonly text: string
  readonly meta: TranslationMeta
  readonly stale: boolean
}

/** 读写工作区的一层薄端口；测试用同一个端口指向临时目录。 */
export interface FilePort {
  read(path: string): Promise<string | null>
  write(path: string, content: string): Promise<void>
  exists(path: string): Promise<boolean>
}

export const nodeFiles: FilePort = {
  async read(path) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return null
      throw error
    }
  },
  async write(path, content) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
  },
  async exists(path) {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  },
}

export interface StoreDeps {
  readonly files: FilePort
  readonly workspaceOf: (sessionId: string) => Promise<string | null> | string | null
  readonly readDefault: () => ModelSelection | null
  readonly now?: () => Date
}

export interface TranslationStore {
  save(input: TranslationSaveInput): Promise<TranslationSaveView>
  load(input: TranslationLoadInput): Promise<TranslationLoadView | null>
}

export interface MirrorPath {
  /** 相对 `.dsh-active-markdown/translate/`、以 `/` 分隔的目标路径。 */
  readonly relative: string
  /** 元数据里的源路径：工作区内是相对路径，工作区外是绝对路径。 */
  readonly sourcePath: string
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

/** 去掉扩展名，把语言后缀放在原扩展名之前：`README.md` → `README.zh.md`。 */
function languageName(name: string, lang: string): string {
  const ext = extname(name)
  const stem = ext === '' ? name : name.slice(0, name.length - ext.length)
  if (stem === '' || stem === '.' || stem === '..') {
    throw new TranslateError('invalid-path', `不是有效的文档文件名：${name}`)
  }
  return `${stem}.${lang}${ext}`
}

/**
 * 纯路径计算：源路径 → 镜像路径。`..` 与指向工作区内的绝对路径在这里拒绝，
 * 保证写盘目标永远是 `translate/` 之下的相对路径。
 */
export function mirrorOf(input: { readonly path: string; readonly lang: string; readonly workspace: string }): MirrorPath {
  const source = typeof input.path === 'string' ? input.path.trim() : ''
  if (source === '') throw new TranslateError('invalid-path', '缺少文档路径')
  const slash = source.replace(/\\/g, '/')
  if (slash.split('/').includes('..')) {
    throw new TranslateError('invalid-path', `路径不能包含 ..：${source}`)
  }
  const lang = requireLanguage(input.lang)

  if (isAbsolute(source)) {
    const absolute = resolve(source)
    if (isInside(resolve(input.workspace), absolute)) {
      throw new TranslateError('invalid-path', `工作区内的文档请使用会话相对路径：${source}`)
    }
    const name = languageName(basename(absolute), lang)
    return { relative: `${EXTERNAL_ROOT}/${sha1Hex(absolute).slice(0, 8)}/${name}`, sourcePath: absolute }
  }

  const segments = slash.split('/').filter(segment => segment !== '' && segment !== '.')
  if (segments.length === 0) throw new TranslateError('invalid-path', `文档路径为空：${source}`)
  const name = languageName(segments[segments.length - 1]!, lang)
  return {
    relative: [...segments.slice(0, -1), name].join('/'),
    sourcePath: segments.join('/'),
  }
}

function metadataPathOf(mirrorRelative: string): string {
  const ext = extname(mirrorRelative)
  return `${mirrorRelative.slice(0, mirrorRelative.length - ext.length)}.json`
}

function parseMeta(raw: string): TranslationMeta | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = translationMetaSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function createTranslationStore(deps: StoreDeps): TranslationStore {
  const now = deps.now ?? (() => new Date())

  return {
    async save(input) {
      const sessionId = requireSessionId(input.sessionId)
      const text = requireText(input.text, '原文')
      const translated = requireText(input.translated, '译文')
      const lang = requireLanguage(input.lang)
      const workspace = await deps.workspaceOf(sessionId)
      if (workspace === null) throw new TranslateError('unknown-session', `未知会话：${sessionId}`)

      const selection = resolveModel({
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.model === undefined ? {} : { model: input.model }),
        readDefault: deps.readDefault,
      })
      const mirror = mirrorOf({ path: input.path, lang, workspace })
      const meta: TranslationMeta = {
        sourcePath: mirror.sourcePath,
        sourceHash: sha256Hex(normalizeSource(text)),
        sourceLines: countSourceLines(text),
        lang,
        model: selection.model,
        provider: selection.provider,
        promptVersion: typeof input.promptVersion === 'string' ? input.promptVersion : '',
        extraInstructionHash: extraInstructionHash(input.extraInstruction),
        aligned: input.aligned === true,
        savedAt: now().toISOString(),
      }

      const translateRoot = resolve(workspace, TRANSLATE_ROOT)
      const markdownPath = resolve(translateRoot, mirror.relative)
      if (!isInside(translateRoot, markdownPath)) {
        throw new TranslateError('invalid-path', `镜像路径越出保存目录：${mirror.relative}`)
      }

      try {
        const gitignorePath = resolve(workspace, STORE_ROOT, '.gitignore')
        if (!(await deps.files.exists(gitignorePath))) {
          await deps.files.write(gitignorePath, STORE_GITIGNORE)
        }
        await deps.files.write(markdownPath, translated)
        await deps.files.write(resolve(translateRoot, metadataPathOf(mirror.relative)), `${JSON.stringify(meta, null, 2)}\n`)
      } catch (error) {
        throw new TranslateError('write-failed', `保存译文失败（${mirror.relative}）：${errorText(error)}`)
      }

      return { file: `${TRANSLATE_ROOT}/${mirror.relative}`, meta }
    },

    async load(input) {
      const sessionId = requireSessionId(input.sessionId)
      const lang = requireLanguage(input.lang)
      const workspace = await deps.workspaceOf(sessionId)
      if (workspace === null) throw new TranslateError('unknown-session', `未知会话：${sessionId}`)

      const mirror = mirrorOf({ path: input.path, lang, workspace })
      const translateRoot = resolve(workspace, TRANSLATE_ROOT)
      const markdownPath = resolve(translateRoot, mirror.relative)
      const metadataPath = resolve(translateRoot, metadataPathOf(mirror.relative))

      try {
        const [text, rawMeta] = await Promise.all([deps.files.read(markdownPath), deps.files.read(metadataPath)])
        if (text === null || rawMeta === null) return null
        const meta = parseMeta(rawMeta)
        if (meta === null) return null
        // The requested path, not the JSON, decides which source is current:
        // metadata is a record, never an instruction.
        const current = await deps.files.read(resolve(workspace, mirror.sourcePath))
        const stale = current === null || sha256Hex(normalizeSource(current)) !== meta.sourceHash
        return { text, meta, stale }
      } catch (error) {
        throw new TranslateError('read-failed', `读取已保存译文失败（${mirror.relative}）：${errorText(error)}`)
      }
    },
  }
}
