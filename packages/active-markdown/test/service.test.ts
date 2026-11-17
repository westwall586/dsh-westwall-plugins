import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ActiveMarkdown from '../src/index.ts'
import { createMemoryAnnotationTable } from '../src/annotate/store.ts'
import type { Annotation, PendingReview } from '../src/annotate/schema.ts'
import { FALLBACK_MAX_TOKENS, type LlmCallOptions, type LlmLike } from '../src/translate/call.ts'
import { LANGUAGES } from '../src/translate/language.ts'
import { MAX_TEXT_BYTES } from '../src/translate/request.ts'
import { PROMPT_VERSION } from '../src/translate/prompt.ts'

interface FakeLlmOptions {
  readonly chunks?: readonly string[]
  readonly finish?: { readonly kind: string, readonly failure?: { readonly message?: string } }
  readonly defaultMaxTokens?: number
}

function fakeLlm(options: FakeLlmOptions = {}): { llm: LlmLike, calls: LlmCallOptions[] } {
  const calls: LlmCallOptions[] = []
  const llm: LlmLike = {
    async resolveModelInfo() {
      return options.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: options.defaultMaxTokens }
    },
    stream(callOptions) {
      calls.push(callOptions)
      return (async function* produce() {
        for (const text of options.chunks ?? []) yield { type: 'text-delta', text }
        if (options.finish !== undefined) yield { type: 'finish', reason: options.finish }
      })()
    },
  }
  return { llm, calls }
}

function serviceWith(services: Record<string, unknown>, config?: unknown): ActiveMarkdown {
  const ctx = new Context()
  const provide = (ctx as unknown as { provide(name: string, value: unknown): void }).provide.bind(ctx)
  for (const [name, value] of Object.entries(services)) provide(name, value)
  if (config !== undefined) {
    (ctx as unknown as { fiber: { rawConfig: unknown } }).fiber.rawConfig = config
  }
  return new ActiveMarkdown(ctx)
}

const SOURCE = '# Title\n\nBody line.\n'

function codeOf(error: unknown): string | undefined {
  return (error as { code?: string }).code
}

test('translate 返回整篇译文，行数与原文一致', async () => {
  const { llm, calls } = fakeLlm({ chunks: ['# 标题\n', '\n', '正文。\n'], defaultMaxTokens: 4096 })
  const service = serviceWith({ llm })
  const view = await service.translate('session-1', 'docs/README.md', SOURCE, 'zh', 'deepseek', 'chat', PROMPT_VERSION, '')

  assert.equal(view.text.split('\n').length, SOURCE.split('\n').length)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].purpose, 'activeMarkdown.translate')
  assert.equal(calls[0].temperature, 0)
  assert.equal(calls[0].maxTokens, 4096)
  assert.match(calls[0].system ?? '', /- 目标语言：简体中文/)
})

test('省略 provider 与 model 时用会话默认模型', async () => {
  const { llm, calls } = fakeLlm({ chunks: ['译文'] })
  const service = serviceWith({
    llm,
    agentDefaultModel: { currentSelection: () => ({ provider: 'default-provider', model: 'default-model' }) },
  })
  await service.translate('session-1', 'a.md', SOURCE, 'zh', '', '', PROMPT_VERSION, '')
  assert.deepEqual([calls[0].provider, calls[0].model], ['default-provider', 'default-model'])
  assert.equal(calls[0].maxTokens, FALLBACK_MAX_TOKENS)
})

test('显式 provider 与 model 压过默认选择', async () => {
  const { llm, calls } = fakeLlm({ chunks: ['译文'] })
  const service = serviceWith({
    llm,
    agentDefaultModel: { currentSelection: () => ({ provider: 'default-provider', model: 'default-model' }) },
  })
  await service.translate('session-1', 'a.md', SOURCE, 'zh', 'explicit-provider', 'explicit-model', PROMPT_VERSION)
  assert.deepEqual([calls[0].provider, calls[0].model], ['explicit-provider', 'explicit-model'])
})

test('describe 回提示词版本、生效设置与语言表', () => {
  const service = serviceWith({})
  assert.deepEqual(service.describe(), {
    promptVersion: PROMPT_VERSION,
    settings: { lang: 'zh', model: null, translateComments: true },
    languages: LANGUAGES,
  })
})

test('describe 读插件设置里的模型、语言代码与注释策略', () => {
  const service = serviceWith({}, {
    model: { provider: 'p', model: 'm' },
    lang: 'en',
    translateComments: false,
  })
  assert.deepEqual(service.describe().settings, {
    lang: 'en',
    model: { provider: 'p', model: 'm' },
    translateComments: false,
  })
})

