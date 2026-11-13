#!/usr/bin/env node
/**
 * 安装冒烟：把一个插件装进指定 profile，启动宿主，确认没有加载告警且页面可访问，
 * 然后自动摘除并还原 profile（无论成功或失败都会还原）。
 *
 * 用法：
 *   node scripts/smoke-install.mjs <spec> [--profile web] [--port 18799] [--expect "mounted"]
 *
 * spec 与 `dsh plugin add` 接受的写法一致：
 *   @westwall/dsh-hello
 *   @westwall/dsh-hello@0.0.1
 *   "git+https://github.com/westwall586/dsh-westwall-plugins.git#<commit>&path:/packages/hello"
 *   link:/绝对路径/packages/hello
 *
 * 只用于本地验证；会临时修改 profile 的 package.json / lockfile / 补丁，结束时还原。
 */
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const spec = args[0]
if (spec === undefined || spec.startsWith('--')) {
  console.error('用法：node scripts/smoke-install.mjs <spec> [--profile web] [--port 18799] [--expect text]')
  process.exit(2)
}
const flag = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}
const profile = flag('--profile', 'web')
const port = flag('--port', '18799')
const expect = flag('--expect', undefined)
const profileDir = join(homedir(), '.dsh', 'profiles', profile)
const MANAGED = ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml', 'pnpm-workspace.yaml']
const WARNING_RE = /did not activate|duplicate loader entry|failed to import|Cannot find package/i

if (!existsSync(join(profileDir, 'package.json'))) {
  console.error(`[smoke] profile 不存在：${profileDir}`)
  process.exit(2)
}

const backupDir = join(tmpdir(), `dsh-smoke-${Date.now()}`)
mkdirSync(backupDir, { recursive: true })
for (const file of MANAGED) {
  const from = join(profileDir, file)
  if (existsSync(from)) copyFileSync(from, join(backupDir, file))
}

const readDeps = () => JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')).dependencies ?? {}
const before = readDeps()
let installed = undefined

function restore() {
  for (const file of MANAGED) {
    const from = join(backupDir, file)
    if (existsSync(from)) copyFileSync(from, join(profileDir, file))
  }
}

function removeInstalled() {
  if (installed === undefined) return
  spawnSync('dsh', ['plugin', '--profile', profile, 'remove', installed], { stdio: 'ignore', timeout: 120000 })
  const scope = installed.startsWith('@') ? installed.split('/')[0] : undefined
  const dir = scope === undefined
    ? join(profileDir, 'node_modules', installed)
    : join(profileDir, 'node_modules', scope, installed.split('/')[1])
  rmSync(dir, { recursive: true, force: true })
  if (scope !== undefined) {
    const scopeDir = join(profileDir, 'node_modules', scope)
    if (existsSync(scopeDir) && readdirSync(scopeDir).length === 0) rmSync(scopeDir, { recursive: true, force: true })
  }
}

function finish(code) {
  restore()
  rmSync(backupDir, { recursive: true, force: true })
  process.exit(code)
}

try {
  console.log(`[smoke] 安装 ${spec} → profile ${profile}`)
  const add = spawnSync('dsh', ['plugin', '--profile', profile, 'add', spec], {
    encoding: 'utf8',
    timeout: 300000,
  })
  if (add.status !== 0) {
    console.error(add.stdout ?? '')
    console.error(add.stderr ?? '')
    console.error('[smoke] ✗ 安装失败')
    finish(1)
  }

  const after = readDeps()
  installed = Object.keys(after).find((key) => before[key] !== after[key])
  if (installed === undefined) {
    console.error('[smoke] ✗ 安装后 profile 依赖没有变化，无法确定包名')
    finish(1)
  }
  console.log(`[smoke] 已安装 ${installed}@${after[installed]}`)

  const logs = []
  const child = spawn('dsh', ['--profile', profile, '--port', port, '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()))
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()))
  let exited = false
  child.on('exit', () => { exited = true })

  const deadline = Date.now() + 60000
  let token
  while (Date.now() < deadline && !exited) {
    const text = logs.join('')
    const match = /token=([A-Za-z0-9_-]+)/.exec(text)
    if (match !== null) { token = match[1]; break }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (token === undefined) {
    console.error(logs.join(''))
    console.error(exited ? '[smoke] ✗ 宿主提前退出' : '[smoke] ✗ 60 秒内没有拿到宿主地址')
    child.kill('SIGKILL')
    finish(1)
  }

  const base = `http://127.0.0.1:${port}`
  const first = await fetch(`${base}/?token=${token}`, { redirect: 'manual' })
  let status = first.status
  const cookies = first.headers.getSetCookie?.() ?? []
  if (status >= 300 && status < 400 && cookies.length > 0) {
    const cookie = cookies.map((value) => value.split(';')[0]).join('; ')
    status = (await fetch(`${base}/`, { headers: { cookie } })).status
  }
  child.kill('SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, 1000))
  if (!exited) child.kill('SIGKILL')

  const text = logs.join('')
  const warnings = text.split('\n').filter((line) => WARNING_RE.test(line))
  const failures = []
  if (status !== 200) failures.push(`页面返回 HTTP ${status}`)
  if (warnings.length > 0) failures.push(`启动告警：${warnings.join(' | ')}`)
  if (expect !== undefined && !text.includes(expect)) failures.push(`日志里没有出现「${expect}」`)

  if (failures.length > 0) {
    console.error(text)
    for (const failure of failures) console.error(`[smoke] ✗ ${failure}`)
    finish(1)
  }

  console.log(`[smoke] ✓ 安装、启动、页面访问均通过${expect === undefined ? '' : `（命中「${expect}」）`}`)
  removeInstalled()
  finish(0)
} catch (error) {
  console.error(`[smoke] ✗ ${error instanceof Error ? error.message : String(error)}`)
  removeInstalled()
  finish(1)
}
