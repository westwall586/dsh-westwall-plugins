// T05 判定用例：Host 流程层（overview/dayDetail/generate/submit 四流程编排，依赖注入）。
// 20261015 Wave：暂存记账、openOutbox/saveNotes/dismiss、素材与候选接入、存储降级、JWL=io 后门。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  overviewFlow, dayDetailFlow, generateFlow, submitFlow, openOutboxFlow, saveNotesFlow, dismissOutboxFlow,
  type HostFlowsDeps,
} from '../src/flows.ts'
import { createDraftStore, createCandidateStore, type DraftStore } from '../src/draft-store.ts'
import { createWorklogsStore, type WorklogsStore, type OutboxDayRecord, type NotesDayRecord, type OutboxEntry } from '../src/store/domain.ts'
import { JiraClient } from '../src/engine/jira.ts'
import type { JiraConfig, Transport } from '../src/engine/types.ts'
import { HttpError } from '../src/engine/types.ts'
import { fakeJira, issueData, worklogItem } from './engine/helpers.ts'

const NOW = '2026-10-15T09:00:00+08:00'

function memStore(): WorklogsStore {
  const mk = <V>() => {
    const m = new Map<string, V>()
    return {
      get: (k: string) => m.get(k),
      put: async (k: string, v: V) => { m.set(k, v) },
      delete: async (k: string) => m.delete(k),
      entries: () => [...m.entries()] as [string, V][],
    }
  }
  return createWorklogsStore({ outbox_day: mk<OutboxDayRecord>(), notes_day: mk<NotesDayRecord>() })
}

/** 全操作失败的存储替身（写失败/读失败注入）。 */
function failingStore(): WorklogsStore {
  const boom = () => { throw new Error('存储读写失败') }
  return {
    getOutbox: boom, putOutbox: boom, deleteOutbox: boom, outboxSummary: boom,
    getNotes: boom, putNotes: boom, close: async () => {},
  }
}

function outboxEntry(over: Partial<OutboxEntry> = {}): OutboxEntry {
  return { issueKey: 'DEMO-745', taskName: '插件设置迁移', start: '11:00', end: '13:00', comment: '完成迁移', userEdited: false, lastStatus: 'failed', ...over }
}

function putOutboxFixture(store: WorklogsStore, date: string, entries: OutboxEntry[]) {
  return store.putOutbox({ date, entries, createdAt: NOW, updatedAt: NOW })
}

function draftContext(store: DraftStore, outboxDate?: string) {
  return store.put({
    date: '2026-09-21',
    taskKeys: new Map([[1, { key: 'DEMO-745', name: '插件设置迁移' }]]),
    ...(outboxDate !== undefined ? { outboxDate } : {}),
  })
}

function streamReturning(text: string) {
  return (options: unknown) => (async function* () {
    void options
    yield { type: 'block-start', index: 0, blockType: 'text' } as never
    yield { type: 'text-delta', index: 0, text } as never
    yield { type: 'block-end', index: 0, block: { type: 'text', text } } as never
    yield { type: 'finish', reason: { kind: 'stop' } } as never
  })()
}

function makeDeps(overrides: Partial<HostFlowsDeps> & {
  fake: Transport
  store?: DraftStore
  stream?: (options: unknown) => AsyncIterable<unknown>
  selectionError?: Error
}): HostFlowsDeps {
  const jira: JiraConfig = { server: 'https://jira', username: 'u', password: 'p', verifySsl: false }
  return {
    engineConfig: () => ({ jira, gitlab: [], repoFilter: [] }),
    jiraConfigured: () => true,
    makeClient: configJira => new JiraClient(configJira.server, configJira.username, configJira.password, overrides.fake, configJira.verifySsl),
    currentSelection: overrides.selectionError ? () => { throw overrides.selectionError } : () => ({ provider: 'deepseek', model: 'test-model' }),
    stream: overrides.stream ?? streamReturning('{"entries":[{"task_id":1,"start":"11:00","end":"13:00","comment":"完成设置迁移与验证"}]}'),
    store: overrides.store ?? createDraftStore(),
    ...overrides,
  }
}

test('overviewFlow：纯配置预检缺失 → 引导态，零网络', async () => {
  let madeClient = false
  const deps = makeDeps({ fake: fakeJira({}) })
  deps.jiraConfigured = () => false
  deps.makeClient = () => { madeClient = true; throw new Error('不应构建客户端') }
  const view = await overviewFlow(deps, '2026-09-24')
  assert.equal(view.error, 'jira-credentials')
  assert.ok(view.message!.includes('插件页 → Jira 工时记录 详情页'))
  assert.equal(madeClient, false)
})

