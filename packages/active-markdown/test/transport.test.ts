import test from 'node:test'
import assert from 'node:assert/strict'

import ActiveMarkdown from '../src/index.ts'
import { CLIENT_CONTRIBUTION, DESCRIPTORS, createBridge, type Namespace } from '../client/src/host.ts'
import type { AnnotationDraft } from '../client/src/annotate/model.ts'

const DESCRIPTOR_KEY = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/** Descriptor parameters: business fields only. The cancel signal never enters the wire. */
const WIRE_PARAMETERS: Record<string, string[]> = {
  describe: [],
  translate: [
    'sessionId', 'path', 'text', 'lang', 'provider', 'model', 'promptVersion', 'extraInstruction',
    'translateComments',
  ],
  cacheGet: ['text', 'lang', 'provider', 'model', 'promptVersion', 'extraInstruction', 'translateComments'],
  cachePut: [
    'text', 'translated', 'lang', 'provider', 'model', 'promptVersion', 'extraInstruction',
    'aligned', 'sourceLines', 'translatedLines', 'translateComments',
  ],
  translationSave: [
    'sessionId', 'path', 'text', 'translated', 'lang', 'provider', 'model', 'promptVersion',
    'extraInstruction', 'aligned',
  ],
  translationLoad: ['sessionId', 'path', 'lang'],
  annotationLoad: ['sessionId', 'path'],
  annotationSave: ['sessionId', 'path', 'annotations', 'pending'],
  annotationClear: ['sessionId', 'path'],
  annotationPending: ['sessionId'],
}

/** Host method parameters: the wire names, plus the Gateway-injected signal on translate. */
const HOST_PARAMETERS: Record<string, string[]> = {
  ...WIRE_PARAMETERS,
  translate: [...WIRE_PARAMETERS.translate, 'signal'],
}

function parameterNames(method: Function): string[] {
  const text = Function.prototype.toString.call(method)
  const open = text.indexOf('(')
  const close = text.indexOf(')', open)
  return text
    .slice(open + 1, close)
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
}

test('Host 描述符声明全部直连方法', () => {
  const property = Object.getOwnPropertyDescriptor(ActiveMarkdown.prototype, DESCRIPTOR_KEY)
  assert.ok(property, '描述符挂在原型上')
  assert.equal(property.configurable, true)
  assert.equal(property.enumerable, false)
  assert.equal(property.writable, false)

  const descriptor = property.value as {
    version: number
    methods: Array<{ method: string, invocation: { kind: string } }>
  }
  assert.ok(Object.isFrozen(descriptor), '描述符运行时不可改')
  assert.equal(descriptor.version, 1)
  assert.deepEqual(descriptor.methods.map(method => method.method), Object.keys(WIRE_PARAMETERS))
  for (const method of descriptor.methods) {
    assert.deepEqual(method.invocation, { kind: 'direct' })
  }
})

test('每个声明的方法都是原型实例方法，参数名与声明顺序一致', () => {
  for (const [name, expected] of Object.entries(HOST_PARAMETERS)) {
    const method = (ActiveMarkdown.prototype as unknown as Record<string, unknown>)[name]
    assert.equal(typeof method, 'function', `${name} 是实例方法`)
    assert.ok(Object.hasOwn(ActiveMarkdown.prototype, name), `${name} 声明在原型上`)
    assert.deepEqual(parameterNames(method as Function), expected, `${name} 的线参数名`)
    assert.equal((method as Function).length, expected.length, `${name} 的参数个数`)
  }
})

test('客户端描述符与 Host 的线参数逐项一致', () => {
  assert.equal(CLIENT_CONTRIBUTION.package, 'active-markdown')
  assert.equal(CLIENT_CONTRIBUTION.descriptors, DESCRIPTORS)
  // 客户端要声明 Host 的全部方法，并且按 Host 的方法顺序排列。
  assert.deepEqual(DESCRIPTORS.map(descriptor => descriptor.method), Object.keys(WIRE_PARAMETERS))

  for (const descriptor of DESCRIPTORS) {
    const wire = WIRE_PARAMETERS[descriptor.method]
    assert.ok(wire, `${descriptor.method} 在 Host 上存在`)
    assert.equal(descriptor.version, 1)
    assert.equal(descriptor.id, `dsh-active-markdown/activeMarkdown.${descriptor.method}`)
    assert.equal(descriptor.service, 'activeMarkdown')
    assert.equal(descriptor.namespace, 'activeMarkdown')
    assert.deepEqual(descriptor.invocation, { kind: 'direct' })
    assert.deepEqual(
      descriptor.parameters.map(parameter => parameter.wire),
      wire,
      `${descriptor.method} 的线参数名与 Host 一致`,
    )
    for (const parameter of descriptor.parameters) {
      assert.equal(parameter.name, parameter.wire)
      assert.equal(parameter.source, 'json')
      assert.equal(parameter.codec, descriptor.result)
    }
    const cancellation = (descriptor as { cancellation?: unknown }).cancellation
    if (descriptor.method === 'translate') {
      assert.deepEqual(cancellation, { parameter: 'signal' })
    } else {
      assert.equal(cancellation, undefined, `${descriptor.method} 不声明取消`)
    }
  }
})

