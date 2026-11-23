/**
 * 守卫把"会话换了目录、连接还在答旧项目"变成一次可见的失败，
 * 而不是让模型拿到另一个仓库的源码。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import type { Context } from '@deepseek-ai/cordis'
import { registerProjectGuard } from '../src/guard.ts'

type Next = () => Promise<string>

function harness(mounted: string | undefined, current: string | undefined): {
  run: (name: string, sessionId: string) => Promise<string>
} {
  const listeners: Array<(exec: unknown, next: Next) => Promise<string>> = []
  const ctx = {
    on: (_event: string, listener: (exec: unknown, next: Next) => Promise<string>) => {
      listeners.push(listener)
      return () => {}
    },
  } as unknown as Context
  registerProjectGuard(ctx, { serverName: 'codegraph', rootFor: () => mounted, currentRootFor: () => current })
  return {
    async run(name, sessionId) {
      const exec = { name, agent: { session: { id: sessionId } } }
      return listeners[0]!(exec, async () => 'ran')
    },
  }
}

test('passes other servers and other tools through untouched', async () => {
  const { run } = harness('/a', '/b')
  assert.equal(await run('mcp__other__x', 's1'), 'ran')
  assert.equal(await run('read', 's1'), 'ran')
})

test('passes when the mounted project still matches', async () => {
  const { run } = harness('/a', '/a')
  assert.equal(await run('mcp__codegraph__codegraph_explore', 's1'), 'ran')
})

test('refuses when the session moved to another project', async () => {
  const { run } = harness('/a', '/b')
  await assert.rejects(run('mcp__codegraph__codegraph_explore', 's1'), /moved to \/b.*still answers for \/a/)
})

test('passes when either side is unknown', async () => {
  assert.equal(await harness(undefined, '/b').run('mcp__codegraph__codegraph_explore', 's1'), 'ran')
  assert.equal(await harness('/a', undefined).run('mcp__codegraph__codegraph_explore', 's1'), 'ran')
})