test('overviewFlow：月视图行与缺口计数', async () => {
  const fake = fakeJira({ logs: { 'DEMO-745': [worklogItem('1', '2026-09-21', '2h', 7200, '联调')] } })
  const view = await overviewFlow(makeDeps({ fake }), '2026-09-24')
  assert.equal(view.error, undefined)
  assert.equal(view.month, '2026-09')
  assert.equal(view.gapCount, 18) // 9/1-9/24 共 18 个工作日，仅 9/21 有 2h，全部缺口
  assert.equal(view.rows.find(row => row.date === '2026-09-21')!.status, 'gap')
})

test('dayDetailFlow：日详情视图', async () => {
  const fake = fakeJira({
    logs: { 'DEMO-745': [worklogItem('1', '2026-09-21', '2h', 7200, '联调')] },
    issueGet: { 'DEMO-745': issueData('插件设置迁移', 'DEMO-745') },
  })
  const view = await dayDetailFlow(makeDeps({ fake }), '2026-09-21')
  assert.equal(view.workday, true)
  assert.equal(view.loggedHours, 2)
  assert.equal(view.tasks[0]!.name, '插件设置迁移')
})

test('generateFlow：全链——plan/素材/llm/解析/入缓存/草稿文档', async () => {
  const fake = fakeJira({
    issues: [issueData('插件设置迁移', 'DEMO-745')],
    logs: { 'DEMO-745': [worklogItem('1', '2026-09-21', '2h', 7200, '联调')] },
    issueGet: { 'DEMO-745': issueData('插件设置迁移', 'DEMO-745') },
  })
  const store = createDraftStore()
  const doc = await generateFlow(makeDeps({ fake, store }), '2026-09-21')
  assert.equal(doc.date, '2026-09-21')
  assert.equal(doc.entries.length, 1)
  assert.equal(doc.entries[0]!.taskId, 1)
  assert.equal(doc.tasks[0]!.name, '插件设置迁移')
  assert.ok(doc.draftId.length > 0)
  const context = store.get(doc.draftId)!
  assert.equal(context.date, '2026-09-21')
  assert.equal(context.taskKeys.get(1)!.key, 'DEMO-745')
  assert.equal(context.taskKeys.get(1)!.name, '插件设置迁移')
})

test('generateFlow：输出不可解析 → fail-closed 抛错，草稿不入缓存', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const store = createDraftStore()
  const placeholderId = store.put({ date: '2026-09-21', taskKeys: new Map() }) // 占位：失败流程不得替换它
  await assert.rejects(
    () => generateFlow(makeDeps({ fake, store, stream: streamReturning('这不是 JSON') }), '2026-09-21'),
    /解析/,
  )
  assert.equal(store.get(placeholderId) !== undefined, true)
})

test('generateFlow：JWL_DEBUG_PARSE_FAIL 注入（S19 验收通道）', async () => {
  process.env.JWL_DEBUG_PARSE_FAIL = '1'
  try {
    await assert.rejects(
      () => generateFlow(makeDeps({ fake: fakeJira({ issues: [issueData()] }) }), '2026-09-21'),
      /解析/,
    )
  } finally {
    delete process.env.JWL_DEBUG_PARSE_FAIL
  }
})

test('generateFlow：路由类失败固定前缀「默认模型路由不可用」', async () => {
  await assert.rejects(
    () => generateFlow(makeDeps({
      fake: fakeJira({ issues: [issueData()] }),
      selectionError: new Error('NO_ADAPTER: provider not registered'),
    }), '2026-09-21'),
    /默认模型路由不可用/,
  )
})

