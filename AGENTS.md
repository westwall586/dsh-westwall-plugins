# AGENTS.md

## 项目定位

本项目是 dsh-westwall-plugins，定位是面向 DeepSeek Harness（DSH）用户的插件库：`packages/*` 每个都是一个可独立安装、独立版本的 bundle，根包是把全部插件一次装齐的聚合 bundle；插件通过 npm、GitHub 固定 commit 或本地目录分发。

**技术指标**：

- 公开开源仓库：文档面向用户，不记录个人身份信息、凭据或本机路径
- 插件各自独立版本、独立发布；未打磨的插件走本地 `link:` 或 GitHub 固定 commit，不占用 npm 版本
- 安装目标是用户的 DSH profile（桌面版或 Web 版）；插件不修改 DSH 源码，只通过 bundle patch 挂载
- 兼容范围由每个包的 `peerDependencies` 与 `dsh.engines.dsh` 声明，安装与启动各校验一次；文档不写死基线，用命令查（见下）
- 发布是显式动作、由 tag 门控，CI 必须先绿；不自动全量发布
- 单人维护、单机开发

**技术栈**：

- Node.js + pnpm workspace；版本下限以 `package.json` 的 `engines` / `packageManager` 为准
- TypeScript（版本以各包 `devDependencies` 为准），`tsc` 产出 `lib/`
- DSH Cordis bundle：`package.json#dsh.bundle.patch` + `cordis.patch.yml`
- 测试：`node:test`，Node 原生类型剥离，直接运行 `.ts`
- CI：GitHub Actions；发布：tag 触发 `.github/workflows/release.yml`（trusted publishing，发布开关未开启时只校验）
- registry：安装与发布都使用 npm 官方 registry（`registry.npmjs.org`）

## 项目级约束

- 构建产物**入库**：`lib/`（有浏览器半体时含 `client.js`）。从 GitHub 安装时 pnpm 不构建，CI 会校验产物与源码一致
- 插件包必须**自包含**：源码不 import 兄弟包，依赖里不出现 `workspace:`。bundle 组合（一个包随附另一个可独立安装的 bundle 的行）是唯一例外，规则见 [packages/AGENTS.md](packages/AGENTS.md)
- 聚合清单是生成物：根 `cordis.patch.yml` 与根 `dependencies` 由 `pnpm aggregate` 生成，**禁止手改**
- **根包与子包不得同时安装**，否则同一行挂两次，启动报 `duplicate loader entry id`
- 发布只针对打磨到位的包，tag 形如 `dsh-<name>@<version>`；一个 tag 只发一个包
- 公开仓库：文档与代码里不写邮箱、账号凭据、token、本机绝对路径
- 提交信息用 Conventional Commits
- **默认在 worktree 上开发，自测通过就合 `main`**：代码改动在 `.agents/worktrees/<任务>` 的 `feat/<name>-<短描述>` 分支上做，从最新 `main` 拉出。主 checkout 只跑桌面端与发布，不放半成品：桌面 App 的插件是 `link:` 到它的，半成品会在下次重启时被用户看到
- **合并闸门是自测，不是人工确认**：分支上跑该包的 `typecheck` / `test` / `build` 与 `pnpm aggregate:check`；有浏览器半体的改动再按 [Web 端实测](docs/DEVELOPMENT.md#web-自主测试) 走一遍关键路径。全绿后 `git merge --ff-only` 进 `main` 并推送，当轮删掉 worktree 与分支。桌面端验证由维护者在合并之后做，是验收而不是闸门
- **文档类改动直接进 `main`**：只改 `docs/`、`*.md`、注释与规则、不产生构建产物的改动，不建 worktree 与分支，直接在 `main` 提交推送
- **仍需先问维护者**：发版 tag、强推、删除用户数据、改动维护者的 desktop profile
- **Web 端实测必须用 Web profile**：`dsh --profile web ...` 启动，从控制台 `dsh web: <URL>?token=<token>` 一行取完整地址访问；不要自己拼端口、不要直接打开不带 token 的地址（会 401）。步骤见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#web-自主测试)
- 版本规则、分发矩阵、兼容性策略以 `docs/decisions.md` 为权威说明

## 常用命令

```bash
# 查版本基线：工具版本 + 各包声明的 DSH 兼容区间（不要从文档里读死版本号）
node -v && pnpm -v && dsh --version
node -e 'const fs=require("fs");for(const d of fs.readdirSync("packages")){const f="packages/"+d+"/package.json";if(!fs.existsSync(f))continue;const p=JSON.parse(fs.readFileSync(f,"utf8"));console.log(p.name,p.peerDependencies?.["@deepseek-ai/dsh"]??"-")}'

# 日常
pnpm install                       # 装齐 workspace 依赖
pnpm create-plugin <name> [id]     # 生成新插件包并重生成聚合清单
pnpm -r build && pnpm -r test      # 构建 + 单元测试
node scripts/smoke-install.mjs <spec>   # 装 → 启动 → 校验 → 摘除还原
```

命令与工具的详细用法见 [DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 项目文件

- [DEVELOPMENT.md](docs/DEVELOPMENT.md)：目录结构、构建与测试、新增插件、包解剖与硬规则。写代码、加插件前
- [packages/AGENTS.md](packages/AGENTS.md)：插件包通用规则与插件目录。改动任何包前（进入包目录时也会被自动加载）
- [RELEASING.md](docs/RELEASING.md)：发版步骤、验证与回滚，以及自动发布的一次性配置。发布前
- [decisions.md](docs/decisions.md)：命名、分发方式、版本管理、兼容性。做设计取舍时
- [PLUGIN-GUIDE.md](docs/PLUGIN-GUIDE.md)：插件标题、描述、README、图标与互推规则。写用户可见文案前
- [README.md](README.md)：面向用户的安装与卸载说明。改用户可见行为时
