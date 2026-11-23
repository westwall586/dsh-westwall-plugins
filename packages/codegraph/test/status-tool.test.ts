/**
 * `codegraph_status` 是模型唯一能碰的 CodeGraph 入口，且只读：它报告状态，
 * 不开启、不关闭、不写仓库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerTools } from '../src/tools.ts'
import { createMemoryStore } from '../src/state.ts'

function capturingContext(directory = '/repo/sub'): { ctx: Context; tools: ToolDefinition[] } {
  const tools: ToolDefinition[] = []
  const ctx = {
    tools: { register: (definition: ToolDefinition) => { tools.push(definition); return () => {} } },
    workingDirectory: { get: () => directory },
  } as unknown as Context
  return { ctx, tools }
}

const agent = { session: { id: 'session-1' } } as unknown as Agent

async function run(tool: ToolDefinition): Promise<Record<string, unknown>> {
  const output = tool.output as { render: (args: unknown, value: unknown) => Array<{ type: string; text?: string }> }
  const value = await (tool.execute as (args: unknown, exec: unknown) => Promise<Record<string, unknown>>)({}, { agent })
  const blocks = output.render({}, value)
  assert.equal(blocks[0]?.type, 'text')
  return value
}

test('status tool says nothing is recorded yet', async () => {
  const { ctx, tools } = capturingContext()
  registerTools(ctx, createMemoryStore(), { size: 0 } as never)
  const value = await run(tools[0]!)
  assert.equal(value.workspaces?.length ?? 0, 0)
  assert.match(String(value.text), /No workspace has CodeGraph recorded/)
  assert.equal(value.durable, false)
})

test('status tool reports each workspace, its state and its reason', async () => {
  const { ctx, tools } = capturingContext()
  const store = createMemoryStore()
  await store.put({ path: '/repo', enabled: true, state: { kind: 'failed', reason: 'init exited 1' }, updatedAt: 2 })
  await store.put({ path: '/other', enabled: false, state: { kind: 'disabled' }, updatedAt: 1 })
  registerTools(ctx, store, { size: 2 } as never)
  const value = await run(tools[0]!)

  const workspaces = value.workspaces as Array<Record<string, unknown>>
  assert.deepEqual(workspaces.map(w => [w.path, w.state, w.reason]), [
    ['/repo', 'failed', 'init exited 1'],
    ['/other', 'disabled', undefined],
  ])
  assert.equal(value.mountedSessions, 2)
  assert.equal(value.currentRoot, '/repo/sub')
  assert.match(String(value.text), /init exited 1/)
})
