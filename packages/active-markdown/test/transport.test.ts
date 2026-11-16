import test from 'node:test'
import assert from 'node:assert/strict'

import ActiveMarkdown from '../src/index.ts'
import { CLIENT_CONTRIBUTION, DESCRIPTORS, createBridge, type Namespace } from '../client/src/host.ts'

const DESCRIPTOR_KEY = '@deepseek-ai/dsh-typert-protocol/remote-methods'

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

test('每个声明的方法都是原型实例方法，参数名与线名一致', () => {
  for (const [name, expected] of Object.entries(WIRE_PARAMETERS)) {
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
  }
})

type Call = { method: string, args: unknown[] }

interface Answers {
  /** 'missing' omits the value field, the way a null result may arrive. */
  cacheGet?: 'hit' | 'missing'
  load?: 'hit' | 'missing'
}

const META = { promptVersion: 'am.translate.v1', lang: 'zh', provider: 'p', model: 'm' }

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