test('generateFlow：真实平台凭据缺失文案经 failure.code 分类（T05 审读 F1）', async () => {
  // llm-deepseek 真实文案不含正则可猜的标记——靠 runGeneration 随错误携带的 code 分类
  const realText = 'llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service'
  const stream = () => (async function* () {
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL', message: realText } } } as never
  })()
  await assert.rejects(
    () => generateFlow(makeDeps({ fake: fakeJira({ issues: [issueData()] }), stream }), '2026-09-21'),
    /默认模型路由不可用/,
  )
  // INVALID_CREDENTIAL（已存凭据非法）同入路由口径（T07 审读补用例）
  const invalidStream = () => (async function* () {
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_CREDENTIAL', message: 'stored API key is malformed' } } } as never
  })()
  await assert.rejects(
    () => generateFlow(makeDeps({ fake: fakeJira({ issues: [issueData()] }), stream: invalidStream }), '2026-09-21'),
    /默认模型路由不可用/,
  )
  // 网络/限流类错误不得误入路由口径
  const netStream = () => (async function* () {
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'Too many requests' } } } as never
  })()
  await assert.rejects(
    () => generateFlow(makeDeps({ fake: fakeJira({ issues: [issueData()] }), stream: netStream }), '2026-09-21'),
    error => !String((error as Error).message).includes('默认模型路由不可用') && String((error as Error).message).includes('Too many requests'),
  )
})

test('generateFlow：signal 透传至模型调用参数（终审 F2 接线核验）', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const controller = new AbortController()
  const text = '{"entries":[{"task_id":1,"start":"11:00","end":"13:00","comment":"完成设置迁移与验证"}]}'
  let seenSignal: AbortSignal | undefined
  const stream = (options: unknown) => {
    seenSignal = (options as { signal?: AbortSignal }).signal
    return (async function* () {
      yield { type: 'block-start', index: 0, blockType: 'text' } as never
      yield { type: 'text-delta', index: 0, text } as never
      yield { type: 'block-end', index: 0, block: { type: 'text', text } } as never
      yield { type: 'finish', reason: { kind: 'stop' } } as never
    })()
  }
  const doc = await generateFlow(makeDeps({ fake, stream }), '2026-09-21', controller.signal)
  assert.equal(doc.entries.length, 1)
  assert.equal(seenSignal, controller.signal)
})

test('overviewFlow：查询期 401/403 认证拒绝 → 凭据引导态（T05 审读 F2）', async () => {
  const { HttpError } = await import('../src/engine/types.ts')
  const failingMyself: import('../src/engine/types.ts').Transport = (method, url) => {
    if (String(url).endsWith('/rest/api/2/myself')) {
      return Promise.reject(new HttpError(401, 'Unauthorized'))
    }
    return Promise.reject(new Error(`unexpected ${method} ${url}`))
  }
  const deps = makeDeps({ fake: failingMyself as never })
  const view = await overviewFlow(deps, '2026-09-24')
  assert.equal(view.error, 'jira-credentials')
  assert.ok(view.message!.includes('认证失败'))
})

test('submitFlow：现查当日工时→重组→引擎写入→回报按序', async () => {
  const fake = fakeJira({ issues: [issueData('插件设置迁移', 'DEMO-745')] })
  const store = createDraftStore()
  const draftId = store.put({
    date: '2026-09-21',
    taskKeys: new Map([[1, { key: 'DEMO-745', name: '插件设置迁移' }]]),
  })
  const report = await submitFlow(makeDeps({ fake, store }), {
    draftId,
    entries: [
      { taskId: 1, start: '09:00', end: '13:00', comment: '完成设置迁移与验证', userEdited: false },
      { taskId: 1, start: '14:00', end: '18:00', comment: '修复写路径并回归', userEdited: false },
    ],
  })
  assert.equal(report.status, 'ok')
  assert.deepEqual(report.results.map(item => item.status), ['written', 'written'])
  assert.equal((fake.logs['DEMO-745'] ?? []).length, 2)
})

test('submitFlow：草稿过期抛可读错误', async () => {
  await assert.rejects(
    () => submitFlow(makeDeps({ fake: fakeJira({}) }), { draftId: 'nope', entries: [] }),
    /过期/,
  )
})

// ---- 20261015 Wave：暂存记账 / 三新 flow / 素材与候选接入 / 降级 / 后门 ----

/** 提交条目组：每条 4h 连续块（两位时刻形态——与客户端 padTimeInput 归一对齐）；
 * 两条恰满 8h 过引擎下限（单条场景须自带 blocked 预期）。 */
function submitEntries(comments: string[]) {
  return comments.map((comment, i) => ({
    taskId: 1, start: `${String(9 + i * 4).padStart(2, '0')}:00`, end: `${13 + i * 4}:00`, comment, userEdited: false,
  }))
}

