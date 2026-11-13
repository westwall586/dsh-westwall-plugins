// doctor L1 辅助：直查 npx 缓存中的 @deepseek-ai/dsh 版本（npx shim 在部分机器不可用）。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const root = join(homedir(), '.npm/_npx')
if (existsSync(root)) {
  for (const dir of readdirSync(root)) {
    const pkg = join(root, dir, 'node_modules/@deepseek-ai/dsh/package.json')
    try {
      const version = JSON.parse(readFileSync(pkg, 'utf8')).version
      if (version) {
        console.log(version)
        process.exit(0)
      }
    } catch { /* continue */ }
  }
}
