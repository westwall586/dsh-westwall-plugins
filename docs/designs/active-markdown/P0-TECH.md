# Active Markdown P0 技术方案

> 状态：草案（2026-11-16）。定位见 [POSITIONING.md](POSITIONING.md)，阶段见 [ROADMAP.md](ROADMAP.md)。本文是技术方案与取舍，不是实现承诺；P0 结束以第 9 节验收清单为准。

## 1. P0 的目标与非目标

**目标**：证明 Active Markdown 能稳定接管 `.md` 默认渲染，并且从右侧文件列表打开时内容正确、全屏可用、失败可退。顺带把后续阶段要用的地基留好：全文与版本、块模型、图片通道、主题适配。

**非目标**：翻译、批注、编辑、目录、Callout、Mermaid、数学公式、diff、Agent 工具、设置页。P0 的功能面要刻意无聊，价值在“接管可信”。

## 2. 总体判断

1. **P0 以客户端为主，不写 Host RPC。** 读取、版本、图片都可以走宿主已有的 `remote.workspaceFiles`；自建 RPC 只会增加一层要验证的契约。
2. **用 `loading: 'renderer'` 自加载，不用 `text-pages`。** 渲染器需要全文、版本和大小上限，不能等用户滚到底才把文档读完。
3. **一次有上限的 `readBytes` 比逐页 `read` 更适合 P0。** 一次往返拿到全文、版本与总大小；超限直接退，不缓冲大文件。
4. **token 直接渲染成 React 元素，不拼 HTML 字符串。** 关掉原始 HTML 后不需要 DOMPurify，图片、链接、块 id 都可控，后续批注与 diff 也有稳定的 DOM 结构。
5. **块模型在 P0 就定下来。** 即使 P0 不用批注，块 id、行号范围、标题路径、纯文本投影也要开始产出；晚一点补会牵动 P1/P2/P4。
6. **回退是功能，不是异常。** 超大、非 UTF-8、读取失败都要有明确状态和“切回原生 Markdown”的指引，不能白屏或渲染半截。

## 3. 接入边界与数据流

### 3.1 接入边界：容器继承，渲染替换

DSH 的 Markdown 不是一个独立页面，而是原生文档预览 tab 里的一种渲染实现。所以 P0 的接入方式是：

- **不注册新的文件类型或 tab 类型**。文件地址仍由原生文档预览 tab 认领，路径、刷新、外部打开、文件列表、全屏、tab 生命周期都沿用原生。
- **只注册一个 renderer implementation**，替换 `.md` 的正文层：`priority: 'extension'`，默认选中；原生 Markdown 仍在下拉里。
- **不读宿主 DOM、不 patch 宿主组件、不做 overlay**。只用渲染器注册与 `sidebar.right.tab.document` 正文 slot。
- **卸载即恢复**：注册属于 effect，插件停用后 `.md` 回到原生 Markdown。

由此带来的能力归属：

| 能力 | 归属 |
|---|---|
| 文件类型、tab、路径、刷新、外部打开、文件列表、全屏 | 原生，继承 |
| 渲染器选择、正文、图片、链接、代码复制、front matter | Active Markdown，自建 |
| 自动刷新触发、资源观察、tab 生命周期 | 原生触发，Active Markdown 响应 |
| 错误边界 | Active Markdown 自建 |
| 滚动与按 tab 的记忆 | 原生正文容器负责；正文提交后由它恢复位置 |

如果未来审阅需要完全不同的页面布局，再考虑独立的 review tab；P0 不动文件类型。

### 3.2 架构与数据流

```
document preview tab
  └─ renderer: active-markdown (priority: extension, loading: renderer)
       ├─ readBytes(session, path, range: CAP)   ← remote.workspaceFiles
       ├─ UTF-8 fatal decode + NUL check
       ├─ markdown-it tokenize（html: false, linkify: true）
       ├─ block model（id / 行号 / 标题路径 / 纯文本）
       ├─ React render（block 元素带 data-block-id / data-source-line）
       └─ images: readBytes(baseFile) → Blob URL，懒加载 + 缓存
```

注册分两处，同一个 id：

- 元数据：`ctx.documentPreviews.register({ id, extensions: ['md','markdown'], priority: 'extension', title, loading: 'renderer' })`。
- 正文：`ctx.slots.register({ name: 'sidebar.right.tab.document', key: id }, Body)`。

