// T07 判定用例：客户端扩展结构契约（20261015 Wave）——三新方法描述符与 API、
// 暂存提示条/素材区组件、暂存回显接线、提交后刷新、uncertain 编辑确认、
// outboxSaved 提示、防抖自动保存。行为级验证归验收 E2E（web profile），
// 此处钉结构与关键接线事实（client-styles.test.ts 同款源断言形态）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const clientSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'client.js'),
  'utf8',
)

test('remote contribution：三新方法描述符在位（openOutbox/dismissOutbox/saveNotes）', () => {
  for (const method of ['openOutbox', 'dismissOutbox', 'saveNotes']) {
    assert.ok(
      clientSource.includes(`dsh-jira-worklogs/jiraWorklogs.${method}`),
      `缺少描述符 ${method}`,
    )
    assert.ok(
      new RegExp(`async ${method}\\(`).test(clientSource),
      `缺少 API 方法 ${method}`,
    )
  }
})

test('OutboxBanner：多日聚合文案、逐日清单、放弃确认、错误态', () => {
  assert.ok(/function OutboxBanner/.test(clientSource), 'OutboxBanner 组件在位')
  assert.ok(clientSource.includes('条待重试提交'), '聚合文案')
  assert.ok(/days\.map/.test(clientSource), '逐日清单展开')
  assert.ok(/放弃/.test(clientSource), '放弃行动')
  assert.ok(/outboxError/.test(clientSource), '读取失败错误态驱动')
})

test('NotesBlock：防抖自动保存、行内失败与重试、非缺口日降级', () => {
  assert.ok(/function NotesBlock/.test(clientSource), 'NotesBlock 组件在位')
  assert.ok(/800/.test(clientSource), '800ms 防抖常量')
  assert.ok(clientSource.includes('保存失败'), '行内失败提示')
  assert.ok(/重试/.test(clientSource), '重试行动')
  assert.ok(clientSource.includes('补充编码外工作'), '缺口日引导文案')
  assert.ok(/notesError/.test(clientSource), '素材读取错误态驱动')
  assert.ok(/outboxUnavailable/.test(clientSource), '存储缺席降级信号消费（终审 F-1）')
  assert.ok(/outboxUnavailable:\s*month\.outboxUnavailable/.test(clientSource), '提示条接线在位（终审复审 RF-1——定义在且调用处传信号）')
  assert.ok(clientSource.includes('素材记录暂不可用'), '素材区存储缺席降级提示')
  assert.ok(clientSource.includes('暂存功能暂不可用'), '提示条存储缺席降级提示')
  assert.ok(/notes-\$\{detail\.date\}/.test(clientSource), '素材区随日期重挂载（终审 F-3）')
})

test('暂存回显接线：lastStatus 渲染、noteConfirmed/userEdited 初始、uncertain 编辑确认', () => {
  assert.ok(/lastStatus/.test(clientSource), '上次失败形态渲染')
  assert.ok(/noteConfirmed/.test(clientSource), '原话条目初始 userEdited')
  assert.ok(/到 Jira 核对/.test(clientSource), 'uncertain 核对入口')
  assert.ok(/上次写入结果未确认|先到 Jira 核对/.test(clientSource), 'uncertain 编辑后提交前确认')
})

test('提交后刷新与 outboxSaved 提示', () => {
  assert.ok(clientSource.includes('暂存未生效'), 'outboxSaved=false 显式提示')
  assert.ok(/degradedNotes/.test(clientSource), '降级提示渲染')
})

test('切日保护区分已提交状态；表单说明长度校验移除（20261028）', () => {
  assert.ok(/pendingResults/.test(clientSource), '待重提判定 pendingResults 在位')
  assert.ok(clientSource.includes('draft.results == null'), '守卫按提交状态分流（未提交/已提交两分支）')
  assert.ok(/editedSinceSubmit/.test(clientSource), '提交后再编辑的兜底标记')
  assert.equal((clientSource.match(/切换将丢弃未提交的表单修改/g) ?? []).length, 2, '两处切日守卫（selectDay/onOpenOutbox）同口径')
  assert.ok(!/说明过长/.test(clientSource), '表单不再有说明长度校验')
})

test('月历已填满工作日 ✓ 标记（20261028，纯展示层）', () => {
  assert.ok(clientSource.includes("row.status === 'full' ? h('span', { key: 'fulldot', className: 'jw-day-dot jw-day-dot-full' }"), 'full 日渲染 ✓ 标记')
  assert.ok(clientSource.includes('.jw-day-dot-full'), '✓ 标记样式类在位')
  assert.ok(clientSource.includes('--dsw-alias-state-success-primary'), '✓ 走 success 令牌（零字面色值约束）')
})

test('CSS 扩展类在位（提示条/素材区走既有令牌体系）', () => {
  const cssMatch = /const CSS = `\n([\s\S]*?)`\n/.exec(clientSource)
  const CSS = cssMatch?.[1] ?? ''
  for (const cls of ['.jw-outbox', '.jw-notes', '.jw-note']) {
    assert.ok(CSS.includes(cls), `缺少样式类 ${cls}`)
  }
})

