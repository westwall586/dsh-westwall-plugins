import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'

import ActiveMarkdown from '../src/index.ts'
import {
  createMemoryCacheStore,
  createTranslationCache,
  type CacheGetInput,
  type CachePutInput,
  type CacheStore,
  type StorageDomainFacility,
  type TranslationCache,
} from '../src/translate/cache.ts'
import { MAX_SAVED_BYTES, MAX_TRANSLATED_BYTES } from '../src/translate/boundary.ts'
import { PROMPT_VERSION } from '../src/translate/prompt.ts'
import { TranslateError, type TranslateErrorCode } from '../src/translate/request.ts'
import {
  createTranslationStore,
  nodeFiles,
  STORE_GITIGNORE,
  type TranslationSaveInput,
  type TranslationStore,
} from '../src/translate/store.ts'

const SESSION = 'session-1'
const LANG = 'zh'
const MODEL = { provider: 'deepseek', model: 'chat' } as const
const SOURCE = '# Title\n\nBody line.\n'
const TRANSLATED = '# 标题\n\n正文。\n'

interface Harness {
  readonly root: string
  readonly workspace: string
  readonly store: TranslationStore
  readonly cache: TranslationCache
}

async function harness(t: TestContext): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'am-store-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace, { recursive: true })
  const now = (): Date => new Date('2026-11-16T09:30:00.000Z')
  return {
    root,
    workspace,
    store: createTranslationStore({
      files: nodeFiles,
      workspaceOf: (sessionId) => (sessionId === SESSION ? workspace : null),
      readDefault: () => MODEL,
      now,
    }),
    cache: createTranslationCache({
      store: createMemoryCacheStore(),
      readDefault: () => MODEL,
      now,
    }),
  }
}

function cacheGet(cache: TranslationCache, overrides: Partial<CacheGetInput> = {}): Promise<unknown> {
  return cache.cacheGet({
    text: SOURCE,
    lang: LANG,
    provider: MODEL.provider,
    model: MODEL.model,
    promptVersion: PROMPT_VERSION,
    translateComments: true,
    extraInstruction: '',
    ...overrides,
  })
}

function cachePut(cache: TranslationCache, overrides: Partial<CachePutInput> = {}): Promise<unknown> {
  return cache.cachePut({
    text: SOURCE,
    translated: TRANSLATED,
    lang: LANG,
    provider: MODEL.provider,
    model: MODEL.model,
    promptVersion: PROMPT_VERSION,
    translateComments: true,
    extraInstruction: '',
    aligned: true,
    sourceLines: 3,
    translatedLines: 3,
    ...overrides,
  })
}

function save(store: TranslationStore, overrides: Partial<TranslationSaveInput> = {}): Promise<unknown> {
  return store.save({
    sessionId: SESSION,
    path: 'docs/a/README.md',
    text: SOURCE,
    translated: TRANSLATED,
    lang: LANG,
    provider: MODEL.provider,
    model: MODEL.model,
    promptVersion: PROMPT_VERSION,
    extraInstruction: '',
    aligned: true,
    ...overrides,
  })
}

async function writeSource(workspace: string, path: string, text: string): Promise<void> {
  const file = join(workspace, path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, text, 'utf8')
}

function isCode(code: TranslateErrorCode): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof TranslateError, `期望 TranslateError，实际 ${String(error)}`)
    assert.equal(error.code, code)
    return true
  }
}

test('缓存未命中，写入后命中同一份译文', async (t) => {
  const h = await harness(t)
  assert.equal(await cacheGet(h.cache), null)

  assert.deepEqual(await cachePut(h.cache), {})

  const hit = (await cacheGet(h.cache)) as { text: string, meta: { aligned: boolean, sourceHash: string } }
  assert.equal(hit.text, TRANSLATED)
  assert.equal(hit.meta.aligned, true)
  assert.match(hit.meta.sourceHash, /^[0-9a-f]{64}$/)
})

test('省略模型时按会话默认解析，解析出的模型就是缓存键里的模型', async (t) => {
  const h = await harness(t)
  await cachePut(h.cache, { provider: undefined, model: undefined })

  const hit = (await cacheGet(h.cache, { provider: MODEL.provider, model: MODEL.model })) as { text: string } | null
  assert.equal(hit?.text, TRANSLATED)
  assert.equal(await cacheGet(h.cache, { model: 'another-model' }), null)
})

