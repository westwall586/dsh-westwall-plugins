# 插件包

本目录下每个子目录 = 一个独立插件包（一个 DSH bundle）。改动某个包之前，先读它自己的
`README.md`（用户视角）与 `docs/`（内部设计）。

## 插件目录

| 目录 | 说明 | 状态 |
|---|---|---|
| [jira-worklogs](jira-worklogs/README.md) | Jira 工时记录：月历缺口、日详情、Git 素材，就地起草并确认后写入 Jira | 草稿 · 推荐本地安装 |
| [feed-ultra](feed-ultra/README.md) | 资讯工作台：RSS、GitHub 榜单、每日早报与 X 书签按天阅读，渠道定时与 AI 翻译 | 草稿 · 推荐本地安装 |

新增插件后把这一行补上。

## 通用规则

### 结构

- 新插件用 `pnpm create-plugin <name> [id]` 生成，不要手抄模板。
- 一个插件包至少包含：`package.json`（`dsh.bundle.patch`、可选 `dsh.client`、`peerDependencies`、
  `files`）、`cordis.patch.yml`（`insert` 行）、`src/index.ts`（宿主半体）、`icon.svg`、
  `locale/*.json`（插件页标题与描述）、测试、`README.md`。
- 有浏览器半体时提供 `client.js`，并在 `package.json#dsh.client` 声明平台与注入。
- **包名与 `cordis.patch.yml` 里的 `name` 必须一致**；插件 `id` 一旦被安装过就不要改（用户配置按 id 存）。

### 依赖

- **包必须自包含**：插件之间不互相 import，不依赖兄弟包，依赖里不出现 `workspace:`。
- 运行期只依赖宿主提供的 `@deepseek-ai/*`：声明进 `peerDependencies`，需要本地类型/测试时再进
  `devDependencies`（从 npm 官方 registry 安装；部分平台包只在官方 registry 有）。
- 第三方运行依赖保持最少，并在包 README 里说明理由。

### 产物

- 模板形态是 `tsc → lib/` 且 `lib/` 入库；从 GitHub 安装时 pnpm 不构建，只打包仓库里已有的文件。
- **TS 直载包**（`exports` 指向 `src/index.ts`）是模板形态的豁免：不需要 `lib/`，
  但必须在包 README 里说明，并保证只用可擦除的 TS 语法。

### 聚合与安装

- 根 `cordis.patch.yml` 与根 `package.json` 的依赖是生成物：改完包后跑 `pnpm aggregate`，
  **不要手改**。
- **根包与子包不要同时安装**，否则启动报 `duplicate loader entry id`。

### 文档

- 用户可见的内容（功能、安装、配置、卸载）写进包 `README.md`；内部设计与命令写进包 `docs/`。
- 插件标题、描述、README 结构与图标按 [../docs/PLUGIN-GUIDE.md](../docs/PLUGIN-GUIDE.md) 写。
- 不把内部迭代记录、验收截图、个人环境信息放进包里。
- 公开仓库：文档与代码里不写邮箱、账号、凭据、本机绝对路径。

### 发布

- 默认不发布。只有打磨到位、要给外部使用的包才发，规则见
  [../docs/decisions.md](../docs/decisions.md) 与 [../docs/RELEASING.md](../docs/RELEASING.md)。
- 发布前从仓库根跑：`pnpm -r build && pnpm -r test && pnpm aggregate:check`。

## 验证

```sh
# 单包测试与类型检查
cd packages/<name>
pnpm test
pnpm typecheck

# 安装冒烟（从仓库根执行）：装 → 启 → 检查 → 摘除还原
node scripts/smoke-install.mjs link:$(pwd)/packages/<name>
```
