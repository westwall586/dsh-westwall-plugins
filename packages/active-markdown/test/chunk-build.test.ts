import test from 'node:test'
import assert from 'node:assert/strict'

import { bundleModule, wrapChunk, wrapEntry } from '../tools/client-bundle.mjs'

interface Registration {
  chunk?: string
  factory(require: unknown): Record<string, unknown>
}

/** The `window` the wrapped programs expect, plus what the stub loader observed. */
interface Loader {
  window: { __ModuleLoader__: { load(registration: Registration): void } }
  registrations: Map<string, Registration>
  asyncCalls: string[]
  fail: { value: boolean }
}

/** One wrapped entry and chunk, as the fixture files produce them. */
const entryProgram = await bundleModule('test/fixtures/chunk-entry.ts', 'FixtureEntry')
const chunkProgram = await bundleModule('test/fixtures/chunk-demo.ts', 'FixtureChunk')

/** A stub page scope whose loader resolves chunks from the registrations it received. */
function loaderFor(): Loader {
  const registrations = new Map<string, Registration>()
  const calls: string[] = []
  const loader: Loader = {
    window: { __ModuleLoader__: { load(registration) { registrations.set(registration.chunk ?? 'entry', registration) } } },
    registrations,
    asyncCalls: calls,
    fail: { value: false },
  }
  return loader
}

/**
 * Build the entry and chunk into one page scope and return the entry's API.
 * @param loader - the stub scope to execute both programs in.
 * @returns the entry program's default export.
 */
async function boot(loader: Loader): Promise<Record<string, unknown>> {
  const entry = wrapEntry(entryProgram, 'FixtureEntry')
  const chunk = wrapChunk(chunkProgram, 'FixtureChunk', 'client.demo.js')
  new Function('window', entry).call({ window: loader.window }, loader.window)
  new Function('window', chunk).call({ window: loader.window }, loader.window)
  const registration = loader.registrations.get('entry')
  assert.ok(registration !== undefined, 'the entry registers itself')
  const require = {
    async(specifier: string): Promise<Record<string, unknown>> {
      loader.asyncCalls.push(specifier)
      if (loader.fail.value) throw new Error('chunk transport failed')
      const registered = loader.registrations.get(specifier.replace('./', ''))
      assert.ok(registered !== undefined, `chunk ${specifier} is registered`)
      return registered.factory(require)
    },
  }
  return registration.factory(require)
}

test('the entry wrapper exposes the loader handle and carries no chunk tag', () => {
  const text = wrapEntry('var X = { default: 1 };', 'X')
  assert.match(text, /\(function \(__dshRequire\) \{/)
  assert.doesNotMatch(text, /chunk:/)
})

test('the wrapper keeps the bundle strict-mode directive first in its scope', () => {
  const text = wrapEntry('"use strict";var X = { default: 1 };', 'X')
  assert.match(text, /\(function \(__dshRequire\) \{\n"use strict";/)
})

test('a chunk wrapper tags its file name', () => {
  const text = wrapChunk('var X = { default: 1 };', 'X', 'client.demo.js')
  assert.match(text, /chunk: "client\.demo\.js"/)
})

test('a wrapped entry loads a wrapped chunk and gets its exports', async () => {
  const loader = loaderFor()
  const api = await boot(loader) as { answer(): Promise<unknown> }
  assert.equal(await api.answer(), 42)
  assert.deepEqual(loader.asyncCalls, ['./client.demo.js'])
})

test('concurrent loads share one request', async () => {
  const loader = loaderFor()
  const api = await boot(loader) as { answer(): Promise<unknown> }
  const results = await Promise.all([api.answer(), api.answer(), api.answer()])
  assert.deepEqual(results, [42, 42, 42])
  assert.deepEqual(loader.asyncCalls, ['./client.demo.js'])
})

test('a failed load is retried on the next request', async () => {
  const loader = loaderFor()
  loader.fail.value = true
  const api = await boot(loader) as { answer(): Promise<unknown> }
  await assert.rejects(api.answer(), /chunk transport failed/)
  loader.fail.value = false
  assert.equal(await api.answer(), 42)
  assert.deepEqual(loader.asyncCalls, ['./client.demo.js', './client.demo.js'])
})
