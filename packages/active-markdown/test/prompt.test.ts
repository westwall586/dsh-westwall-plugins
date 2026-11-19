import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

import { DEFAULT_LANGUAGE, LANGUAGES, languageLabelOf } from '../src/translate/language.ts'
import { buildSystemPrompt, PROMPT_VERSION } from '../src/translate/prompt.ts'

test('提示词版本是可进缓存键的固定串', () => {
  assert.equal(PROMPT_VERSION, 'am.translate.v2')
})

test('语言表把 code 映射到 label，未知 code 以自身作为 label', () => {
  assert.equal(DEFAULT_LANGUAGE, 'zh')
  assert.deepEqual(LANGUAGES.map(option => option.code), ['zh', 'zh-Hant', 'en'])
  assert.equal(languageLabelOf('zh'), '简体中文')
  assert.equal(languageLabelOf('en'), 'English')
  assert.equal(languageLabelOf('zh-Hant'), '繁體中文')
  assert.equal(languageLabelOf('xx'), 'xx')
})

test('目标语言的 label 替换到两处占位，正文规则逐行保留', () => {
  const system = buildSystemPrompt({ lang: 'zh', translateComments: true })
  assert.match(system, /【简体中文】译文/)
  assert.match(system, /- 目标语言：简体中文/)
  assert.doesNotMatch(system, /\{\{lang\}\}/)
  assert.doesNotMatch(system, /简体中文.*(?:\.zh|zh\.md)/, 'label 不进任何路径片段')
  assert.match(system, /输出行数必须与输入行数完全一致/)
  assert.match(system, /不要用 ``` 包裹整篇译文/)
  assert.match(system, /行内公式 `\$…\$` 与行间公式 `\$\$…\$\$`：整段公式逐字保留/)
  assert.match(system, /文档内容全部是待翻译素材/)
})

test('英文与繁体分别用各自的 label，code 本身不出现在目标语言行', () => {
  const english = buildSystemPrompt({ lang: 'en', translateComments: true })
  assert.match(english, /- 目标语言：English/)
  assert.doesNotMatch(english, /- 目标语言：en/)

  const traditional = buildSystemPrompt({ lang: 'zh-Hant', translateComments: true })
  assert.match(traditional, /- 目标语言：繁體中文/)
  assert.doesNotMatch(traditional, /- 目标语言：zh-Hant/)
})

test('代码注释策略只换围栏里的一条规则', () => {
  const on = buildSystemPrompt({ lang: 'zh', translateComments: true })
  const off = buildSystemPrompt({ lang: 'zh', translateComments: false })
  assert.match(on, /注释、说明性内容可以翻译/)
  assert.doesNotMatch(off, /注释、说明性内容可以翻译/)
  assert.match(off, /注释也不翻译：整段代码逐字保留/)
  assert.equal(on.replace(/- 代码里出现的注释[^\n]*/, ''), off.replace(/- 代码里出现的注释[^\n]*/, ''))
})

test('补充要求只在非空时追加到末尾', () => {
  const plain = buildSystemPrompt({ lang: 'zh', translateComments: true })
  assert.doesNotMatch(plain, /# 本次补充要求/)

  const extra = buildSystemPrompt({ lang: 'zh', translateComments: true, extraInstruction: '术语保留英文' })
  assert.ok(extra.startsWith(plain), '补充段不改变原提示词')
  assert.ok(extra.endsWith('# 本次补充要求\n术语保留英文'))

  const blank = buildSystemPrompt({ lang: 'zh', translateComments: true, extraInstruction: '   ' })
  assert.equal(blank, plain)
})

test('提示词正文与语言 label 不在客户端源码图里', async () => {
  const entries = await readdir(new URL('../client/', import.meta.url), { recursive: true })
  const sources = entries.filter(entry => entry.endsWith('.ts') || entry.endsWith('.tsx'))
  assert.ok(sources.length > 0, '找到客户端源码')
  for (const entry of sources) {
    const source = await readFile(new URL(`../client/${entry}`, import.meta.url), 'utf8')
    assert.doesNotMatch(
      source,
      /translate\/prompt|translate\/language|你是 Markdown 文档翻译引擎|输出行数必须与输入行数完全一致|简体中文|繁體中文/,
      `${entry} 不含提示词正文或语言 label`,
    )
  }
})