test('换语言、换 provider 或换模型都会错过缓存', async (t) => {
  const h = await harness(t)
  await cachePut(h.cache)

  assert.equal(await cacheGet(h.cache, { lang: 'en' }), null)
  assert.equal(await cacheGet(h.cache, { provider: 'another-provider' }), null)
  assert.equal(await cacheGet(h.cache, { model: 'another-model' }), null)
})

test('源文改动后错过缓存', async (t) => {
  const h = await harness(t)
  await cachePut(h.cache)

  assert.equal(await cacheGet(h.cache, { text: `${SOURCE}More.\n` }), null)
  assert.notEqual(await cacheGet(h.cache, { text: SOURCE }), null)
})

test('换注释策略会错过缓存', async (t) => {
  const h = await harness(t)
  await cachePut(h.cache)

  assert.equal(await cacheGet(h.cache, { translateComments: false }), null)
  assert.notEqual(await cacheGet(h.cache, { translateComments: true }), null)
})

test('补充要求的 hash 把特调结果与普通结果分开', async (t) => {
  const h = await harness(t)
  await cachePut(h.cache)
  await cachePut(h.cache, { extraInstruction: '保留术语', translated: '# 标题(术语版)\n\n正文。\n' })

  assert.equal(((await cacheGet(h.cache)) as { text: string }).text, TRANSLATED)
  assert.equal(
    ((await cacheGet(h.cache, { extraInstruction: '保留术语' })) as { text: string }).text,
    '# 标题(术语版)\n\n正文。\n',
  )
  assert.equal(await cacheGet(h.cache, { extraInstruction: '换一种说法' }), null)
})

test('保存镜像源路径，绝对的外部路径收进 _external', async (t) => {
  const h = await harness(t)
  const saved = (await save(h.store)) as { file: string }

  assert.equal(saved.file, '.dsh-active-markdown/translate/zh/docs/a/README.md')
  assert.equal(await readFile(join(h.workspace, saved.file), 'utf8'), TRANSLATED)
  assert.equal(await readFile(join(h.workspace, '.dsh-active-markdown/.gitignore'), 'utf8'), STORE_GITIGNORE)

  const externalSource = join(h.root, 'REVIEW.md')
  await writeFile(externalSource, SOURCE, 'utf8')
  const external = (await save(h.store, { path: externalSource, translated: '# 审阅\n' })) as {
    file: string
    meta: { sourcePath: string }
  }
  const digest = createHash('sha1').update(resolve(externalSource)).digest('hex').slice(0, 8)
  assert.equal(external.file, `.dsh-active-markdown/translate/zh/_external/${digest}/REVIEW.md`)
  assert.equal(external.meta.sourcePath, resolve(externalSource))
})

test('同一份文档换语言写到不同语言目录，互不覆盖', async (t) => {
  const h = await harness(t)
  const chinese = (await save(h.store, { lang: 'zh' })) as { file: string }
  const english = (await save(h.store, { lang: 'en', translated: '# Title\n\nBody.\n' })) as { file: string }

  assert.equal(chinese.file, '.dsh-active-markdown/translate/zh/docs/a/README.md')
  assert.equal(english.file, '.dsh-active-markdown/translate/en/docs/a/README.md')
  assert.equal(await readFile(join(h.workspace, chinese.file), 'utf8'), TRANSLATED)
  assert.equal(await readFile(join(h.workspace, english.file), 'utf8'), '# Title\n\nBody.\n')
  assert.equal((await h.store.load({ sessionId: SESSION, path: 'docs/a/README.md', lang: 'zh' }))?.text, TRANSLATED)
})

test('不同目录的同名文档各自镜像，互不覆盖', async (t) => {
  const h = await harness(t)
  const first = (await save(h.store, { path: 'docs/a/README.md', translated: '# A\n' })) as { file: string }
  const second = (await save(h.store, { path: 'docs/b/README.md', translated: '# B\n' })) as { file: string }

  assert.notEqual(first.file, second.file)
  assert.equal((await h.store.load({ sessionId: SESSION, path: 'docs/a/README.md', lang: LANG }))?.text, '# A\n')
  assert.equal((await h.store.load({ sessionId: SESSION, path: 'docs/b/README.md', lang: LANG }))?.text, '# B\n')
})