type Call = { method: string, args: unknown[] }

interface Answers {
  /** 'missing' omits the value field, the way a null result may arrive. */
  cacheGet?: 'hit' | 'missing'
  load?: 'hit' | 'missing'
  annotationLoad?: 'hit' | 'missing'
}

const META = { promptVersion: 'am.translate.v1', lang: 'zh', provider: 'p', model: 'm' }

const DRAFT: AnnotationDraft = {
  sessionId: 's1',
  path: '/w/a.md',
  annotations: [{
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
    createdAt: '2026-01-01T00:00:00.000Z',
  }],
  nextSeq: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function recordingNamespace(answers: Answers = {}): { namespace: Namespace, calls: Call[] } {
  const calls: Call[] = []
  const record = (method: string, args: unknown[]): void => { calls.push({ method, args }) }
  const stored = { text: '译文', meta: META, stale: true }
  const namespace: Namespace = {
    async describe() {
      return {
        ok: true,
        value: {
          promptVersion: 'am.translate.v1',
          settings: { lang: 'zh', model: null, translateComments: true },
          languages: [{ code: 'zh', label: '简体中文' }],
        },
      }
    },
    async translate(...args: unknown[]) {
      record('translate', args)
      return { ok: true, value: { text: '译文' } }
    },
    async cacheGet(...args: unknown[]) {
      record('cacheGet', args)
      return answers.cacheGet === 'hit' ? { ok: true, value: stored } : { ok: true }
    },
    async cachePut(...args: unknown[]) {
      record('cachePut', args)
      return { ok: true, value: {} }
    },
    async translationSave(...args: unknown[]) {
      record('translationSave', args)
      return { ok: true, value: { file: '.dsh-active-markdown/translate/zh/a.md', meta: META } }
    },
    async translationLoad(...args: unknown[]) {
      record('translationLoad', args)
      return answers.load === 'hit' ? { ok: true, value: stored } : { ok: true }
    },
    async annotationLoad(...args: unknown[]) {
      record('annotationLoad', args)
      return answers.annotationLoad === 'hit' ? { ok: true, value: DRAFT } : { ok: true }
    },
    async annotationSave(...args: unknown[]) {
      record('annotationSave', args)
      return { ok: true, value: { status: 'saved', durable: true } }
    },
    async annotationClear(...args: unknown[]) {
      record('annotationClear', args)
      return { ok: true, value: {} }
    },
    async annotationPending(...args: unknown[]) {
      record('annotationPending', args)
      return { ok: true, value: [] }
    },
  }
  return { namespace, calls }
}

test('桥接方法按 Host 的线序传参', async () => {
  const { namespace, calls } = recordingNamespace()
  const bridge = createBridge(namespace)
  const described = await bridge.describe()
  assert.equal(described.promptVersion, 'am.translate.v1')
  assert.equal(described.settings.lang, 'zh')

  await bridge.translate({
    sessionId: 's1', path: 'a.md', text: '原文', lang: 'zh', provider: 'p', model: 'm', promptVersion: 'v1',
    translateComments: true,
  })
  assert.deepEqual(calls.at(-1), {
    method: 'translate',
    args: ['s1', 'a.md', '原文', 'zh', 'p', 'm', 'v1', '', true],
  })

  await bridge.cacheGet({ text: '原文', lang: 'zh', promptVersion: 'v1', translateComments: false })
  assert.deepEqual(calls.at(-1), { method: 'cacheGet', args: ['原文', 'zh', '', '', 'v1', '', false] })

  await bridge.cachePut({
    text: '原文', translated: '译文', lang: 'zh', provider: 'p', model: 'm', promptVersion: 'v1',
    translateComments: true, aligned: false, sourceLines: 4, translatedLines: 3,
  })
  assert.deepEqual(calls.at(-1), {
    method: 'cachePut',
    args: ['原文', '译文', 'zh', 'p', 'm', 'v1', '', false, 4, 3, true],
  })

  await bridge.save({ sessionId: 's1', path: 'a.md', text: '原文', translated: '译文', lang: 'zh', promptVersion: 'v1', aligned: false })
  assert.deepEqual(calls.at(-1), {
    method: 'translationSave',
    args: ['s1', 'a.md', '原文', '译文', 'zh', '', '', 'v1', '', false],
  })

  await bridge.load({ sessionId: 's1', path: 'a.md', lang: 'zh' })
  assert.deepEqual(calls.at(-1), { method: 'translationLoad', args: ['s1', 'a.md', 'zh'] })
})

test('批注桥接按 Host 的线序传参，空结果按 null 返回', async () => {
  const hit = recordingNamespace({ annotationLoad: 'hit' })
  const bridge = createBridge(hit.namespace)
  const draft = await bridge.annotationLoad({ sessionId: 's1', path: '/w/a.md' })
  assert.equal(draft?.annotations[0]?.body, '意见')
  assert.deepEqual(hit.calls.at(-1), { method: 'annotationLoad', args: ['s1', '/w/a.md'] })

  await bridge.annotationSave({
    sessionId: 's1',
    path: '/w/a.md',
    annotations: DRAFT.annotations,
    pending: null,
  })
  assert.deepEqual(hit.calls.at(-1), {
    method: 'annotationSave',
    args: ['s1', '/w/a.md', DRAFT.annotations, null],
  })

  await bridge.annotationClear({ sessionId: 's1', path: '/w/a.md' })
  assert.deepEqual(hit.calls.at(-1), { method: 'annotationClear', args: ['s1', '/w/a.md'] })

  const pending = await bridge.annotationPending('s1')
  assert.deepEqual(pending, [])
  assert.deepEqual(hit.calls.at(-1), { method: 'annotationPending', args: ['s1'] })

  const empty = createBridge(recordingNamespace().namespace)
  assert.equal(await empty.annotationLoad({ sessionId: 's1', path: '/w/a.md' }), null)
})

test('取消信号只在提供时追加到 translate 参数末尾', async () => {
  const { namespace, calls } = recordingNamespace()
  const bridge = createBridge(namespace)
  const controller = new AbortController()

  await bridge.translate({
    sessionId: 's1', path: 'a.md', text: '原文', lang: 'zh', promptVersion: 'v1', translateComments: true,
  }, controller.signal)
  assert.deepEqual(calls.at(-1), {
    method: 'translate',
    args: ['s1', 'a.md', '原文', 'zh', '', '', 'v1', '', true, controller.signal],
  })

  await bridge.translate({
    sessionId: 's1', path: 'a.md', text: '原文', lang: 'zh', promptVersion: 'v1', translateComments: true,
  })
  assert.equal(calls.at(-1)!.args.length, 9)
})

test('补充要求随本次运行上线，缺省的模型与要求以空串上线', async () => {
  const { namespace, calls } = recordingNamespace()
  const bridge = createBridge(namespace)

  await bridge.translate({
    sessionId: 's1', path: 'a.md', text: '原文', lang: 'zh', promptVersion: 'v1',
    extraInstruction: '术语保留英文', translateComments: false,
  })
  assert.deepEqual(calls.at(-1), {
    method: 'translate',
    args: ['s1', 'a.md', '原文', 'zh', '', '', 'v1', '术语保留英文', false],
  })

  await bridge.cacheGet({
    text: '原文', lang: 'zh', promptVersion: 'v1', extraInstruction: '术语保留英文', translateComments: true,
  })
  assert.deepEqual(calls.at(-1), {
    method: 'cacheGet',
    args: ['原文', 'zh', '', '', 'v1', '术语保留英文', true],
  })
})

test('缓存与保存文件的命中值原样返回，空结果按 null 返回', async () => {
  const hit = createBridge(recordingNamespace({ cacheGet: 'hit', load: 'hit' }).namespace)
  assert.equal((await hit.cacheGet({ text: '原文', lang: 'zh', promptVersion: 'v1', translateComments: true }))?.text, '译文')
  assert.equal((await hit.load({ sessionId: 's1', path: 'a.md', lang: 'zh' }))?.stale, true)

  const empty = createBridge(recordingNamespace().namespace)
  assert.equal(await empty.cacheGet({ text: '原文', lang: 'zh', promptVersion: 'v1', translateComments: true }), null)
  assert.equal(await empty.load({ sessionId: 's1', path: 'a.md', lang: 'zh' }), null)
})
