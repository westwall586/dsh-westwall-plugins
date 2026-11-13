# 开发指南

面向维护者。用户安装说明见 [README](../README.md)。

## 环境要求

- Node.js >= 22.19
- pnpm >= 10（仓库用 `packageManager` 钉版本）
- 可运行的 DSH（本地调试用）

## 目录结构

```
.
├── package.json          # 根包：全家桶聚合 bundle（dsh.bundle.patch）
├── index.js              # 根包插件体（无宿主逻辑）
├── cordis.patch.yml      # 生成物：根行 + 各插件行，不要手改
├── pnpm-workspace.yaml   # workspace 与 pnpm 设置
├── packages/<name>/      # 一个插件包 = 一个可独立安装的 bundle
├── templates/hello/      # 新插件蓝本
├── scripts/              # aggregate（生成聚合清单）、create-plugin（脚手架）
└── docs/                 # 本文档、发布流程、设计决定
```

## 常用命令

```sh
pnpm install                       # 一次装齐全部 workspace 依赖
pnpm create-plugin <name> [id]     # 生成 packages/<name>
pnpm -r build                      # 构建全部插件
pnpm -r typecheck                  # 类型检查
pnpm -r test                       # 单元测试
pnpm aggregate                     # 包集合或版本变化后重新生成聚合清单
pnpm aggregate:check               # 校验聚合清单是否过期（CI 用）
```

## 新增插件

```sh
pnpm create-plugin <name> [id]
pnpm install
pnpm -r build
```

模板会生成 `packages/<name>`（`@westwall/dsh-<name>`，插件 id `<id>`），并自动重跑聚合。
之后的开发循环：

```sh
pnpm --filter @westwall/dsh-<name> build
dsh plugin --profile <profile> add link:$(pwd)/packages/<name>
```

## 插件包解剖

| 文件 | 作用 |
|---|---|
| `package.json` | `dsh.bundle.patch` 指向补丁；`dsh.client`（可选）声明浏览器半体；`peerDependencies.@deepseek-ai/dsh` 写兼容区间；`files` 决定 npm 产物 |
| `cordis.patch.yml` | 一条 `insert` 行，把插件挂进 profile 阵容 |
| `src/index.ts` | 宿主半体：`name` / `inject` / `apply(ctx, config)` |
| `lib/` | tsc 产物（**入库**，见下） |
| `client.js` | 浏览器半体单文件（有 UI 时提供，**入库**） |
| `locale/*.json` | 插件页显示用的标题与描述 |
| `icon.svg` | 插件页图标（`exports["./icon"]`） |
| `test/` | 单元测试（Node 原生 `node:test`，直接跑 `.ts`） |

## 硬规则

1. **构建产物入库。** `lib/`（以及 `client.js`）随源码提交。从 GitHub 安装时 pnpm 不会构建，
   只按 `files` 打包仓库里已有的文件；不入库就会装到空壳。
2. **包必须自包含。** 插件之间不互相 import；运行期只依赖宿主提供的 `@deepseek-ai/*`
   （声明为 `peerDependencies`）。依赖里不要出现 `workspace:`。
3. **聚合清单是生成物。** 根 `cordis.patch.yml` 与根 `package.json` 的依赖由
   `pnpm aggregate` 生成，不要手改；增删包或改版本后必须重新生成并提交。
4. **根包与子包不要同时安装。** 否则同一行会被挂两次，启动报 `duplicate loader entry id`。
5. **提交信息用 Conventional Commits。** 如 `feat(hello): ...`、`fix(hello): ...`。

## 本地调试与验证

```sh
# 装进一个验证用 profile
dsh plugin --profile web add link:$(pwd)/packages/<name>

# 启动宿主；确认无「did not activate」等告警
dsh --profile web --port 18787 --no-open
```

装完记得摘除，避免污染 profile：

```sh
dsh plugin --profile web remove @westwall/dsh-<name>
```

也可以一条命令完成「安装 → 启动 → 检查 → 摘除还原」：

```sh
node scripts/smoke-install.mjs link:$(pwd)/packages/<name> --expect "[dsh-<name>] mounted"
```

## 版本与发布

版本规则见 [decisions.md](decisions.md)，发布步骤见 [RELEASING.md](RELEASING.md)。
发布只针对打磨到位的包；未发布的插件用本地 `link:` 或固定 commit 分发。
