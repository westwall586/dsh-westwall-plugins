#!/usr/bin/env node
/**
 * 清理已合并的 worktree 与分支。
 *
 * 只处理三件事同时成立的条目：worktree 在 `.agents/worktrees/` 下、分支已合入
 * `main`、worktree 里没有未提交改动。默认只列出来，加 `--apply` 才删除；删除
 * worktree 之后，再删掉因此不再被任何 worktree 占用的已合并分支。
 *
 * 用法：
 *   node scripts/worktree-clean.mjs          # 列出可清理的条目
 *   node scripts/worktree-clean.mjs --apply  # 真的删
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WORKTREES = resolve(root, '.agents', 'worktrees')
const MAIN = 'main'
const APPLY = process.argv.includes('--apply')

function git(args, cwd = root) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function gitOrEmpty(args, cwd = root) {
  try {
    return git(args, cwd)
  } catch {
    return ''
  }
}

/** One `git worktree list --porcelain` record per blank-line block. */
function worktrees() {
  return git(['worktree', 'list', '--porcelain']).split('\n\n').map((block) => {
    const lines = block.split('\n')
    const path = lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length) ?? ''
    const branch = lines.find(line => line.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length)
    return { path: resolve(path), branch }
  })
}

function mergedIntoMain() {
  const names = git(['branch', '--merged', MAIN, '--format=%(refname:short)']).split('\n').filter(Boolean)
  return new Set(names)
}

function underManagedRoot(path) {
  const prefix = WORKTREES + sep
  return path.startsWith(prefix) && path !== resolve(WORKTREES)
}

function cleanWorktree(path) {
  return gitOrEmpty(['status', '--porcelain'], path) === ''
}

const all = worktrees()
const merged = mergedIntoMain()
const checkedOut = new Set(all.map(item => item.branch).filter(Boolean))
const removable = []
const skipped = []

for (const item of all) {
  if (item.path === root) continue
  if (!underManagedRoot(item.path)) {
    skipped.push(`${item.path}（不在 .agents/worktrees 下）`)
    continue
  }
  if (item.branch === undefined) {
    skipped.push(`${item.path}（detached HEAD）`)
    continue
  }
  if (item.branch === MAIN) {
    skipped.push(`${item.path}（在 ${MAIN} 上）`)
    continue
  }
  if (!merged.has(item.branch)) {
    skipped.push(`${item.path}（分支 ${item.branch} 未合入 ${MAIN}）`)
    continue
  }
  if (!cleanWorktree(item.path)) {
    skipped.push(`${item.path}（有未提交改动）`)
    continue
  }
  removable.push({ path: item.path, branch: item.branch })
}

const branches = git(['branch', '--format=%(refname:short)'])
  .split('\n')
  .filter(Boolean)
  .filter(name => name !== MAIN && merged.has(name) && !checkedOut.has(name))
  .filter(name => !removable.some(item => item.branch === name))

if (removable.length === 0 && branches.length === 0) {
  console.log('[worktree-clean] 没有可清理的 worktree 或分支')
} else {
  for (const item of removable) console.log(`[worktree-clean] worktree  ${item.path}  ${item.branch}`)
  for (const name of branches) console.log(`[worktree-clean] branch    ${name}`)
}

for (const item of skipped) console.log(`[worktree-clean] 跳过      ${item}`)

if (APPLY && removable.length + branches.length > 0) {
  for (const item of removable) {
    try {
      git(['worktree', 'remove', item.path])
      git(['branch', '-d', item.branch])
      console.log(`[worktree-clean] 已删除    ${item.path}  ${item.branch}`)
    } catch (error) {
      console.error(`[worktree-clean] 失败      ${item.path}: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    }
  }
  for (const name of branches) {
    try {
      git(['branch', '-d', name])
      console.log(`[worktree-clean] 已删除    ${name}`)
    } catch (error) {
      console.error(`[worktree-clean] 失败      ${name}: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    }
  }
  git(['worktree', 'prune'])
} else if (!APPLY && removable.length + branches.length > 0) {
  console.log('[worktree-clean] 只列出；加 --apply 才会删除')
}