正文拿到 `resourceAddress`、`content`、`scrollportRef`、`useResource`。从地址解析 `sessionId` 与路径；从 `useResource('file')` 拿 `absolutePath`。读取成功后调用 `content.loaded(version)`，失败调用 `content.failed()`；`content.revision` 变化或卸载时中止在途读取。

## 4. 关键取舍

### 4.1 加载模式：选 `renderer`

| 模式 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| `text-pages` | 复用原生分页、自动刷新、行导航 | 用户滚到哪才读哪，拿不到全文；TOC/diff 无法可靠工作 | 不用 |
| `bytes-complete` | 一次拿到全部字节，加载态由宿主负责 | 受宿主的 `maxFileBytes` 上限约束，可能先缓冲 50MB；版本要另查 `stat` | 不用 |
| `renderer` | 自己控制读取上限、版本、错误与重试；先挂载后读 | 要自己实现加载/失败/取消/重载 | **选它** |

`renderer` 的成本是一次性的加载壳：状态机 + 取消 + `loaded/failed`。换来的是后续编辑、翻译、diff 都需要的全文与版本。

### 4.2 读取通道：复用 `remote.workspaceFiles`

- `readBytes(sessionId, path, { range: { offset: 0, length: CAP } }, signal)` 返回 `data`、`eof`、`bytes`、`version`、`absolutePath`。
- `CAP` 取 2 MiB，与 `workspaceFiles.maxBytes` 的默认值一致：一次往返覆盖默认部署，且请求长度本身不会先撞上宿主的窗口上限。宿主配置更小时，按失败里的 `limit` 重试一次；`!eof` 或 `bytes > CAP` 视为超大，显示回退状态，不继续读。
- 用 `TextDecoder('utf-8', { fatal: true })` 解码；出现 NUL 视为二进制；失败显示回退状态。
- CRLF 原样保留，不做换行归一化；P3 保存时要写回原样。
- 不引入自建 Host RPC。等 P1 需要模型调用、P2 需要基线存储时再加 Host 半体。

风险：`remote.workspaceFiles` 是否对第三方客户端插件可用、路径是否接受会话相对路径，需要在 P0 第一个 spike 里确认。不可用时才退回自建 RPC（读取 + 版本两个方法）。

### 4.3 渲染方式：token → React

- `markdown-it`：`html: false`、`linkify: true`、`typographer: false`（避免中文引号被改写）。
- 块级 token 直接映射为 React 元素；行内 token 递归映射（text、strong、em、code、link、image、softbreak、hardbreak、s）。
- 不拼 HTML 字符串，因此不需要 DOMPurify；链接协议、图片地址、代码文本都由我们白名单控制。
- 表格、列表、代码块、任务列表各自处理；任务列表用一个小规则把 `[ ]` / `[x]` 变成 checkbox。
- 代码块 P0 只做语言标签、复制、横向滚动；语法高亮放 P4。
- 数学、Callout、Mermaid 不在 P0。
- 原始 HTML 不执行、不解析：`html: false` 下 HTML 标签与注释按文本呈现，作为已知差异记录；P4 再决定是否支持受控子集。

代价是要自己维护一套行内渲染；收益是块 id、图片懒加载、链接拦截、后续批注高亮都能干净接入。

### 4.4 块模型

每个块至少包含：

| 字段 | 用途 |
|---|---|
| `id` | 类型 + 纯文本 hash + 同名序号；跨修订尽量稳定 |
| `type` | heading / paragraph / list-item / code / table / quote / … |
| `sourceStartLine` / `sourceEndLine` | 反馈行号、编辑重锚、diff 定位 |
| `headingPath` | 批注分组与反馈里的章节路径 |
| `text` | 纯文本投影；hash、引用匹配、字数 |
| `raw` | 该块的源码片段；diff 与编辑重锚的兜底 |

front matter 被切掉后，正文解析要带上原始行号偏移，块的行号始终相对整份源文件。P0 不解析 YAML，front matter 原样显示在正文上方。DOM 上每块一个容器，带 `data-block-id`、`data-block-type`、`data-source-line`。块内不要再嵌块容器（列表项本身是块），这样 P2 的选区偏移与跨块批注才有稳定坐标系。

### 4.5 图片