test('submitFlow 记账：failed/uncertain 条目写入暂存（lastError 脱敏），outboxSaved=true', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const wrapped: Transport = (method, url, init) => {
    if (method === 'POST' && String(url).includes('/worklog')) {
      const body = init?.body as { comment: string }
      if (body.comment === 'c-failed') return Promise.reject(new HttpError(500, '写入 DEMO-745 时服务错误'))
      if (body.comment === 'c-uncertain') return Promise.reject(new Error('网络中断'))
    }
    return Promise.resolve(fake(method, url, init))
  }
  const store = createDraftStore()
  const worklogs = memStore()
  const report = await submitFlow(makeDeps({ fake: wrapped, store, worklogs }), {
    draftId: draftContext(store),
    entries: submitEntries(['c-failed', 'c-uncertain']),
  })
  assert.equal(report.status, 'failed', '两条皆失败——引擎日级状态为 failed（非 partial）')
  assert.equal(report.outboxSaved, true)
  const record = worklogs.getOutbox('2026-09-21')!
  assert.equal(record.entries.length, 2)
  assert.deepEqual(record.entries.map(entry => entry.lastStatus), ['failed', 'uncertain'])
  assert.ok(record.entries[0]!.lastError!.includes('该任务'), 'lastError 键形串脱敏')
  assert.ok(!record.entries[0]!.lastError!.includes('DEMO-745'))
})

test('submitFlow 记账：blocked 不写暂存（本地校验拒绝不属系统故障）', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const store = createDraftStore()
  const worklogs = memStore()
  const report = await submitFlow(makeDeps({ fake, store, worklogs }), {
    draftId: draftContext(store),
    entries: [{ taskId: 1, start: '09:00', end: '10:00', comment: '只有一小时', userEdited: false }],
  })
  assert.equal(report.status, 'blocked')
  assert.equal(report.outboxSaved, undefined)
  assert.equal(worklogs.getOutbox('2026-09-21'), undefined)
})

test('submitFlow 记账：本地重组错误（时间段非法）不暂存', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const store = createDraftStore()
  const worklogs = memStore()
  await assert.rejects(
    () => submitFlow(makeDeps({ fake, store, worklogs }), {
      draftId: draftContext(store),
      entries: [{ taskId: 1, start: '13:00', end: '11:00', comment: '非法时段', userEdited: false }],
    }),
    /时间段非法/,
  )
  assert.equal(worklogs.getOutbox('2026-09-21'), undefined, '本地错误不进暂存')
})

test('submitFlow 记账：暂存来源全部终态成功 → 暂存清除', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const store = createDraftStore()
  const worklogs = memStore()
  await putOutboxFixture(worklogs, '2026-09-21', [outboxEntry()])
  const report = await submitFlow(makeDeps({ fake, store, worklogs }), {
    draftId: draftContext(store, '2026-09-21'),
    entries: submitEntries(['完成迁移', '补充到八小时']),
  })
  assert.equal(report.status, 'ok')
  assert.equal(worklogs.getOutbox('2026-09-21'), undefined, '全成功清除暂存')
})

test('submitFlow 记账：暂存来源部分成功 → 替换为剩余未成功项（S21）', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const wrapped: Transport = (method, url, init) => {
    if (method === 'POST' && String(url).includes('/worklog')) {
      const body = init?.body as { comment: string }
      if (body.comment === 'still-fail') return Promise.reject(new HttpError(502, '服务暂不可用'))
    }
    return Promise.resolve(fake(method, url, init))
  }
  const store = createDraftStore()
  const worklogs = memStore()
  await putOutboxFixture(worklogs, '2026-09-21', [outboxEntry(), outboxEntry({ comment: 'still-fail', start: '14:00', end: '16:00' })])
  const report = await submitFlow(makeDeps({ fake: wrapped, store, worklogs }), {
    draftId: draftContext(store, '2026-09-21'),
    entries: submitEntries(['完成迁移', 'still-fail']),
  })
  assert.equal(report.outboxSaved, true)
  const record = worklogs.getOutbox('2026-09-21')!
  assert.equal(record.entries.length, 1, '仅剩未成功项')
  assert.equal(record.entries[0]!.comment, 'still-fail')
})

test('submitFlow 记账：普通提交全成功不写暂存、outboxSaved 省略', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const store = createDraftStore()
  const worklogs = memStore()
  const report = await submitFlow(makeDeps({ fake, store, worklogs }), {
    draftId: draftContext(store),
    entries: submitEntries(['完成设置迁移与热生效验证', '修复写路径并回归']),
  })
  assert.equal(report.status, 'ok')
  assert.equal(report.outboxSaved, undefined)
  assert.equal(worklogs.getOutbox('2026-09-21'), undefined)
})

