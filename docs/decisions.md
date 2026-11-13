# 已拍板的约定

> 改这里之前先想清楚：包名、版本号、产物形态一旦发布就无法回退（npm 版本不可复用）。

## 1. 命名

| 项 | 取值 |
|---|---|
| npm scope | `@westwall`（npmjs 用户 westwall 的 scope） |
| 单插件包名 | `@westwall/dsh-<name>`，目录 `packages/<name>` |
| 根聚合包名 | `@westwall/dsh-plugins`，`private: true`（暂不发布；需要 npm 安装全家桶时再放开） |
| 插件 id（cordis entry id） | 小写、短、稳定；默认与 `<name>` 一致 |

## 2. 版本

- 每个插件包**独立 semver**；聚合清单钉**精确版本**（不用 `workspace:*`，否则 git 子路径安装会失败）。
- 发布顺序固定：改代码 → bump 版本 → `pnpm aggregate` → `pnpm install --lockfile-only` → `pnpm -r build` → 发布。
- npm 上已发布的 `包名@版本` 永久占用，不能复用。

## 3. 产物

- `lib/`、`client.js`（若有浏览器半体）**入库**：宿主直接按文件供给，git 安装也不会构建。
- `files` 是手写清单，必须包含运行时入口、`cordis.patch.yml`、`locale/`、`icon.svg`、README。
- 发布前用 `pnpm pack --dry-run` 核对产物，并用 tarball 装进一个临时 profile 实测。

## 4. 兼容性

- 每个包声明 `peerDependencies.@deepseek-ai/dsh`（多档区间）与 `dsh.engines.dsh`（下限）。
- 宿主安装与启动都按 `engines.dsh`，否则回退 `peerDependencies` 校验；市场只按 `engines.dsh` 展示。
- 当前基线：DSH `0.2.2-rc.2`。

## 5. registry

- **安装**沿用全局镜像（`~/.npmrc` 的 `registry.npmmirror.com`）。
- **发布**必须去 `https://registry.npmjs.org/`：各包 `publishConfig.registry` 已钉住。
- 首次发布前：`npm login --registry=https://registry.npmjs.org/`，并确认 `npm whoami` 有输出。

## 6. 上架

- 市场条目只是「包名 + 版本」的路标，安装仍由宿主跑 `pnpm add`。
- 顺序：先自建 format-1 索引自用（可指向 npm 或 git commit+子目录），再考虑投稿 awesome 精选列表。
- 纯聚合包不上架；只登记单个插件包。