test('未显式给注释策略时用插件设置，显式值压过设置', async () => {
  const off = fakeLlm({ chunks: ['译文'] })
  const offService = serviceWith({ llm: off.llm }, { translateComments: false })
  await offService.translate('session-1', 'a.md', SOURCE, 'zh', 'p', 'm', PROMPT_VERSION, '')
  assert.match(off.calls[0]!.system ?? '', /注释也不翻译/)

  const on = fakeLlm({ chunks: ['译文'] })
  const onService = serviceWith({ llm: on.llm }, { translateComments: false })
  await onService.translate('session-1', 'a.md', SOURCE, 'zh', 'p', 'm', PROMPT_VERSION, '', true)
  assert.match(on.calls[0]!.system ?? '', /注释、说明性内容可以翻译/)
})

test('边界守卫以 Remote 错误码返回，而不是裸异常', async () => {
  const { llm } = fakeLlm({ chunks: ['译文'] })
  const service = serviceWith({ llm })

  await assert.rejects(
    service.translate('', 'a.md', SOURCE, 'zh', 'p', 'm', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/invalid-request',
  )
  await assert.rejects(
    service.translate('session-1', 'a.md', '   ', 'zh', 'p', 'm', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/invalid-request',
  )
  await assert.rejects(
    service.translate('session-1', 'a.md', 'a'.repeat(MAX_TEXT_BYTES + 1), 'zh', 'p', 'm', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/text-too-large',
  )
  await assert.rejects(
    service.translate('session-1', 'a.md', SOURCE, '', 'p', 'm', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/invalid-request',
  )
  await assert.rejects(
    service.translate('session-1', 'a.md', SOURCE, 'zh', '', '', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/no-model',
  )
})

test('reviewPrepare / reviewCommit / reviewDetach 走工作区快照与草稿', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'am-review-'))
  const table = createMemoryAnnotationTable()
  const service = serviceWith({
    storageDomain: { open: async () => ({ table: () => table }) },
    sessions: { get: () => ({ header: { cwd: workspace } }) },
  })
  const path = join(workspace, 'docs', 'a.md')
  const pending: PendingReview = {
    roundId: 'r1',
    draftAttachmentId: 'd-r1',
    fileName: 'a-review-r1.md',
    fileBytes: 10,
    fileHash: 'f'.repeat(64),
    sourceHash: 's'.repeat(64),
    annotations: [annotation()],
    feedback: '# 反馈',
    createdAt: '2026-11-17T00:00:00.000Z',
  }

  try {
    const prepared = await service.reviewPrepare('s1', path, 'r1', '# 原文\n')
    assert.equal(prepared.snapshotWritten, true)
    assert.equal(prepared.bytes, Buffer.byteLength('# 原文\n', 'utf8'))
    assert.match(prepared.sourceHash, /^[0-9a-f]{64}$/)

    await service.annotationSave('s1', path, [annotation()], pending)
    const committed = await service.reviewCommit('s1', path, 'r1', '发送的文本')
    assert.deepEqual(committed, { roundId: 'r1', committed: true, snapshotMissing: false })
    assert.equal(await service.annotationLoad('s1', path), null)

    const snapshot = join(workspace, '.dsh-active-markdown', 'reviews', 'docs', 'a.md', 'r1.md')
    assert.equal(await readFile(snapshot, 'utf8'), '# 原文\n')
    const meta = JSON.parse(await readFile(snapshot.replace(/\.md$/, '.json'), 'utf8')) as {
      sourcePath: string
      sentText: string
      feedback: string
      annotations: unknown[]
    }
    assert.equal(meta.sourcePath, 'docs/a.md')
    assert.equal(meta.sentText, '发送的文本')
    assert.equal(meta.feedback, '# 反馈')
    assert.equal(meta.annotations.length, 1)

    const second: PendingReview = { ...pending, roundId: 'r2', draftAttachmentId: 'd-r2' }
    await service.reviewPrepare('s1', path, 'r2', '第二轮原文')
    await service.annotationSave('s1', path, [annotation()], second)
    assert.deepEqual(await service.reviewDetach('s1', path, 'r1'), { detached: false })
    assert.deepEqual(await service.reviewDetach('s1', path, 'r2'), { detached: true })
    const draft = await service.annotationLoad('s1', path)
    assert.equal(draft?.pending, undefined)
    assert.equal(draft?.annotations.length, 1)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('reviewDetach 能清掉 attach 失败留下的孤儿 pending 快照', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'am-review-orphan-'))
  const service = serviceWith({
    storageDomain: { open: async () => ({ table: () => createMemoryAnnotationTable() }) },
    sessions: { get: () => ({ header: { cwd: workspace } }) },
  })
  const path = join(workspace, 'a.md')
  try {
    await service.reviewPrepare('s1', path, 'orphan', '原文')
    assert.deepEqual(await service.reviewDetach('s1', path, 'orphan'), { detached: true })
    await assert.rejects(readFile(join(workspace, '.dsh-active-markdown', 'reviews', 'pending', 'orphan.md'), 'utf8'))
    assert.deepEqual(await service.reviewDetach('s1', path, 'orphan'), { detached: false })
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('reviewPrepare 拒绝空原文', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'am-review-empty-'))
  const service = serviceWith({
    storageDomain: { open: async () => ({ table: () => createMemoryAnnotationTable() }) },
    sessions: { get: () => ({ header: { cwd: workspace } }) },
  })
  try {
    await assert.rejects(
      service.reviewPrepare('s1', join(workspace, 'a.md'), 'r1', ''),
      (error: unknown) => codeOf(error) === 'activeMarkdown/invalid-request',
    )
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('reviewCommit 保留发送后新加、未冻结进这一轮的批注', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'am-review-extra-'))
  const table = createMemoryAnnotationTable()
  const service = serviceWith({
    storageDomain: { open: async () => ({ table: () => table }) },
    sessions: { get: () => ({ header: { cwd: workspace } }) },
  })
  const path = join(workspace, 'a.md')
  const first = annotation()
  const edited = { ...first, body: '改过的同一批注' }
  const second = { ...annotation(), id: 'a2', seq: 2 }
  const pending: PendingReview = {
    roundId: 'r1',
    draftAttachmentId: 'd-r1',
    fileName: 'a-review-r1.md',
    fileBytes: 10,
    fileHash: 'f'.repeat(64),
    sourceHash: 's'.repeat(64),
    annotations: [first],
    feedback: '反馈',
    createdAt: '2026-11-17T00:00:00.000Z',
  }
  try {
    await service.reviewPrepare('s1', path, 'r1', '原文')
    await service.annotationSave('s1', path, [edited, second], pending)
    assert.deepEqual(await service.reviewCommit('s1', path, 'r1', ''), { roundId: 'r1', committed: true, snapshotMissing: false })
    const draft = await service.annotationLoad('s1', path)
    assert.deepEqual(draft?.annotations.map(item => item.id), ['a1', 'a2'])
    assert.equal(draft?.annotations[0]?.body, '改过的同一批注')
    assert.equal(draft?.pending, undefined)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('reviewCommit 在 pending 快照缺失时仍提交并标 snapshotMissing', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'am-review-missing-'))
  const table = createMemoryAnnotationTable()
  const service = serviceWith({
    storageDomain: { open: async () => ({ table: () => table }) },
    sessions: { get: () => ({ header: { cwd: workspace } }) },
  })
  const path = join(workspace, 'a.md')
  const pending: PendingReview = {
    roundId: 'r9',
    draftAttachmentId: 'd-r9',
    fileName: 'a-review-r9.md',
    fileBytes: 10,
    fileHash: 'f'.repeat(64),
    sourceHash: 's'.repeat(64),
    annotations: [annotation()],
    feedback: '反馈',
    createdAt: '2026-11-17T00:00:00.000Z',
  }
  try {
    await service.annotationSave('s1', path, [annotation()], pending)
    const committed = await service.reviewCommit('s1', path, 'r9', '')
    assert.deepEqual(committed, { roundId: 'r9', committed: true, snapshotMissing: true })
    assert.equal(await service.annotationLoad('s1', path), null)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('模型失败以 Remote 错误码返回', async () => {
  const { llm } = fakeLlm({ chunks: ['半截'], finish: { kind: 'error', failure: { message: 'rate limited' } } })
  const service = serviceWith({ llm })
  await assert.rejects(
    service.translate('session-1', 'a.md', SOURCE, 'zh', 'p', 'm', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/model-failed',
  )
})

function annotation(): Annotation {
  return {
    id: 'a1',
    seq: 1,
    kind: 'text',
    body: '意见',
    quote: '原文',
    prefix: '',
    suffix: '',
    startOffset: 0,
    blockStartId: 'paragraph-1',
    blockEndId: 'paragraph-1',
    blockSignature: '',
    section: '',
    lineStart: 1,
    lineEnd: 1,
    createdAt: '2026-11-17T00:00:00.000Z',
  }
}

test('批注方法走 storageDomain，非法路径映射成 Remote 错误码', async () => {
  const table = createMemoryAnnotationTable()
  const service = serviceWith({
    storageDomain: { open: async () => ({ table: () => table }) },
  })

  const saved = await service.annotationSave('s1', '/w/a.md', [annotation()], null)
  assert.deepEqual(saved, { status: 'saved', durable: true })
  assert.equal((await service.annotationLoad('s1', '/w/a.md'))?.annotations[0]?.body, '意见')
  assert.deepEqual(await service.annotationPending('s1'), [])
  assert.deepEqual(await service.annotationClear('s1', '/w/a.md'), {})
  assert.equal(await service.annotationLoad('s1', '/w/a.md'), null)

  await assert.rejects(
    service.annotationSave('s1', 'relative.md', [annotation()], null),
    (error: unknown) => codeOf(error) === 'activeMarkdown/invalid-request',
  )
})