function metadataFileOf(file: string): string {
  const rest = file.slice('.dsh-active-markdown/translate/'.length)
  const slash = rest.indexOf('/')
  const lang = rest.slice(0, slash)
  const relative = rest.slice(slash + 1)
  const dot = relative.lastIndexOf('.')
  return `.dsh-active-markdown/index/translate/${lang}/${dot === -1 ? relative : relative.slice(0, dot)}.json`
}

test('元数据写出 8.1 表里的全部字段，落在平行的 index 树', async (t) => {
  const h = await harness(t)
  const saved = (await save(h.store)) as { file: string }
  const raw = JSON.parse(await readFile(join(h.workspace, metadataFileOf(saved.file)), 'utf8')) as Record<string, unknown>

  assert.deepEqual(Object.keys(raw).sort(), [
    'aligned',
    'extraInstructionHash',
    'lang',
    'model',
    'promptVersion',
    'provider',
    'savedAt',
    'sourceHash',
    'sourceLines',
    'sourcePath',
  ])
  assert.equal(raw.sourcePath, 'docs/a/README.md')
  assert.match(String(raw.sourceHash), /^[0-9a-f]{64}$/)
  assert.equal(raw.sourceLines, 3)
  assert.equal(raw.lang, LANG)
  assert.equal(raw.model, MODEL.model)
  assert.equal(raw.provider, MODEL.provider)
  assert.equal(raw.promptVersion, PROMPT_VERSION)
  assert.equal(raw.extraInstructionHash, '')
  assert.equal(raw.aligned, true)
  assert.equal(raw.savedAt, '2026-11-16T09:30:00.000Z')
})

test('带 .. 的路径被拒绝，工作区内的绝对路径归一为相对路径', async (t) => {
  const h = await harness(t)

  await assert.rejects(save(h.store, { path: 'docs/../secret.md' }), isCode('invalid-path'))
  await assert.rejects(
    h.store.load({ sessionId: SESSION, path: 'docs/../../etc/passwd', lang: LANG }),
    isCode('invalid-path'),
  )

  const absolute = join(h.workspace, 'docs/a/README.md')
  await writeSource(h.workspace, 'docs/a/README.md', SOURCE)
  const saved = (await save(h.store, { path: absolute })) as { file: string, meta: { sourcePath: string } }
  assert.equal(saved.file, '.dsh-active-markdown/translate/zh/docs/a/README.md')
  assert.equal(saved.meta.sourcePath, 'docs/a/README.md')
  assert.equal((await h.store.load({ sessionId: SESSION, path: absolute, lang: LANG }))?.text, TRANSLATED)

  await assert.rejects(save(h.store, { path: h.workspace }), isCode('invalid-path'))
})

test('未知会话在写入前就被拒绝', async (t) => {
  const h = await harness(t)
  await assert.rejects(save(h.store, { sessionId: 'session-unknown' }), isCode('unknown-session'))
  await assert.rejects(
    h.store.load({ sessionId: 'session-unknown', path: 'docs/a/README.md', lang: LANG }),
    isCode('unknown-session'),
  )
})

test('超过旧 64 KiB 上限的译文照常命中；缓存停在 4 MiB，落盘更宽', async (t) => {
  const h = await harness(t)
  const long = '译'.repeat(70_000)

  assert.deepEqual(await cachePut(h.cache, { translated: long }), {})
  assert.equal(((await cacheGet(h.cache)) as { text: string }).text, long)

  await assert.rejects(
    cachePut(h.cache, { translated: 'x'.repeat(MAX_TRANSLATED_BYTES + 1) }),
    isCode('text-too-large'),
  )

  // 能翻译出来的结果就该能存：缓存的上限不是落盘的上限。
  const bigger = 'x'.repeat(MAX_TRANSLATED_BYTES + 1)
  const saved = (await save(h.store, { translated: bigger })) as { file: string }
  assert.equal((await readFile(join(h.workspace, saved.file), 'utf8')).length, bigger.length)

  await assert.rejects(
    save(h.store, { translated: 'x'.repeat(MAX_SAVED_BYTES + 1) }),
    isCode('text-too-large'),
  )
})

