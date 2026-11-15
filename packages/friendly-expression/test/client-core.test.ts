import test from 'node:test'
import assert from 'node:assert/strict'

import {
  cacheKey, clampZoom, detectDiagramType, errorCopyText, errorDetail, errorSummary, fitScale, readPromptValue, titleFromCode,
} from '../client/src/core.ts'

test('detectDiagramType 识别常见图形', () => {
  assert.equal(detectDiagramType('flowchart TD\n  A --> B'), 'flowchart')
  assert.equal(detectDiagramType('graph LR\n  A --> B'), 'flowchart')
  assert.equal(detectDiagramType('sequenceDiagram\n  A->>B: hi'), 'sequence')
  assert.equal(detectDiagramType('stateDiagram-v2\n  [*] --> A'), 'state')
  assert.equal(detectDiagramType('erDiagram\n  A ||--o{ B : has'), 'er')
  assert.equal(detectDiagramType('classDiagram\n  A <|-- B'), 'class')
  assert.equal(detectDiagramType('gantt\n  title Plan'), 'gantt')
  assert.equal(detectDiagramType('pie\n  "A": 1'), 'pie')
  assert.equal(detectDiagramType('mindmap\n  root'), 'mindmap')
  assert.equal(detectDiagramType('timeline\n  2020 : start'), 'timeline')
  assert.equal(detectDiagramType('journey\n  title Day'), 'journey')
  assert.equal(detectDiagramType('gitGraph\n  commit'), 'gitGraph')
  assert.equal(detectDiagramType('quadrantChart\n  x-axis Low --> High'), 'quadrant')
  assert.equal(detectDiagramType('nonsense'), 'other')
})

test('detectDiagramType 跳过 frontmatter 和初始化指令', () => {
  const code = '---\ntitle: Flow\n---\n%%{init: {"theme": "base"}}%%\nflowchart TD\n  A --> B'
  assert.equal(detectDiagramType(code), 'flowchart')
})

test('titleFromCode 优先 meta，其次 frontmatter，不猜节点标签', () => {
  const code = '---\ntitle: "加载流程"\n---\nflowchart TD\n  "开始" --> "结束"'
  assert.equal(titleFromCode(code, '围栏标题'), '围栏标题')
  assert.equal(titleFromCode(code, ''), '加载流程')
  assert.equal(titleFromCode('flowchart TD\n  A[开始] --> B[结束]'), undefined)
  assert.equal(titleFromCode('---\nfoo: bar\n---\nflowchart TD'), undefined)
})

test('errorCopyText 只替换错误信息，不携带源码', () => {
  const template = 'Mermaid 渲染失败，请重新生成。错误信息：\n{message}'
  assert.equal(errorCopyText(template, 'Parse error'), 'Mermaid 渲染失败，请重新生成。错误信息：\nParse error')
})

test('errorDetail 保留换行和完整错误，errorSummary 只用于展示', () => {
  const raw = 'Parse error on line 4:\n... -> B[结束 C --> D\n---------------------^\nExpecting \'SQE\', \'DOUBLECIRCLEEND\', \'PE\', \'-\)\', \'STADIUMEND\', \'SUBROUTINEEND\', \'PIPE\', \'CYLINDEREND\', \'TAGEND\', \'TRAPEND\', \'INVTRAPEND\', \'UNICODE_TEXT\', \'TEXT\', \'TAGSTART\', got \'SOS\''
  assert.equal(errorDetail(new Error(raw)), raw)
  assert.equal(errorDetail(raw), raw)
  assert.ok(errorSummary(new Error(raw)).length <= 180)
  assert.ok(!errorSummary(new Error(raw)).includes('\n'))
})

test('clampZoom 限制在 20% 到 800%', () => {
  assert.equal(clampZoom(0.01), 0.2)
  assert.equal(clampZoom(1.5), 1.5)
  assert.equal(clampZoom(99), 8)
  assert.equal(clampZoom(Number.NaN), 0.2)
})

test('fitScale 按容器和图像尺寸缩放', () => {
  assert.equal(fitScale(1000, 600, 500, 300, 0), 2)
  assert.equal(fitScale(500, 300, 1000, 600, 0), 0.5)
  assert.equal(fitScale(0, 0, 100, 100), 1)
})

test('cacheKey 区分代码、配色与明暗模式', () => {
  const theme = { scheme: 'light', variables: { background: '#fff', textColor: '#111' } }
  const same = { scheme: 'light', variables: { textColor: '#111', background: '#fff' } }
  const dark = { scheme: 'dark', variables: { background: '#000', textColor: '#eee' } }
  assert.equal(cacheKey('flowchart TD', theme), cacheKey('flowchart TD', same))
  assert.notEqual(cacheKey('flowchart TD', theme), cacheKey('flowchart TD', dark))
  assert.notEqual(cacheKey('flowchart TD', theme), cacheKey('flowchart LR', theme))
})

test('readPromptValue 接受字符串和 volatile 引用', () => {
  assert.equal(readPromptValue('hello'), 'hello')
  assert.equal(readPromptValue({ get: () => 'from getter' }), 'from getter')
  assert.equal(readPromptValue(undefined), '')
  assert.equal(readPromptValue({ get: () => { throw new Error('bad') } }), '')
})
