import test from 'node:test'
import assert from 'node:assert/strict'

import { aligned, alignOf, type Alignment } from '../client/src/translate/verify.ts'

const SOURCE = '# Guide\n\nIntro line.\n\n## Setup\n\nBody.\n'
const TRANSLATED = '# 指南\n\n简介。\n\n## 安装\n\n正文。\n'

test('标题行与级别一一对应时对齐', () => {
  const alignment = alignOf(SOURCE, TRANSLATED)
  assert.equal(alignment.sourceLines, 7)
  assert.equal(alignment.translatedLines, 7)
  assert.equal(alignment.headingBreak, null)
  assert.equal(aligned(alignment), true)
})

test('行数相同但标题级别变了算不一致，并给出两侧锚点', () => {
  const alignment = alignOf(SOURCE, '# 指南\n\n简介。\n\n### 安装\n\n正文。\n')
  assert.equal(alignment.sourceLines, alignment.translatedLines)
  assert.deepEqual(alignment.headingBreak, {
    kind: 'mismatch',
    source: { line: 5, level: 2 },
    translated: { line: 5, level: 3 },
  })
  assert.equal(aligned(alignment), false)
})

test('行数相同但标题挪了行算不一致', () => {
  const moved = alignOf(SOURCE, '# 指南\n\n## 安装\n\n简介。\n\n正文。\n')
  assert.deepEqual(moved.headingBreak, {
    kind: 'mismatch',
    source: { line: 5, level: 2 },
    translated: { line: 3, level: 2 },
  })
  assert.equal(aligned(moved), false)
})

test('译文少了标题算 missing，行数可以相同', () => {
  const alignment = alignOf('# Guide\n\n## Setup\n\nBody.\n', '# 指南\n\n正文。\n\n更多。\n')
  assert.equal(alignment.sourceLines, alignment.translatedLines)
  assert.deepEqual(alignment.headingBreak, { kind: 'missing', source: { line: 3, level: 2 } })
  assert.equal(aligned(alignment), false)
})

test('译文多出标题算 extra，锚点是译文行', () => {
  const alignment = alignOf('# Guide\n\nBody.\n\nMore.\n', '# 指南\n\n## 安装\n\n正文。\n')
  assert.equal(alignment.sourceLines, alignment.translatedLines)
  assert.deepEqual(alignment.headingBreak, { kind: 'extra', translated: { line: 3, level: 2 } })
  assert.equal(aligned(alignment), false)
})

test('列表项与引用里的标题按文档顺序递归比较', () => {
  const source = '- item\n\n  > ### Deep\n\n> ## Quoted\n'
  const translated = '- 项目\n\n  > ### 深层\n\n> ## 引用\n'
  const nested = alignOf(source, translated)
  assert.equal(nested.headingBreak, null)
  assert.equal(aligned(nested), true)

  const changed = alignOf(source, '- 项目\n\n  > ## 深层\n\n> ## 引用\n')
  assert.deepEqual(changed.headingBreak, {
    kind: 'mismatch',
    source: { line: 3, level: 3 },
    translated: { line: 3, level: 2 },
  })
})

test('Setext 标题按级别比较', () => {
  const alignedSetext = alignOf('Title\n=====\n\nBody.\n', '标题\n=====\n\n正文。\n')
  assert.equal(alignedSetext.headingBreak, null)
  assert.equal(aligned(alignedSetext), true)

  const levelChanged = alignOf('Title\n=====\n\nBody.\n', '标题\n-----\n\n正文。\n')
  assert.deepEqual(levelChanged.headingBreak, {
    kind: 'mismatch',
    source: { line: 1, level: 1 },
    translated: { line: 1, level: 2 },
  })
})

test('代码围栏里的 # 不是标题', () => {
  const source = '# Real\n\n```\n# fake\n```\n\nBody.\n'
  const translated = '# 真\n\n```\nfake\n```\n\n正文。\n'
  const alignment = alignOf(source, translated)
  assert.equal(alignment.sourceLines, 7)
  assert.equal(alignment.headingBreak, null)
  assert.equal(aligned(alignment), true)
})

test('段落、行内标记与代码正文不比较', () => {
  const source = '# A\n\n**bold** and `code`\n\n```js\nconst a = 1\n```\n'
  const translated = '# 甲\n\n**粗体** 与 `代码`\n\n```js\nconst b = 2\n```\n'
  const alignment = alignOf(source, translated)
  assert.equal(alignment.headingBreak, null)
  assert.equal(aligned(alignment), true)
})

test('CRLF 与 LF 的换行差异不影响行数与标题', () => {
  const alignment = alignOf('# Guide\r\n\r\nIntro.\r\n', '# 指南\n\n简介。')
  assert.equal(alignment.sourceLines, 3)
  assert.equal(alignment.translatedLines, 3)
  assert.equal(alignment.headingBreak, null)
  assert.equal(aligned(alignment), true)
})

test('标题全对但行数不同也不算对齐', () => {
  const alignment: Alignment = alignOf('# A\n\nBody.\n', '# 甲\n\n正文。\n\n更多。\n')
  assert.equal(alignment.headingBreak, null)
  assert.notEqual(alignment.sourceLines, alignment.translatedLines)
  assert.equal(aligned(alignment), false)
})