- 相对路径与绝对路径都走 `readBytes(sessionId, src, { baseFile: absolutePath, range: { length: IMAGE_CAP + 1 } })`。
- 魔数嗅探 PNG / JPEG / GIF / WebP / BMP / ICO / SVG；SVG 解码为文本后用 `image/svg+xml` 的 Blob URL，放在 `<img>` 中不会执行脚本。
- `IntersectionObserver` 懒加载，失败显示 alt；同一 `absolutePath + version` 只读一次；卸载时 revoke 所有 object URL。
- HTTP(S) 图片保留原地址直接渲染；加载失败显示 alt。
- 不走 `/api/file`：Desktop 的 `dsh-app:` 页面没有该 HTTP 路由，字节 + Blob 是两端都安全的路径。

### 4.6 主题与排版

- 只用 `--dsw-alias-*`：`label-primary/secondary/tertiary`、`bg-base`、`bg-layer-1/2`、`border-l1..l4`、`link`、`markdown-code-block`、`interactive-bg-hover`、`state-*`。
- 字号用 `--dsh-content-font-size` / `--dsh-code-font-size`；不自定义字体家族，正文继承宿主。
- 正文不设最大宽度，随预览面板宽度自适应；左右内边距 `clamp(24px, 4%, 56px)`，窄栏不小于 24px，全屏封顶 56px。行高 1.7，段落间距 0.9em。
- 明暗主题靠 token 自动切换，不写 `prefers-color-scheme` 分支。

### 4.7 链接

- `#heading`：滚动到标题 id。
- `dsh-resource://file/...`：`ctx.sidebarRight.openResource(address)`。
- 相对 `.md` / 其他文件：相对文档目录解析后打开侧栏；`..` 越界不解析。
- HTTP(S) / mailto：新窗口打开；不劫持 Ctrl/Cmd 点击。
- 其余协议与不合法地址只显示为文本，不执行。

## 5. 模块划分

```
client/src/
  main.tsx            注册 locale、渲染器、正文、样式
  context.ts          结构化客户端契约（不 import DSH client 包）
  body.tsx            正文壳：加载状态机、scrollport、错误与回退
  source.ts           地址解析、readBytes、UTF-8/上限校验
  markdown/parse.ts   markdown-it 管线、任务列表、front matter 切分
  markdown/blocks.ts  块模型、id、行号、标题路径、纯文本
  markdown/render.tsx 块级与行内 React 渲染
  images.ts           图片读取、嗅探、Blob 缓存、懒加载
  links.ts            链接分类与打开
  styles.css          主题 token 排版
```

Host 半体 P0 只保留一个空 `apply()`，保证 bundle 行存在，后续 P1/P2 再加 RPC、存储与工具。

## 6. 状态与生命周期

- 正文状态：`idle → loading → ready | failed | too-large | not-text`。
- `content.revision` 变化：中止旧请求，清空状态，重新读取。
- 卸载：中止请求，revoke object URL，移除样式。
- `content.loaded(version)` 只在成功渲染后调用；`content.failed()` 在读取或解码失败时调用。
- 不接管滚动容器：滚动、按 tab 记忆位置都由父级正文容器负责。
- `content.loaded(version)` 必须在正文提交之后调用，父级要等正文有完整高度再恢复滚动位置；在读取完成时立刻调用会让恢复发生在空文档上，位置被钳到 0。
- 正文包一层错误边界：渲染崩溃显示可恢复状态和“切换原生 Markdown”的指引，不白屏；错误照常上报。
- 不写文件、不建存储、不发网络请求（图片走宿主字节接口）。

## 7. 失败与回退

| 情况 | 处理 |
|---|---|
| 超过 2 MiB | 显示“文档较大”，提示在上方渲染器下拉切换为 Markdown |
| 非 UTF-8 / 含 NUL | 显示“不是可读文本”，同样给切换指引 |
| 读取失败 | 显示错误码与重试；重试走 `content.reload()` |
| 图片失败 | 显示 alt；不阻塞正文 |
| 插件卸载 | 渲染器注册随 effect 释放，`.md` 回到原生预览 |
| 链接越界 | 不打开；保留 title 提示 |

## 8. 实施切片

| 切片 | 内容 | 完成标志 |
|---|---|---|
| S0.1 | 包骨架、bundle 行、client 构建、locale、渲染器注册 | 渲染器下拉出现“可交互 Markdown”，新开 `.md` 默认选中 |
| S0.2 | 地址解析、`readBytes`、UTF-8/上限、加载与错误状态 | 从文件树打开任意文本 md，能看到原文；超限/二进制有回退 |
| S0.3 | markdown-it、块模型、块级/行内 React 渲染 | 标题、段落、列表、任务列表、引用、表格、代码、链接正确 |
| S0.4 | 图片、front matter、代码复制、链接打开 | 带图文档可用；图片懒加载；`.md` 链接走侧栏 |
| S0.5 | 布局、全屏、主题、窄栏、滚动记忆、性能 | 明暗/窄栏/全屏一致；200 段文档 <1s；切 tab 回来位置还在 |
| S0.6 | 错误边界、回退矩阵、卸载恢复、纯函数测试、演示文档 | 第 9 节验收全过 |

