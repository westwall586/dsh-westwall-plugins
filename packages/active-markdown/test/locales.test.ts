import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { en, zh } from '../client/src/locales.ts'

const CLIENT = new URL('../client/src/', import.meta.url)
const SOURCES = ['body.tsx', 'main.tsx', 'menus.ts', 'settings.tsx', 'translate/ask.tsx']

/** Every key the Body and the menu ask the locale service for. */
function keysUsed(): Set<string> {
  const keys = new Set<string>()
  for (const file of SOURCES) {
    const source = readFileSync(new URL(file, CLIENT), 'utf8')
    for (const match of source.matchAll(/\bt\('([^']+)'/g)) keys.add(match[1]!)
  }
  return keys
}

test('中文与英文的文案键集一致', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
})

test('界面读取的每个 key 中英文都有文案', () => {
  const used = keysUsed()
  assert.ok(used.size > 0, '至少扫到一个 t(...) 调用')
  for (const key of used) {
    assert.equal(typeof zh[key], 'string', `中文缺少 ${key}`)
    assert.equal(typeof en[key], 'string', `英文缺少 ${key}`)
  }
})