test('submitFlow 记账：暂存写入失败 → outboxSaved=false（回报照常）', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const wrapped: Transport = (method, url, init) => {
    if (method === 'POST' && String(url).includes('/worklog')) {
      const body = init?.body as { comment: string }
      if (body.comment === 'c-failed') return Promise.reject(new HttpError(500, '服务错误'))
    }
    return Promise.resolve(fake(method, url, init))
  }
  const store = createDraftStore()
  const report = await submitFlow(makeDeps({ fake: wrapped, store, worklogs: failingStore() }), {
    draftId: draftContext(store),
    entries: submitEntries(['c-failed', '填充到八小时的正常条目']),
  })
  assert.equal(report.results[0]!.status, 'failed')
  assert.equal(report.outboxSaved, false, '暂存写入失败显式标记')
})

test('submitFlow 记账：远程段抛错 → 全量按 failed 暂存后原错误重抛（S01 整体抛错形态）', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const wrapped: Transport = (method, url) => {
    if (String(url).includes('/search') && String(url).includes('worklogAuthor')) {
      return Promise.reject(new Error('Jira 网关 502'))
    }
    return Promise.resolve(fake(method, url))
  }
  const store = createDraftStore()
  const worklogs = memStore()
  await assert.rejects(
    () => submitFlow(makeDeps({ fake: wrapped, store, worklogs }), {
      draftId: draftContext(store),
      entries: submitEntries(['第一条', '第二条']),
    }),
    /Jira 网关 502/,
  )
  const record = worklogs.getOutbox('2026-09-21')!
  assert.equal(record.entries.length, 2, '全量条目暂存')
  assert.ok(record.entries.every(entry => entry.lastStatus === 'failed'))
})

test('submitFlow 记账：远程抛错且暂存写入失败 → 错误消息拼接「暂存未生效」（S10）', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const wrapped: Transport = (method, url) => {
    if (String(url).includes('/search') && String(url).includes('worklogAuthor')) {
      return Promise.reject(new Error('Jira 网关 502'))
    }
    return Promise.resolve(fake(method, url))
  }
  const store = createDraftStore()
  await assert.rejects(
    () => submitFlow(makeDeps({ fake: wrapped, store, worklogs: failingStore() }), {
      draftId: draftContext(store),
      entries: submitEntries(['第一条']),
    }),
    /Jira 网关 502；暂存未生效——请勿关闭面板/,
  )
})

test('submitFlow 记账：普通上下文二次提交失败 → 替换既有暂存为本次未成功项（T05 review f6a）', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const wrapped: Transport = (method, url, init) => {
    if (method === 'POST' && String(url).includes('/worklog')) {
      return Promise.reject(new HttpError(500, '服务错误'))
    }
    return Promise.resolve(fake(method, url, init))
  }
  const store = createDraftStore()
  const worklogs = memStore()
  await putOutboxFixture(worklogs, '2026-09-21', [outboxEntry({ comment: '上一批遗留' })])
  const report = await submitFlow(makeDeps({ fake: wrapped, store, worklogs }), {
    draftId: draftContext(store),
    entries: submitEntries(['本批失败一', '本批失败二']),
  })
  assert.equal(report.outboxSaved, true)
  const record = worklogs.getOutbox('2026-09-21')!
  assert.deepEqual(record.entries.map(entry => entry.comment), ['本批失败一', '本批失败二'], '替换而非合并——上一批不残留')
})

test('submitFlow 记账：全成功清除失败静默（暂存留存，回报不受影响——T05 review f6b）', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const store = createDraftStore()
  // 只删失败的存储替身：get/put 正常、deleteOutbox 抛错
  const deleteOnlyFail: WorklogsStore = {
    ...memStore(),
    deleteOutbox: async () => { throw new Error('删除失败') },
  }
  await putOutboxFixture(deleteOnlyFail, '2026-09-21', [outboxEntry()])
  const report = await submitFlow(makeDeps({ fake, store, worklogs: deleteOnlyFail }), {
    draftId: draftContext(store, '2026-09-21'),
    entries: submitEntries(['完成迁移', '补充到八小时']),
  })
  assert.equal(report.status, 'ok')
  assert.equal(report.outboxSaved, undefined, '清除失败不产生写入信号')
  assert.ok(deleteOnlyFail.getOutbox('2026-09-21') !== undefined, '暂存留存（提示条下次仍见，可手动放弃）')
})

