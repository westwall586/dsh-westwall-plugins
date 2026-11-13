#!/usr/bin/env node
/**
 * 发布前校验：tag 是否与包版本、聚合清单、产物一致。
 *
 * 用法：
 *   node scripts/release.mjs --tag dsh-hello@0.1.0
 *   node scripts/release.mjs --tag dsh-hello@0.1.0 --publish   # 校验通过后发布该包
 *
 * 只处理形如 dsh-<name>@<version> 的 tag；一个 tag 只对应一个包。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = join(root, 'packages')
const TAG_RE = /^dsh-([a-z0-9][a-z0-9-]*)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/

function fail(message) {
  console.error(`[release] ✗ ${message}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const tagIndex = args.indexOf('--tag')
if (tagIndex === -1 || args[tagIndex + 1] === undefined) {
  console.error('用法：node scripts/release.mjs --tag dsh-<name>@<version> [--publish]')
  process.exit(2)
}
const tag = args[tagIndex + 1]
const publish = args.includes('--publish')

const match = TAG_RE.exec(tag)
if (match === null) fail(`tag 不符合 dsh-<name>@<version>：${tag}`)
const [, name, version] = match
const expectedPackage = `@westwall/dsh-${name}`

const pkgDir = join(packagesDir, name)
const pkgPath = join(pkgDir, 'package.json')
if (!existsSync(pkgPath)) fail(`没有找到包目录 packages/${name}`)

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

if (pkg.name !== expectedPackage) fail(`packages/${name} 的包名是 ${pkg.name}，应为 ${expectedPackage}`)
if (pkg.version !== version) fail(`packages/${name} 的版本是 ${pkg.version}，与 tag 的 ${version} 不一致`)
if (pkg.dsh?.bundle?.patch === undefined) fail(`${pkg.name} 没有声明 dsh.bundle.patch`)
if (pkg.dsh?.engines?.dsh === undefined) fail(`${pkg.name} 没有声明 dsh.engines.dsh`)
if (pkg.peerDependencies?.['@deepseek-ai/dsh'] === undefined) fail(`${pkg.name} 没有声明 @deepseek-ai/dsh peer 区间`)

const pinned = rootPkg.dependencies?.[pkg.name]
if (pinned !== version) fail(`根 package.json 里 ${pkg.name} 钉的是 ${pinned ?? '(缺失)'}，应为 ${version}（先运行 pnpm aggregate）`)

const patchText = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
if (!patchText.includes(pkg.name)) fail(`根 cordis.patch.yml 里没有 ${pkg.name} 的行（先运行 pnpm aggregate）`)

const mainFile = pkg.main ?? 'index.js'
if (!existsSync(join(pkgDir, mainFile))) fail(`${pkg.name} 的入口 ${mainFile} 不存在（产物是否已入库？）`)

console.log(`[release] ✓ ${pkg.name}@${version}`)

if (!publish) process.exit(0)

console.log(`[release] 发布 ${pkg.name}@${version} …`)
const result = spawnSync('pnpm', ['--filter', pkg.name, 'publish', '--access', 'public', '--no-git-checks'], {
  cwd: root,
  stdio: 'inherit',
})
if (result.status !== 0) fail(`pnpm publish 失败（退出码 ${result.status}）`)
console.log(`[release] ✓ 已发布 ${pkg.name}@${version}；registry 可见性可能延迟 1–2 分钟`)
