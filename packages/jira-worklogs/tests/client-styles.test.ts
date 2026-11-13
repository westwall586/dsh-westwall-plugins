// client.js 样式层一致性契约（面板化入口改版，替代 Wave 20260926 的弹窗契约）：
// 颜色只走 --dsw-alias-* 令牌（字面色值为 0）、控件几何对齐宿主原语（胶囊按钮/
// 32 输入）、页面容器描摹 PluginManagerPage、焦点规则在位、设置卡片区不被重写波及、
// 入口注册为 main 键控面板 + sidebar.panellist 菜单行（浮窗 shell.overlay 已下线）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const clientSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'client.js'),
  'utf8',
)

const cssMatch = /const CSS = `\n([\s\S]*?)`\n/.exec(clientSource)
const CSS = cssMatch?.[1] ?? ''

test('CSS 模板字符串可提取', () => {
  assert.ok(CSS.length > 1000, 'CSS 段应存在且非空')
})

test('CSS 段零字面色值（hex 与 rgb()/rgba()）', () => {
  const hex = CSS.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
  const rgb = CSS.match(/\brgba?\(/g) ?? []
  assert.deepEqual(hex, [], `hex 色值应为 0，实得：${hex.join(', ')}`)
  assert.deepEqual(rgb, [], `rgb()/rgba() 应为 0，实得 ${rgb.length} 处`)
})

test('主题令牌引用在位', () => {
  for (const token of [
    '--dsw-alias-label-primary',
    '--dsw-alias-label-secondary',
    '--dsw-alias-label-tertiary',
    '--dsw-alias-border-l2',
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-button-primary-fill',
    '--dsw-alias-interactive-bg-hover',
  ]) {
    assert.ok(CSS.includes(token), `缺少令牌 ${token}`)
  }
})

test('页面容器描摹 PluginManagerPage（居中列 + max-width + 流式内边距）', () => {
  assert.ok(CSS.includes('.jw-page {'), '应有 .jw-page 页面容器')
  assert.match(CSS, /max-width:\s*720px/, '内容列应限宽（页面居中列模式）')
  assert.match(CSS, /padding:\s*0 clamp\(24px,\s*4vw,\s*48px\) 48px/, '水平内边距应为宿主页面流式档')
  assert.match(CSS, /\[data-platform='darwin'\]\s*\.jw-page-head/, 'macOS 隐藏标题栏安全距应让位头行')
})

test('胶囊按钮几何（r18 主档）与 32 输入对齐宿主', () => {
  assert.match(CSS, /border-radius:\s*18px/, '主按钮应为胶囊 r18')
  assert.match(CSS, /height:\s*32px/, '输入框应为 32px 高')
})

test('键盘焦点规则在位（focus-visible outline 2px）', () => {
  assert.match(CSS, /:focus-visible[^{]*\{[^}]*outline:\s*2px\s+solid\s+var\(--dsw-alias-brand-primary\)/)
})

test('设置卡片区类名保留（不被重写波及）', () => {
  for (const cls of ['.jw-c-page', '.jw-c-save', '.jw-c-switch', '.jw-c-input']) {
    assert.ok(CSS.includes(cls), `设置卡片区类 ${cls} 应保留`)
  }
})

test('Git 实例行身份与可编辑的实例名解耦（防逐字符失焦回归）', () => {
  assert.match(clientSource, /key:\s*row\.id/, '实例行 React key 应走稳定 id')
  assert.ok(!/key:\s*row\.name/.test(clientSource), '实例行 key 不得用可编辑的 name（每敲一键 key 变化→整行重挂→失焦）')
  assert.match(clientSource, /patchRow\(row\.id,\s*\{\s*name:/, '实例名编辑应按 id 定位行')
  assert.match(clientSource, /removeRow\(row\.id\)/, '删除实例应按 id 定位行')
})

test('设置导航图标覆盖已随旧入口移除（不误伤其他设置分区）', () => {
  assert.ok(!CSS.includes("[data-shortcut-modal='settings']"), '设置导航 CSS 覆盖块应移除（残留时 last-of-type 命中其他分区）')
  assert.ok(!clientSource.includes('panelIconMaskUri'), 'mask 插值变量应随覆盖块一并清理')
  assert.match(clientSource, /PANEL_ICON_STROKES\.map/, '侧栏图标组件仍消费线稿常量')
})

test('弹窗/浮窗外壳已移除（页面化后无模态结构）', () => {
  for (const cls of ['.jw-fab', '.jw-backdrop', '.jw-window', '.jw-head', '.jw-foot']) {
    assert.ok(!CSS.includes(cls), `弹窗期类 ${cls} 应随模态形态下线`)
  }
  assert.ok(!clientSource.includes("slots.inject('shell.overlay'"), '浮窗 shell.overlay 注册应已下线')
})

test('面板注册结构在位（main 键控 + sidebar.panellist 菜单行）', () => {
  assert.match(clientSource, /const PANEL_ID = 'jiraWorklogs'/, '面板 key 常量应为 jiraWorklogs')
  assert.match(clientSource, /name:\s*'main',\s*key:\s*PANEL_ID/, '应注册 main 键控面板（key=PANEL_ID）')
  assert.match(
    clientSource,
    /name:\s*'sidebar\.panellist',\s*id:\s*PANEL_ID,\s*order:\s*5/,
    '应注册 sidebar.panellist 菜单行（id=PANEL_ID）',
  )
  const orderMatch = /name:\s*'sidebar\.panellist',\s*id:\s*PANEL_ID,\s*order:\s*(\d+)/.exec(clientSource)
  const order = orderMatch ? Number(orderMatch[1]) : null
  assert.ok(order !== null && order > 0 && order < 10, `order 应落在「插件」(0) 与「任务」(10) 之间，实得 ${order}`)
})

test('面板图标为描摹宿主 IconListPenOutline 的 current-color 线稿', () => {
  assert.match(clientSource, /function JiraPanelIcon/, '应有面板图标组件')
  const iconBlock = /function JiraPanelIcon[\s\S]*?\n    \}/.exec(clientSource)?.[0] ?? ''
  assert.match(iconBlock, /viewBox: '0 0 16 16'/, '描摹源为 16×16 视窗')
  assert.match(iconBlock, /stroke: 'currentColor'/, '线稿应走 currentColor')
  assert.match(iconBlock, /width: size, height: size/, '尺寸应由侧栏传入（wide 16 / rail 18）')
  assert.ok(!clientSource.includes("require('@deepseek-ai/dsh-client-ui-primitives')"), '不得 require ui-primitives（practices.md 规范）')
})
