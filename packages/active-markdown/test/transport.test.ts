import test from 'node:test'
import assert from 'node:assert/strict'

import ActiveMarkdown from '../src/index.ts'
import { CLIENT_CONTRIBUTION, DESCRIPTORS } from '../client/src/host.ts'

const DESCRIPTOR_KEY = '@deepseek-ai/dsh-typert-protocol/remote-methods'

const WIRE_PARAMETERS: Record<string, string[]> = {
  describe: [],
  translate: ['sessionId', 'path', 'text', 'lang', 'provider', 'model', 'promptVersion', 'extraInstruction'],
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

test('Host 描述符恰好声明 describe 与 translate 两个直连方法', () => {
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
  assert.deepEqual(DESCRIPTORS.map(descriptor => descriptor.method), Object.keys(WIRE_PARAMETERS))

  for (const descriptor of DESCRIPTORS) {
    assert.equal(descriptor.version, 1)
    assert.equal(descriptor.id, `dsh-active-markdown/activeMarkdown.${descriptor.method}`)
    assert.equal(descriptor.service, 'activeMarkdown')
    assert.equal(descriptor.namespace, 'activeMarkdown')
    assert.deepEqual(descriptor.invocation, { kind: 'direct' })
    assert.deepEqual(
      descriptor.parameters.map(parameter => parameter.wire),
      WIRE_PARAMETERS[descriptor.method],
      `${descriptor.method} 的线参数名与 Host 一致`,
    )
    for (const parameter of descriptor.parameters) {
      assert.equal(parameter.name, parameter.wire)
      assert.equal(parameter.source, 'json')
      assert.equal(parameter.codec, descriptor.result)
    }
  }
})