test('保存后原文未变不算过期，原文一改就标过期且旧译文仍可读', async (t) => {
  const h = await harness(t)
  await writeSource(h.workspace, 'docs/a/README.md', SOURCE)
  await save(h.store)

  const fresh = await h.store.load({ sessionId: SESSION, path: 'docs/a/README.md', lang: LANG })
  assert.equal(fresh?.stale, false)
  // The load view names the mirror so the toolbar can say where the file is.
  assert.equal(fresh?.file, '.dsh-active-markdown/translate/zh/docs/a/README.md')

  await writeSource(h.workspace, 'docs/a/README.md', `${SOURCE}\nA new paragraph.\n`)
  const stale = await h.store.load({ sessionId: SESSION, path: 'docs/a/README.md', lang: LANG })
  assert.equal(stale?.stale, true)
  assert.equal(stale?.text, TRANSLATED)
})

test('没有保存过的文档返回 null', async (t) => {
  const h = await harness(t)
  assert.equal(await h.store.load({ sessionId: SESSION, path: 'docs/missing.md', lang: LANG }), null)
})

test('语言为空与超限原文都以类型化错误拒绝', async (t) => {
  const h = await harness(t)
  await assert.rejects(cacheGet(h.cache, { lang: '   ' }), isCode('invalid-language'))
  await assert.rejects(cacheGet(h.cache, { text: 'x'.repeat(2 * 1024 * 1024 + 1) }), isCode('text-too-large'))
  await assert.rejects(save(h.store, { text: '   ' }), isCode('invalid-text'))
})

interface ServiceHarness extends Harness {
  readonly service: ActiveMarkdown
}

async function serviceHarness(t: TestContext): Promise<ServiceHarness> {
  const h = await harness(t)
  const cacheStore: CacheStore = createMemoryCacheStore()
  const facility: StorageDomainFacility = {
    async open() {
      return { table: () => ({ get: cacheStore.get, put: cacheStore.put }) }
    },
  }
  const ctx = new Context()
  const provide = (ctx as unknown as { provide(name: string, value: unknown): void }).provide.bind(ctx)
  provide('sessions', { get: (id: string) => (id === SESSION ? { header: { cwd: h.workspace } } : undefined) })
  provide('agentDefaultModel', { currentSelection: () => MODEL })
  provide('storageDomain', facility)
  return { ...h, service: new ActiveMarkdown(ctx) }
}

function codeOf(error: unknown): string | undefined {
  return (error as { code?: string }).code
}

test('服务层：没有模型服务时也能命中缓存，保存与读取共用一个工作区', async (t) => {
  const h = await serviceHarness(t)

  assert.equal(await h.service.cacheGet(SOURCE, LANG, '', '', PROMPT_VERSION, ''), null)
  assert.deepEqual(await h.service.cachePut(SOURCE, TRANSLATED, LANG, '', '', PROMPT_VERSION, '', true, 3, 3), {})
  assert.equal((await h.service.cacheGet(SOURCE, LANG, '', '', PROMPT_VERSION, ''))?.text, TRANSLATED)

  await writeSource(h.workspace, 'docs/a/README.md', SOURCE)
  const saved = await h.service.translationSave(
    SESSION, 'docs/a/README.md', SOURCE, TRANSLATED, LANG, '', '', PROMPT_VERSION, '', true,
  )
  assert.equal(saved.file, '.dsh-active-markdown/translate/zh/docs/a/README.md')

  const loaded = await h.service.translationLoad(SESSION, 'docs/a/README.md', LANG)
  assert.equal(loaded?.text, TRANSLATED)
  assert.equal(loaded?.stale, false)
})

test('服务层：边界失败映射成 Remote 错误码', async (t) => {
  const h = await serviceHarness(t)

  await assert.rejects(
    h.service.translationSave(SESSION, 'docs/../x.md', SOURCE, TRANSLATED, LANG, '', '', PROMPT_VERSION, '', true),
    (error: unknown) => codeOf(error) === 'activeMarkdown/invalid-path',
  )
  await assert.rejects(
    h.service.translationSave('session-unknown', 'docs/a/README.md', SOURCE, TRANSLATED, LANG, '', '', PROMPT_VERSION, '', true),
    (error: unknown) => codeOf(error) === 'activeMarkdown/unknown-session',
  )
  await assert.rejects(
    h.service.cacheGet('   ', LANG, '', '', PROMPT_VERSION, ''),
    (error: unknown) => codeOf(error) === 'activeMarkdown/invalid-request',
  )
})
