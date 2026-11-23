/**
 * 首调判定：CodeGraph 查不到符号时不报错，只返回本项目里的近似结果，
 * 所以"有正文"不能算通过，必须命中预期符号的定义分节。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { answerProvesProject, filesInAnswer } from '../src/probe-judge.ts'

const HIT = [
  '**Exploration: alphaOnlySymbol**',
  '',
  'Found 2 symbols across 1 file.',
  '',
  '**`a.js`** — alphaOnlySymbol(function), sharedUtility(function)',
  '',
  '```javascript',
  '1\texport function alphaOnlySymbol(x){ return x + 1 }',
  '```',
].join('\n')

const MISS = [
  '**Exploration: alphaOnlySymbol**',
  '',
  'Found 2 symbols across 1 file.',
  '',
  '**`b.js`** — betaOnlySymbol(function), sharedUtility(function)',
].join('\n')

test('reads files from definition sections only', () => {
  assert.deepEqual(filesInAnswer(HIT), ['a.js'])
  assert.deepEqual(filesInAnswer('**`src/deep/path/x.ts`** — thing(type)'), ['src/deep/path/x.ts'])
  assert.deepEqual(filesInAnswer('Found 2 symbols'), [])
})

test('a hit needs both the symbol and its definition section', () => {
  assert.deepEqual(answerProvesProject(HIT, 'alphaOnlySymbol'), { ok: true, files: ['a.js'] })
  assert.deepEqual(answerProvesProject(MISS, 'alphaOnlySymbol'), { ok: false, files: [] })
})

test('a section without the symbol is not a hit', () => {
  assert.equal(answerProvesProject('**`a.js`** — other(function)', 'alphaOnlySymbol').ok, false)
})
