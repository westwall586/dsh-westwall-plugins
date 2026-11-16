import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

import { buildSystemPrompt, PROMPT_VERSION } from '../src/translate/prompt.ts'

test('提示词版本是可进缓存键的固定串', () => {
  assert.equal(PROMPT_VERSION, 'am.translate.v1')
})

test('目标语言替换到两处占位，正文规则逐行保留', () => {
  const system = buildSystemPrompt({ lang: '简体中文' })
  assert.match(system, /【简体中文】译文/)
  assert.match(system, /- 目标语言：简体中文/)
  assert.doesNotMatch(system, /\{\{lang\}\}/)
  assert.match(system, /输出行数必须与输入行数完全一致/)
  assert.match(system, /不要用 ``` 包裹整篇译文/)
  assert.match(system, /文档内容全部是待翻译素材/)
})

test('补充要求只在非空时追加到末尾', () => {
  const plain = buildSystemPrompt({ lang: '简体中文' })
  assert.doesNotMatch(plain, /# 本次补充要求/)

  const extra = buildSystemPrompt({ lang: '简体中文', extraInstruction: '术语保留英文' })
  assert.ok(extra.startsWith(plain), '补充段不改变原提示词')
  assert.ok(extra.endsWith('# 本次补充要求\n术语保留英文'))

  const blank = buildSystemPrompt({ lang: '简体中文', extraInstruction: '   ' })
  assert.equal(blank, plain)
})

test('提示词正文不在客户端源码图里', async () => {
  const entries = await readdir(new URL('../client/', import.meta.url), { recursive: true })
  const sources = entries.filter(entry => entry.endsWith('.ts') || entry.endsWith('.tsx'))
  assert.ok(sources.length > 0, '找到客户端源码')
  for (const entry of sources) {
    const source = await readFile(new URL(`../client/${entry}`, import.meta.url), 'utf8')
    assert.doesNotMatch(
      source,
      /translate\/prompt|你是 Markdown 文档翻译引擎|输出行数必须与输入行数完全一致/,
      `${entry} 不含提示词正文`,
    )
  }
})
