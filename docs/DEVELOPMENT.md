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

源码版本跟本机安装的 DSH 保持一致，不追上游最新：上游 tag 形如 `dsh-v<version>`，
`<version>` 直接取自 `dsh --version`（如 `0.2.2-rc.3` → `dsh-v0.2.2-rc.3`）。

首次检出（按 tag 浅克隆，只拉这一版）：

```sh
V=$(dsh --version)
git submodule init                            # 只登记 url，不拉对象
git clone --depth 1 --branch "dsh-v$V" \
  git@github.com:deepseek-ai/deepseek-harness.git deepseek-harness
git submodule absorbgitdirs deepseek-harness  # 内嵌 .git 收进 .git/modules
```

**不要用 `git submodule update --init` 做首次检出**：父仓库钉的 commit 是 tag tip，不是默认分支 tip，
`.gitmodules` 的 `shallow = true` 对这次补拉不生效，git 会按 SHA 拉全量历史（200MB+），
既慢又违背“只读参考”。检出后 `git submodule status` 不应带 `+` 前缀（指针与 tag 一致）。

本机 DSH 升级后，只切 tag、不 unshallow：

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

## 开发闭环

单人维护：**开分支、不开 PR**。PR 与网页合并省掉，`main` 由维护者确认后直接接收推送。

1. 从最新 `main` 开分支：`git switch -c feat/<name>-<短描述>`。
2. 改源码，跑完整自检：
   ```sh
   pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm aggregate:check
   ```
   有浏览器半体的改动，再做 [Web 端实测](#web-自主测试)。
3. 在分支上提交（Conventional Commits），**不要**推 `main`。
4. 向维护者汇报：分支名、改动的文件、跑过的命令、Web 实测结论（含截图路径）。
5. 维护者确认后合入并推送：
   ```sh
   git switch main && git merge --ff-only <分支> && git push origin main
   git branch -d <分支>
   ```
   只用 `--ff-only`：分支必须基于最新 `main`，冲突时先在分支上 `git rebase main`，不要用 merge commit。

CI 只在推送 `main` 时运行（`.github/workflows/ci.yml`），它是推送前的最后一道闸门，所以在本地跑绿之前不要推 `main`。

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

### Web 自主测试

Agent 在 Web 端做自主测试时，按下面的步骤走，不要靠猜。

**必须用 Web profile 启动。** `dsh --profile web ...`（profile 名默认是 `web`）；桌面版、`headless`
或默认 profile 起不来 Web GUI。

**服务地址从控制台拿，不要自己拼。** 每个进程启动时生成一个随机 launch token，就绪后打印一行：

```
dsh web: http://127.0.0.1:<port>/?token=<token>
```

访问这个完整 URL。`GET /?token=...` 是本进程唯一的换取 cookie 入口：它写入绑定 authority 的签名 cookie，
再 302 到干净的 `./`。直接打开不带 token 的地址（例如 `http://127.0.0.1:18787/`）会得到 **401**，
这不是「需要额外配置」，而是走错了入口。

后台起服务并取地址：

```sh
logs=$(mktemp)
dsh --profile web --port 18787 --no-open >"$logs" 2>&1 &
url=$(grep -ho 'dsh web: http[^ ]*' "$logs" | head -1 | cut -d' ' -f3)
echo "$url"   # 浏览器打开这一个地址
```

用这个地址之前先看日志有没有 `did not activate`、`duplicate loader entry id`、`failed to import` 告警；
有就让服务继续跑、把它们作为测试结论一起报，不要重试到静默。

测完停进程、摘除插件，别把验证 profile 留脏。

常见错误：

| 现象 | 原因 |
|---|---|
| 直连 `http://127.0.0.1:<port>/` 返回 401 | 没走 `?token=` 入口；用控制台打印的完整 URL |
| 端口连不上 | 自己猜了端口；实际端口以 `dsh web:` 那行为准，默认是 3080 |
| 页面能开但插件行没出现 | 启动的不是 `--profile web`，或插件没装进这个 profile |

## 版本与发布

版本规则见 [decisions.md](decisions.md)，发布步骤见 [RELEASING.md](RELEASING.md)。
发布只针对打磨到位的包；未发布的插件用本地 `link:` 或固定 commit 分发。