test('submitFlow 记账：远程抛错且存在无任务映射条目 → 整体不暂存（对位本地错误口径——T05 review f6c）', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const wrapped: Transport = (method, url) => {
    if (String(url).includes('/search') && String(url).includes('worklogAuthor')) {
      return Promise.reject(new Error('Jira 网关 502'))
    }
    return Promise.resolve(fake(method, url))
  }
  const store = createDraftStore()
  const draftId = store.put({
    date: '2026-09-21',
    taskKeys: new Map([[1, { key: 'DEMO-745', name: '插件设置迁移' }]]), // taskId 9 无映射
  })
  const worklogs = memStore()
  await assert.rejects(
    () => submitFlow(makeDeps({ fake: wrapped, store, worklogs }), {
      draftId,
      entries: [{ taskId: 1, start: '09:00', end: '13:00', comment: '合法条目', userEdited: false }, { taskId: 9, start: '13:00', end: '17:00', comment: '无映射条目', userEdited: false }],
    }),
    /Jira 网关 502$/,
  )
  assert.equal(worklogs.getOutbox('2026-09-21'), undefined, '请求不合法整体不暂存')
})

test('submitFlow 记账：worklogs 缺席跳过记账不报错（存储缺席降级）', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const wrapped: Transport = (method, url, init) => {
    if (method === 'POST' && String(url).includes('/worklog')) {
      const body = init?.body as { comment: string }
      if (body.comment === 'c-failed') return Promise.reject(new HttpError(500, '服务错误'))
    }
    return Promise.resolve(fake(method, url, init))
  }
  const store = createDraftStore()
  const report = await submitFlow(makeDeps({ fake: wrapped, store }), {
    draftId: draftContext(store),
    entries: submitEntries(['c-failed']),
  })
  assert.equal(report.outboxSaved, undefined, '缺席省略字段')
})

test('openOutboxFlow：暂存回显——注册 outboxDate、候选并入暂存任务、键不进文档', async () => {
  const fake = fakeJira({
    issues: [issueData()],
    logs: { 'DEMO-745': [worklogItem('1', '2026-09-21', '2h', 7200, '联调')] },
  })
  const store = createDraftStore()
  const worklogs = memStore()
  const candidates = createCandidateStore()
  await putOutboxFixture(worklogs, '2026-09-21', [outboxEntry({ issueKey: 'OUT-1', taskName: '暂存专属任务' })])
  const doc = await openOutboxFlow(makeDeps({ fake, store, worklogs, candidates }), '2026-09-21')
  assert.equal(doc.date, '2026-09-21')
  assert.equal(doc.elapsedMs, 0)
  assert.equal(doc.loggedHours, 2, '现查已填')
  assert.ok(doc.tasks.some(task => task.name === '暂存专属任务'), '暂存任务并入候选')
  assert.equal(doc.entries[0]!.lastStatus, 'failed')
  assert.ok(!JSON.stringify(doc).includes('OUT-1'), '键不进客户端文档')
  const context = store.get(doc.draftId)!
  assert.equal(context.outboxDate, '2026-09-21')
  assert.ok([...context.taskKeys.values()].some(ref => ref.key === 'OUT-1'))
  // 候选映射不重注册（所有权在 dayDetail——T05 review f3：重注册会使素材下拉解析错位）
  assert.equal(candidates.get('2026-09-21'), undefined)
})

test('openOutboxFlow：无暂存记录抛可读错误', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  await assert.rejects(
    () => openOutboxFlow(makeDeps({ fake, store: createDraftStore(), worklogs: memStore() }), '2026-09-21'),
    /暂存不存在/,
  )
})

test('dismissOutboxFlow：删除该日暂存', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const worklogs = memStore()
  await putOutboxFixture(worklogs, '2026-09-21', [outboxEntry()])
  await dismissOutboxFlow(makeDeps({ fake, worklogs }), '2026-09-21')
  assert.equal(worklogs.getOutbox('2026-09-21'), undefined)
})

