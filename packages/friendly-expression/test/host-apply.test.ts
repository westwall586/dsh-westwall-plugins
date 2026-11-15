import test from 'node:test'
import assert from 'node:assert/strict'

import { apply } from '../src/index.ts'

type Listener = (payload: never) => void

interface StoredPrompt {
  prompt: string
  capturedAt: number
}

interface SectionCall {
  name: string
  order: number
  text: string
  disposed: boolean
}

function createHarness(options: {
  web?: boolean
  agents?: FakeAgent[]
  records?: Record<string, StoredPrompt>
  putFails?: boolean
} = {}) {
  const web = options.web ?? true
  const stored = new Map<string, StoredPrompt>(Object.entries(options.records ?? {}))
  const puts: [string, StoredPrompt][] = []
  const listeners = new Map<string, Listener[]>()
  const disposers: (() => void)[] = []
  const agents = options.agents ?? []
  const ctx = {
    get(name: string) {
      if (name === 'webApp' && web) return {}
      if (name === 'storageDomain') {
        return {
          open: async () => ({
            table: () => ({
              get: (key: string) => stored.get(key),
              put: async (key: string, value: StoredPrompt) => {
                puts.push([key, value])
                if (options.putFails === true) throw new Error('disk full')
                stored.set(key, value)
              },
            }),
            close: async () => {},
          }),
        }
      }
      if (name === 'agents') return { list: () => agents }
      return undefined
    },
    on(name: string, listener: Listener) {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => {}
    },
    effect(run: () => (() => void) | void) {
      const disposer = run()
      if (typeof disposer === 'function') disposers.push(disposer)
      return () => {}
    },
    emit(name: string, payload: unknown) {
      for (const listener of listeners.get(name) ?? []) listener(payload as never)
    },
  }
  return { ctx, stored, puts, disposers, emit: ctx.emit }
}

interface FakeAgent {
  session: {
    id: string
    header: { origin?: 'subagent'; isSeeded: boolean }
    surface: { nodes: readonly unknown[] }
  }
  ctx: {
    effect(run: () => (() => void) | void): () => void
    systemPrompt: { section(spec: { name: string; order: number; text: string }): () => void }
  }
  sections: SectionCall[]
}

function createAgent(id: string, options: {
  origin?: 'subagent'
  seeded?: boolean
  messages?: number
} = {}): FakeAgent {
  const sections: SectionCall[] = []
  return {
    session: {
      id,
      header: {
        ...options.origin === undefined ? {} : { origin: options.origin },
        isSeeded: options.seeded ?? false,
      },
      surface: { nodes: Array.from({ length: options.messages ?? 0 }, () => ({})) },
    },
    ctx: {
      effect(run) { return run() ?? (() => {}) },
      systemPrompt: {
        section(spec) {
          const call = { ...spec, disposed: false }
          sections.push(call)
          return () => { call.disposed = true }
        },
      },
    },
    sections,
  }
}

const config = { stylePrompt: { get: () => '当前提示词' } }

const PREFIX = 'When talking with the user, follow these principles:'

function sectionText(body: string): string {
  return `${PREFIX}\n${body}`
}

test('新建 Web 会话捕获完整 section 并注册 scoped section', async () => {
  const harness = createHarness()
  await apply(harness.ctx as never, config)
  const agent = createAgent('s1')
  harness.emit('agent/created', { agent, source: 'startup' })
  assert.equal(agent.sections.length, 1)
  assert.equal(agent.sections[0].name, 'westwall:friendly-expression')
  assert.equal(agent.sections[0].order, 9500)
  assert.equal(agent.sections[0].text, sectionText('当前提示词'))
  assert.equal(harness.stored.get('s1')?.prompt, agent.sections[0].text)
})

test('旧版仅正文快照按原样注册，不加前缀', async () => {
  const harness = createHarness({ records: { s2: { prompt: '旧提示词', capturedAt: 1 } } })
  await apply(harness.ctx as never, config)
  const agent = createAgent('s2', { messages: 3 })
  harness.emit('agent/created', { agent, source: 'resume' })
  assert.equal(agent.sections[0]?.text, '旧提示词')
  assert.equal(harness.puts.length, 0)
})

test('已冻结的完整 section 恢复时不再重复加前缀', async () => {
  const harness = createHarness({ records: { s14: { prompt: sectionText('旧正文'), capturedAt: 1 } } })
  await apply(harness.ctx as never, config)
  const agent = createAgent('s14', { messages: 2 })
  harness.emit('agent/created', { agent, source: 'resume' })
  assert.equal(agent.sections[0]?.text, sectionText('旧正文'))
  assert.equal(harness.puts.length, 0)
})

