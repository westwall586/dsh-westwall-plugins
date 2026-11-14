# 设计决定

公开仓库文档：这里只记录与项目使用和维护相关的约定，不记录任何个人身份信息、凭据或本机配置。

## 命名

| 项 | 取值 |
|---|---|
| npm scope | `@westwall` |
| 单插件包名 | `@westwall/dsh-<name>`，目录 `packages/<name>` |
| 根聚合包名 | `@westwall/dsh-plugins`（`private: true`，暂不发布） |
| 插件 id | 小写、短、稳定；默认与目录名一致 |

## 分发方式

| 方式 | 适用场景 | 说明 |
|---|---|---|
| 本地 `link:` | 开发调试 | 改代码重启即生效；依赖变化需重新安装 |
| GitHub 固定 commit | 未发布、试用、分享 | spec 钉 40 位 commit + `&path:/packages/<name>`；仓库公开 |
| npm | 打磨到位、长期使用 | 版本号不可复用；发布前按发布流程校验 |
| 市场索引 | 希望“一键安装” | 索引条目指向 npm 版本或 git commit |

约定：

- **不自动发布。** 发布是维护者在发版时的显式动作；未发布的插件用本地 `link:` 或固定 commit 分发。
- **根聚合 bundle 只在全部子包已发布时使用。** 根包的依赖按 npm 版本解析，存在未发布子包时安装会失败；
  这种情况下用子目录 spec 逐个安装。

## 产物

- `lib/`（以及有浏览器半体时的 `client.js`）**入库**：从 GitHub 安装时 pnpm 不构建，只打包仓库里已有的文件。
- `files` 必须包含运行时入口、`cordis.patch.yml`、`locale/`、`icon.svg`、README。
- 发布前用 `npm pack --dry-run` 核对实际产物。

## 兼容性

- 每个包声明 `peerDependencies.@deepseek-ai/dsh`（多档区间）与 `dsh.engines.dsh`（下限）。
- 宿主在安装前与启动时各校验一次；市场展示只读 `engines.dsh`。
- 当前基线：DSH `0.2.2-rc.2`。

## registry

- **安装**与发布都使用 npm 官方 registry（`registry.npmjs.org`）。
- **发布**固定到 `https://registry.npmjs.org/`：各包 `publishConfig.registry` 已声明。

## bundle 组合

- 一个 bundle 可以**随附**另一个可独立安装的 bundle：在自己的 `dependencies` 里钉它的版本，
  并在自己的 `cordis.patch.yml` 插入它的行，用户装一个 bundle 就得到整套能力。
- 组合仍然遵守自包含：源码不互相 import，依赖里不出现 `workspace:`。被随附的包保持独立可装。
- 例：`feed-ultra` 随附 `web-clipper`；`web-clipper` 也可以单独安装。
- 根聚合由 `scripts/aggregate.mjs` 生成，插入行按行 id 去重并保留首次出现，因此同一个插件行
  不会在根清单里出现两次。
- 安装约束：**组合 bundle 与被随附的包不要同时安装**，否则同一行挂两次，启动报
  `duplicate loader entry id`。
- 发布顺序：**先发被随附的包，再发组合 bundle**。组合的依赖按 npm 版本解析，被随附包尚未
  发布时组合安装会失败；根聚合包同样受这条约束。

## 版本管理

核心：**一个包一个版本号，只在决定发布时 bump；tag 是发布开关。**

- **版本语义（0.x）**：修复 / 文案 / 样式 → `patch`；新功能或需要用户重新配置 → `minor`；
  破坏对外契约（配置形状、工具名、路由）在 0.x 阶段并入 `minor` 并在 Release notes 说明，
  1.0 之后才用 `major`。
- **bump 时机**：只在发版时改版本号，不随每次提交；发布过一次后每次再发都必须 bump。
  未发布的包长期停在任意版本都没关系——本地 `link:` 与 GitHub commit 都不看版本号。
- **tag**：`dsh-<name>@<version>`，一个 tag 只发一个包。不设整仓统一版本。
- **根聚合包**：`private: true`，版本保持 `0.0.0`，不参与发布；只把子包精确版本钉进依赖。
- **预发布**：试用版用 `-rc.N` / `-beta.N` 并以 `--tag next` 发布，`latest` 留给稳定版。
- **变更说明**：用 GitHub Release（关联 tag）记录；暂不引入 changesets。
- **与 DSH 解耦**：插件版本不追随 DSH 版本；兼容性由 `dsh.engines.dsh` 与 peer 区间表达。
- **不发布**：未打磨完的插件用本地 `link:` 或固定 commit 分发；只改文档/测试不需要发版。
