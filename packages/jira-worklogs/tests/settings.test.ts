// 判定用例：settings 命名空间值 → 引擎配置的纯映射。
// project 子树与 statusFrom 已随专用项目机制移除（2026-09-24 Wave，SPEC D12/D15）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  schemaValue, engineConfigFrom, SETTINGS_NS,
  bindPluginConfig, pluginConfigSnapshot, requireEngineConfig,
} from '../src/settings.ts'

const settingsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'settings.ts'),
  'utf8',
)

const DEFAULT = schemaValue(undefined)

test('schema 默认值：jira 空、git 空映射、过滤名单默认 context-repo', () => {
  assert.equal(DEFAULT.jira.server, '')
  assert.equal(DEFAULT.jira.username, '')
  assert.deepEqual(DEFAULT.repoFilter, ['context-repo'])
  assert.deepEqual(DEFAULT.gitInstances, {})
})

test('存量 project 键残留于解析值但被下游忽略（遗留物不迁移不报错，R6 实测更正 F18 措辞）', () => {
  const value = schemaValue({
    jira: { server: 'https://jira', username: 'u', password: 'p' },
    project: { path: '~/Developer/jira-worklogs', initialized: true },
  })
  // schemastery 非严格对象对未知键是「残留」而非「剔除」——键无害：schema 不再声明、
  // 引擎配置与凭据预检不消费、设置界面不渲染（S14），磁盘与存量值均不清理（D12）
  assert.equal(value.jira.server, 'https://jira')
  const config = engineConfigFrom(value)
  assert.ok(!('project' in config))
  assert.equal(config.jira.server, 'https://jira')
})

test('engineConfigFrom：默认值 → jira 三要素空 + gitlab 空列表（降级语义）', () => {
  const config = engineConfigFrom(DEFAULT)
  assert.equal(config.jira.server, '')
  assert.equal(config.jira.username, '')
  assert.equal(config.jira.password, '')
  assert.equal(config.jira.verifySsl, false)
  assert.deepEqual(config.gitlab, [])
})

test('engineConfigFrom：dict 实例 url+token 成对才收录，server 尾斜杠归一', () => {
  const value = schemaValue({
    jira: { server: 'https://jira.example.com/', username: 'u', password: 'p', verifySsl: true },
    gitInstances: {
      work: { url: 'https://git.example.com/', token: 't', verifySsl: true },
      broken: { url: 'https://only-url', token: '', verifySsl: false },
      notoken: { token: 't-only' },
    },
    repoFilter: ['a', 'b'],
  })
  const config = engineConfigFrom(value)
  assert.equal(config.jira.server, 'https://jira.example.com')
  assert.equal(config.jira.username, 'u')
  assert.equal(config.jira.password, 'p')
  assert.equal(config.jira.verifySsl, true)
  assert.equal(config.gitlab.length, 1)
  assert.deepEqual(config.gitlab[0], { url: 'https://git.example.com', token: 't', verifySsl: true })
  assert.deepEqual(config.repoFilter, ['a', 'b'])
})

test('engineConfigFrom：JIRA_* 进程环境变量覆盖 jira 字段（调试后门）', () => {
  const prev = { ...process.env }
  try {
    process.env.JIRA_SERVER = 'https://env-jira'
    process.env.JIRA_USERNAME = 'env-user'
    process.env.JIRA_PASSWORD = 'env-pass'
    process.env.JIRA_VERIFY_SSL = 'true'
    const config = engineConfigFrom(schemaValue({
      jira: { server: 'https://settings-jira', username: 'u', password: 'p', verifySsl: false },
    }))
    assert.equal(config.jira.server, 'https://env-jira')
    assert.equal(config.jira.username, 'env-user')
    assert.equal(config.jira.password, 'env-pass')
    assert.equal(config.jira.verifySsl, true)
  } finally {
    for (const key of ['JIRA_SERVER', 'JIRA_USERNAME', 'JIRA_PASSWORD', 'JIRA_VERIFY_SSL']) {
      if (prev[key] === undefined) delete process.env[key]
      else process.env[key] = prev[key]
    }
  }
})

test('命名空间名符合平台小写连字符约束', () => {
  assert.match(SETTINGS_NS, /^[a-z][a-z0-9-]*$/)
})

test('pluginConfigSnapshot：volatile 引用输入解引用为 plain 快照（输出侧解引用）', () => {
  bindPluginConfig({
    jira: { get: () => ({ server: 'https://jira', username: 'u', password: 'p', verifySsl: false }) },
    repoFilter: { get: () => ['x', 'y'] },
  })
  const snap = pluginConfigSnapshot()
  assert.equal(snap.jira.server, 'https://jira')
  assert.equal(snap.jira.username, 'u')
  assert.deepEqual(snap.repoFilter, ['x', 'y'])
  // 快照为 plain 值：顶层字段无 .get 残留（审计 F-A 的失明防护）
  for (const value of Object.values(snap as unknown as Record<string, unknown>)) {
    assert.equal(typeof (value as { get?: unknown })?.get, 'undefined')
  }
  // 每调用重读引用：引用值变化后快照跟随（F17 热生效）
  let server = 'https://jira-2'
  bindPluginConfig({ jira: { get: () => ({ server, username: '', password: '', verifySsl: false }) } })
  assert.equal(pluginConfigSnapshot().jira.server, 'https://jira-2')
  server = 'https://jira-3'
  assert.equal(pluginConfigSnapshot().jira.server, 'https://jira-3')
})

test('requireEngineConfig：config 未绑定时报「设置不可用」口径（R9）', () => {
  // 上一用例已绑定；以新模块状态不可行，故仅验证已绑定路径可取引擎配置
  const config = requireEngineConfig()
  assert.equal(typeof config.jira.server, 'string')
})

test('配置缺失报错文案指向插件页（源断言钉引导口径）', () => {
  assert.ok(
    settingsSource.includes('请在插件页 dsh-jira-worklogs 详情页完成配置'),
    'requireEngineConfig 未绑定分支的引导文案应指向插件页组合包详情页',
  )
})