test('空正文的新会话不注册 section，快照也为空', async () => {
  const harness = createHarness()
  await apply(harness.ctx as never, { stylePrompt: { get: () => '' } })
  const agent = createAgent('s15')
  harness.emit('agent/created', { agent, source: 'startup' })
  assert.equal(agent.sections.length, 0)
  assert.equal(harness.puts.length, 1)
  assert.equal(harness.puts[0][1].prompt, '')
})

test('没有快照的恢复会话不注册也不捕获', async () => {
  const harness = createHarness()
  await apply(harness.ctx as never, config)
  const agent = createAgent('s3', { messages: 2 })
  harness.emit('agent/created', { agent, source: 'resume' })
  assert.equal(agent.sections.length, 0)
  assert.equal(harness.puts.length, 0)
})

test('子代理不注册 section', async () => {
  const harness = createHarness({ records: { s4: { prompt: '不该注入', capturedAt: 1 } } })
  await apply(harness.ctx as never, config)
  const agent = createAgent('s4', { origin: 'subagent' })
  harness.emit('agent/created', { agent, source: 'startup' })
  assert.equal(agent.sections.length, 0)
})

test('没有 Web 渲染面时不捕获也不注册', async () => {
  const harness = createHarness({ web: false })
  await apply(harness.ctx as never, config)
  const agent = createAgent('s5')
  harness.emit('agent/created', { agent, source: 'startup' })
  assert.equal(agent.sections.length, 0)
  assert.equal(harness.puts.length, 0)
})

test('插件加载时只恢复已有快照的活跃会话', async () => {
  const withSnapshot = createAgent('s6')
  const withoutSnapshot = createAgent('s7')
  const harness = createHarness({
    agents: [withSnapshot, withoutSnapshot],
    records: { s6: { prompt: '恢复提示词', capturedAt: 1 } },
  })
  await apply(harness.ctx as never, config)
  assert.equal(withSnapshot.sections[0]?.text, '恢复提示词')
  assert.equal(withoutSnapshot.sections.length, 0)
  assert.equal(harness.puts.length, 0)
})

test('空快照不注册 section', async () => {
  const harness = createHarness({ records: { s8: { prompt: '', capturedAt: 1 } } })
  await apply(harness.ctx as never, config)
  const agent = createAgent('s8')
  harness.emit('agent/created', { agent, source: 'resume' })
  assert.equal(agent.sections.length, 0)
})

test('插件卸载时释放已注册的 section', async () => {
  const harness = createHarness()
  await apply(harness.ctx as never, config)
  const agent = createAgent('s9')
  harness.emit('agent/created', { agent, source: 'startup' })
  for (const dispose of harness.disposers) dispose()
  assert.equal(agent.sections[0].disposed, true)
})

test('配置修改后已有会话仍使用快照，不被新值覆盖', async () => {
  let current = '第一版提示词'
  const harness = createHarness()
  await apply(harness.ctx as never, { stylePrompt: { get: () => current } })

  const first = createAgent('s10')
  harness.emit('agent/created', { agent: first, source: 'startup' })
  assert.equal(first.sections[0]?.text, sectionText('第一版提示词'))

  current = '第二版提示词'
  const resumed = createAgent('s10', { messages: 2 })
  harness.emit('agent/created', { agent: resumed, source: 'resume' })
  assert.equal(first.sections[0]?.disposed, true)
  assert.equal(resumed.sections[0]?.text, sectionText('第一版提示词'))
  assert.equal(harness.puts.length, 1)
})

test('快照写入失败时仍注册本次运行的 section', async () => {
  const harness = createHarness({ putFails: true })
  await apply(harness.ctx as never, config)
  const agent = createAgent('s11')
  harness.emit('agent/created', { agent, source: 'startup' })
  assert.equal(agent.sections[0]?.text, sectionText('当前提示词'))
  assert.equal(harness.puts.length, 1)
})

test('插件加载时跳过子代理的已有快照', async () => {
  const subagent = createAgent('s12', { origin: 'subagent' })
  const harness = createHarness({
    agents: [subagent],
    records: { s12: { prompt: '不该注入', capturedAt: 1 } },
  })
  await apply(harness.ctx as never, config)
  assert.equal(subagent.sections.length, 0)
})

test('同一会话被新 Agent 替换时重新注册 section', async () => {
  const harness = createHarness()
  await apply(harness.ctx as never, config)
  const first = createAgent('s13')
  harness.emit('agent/created', { agent: first, source: 'startup' })
  const replacement = createAgent('s13', { messages: 1 })
  harness.emit('agent/created', { agent: replacement, source: 'compact' })
  assert.equal(first.sections[0]?.disposed, true)
  assert.equal(replacement.sections[0]?.text, sectionText('当前提示词'))
})