test('暂存回显表单头：现查已填时数与已填满提示（验收 round-01 问题 3，S13）', () => {
  assert.ok(/已填 \$\{fmtHours\(draft\.doc\.loggedHours\)\}h/.test(clientSource), '表单头显示现查已填时数（outboxToDraft 现查传入）')
  assert.ok(clientSource.includes('已填满'), '缺口 0 且已填>0 的已填满提示（S13）')
  assert.ok(/gapHours === 0 && draft\.doc\.loggedHours > 0/.test(clientSource), '已填满徽标条件（缺口 0 且已填>0，不误标豁免日空填）')
})

test('设置入口内嵌组合包详情页（plugins.bundle.config 键＝包名）', () => {
  assert.match(clientSource, /slots\.inject\('plugins\.bundle\.config'/, '应注册进包级配置槽')
  assert.match(clientSource, /key: 'dsh-jira-worklogs'/, '键应为包名')
  assert.ok(!/slots\.inject\('plugins\.row\.config'/.test(clientSource), '行级注册应移除（包级内嵌为仓规范）')
  assert.ok(!clientSource.includes("view === 'summary'"), 'bundle 槽仅 page 视图，summary 分支应移除')
  assert.ok(!clientSource.includes('CARD_DESC'), 'summary 简介常量应随分支移除')
})

// ---- 查同事日志（20261023 Wave）：查询区结构契约 ----

test('query：contribution 描述符与 API 方法在位', () => {
  assert.ok(
    clientSource.includes('dsh-jira-worklogs/jiraWorklogs.query'),
    '缺少 query 描述符',
  )
  assert.ok(/async query\(/.test(clientSource), '缺少 API 方法 query')
})

test('QueryBlock：组件在位、挂载于面板、默认收起、结果按日聚合渲染', () => {
  const block = clientSource.match(/function QueryBlock[\s\S]*?\n    function /)?.[0] ?? ''
  assert.ok(block.length > 100, 'QueryBlock 组件在位（块可提取）')
  assert.ok(
    clientSource.includes("h(QueryBlock, { key: 'query-others', api })"),
    '查询区挂载于面板 body（固定形态，不携带锁定属性）',
  )
  assert.ok(/useState\(false\)/.test(block), '默认收起（open 初始 false）')
  for (const token of ['weekday', 'totalHours', 'issueUrl', 'permissionNote']) {
    assert.ok(block.includes(token), `结果渲染消费 ${token}`)
  }
})

test('QueryBlock：不参与既有锁定（互不锁定口径的结构面）', () => {
  const mount = clientSource.match(/h\(QueryBlock,[^)]*\)/)?.[0] ?? ''
  assert.ok(!/locked|generating|submitting/.test(mount), '挂载点不传入锁定相关属性')
})

test('QueryBlock：收起不中止、不清除结果（取消口径的结构面）', () => {
  assert.ok(/setOpen\(value => !value\)/.test(clientSource), '收起仅翻转展开态')
  const block = clientSource.match(/function QueryBlock[\s\S]*?\n    function /)?.[0] ?? ''
  assert.ok(!/AbortController|signal/.test(block), '无中止机制接线')
  assert.ok(!/setView\(null\)/.test(block), '收起路径不清除结果状态')
})

test('QueryBlock：样式类自有前缀且在 CSS 段在场', () => {
  const css = /const CSS = `\n([\s\S]*?)`\n/.exec(clientSource)?.[1] ?? ''
  for (const cls of ['jw-qy', 'jw-qy-head', 'jw-qy-form', 'jw-qy-result', 'jw-qy-date', 'jw-qy-comment', 'jw-qy-note']) {
    assert.ok(css.includes(`.${cls}`), `CSS 缺少 .${cls}`)
  }
})

test('QueryBlock：日期为文本输入（yyyy-mm-dd 直改，斜杠归一）——桌面反馈 T08', () => {
  const block = clientSource.match(/function QueryBlock[\s\S]*?\n    function /)?.[0] ?? ''
  assert.ok(!block.includes("type: 'date'"), '不再使用原生 date 控件（en-US 区域下显示 MM/DD/YYYY）')
  assert.ok(block.includes("placeholder: 'YYYY-MM-DD'"), '占位提示格式在位')
  assert.ok(block.includes(".replace(/\\//g, '-')"), '斜杠输入归一为连字符')
})

test('QueryBlock：迷你日历弹层在位（桌面反馈 T09——保留日历选择、格式自控）', () => {
  assert.ok(/function MiniDatePicker/.test(clientSource), 'MiniDatePicker 组件在位')
  const block = clientSource.match(/function QueryBlock[\s\S]*?\n    function /)?.[0] ?? ''
  assert.ok(block.includes("aria-label': '选择开始日期'"), '开始日期弹出按钮在位')
  assert.ok(block.includes("aria-label': '选择结束日期'"), '结束日期弹出按钮在位')
  const css = /const CSS = `\n([\s\S]*?)`\n/.exec(clientSource)?.[1] ?? ''
  for (const cls of ['jw-qy-dwrap', 'jw-qy-dbtn', 'jw-qy-pop', 'jw-qy-pop-grid', 'jw-qy-pop-day', 'jw-qy-pop-sel']) {
    assert.ok(css.includes(`.${cls}`), `CSS 缺少 .${cls}`)
  }
})