test('saveNotesFlow：candidateId 解析、id 稳定、换任务、空数组清空', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const worklogs = memStore()
  const candidates = createCandidateStore()
  candidates.put('2026-09-21', new Map([
    [1, { key: 'DEMO-745', name: '插件设置迁移' }],
    [2, { key: 'DEMO-772', name: '另一个任务' }],
  ]))
  const deps = makeDeps({ fake, worklogs, candidates })
  const first = await saveNotesFlow(deps, { date: '2026-09-21', items: [{ candidateId: 1, text: '上午迁移收尾' }] })
  assert.equal(first.items[0]!.taskName, '插件设置迁移')
  assert.ok(!JSON.stringify(first).includes('DEMO-745'), '键不进素材视图')
  const heldId = first.items[0]!.id
  const second = await saveNotesFlow(deps, {
    date: '2026-09-21',
    items: [{ id: heldId, text: '上午迁移收尾（改）' }, { candidateId: 2, text: '下午评审' }],
  })
  assert.equal(second.items[0]!.id, heldId, '已存条目 id 稳定')
  assert.equal(second.items[1]!.taskName, '另一个任务')
  const third = await saveNotesFlow(deps, { date: '2026-09-21', items: [{ id: heldId, candidateId: 2, text: '改记到另一任务' }] })
  assert.equal(third.items[0]!.taskName, '另一个任务', '换任务生效')
  const fourth = await saveNotesFlow(deps, { date: '2026-09-21', items: [] })
  assert.equal(fourth.items.length, 0)
  assert.equal(worklogs.getNotes('2026-09-21')!.items.length, 0, '空数组＝清空')
})

test('saveNotesFlow：candidateId 解析不到（映射失效/新条目缺失）抛可读错误', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const deps = makeDeps({ fake, worklogs: memStore(), candidates: createCandidateStore() })
  await assert.rejects(
    () => saveNotesFlow(deps, { date: '2026-09-21', items: [{ candidateId: 9, text: 'x' }] }),
    /任务选择已失效/,
  )
  await assert.rejects(
    () => saveNotesFlow(deps, { date: '2026-09-21', items: [{ text: 'x' }] }),
    /缺少任务选择/,
  )
})

test('saveNotesFlow：worklogs 缺席抛存储不可用', async () => {
  await assert.rejects(
    () => saveNotesFlow(makeDeps({ fake: fakeJira({}) }), { date: '2026-09-21', items: [{ candidateId: 1, text: 'x' }] }),
    /存储不可用/,
  )
})

test('overviewFlow：outbox 概要并入、空暂存省略、读取失败 outboxError（月历不受影响）', async () => {
  const fake = fakeJira({ logs: { 'DEMO-745': [worklogItem('1', '2026-09-21', '2h', 7200, '联调')] } })
  const worklogs = memStore()
  await putOutboxFixture(worklogs, '2026-09-21', [outboxEntry()])
  const view = await overviewFlow(makeDeps({ fake, worklogs }), '2026-09-24')
  assert.deepEqual(view.outbox, { days: [{ date: '2026-09-21', count: 1 }], total: 1 })
  await worklogs.deleteOutbox('2026-09-21')
  const empty = await overviewFlow(makeDeps({ fake, worklogs }), '2026-09-24')
  assert.equal(empty.outbox, undefined, '空暂存字段省略')
  const errView = await overviewFlow(makeDeps({ fake, worklogs: failingStore() }), '2026-09-24')
  assert.equal(errView.outboxError, true, '读取失败错误态')
  assert.equal(errView.error, undefined, '月历查询不受存储影响')
  const absent = await overviewFlow(makeDeps({ fake }), '2026-09-24')
  assert.equal(absent.outbox, undefined, '存储缺席省略')
})

test('dayDetailFlow：notes 读取、候选集＝watched∪已登记∪素材任务、映射注册', async () => {
  const fake = fakeJira({
    issues: [issueData()],
    logs: { 'DEMO-745': [worklogItem('1', '2026-09-21', '2h', 7200, '联调')] },
  })
  const worklogs = memStore()
  const candidates = createCandidateStore()
  await worklogs.putNotes({
    date: '2026-09-21', createdAt: NOW, updatedAt: NOW,
    items: [{ id: 'n-1', issueKey: 'NOTE-1', taskName: '素材任务', text: '评审', createdAt: NOW, updatedAt: NOW }],
  })
  const view = await dayDetailFlow(makeDeps({ fake, worklogs, candidates }), '2026-09-21')
  assert.deepEqual(view.notes, [{ id: 'n-1', taskName: '素材任务', text: '评审' }])
  assert.ok(view.candidates!.some(item => item.name === '素材任务'), '素材任务并入候选')
  assert.ok(view.candidates!.some(item => item.name === '示例任务甲'), 'watched 任务并入候选')
  const map = candidates.get('2026-09-21')!
  assert.ok([...map.values()].some(ref => ref.key === 'NOTE-1'), '候选映射含素材任务键')
  assert.ok([...map.values()].some(ref => ref.key === 'DEMO-745' && ref.name === '示例任务甲'), '候选映射含 watched 键')
  assert.ok(!JSON.stringify(view.candidates!).includes('NOTE-1'), '键不进候选视图')
})

