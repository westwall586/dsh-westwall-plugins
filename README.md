# westwall DSH 插件库

[DeepSeek Harness](https://www.deepseek.com/harness/)（DSH）的插件 monorepo。
每个 `packages/*` 都是一个**完整、可独立安装、可独立上架 npm** 的 bundle；
仓库根包是**全家桶聚合 bundle**，一条命令挂载全部插件。

## 结构

```
.
├── package.json          # @westwall/dsh-plugins：根聚合 bundle（dsh.bundle.patch）
├── cordis.patch.yml      # 生成物：根行 + 各插件行（pnpm aggregate）
├── packages/<name>/      # 一个插件包 = 一个 bundle，独立版本、独立发布
├── templates/hello/      # 新插件蓝本（pnpm create-plugin 复制它）
├── scripts/              # aggregate（生成聚合清单）/ create-plugin（脚手架）
└── docs/decisions.md     # 命名、版本、产物、发布等已经拍板的约定
```

单包解剖：

| 文件 | 作用 |
|---|---|
| `package.json` | `dsh.bundle.patch` 指向补丁；`peerDependencies.@deepseek-ai/dsh` 写兼容区间；`files` 决定 npm 产物 |
| `cordis.patch.yml` | 一条 `insert` 行，把插件挂进 profile 阵容 |
| `src/index.ts` | 宿主半体：`name` / `inject` / `apply(ctx, config)` |
| `lib/` | tsc 产物（入库，发布前不需要现场构建） |
| `locale/*.json` | 插件页的标题与描述（`meta.title` / `meta.description`） |
| `icon.svg` | 插件页图标（`exports["./icon"]`） |

## 常用命令

```sh
pnpm install                       # 一次装齐所有 workspace 包的依赖
pnpm create-plugin <name> [id]     # 生成 packages/<name>（@westwall/dsh-<name>）
pnpm -r build                      # 构建全部插件
pnpm aggregate                     # 改了包集合/版本后重新生成聚合清单
pnpm aggregate:check               # CI 用：聚合清单是否与包集合一致

# 本地挂载全家桶（先把本仓库 link 进 profile）
dsh plugin --profile web add link:$(pwd)
dsh web                            # 重启后生效

# 只挂一个子包
dsh plugin --profile web add link:$(pwd)/packages/<name>
```

> 根包与子包**不要同时安装**，否则同一行会被挂两次，启动时报 `duplicate loader entry id`。

## 当前状态

骨架阶段：`packages/` 为空，尚未迁入任何插件。下一个动作见 [docs/decisions.md](docs/decisions.md)。
