# 开发指南

面向维护者。用户安装说明见 [README](../README.md)。

## 只需要记住三件事

1. **新增插件**：`pnpm create-plugin <name>`，然后 `pnpm install && pnpm -r build`。
2. **怎么用**：自己用 `link:` 装；分享/换机用 GitHub 固定 commit。这两种都**不需要发布**。
3. **要发 npm**：按 [RELEASING.md](RELEASING.md) 走一遍，最后打 `dsh-<name>@<version>` tag。

其余细节（结构、产物、版本语义、CI 检查什么）本文与 [decisions.md](decisions.md) 有完整说明；
CI 会自动拦住常见错误（聚合清单过期、产物没入库、类型或测试失败）。

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
├── deepseek-harness/     # submodule：DSH 上游源码，只读参考
└── docs/                 # 本文档、发布流程、设计决定
```

## 上游源码（只读参考）

`deepseek-harness/` 是 DSH 上游仓库的 submodule，浅克隆，只用来读实现、查 API；
它不参与 `packages/*` 的构建与发布，CI 也不初始化它。**不要修改它，也不要在子模块里提交。**

首次检出：

```sh
git submodule update --init
```

把源码切到与本机 DSH 一致的版本（上游 tag 形如 `dsh-v0.2.2-rc.3`，与 `dsh --version` 对应）：

```sh
cd deepseek-harness
git fetch --depth 1 origin tag dsh-v<version>
git checkout --detach dsh-v<version>
cd ..
```

切换后父仓库会显示 submodule 指针变化。想把这版源码记进历史，就提交这个指针：

```sh
git add deepseek-harness
git commit -m "chore: bump dsh source to dsh-v<version>"
```

只想本地看、不想让父仓库变脏，可以 `git config submodule.deepseek-harness.ignore all`。
需要更早的历史时，在子模块里执行 `git fetch --unshallow`（会补全完整历史，体积较大）。

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
新插件的标题、描述、README 与图标按 [PLUGIN-GUIDE.md](PLUGIN-GUIDE.md) 完成。
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
2. **包必须自包含。** 源码不 import 兄弟包；运行期只依赖宿主提供的 `@deepseek-ai/*`
   （声明为 `peerDependencies`）。依赖里不要出现 `workspace:`。唯一的例外是 bundle 组合：
   一个包可以声明另一个可独立安装的 bundle 为依赖，并插入它的行；组合与被随附包不要同时安装。
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
