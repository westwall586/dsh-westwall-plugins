/**
 * CodeGraph CLI 与索引目录的最小封装。这里只做进程、退出码与文件系统，
 * 不碰协议；MCP 那边由 mcp-client 负责。
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 索引就绪的标志：CodeGraph 自己的数据目录里有数据库文件。 */
export function databasePath(root: string): string {
  const dir = join(root, codeGraphDirName(root))
  return join(dir, 'codegraph.db')
}

export function hasIndex(root: string): boolean {
  return existsSync(databasePath(root))
}

/**
 * 项目的 CodeGraph 数据目录名。与 CodeGraph 的 `codeGraphDirNameFor` 同规则：
 * `CODEGRAPH_DIR` 优先；WSL 下 Windows 盘的项目优先 `.codegraph-wsl`，但已有
 * `.codegraph/codegraph.db` 的项目继续用 `.codegraph`。规则不同会让开关读到的
 * 索引和 MCP 线程实际用的索引不是同一份。
 */
export function codeGraphDirName(root: string): string {
  const override = process.env.CODEGRAPH_DIR?.trim()
  if (override !== undefined && override !== '') return override
  if (process.platform !== 'linux' || !/^\/mnt\/[a-z](\/|$)/i.test(root)) return '.codegraph'
  if (existsSync(join(root, '.codegraph-wsl'))) return '.codegraph-wsl'
  if (existsSync(join(root, '.codegraph', 'codegraph.db'))) return '.codegraph'
  return '.codegraph-wsl'
}

export type CliResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly reason: string }

/**
 * 探测 CodeGraph 可执行文件。顺序与文档一致：配置项、`PATH`、`~/.local/bin`。
 * 找不到返回 undefined，由调用方把它表达成状态而不是异常。
 */
export function resolveCommand(configured: string | undefined, pathEnv = process.env.PATH ?? ''): string | undefined {
  if (configured !== undefined && configured !== '') return existsSync(configured) ? configured : undefined
  for (const dir of pathEnv.split(':')) {
    if (dir === '') continue
    const candidate = join(dir, 'codegraph')
    if (existsSync(candidate)) return candidate
  }
  const local = join(homedir(), '.local', 'bin', 'codegraph')
  return existsSync(local) ? local : undefined
}

/**
 * 跑一次 `codegraph init`。非零退出、超时、被信号结束都折成一条可展示的原因；
 * 调用方把它写进状态机，不会往外抛。
 */
export function runInit(
  command: string,
  root: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(command, ['init'], {
      cwd: root,
      env: { ...env, CODEGRAPH_TELEMETRY: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ ok: false, reason: `codegraph init 超时（${timeoutMs}ms）` })
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.once('error', (error: Error) => {
      clearTimeout(timer)
      resolve({ ok: false, reason: `无法执行 ${command}：${error.message}` })
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve({ ok: true, stdout: output })
      else resolve({ ok: false, reason: `codegraph init 退出码 ${code ?? signal}：${lastLine(output)}` })
    })
  })
}

function lastLine(output: string): string {
  const lines = output.split('\n').map(line => line.trim()).filter(line => line !== '')
  return lines.at(-1) ?? '(无输出)'
}

/**
 * 挑一个足够独特的符号来验证索引。优先源码里的导出名，其次最多的标识符；
 * 全空仓库返回 undefined，交给调用方给出"这个工作区没有可索引的代码"。
 */
export function pickProbeSymbol(root: string): string | undefined {
  const counts = new Map<string, number>()
  const files = walkSources(root, 0)
  for (const file of files) {
    let text: string
    try { text = statSync(file).isFile() ? readText(file) : '' } catch { continue }
    for (const match of text.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) {
      counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 2)
    }
    for (const match of text.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]{4,})/g)) {
      counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 1)
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return ranked[0]?.[0]
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.cs', '.rb', '.php', '.swift', '.kt'])
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '.next', 'coverage', '.turbo'])
const MAX_FILES = 400

function walkSources(root: string, depth: number): string[] {
  if (depth > 6) return []
  let entries: string[]
  try { entries = readdirSync(root) } catch { return [] }
  const found: string[] = []
  for (const name of entries) {
    if (found.length >= MAX_FILES) break
    if (SKIP_DIRECTORIES.has(name) || name.startsWith('.codegraph')) continue
    const full = join(root, name)
    let isDirectory: boolean
    try { isDirectory = statSync(full).isDirectory() } catch { continue }
    if (isDirectory) found.push(...walkSources(full, depth + 1))
    else if (SOURCE_EXTENSIONS.has(name.slice(name.lastIndexOf('.')))) found.push(full)
  }
  return found
}

function readText(file: string): string {
  return statSync(file).size > 512 * 1024 ? '' : readFileSyncUtf8(file)
}

function readFileSyncUtf8(file: string): string {
  try { return readFileSync(file, 'utf8') } catch { return '' }
}