test('generateFlow：素材进生成＋不可解析素材任务降级（existingKeys 组装不变量——T03 review F3）', async () => {
  // watched 仅 DEMO-745；核查 JQL 命中 REAL-9（原始形态）、不命中 NOTE-GONE
  //——核查命中键经 issueSummary 归一化后进 existingKeys（round-01 P1 回归：真实键不得误判不可解析）
  const fake = fakeJira({
    issues: [issueData('插件设置迁移', 'DEMO-745')],
    issueKeySearch: [issueData('真实存在任务', 'REAL-9')],
  })
  const worklogs = memStore()
  await worklogs.putNotes({
    date: '2026-09-21', createdAt: NOW, updatedAt: NOW,
    items: [
      { id: 'n-1', issueKey: 'DEMO-745', taskName: '插件设置迁移', text: '上午迁移收尾', createdAt: NOW, updatedAt: NOW },
      { id: 'n-2', issueKey: 'NOTE-GONE', taskName: '已删除任务', text: '做旧事', createdAt: NOW, updatedAt: NOW },
      { id: 'n-3', issueKey: 'REAL-9', taskName: '真实存在任务', text: '核对线上配置', createdAt: NOW, updatedAt: NOW },
    ],
  })
  const doc = await generateFlow(makeDeps({ fake, worklogs }), '2026-09-21')
  assert.ok(doc.tasks.some(task => task.name === '插件设置迁移'), 'watched 任务存活（F3 不变量：existingKeys 含 watched）')
  assert.ok(!doc.tasks.some(task => task.name === '已删除任务'), '不可解析素材任务剔除')
  assert.ok(doc.tasks.some(task => task.name === '真实存在任务'), '核查命中的真实键素材任务存活（P1 回归）')
  assert.equal(doc.degradedNotes!.length, 1)
  assert.ok(doc.degradedNotes![0]!.includes('已删除任务') && doc.degradedNotes![0]!.includes('不可解析'))
})

test('generateFlow：素材读取抛错降级空素材照常生成（存储故障不阻断，S12）', async () => {
  const fake = fakeJira({ issues: [issueData()] })
  const doc = await generateFlow(makeDeps({ fake, worklogs: failingStore() }), '2026-09-21')
  assert.equal(doc.entries.length, 1)
})

test('JWL_DEBUG_STORE_FAIL=io：flows 存储操作抛错（overview 错误态）', async () => {
  process.env.JWL_DEBUG_STORE_FAIL = 'io'
  try {
    const fake = fakeJira({ logs: { 'DEMO-745': [worklogItem('1', '2026-09-21', '2h', 7200, '联调')] } })
    const view = await overviewFlow(makeDeps({ fake, worklogs: memStore() }), '2026-09-24')
    assert.equal(view.outboxError, true)
  } finally {
    delete process.env.JWL_DEBUG_STORE_FAIL
  }
})

test('存储缺席：overview 置 outboxUnavailable、dayDetail 省 candidates/notes（区域降级——终审 F-1）', async () => {
  const fake = fakeJira({
    issues: [issueData()],
    logs: { 'DEMO-745': [worklogItem('1', '2026-09-21', '2h', 7200, '联调')] },
  })
  const view = await overviewFlow(makeDeps({ fake }), '2026-09-24')
  assert.equal(view.outboxUnavailable, true, '提示条降级信号')
  assert.equal(view.outbox, undefined)
  const detail = await dayDetailFlow(makeDeps({ fake }), '2026-09-21')
  assert.equal(detail.candidates, undefined, '存储缺席省候选（素材区降级提示、无下拉）')
  assert.equal(detail.notes, undefined)
  assert.equal(detail.notesError, undefined, '缺席与读失败可区分')
  assert.equal(detail.tasks.length > 0, true, '日详情本体不受影响')
})