S0.1/S0.2 是 spike 性质：先证明契约，再写渲染。契约不通就换方案，不要先堆 UI。

## 9. 验收清单

**功能**

- 从右侧文件列表点开 `.md`，默认进入 Active Markdown，内容正确。
- 渲染器下拉可切回原生 Markdown；切回后原生行为正常。
- 标题、段落、嵌套列表、任务列表、引用、表格、代码、链接、图片、front matter 都正确。
- 本地图片显示；缺失图片显示 alt；远程图片失败不阻塞。
- 相对 `.md` 链接与 `#` 锚点可用。

**形态**

- 路径、刷新、外部打开、文件列表、全屏都沿用原生，插件没有重写这些入口。
- 右侧栏窄栏不溢出；全屏可用；明暗主题切换无硬编码颜色。
- 滚动由原生正文容器承担，正文不另建滚动层；切 tab 再回来阅读位置还在。

**失败**

- 超过 2 MiB、非 UTF-8、读取失败都有明确状态与切换原生指引。
- 文件被外部修改后，页面提示并可刷新。
- 正文渲染崩溃不白屏，能切回原生。
- 卸载插件后 `.md` 恢复原生预览，无残留样式或 object URL。

**性能**

- 200 段 / 约 2000 行文档首次打开小于 1 秒。
- 图片懒加载，首屏不因图片阻塞。
- client.js 体积在 1.5 MiB 以内。

**测试**

- 纯函数单测：地址解析、路径解析、UTF-8/魔数、front matter、任务列表、块 id、链接分类。
- 一份 P0 演示文档作为人工验收 fixture。

## 10. 实机验证记录

Web 版（`dsh --profile web`，真实宿主 + 浏览器）已确认：

| 项 | 结果 |
|---|---|
| `documentPreviews` 与 `remote.workspaceFiles` 注入 | 可用；`remote` 本身也要注入，否则 `scoped.remote` 是 undefined |
| 第三方 `priority: 'extension'` 默认选中 | 新开 tab 默认进可交互 Markdown，下拉保留原生 |
| `readBytes` 的 `range` / `eof` / `bytes` | 与文档一致；超 2 MiB 走 `too-large` 状态 |
| Blob 图片与 SVG | Web 正常；Desktop `dsh-app:` 仍待验证 |
| 滚动记忆 | 父级容器负责；`loaded` 推迟到正文提交后，切换渲染器与切 tab 都能恢复 |
| 全屏、原生路径、刷新、外部打开、翻译按钮 | 布局与原生一致 |

仍待 Desktop 验证：`dsh-app:` 下的 Blob/CSP、桌面宿主对 `remote.workspaceFiles` 的暴露、卸载后的回归。

### 10.1 未验证项

1. Desktop `dsh-app:` 下的 Blob 图片、SVG 与 CSP。
2. 桌面宿主的自动刷新是否真的调用 `content.reload()`。
3. 插件停用或卸载后，`.md` 是否自动回到原生（需重启宿主）。
4. 渲染器选择在桌面版跨重启的持久化。

## 11. 主要风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 原生能力回退 | 用户失去分页、行跳转、代码高亮 | 超限回退原生；滚动记忆已由原生容器保留；P4 补高亮 |
| 正文崩溃 | 渲染异常导致预览白屏 | 自带错误边界 + 切换原生指引 |
| 契约不稳 | `renderer` 或 `workspaceFiles` 行为与文档不符 | S0.1/S0.2 先 spike，再写 UI |
| 块模型返工 | id 或行号口径错了，P2 全要改 | P0 固定字段与 DOM 约定，先写测试 |
| 图片通道 | Desktop 下 Blob/CSP 限制 | 字节 + Blob 为默认；`/api/file` 不作为依赖 |
| 包体积 | 依赖膨胀拖慢首屏 | P0 不引入高亮/图表/编辑器；1.5 MiB 守卫 |
| 接管太强势 | 用户找不到原生预览 | 下拉保留原生；错误态给切换指引 |
