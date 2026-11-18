# Active Markdown P3 技术方案：源码编辑与显式保存

> 状态：已实现（2026-11-18），Web 版实机复核通过。定位见 [POSITIONING.md](POSITIONING.md)，阶段见 [ROADMAP.md](ROADMAP.md)，批注与变化标记见 [P2-ANNOTATION-TECH.md](P2-ANNOTATION-TECH.md)、[P2b-CHANGES-TECH.md](P2b-CHANGES-TECH.md)。
>
> 本文只覆盖 P3：在预览页里改一小段、显式保存、并发冲突不静默覆盖。不做 WYSIWYG、块级编辑、自动保存、多文件编辑与自动合并。

## 1. 目标与非目标

**目标**

- 阅读 / 编辑两态在同一 tab 内切换，编辑态一眼可辨，有脏标记、有「保存」与「退出」。
- **编辑只对工作区内、且当前会话可写的文件开放**：沙箱之外的文件不给入口，也不做半截可用。
- 保存走版本守卫：内容仍是读到的那一份才写；被别人改过就进冲突态，给出明确出口。
- 保存成功立即重渲染：正文、目录、标题层级、更新标记都按新内容重算；译文按源 hash 标过期。
- 编辑与批注、编辑与译文、批注与译文三组互斥有明确规则和提示，不靠灰色不可点猜。

**非目标**

- WYSIWYG、块级或行内富文本编辑、拖拽排版。
- 自动保存、跨刷新草稿持久化、多文件同时编辑、外部编辑器跳转。
- 三家自动合并（行级 / 词级）；本轮只做「三出口」。
- 全屏编辑：DSH 侧栏自带全屏，不重复做。
- 编辑态批注、译文批注、批注与更新标记同时展示。
- 围栏代码块的语法高亮、补全、搜索替换面板、LSP。

## 2. 本轮定下的结论

| 项 | 结论 |
|---|---|
| 形态 | 阅读 / 编辑两态，同一 tab 内切换，不新开 tab |
| 入口 | 原文视图工具栏「编辑」；译文视图先切回原文；**仅工作区内文件** |
| 编辑器 | CodeMirror 6 源码编辑，行号 + Markdown 语法高亮 |
| 写通道 | 插件 Host 新增 Remote 方法包 `ctx.fs.writeText`，带 `replaceIfVersion` 守卫 |
| 可编辑判定 | 进编辑前问 Host：工作区内、非符号链接、未超限、会话非 read-only；不满足就不给入口并说明原因 |
| 保存后 | 写成功即回到阅读态，紧接着就能批注、看渲染结果 |
| 冲突出口 | 重载 / 覆盖（二次确认）/ 另存为；关闭面板保留草稿继续改 |
| 另存为 | 原文件同目录 `<base>.conflict-<yyyyMMdd-HHmmss>.md`，提示里给完整路径与「复制路径」 |
| 与批注 | 有未发送批注不能进编辑；编辑态不能新建批注 |
| 与译文 | 译文视图不能进编辑；保存后译文被清成未翻译，并提示「原文已更新，译文已失效」 |
| 与更新标记 | 保存后按原基线重算，自己的改动也计入「更新」；不单标、不提示「含你的修改」 |
| Agent 知情 | 反馈 Markdown 附件文件名那行之后加一行「本文件已被用户修改，请重新读取。」，不做主动注入 |
| 草稿 | 只在内存，刷新即丢；退出编辑有脏确认 |
| 上限 | 编辑上限 1 MiB；超限 / 只读 / 工作区外 / 符号链接都不给编辑入口 |
| 工具栏 | 保留顶部工具栏，编辑态换成「保存 / 退出」 |

## 3. DSH 能力边界（已核实）

这一节记录方案依赖的外部事实，以及每条是怎么核到的；实现与评审都以这里为准。

| 事实 | 核实方式 | 对方案的含义 |
|---|---|---|
| 客户端读文件没有写方法 | Inspect `Service` 列 `workspaceFiles`：`read` / `readBytes` / `stat` / `list` / `search` / `changes` | 写必须由插件 Host 自己开口子 |
| 写入有版本守卫 | Inspect `fs`：`writeText(target, text, expected?: FsWriteIntent, signal?, sandboxPolicy?)`，`FsWriteIntent` 为 `{ kind: 'createIfAbsent' }` 或 `{ kind: 'replaceIfVersion', version }`，返回 `FsWriteOutcome { operation, version, before, after }` | 冲突检测不自己造，直接用 `version` |
| 陈旧写有明确错误码 | `dsh-fs` 的 `FS_ERROR_CODES` 含 `FS_STALE_VERSION`、`FS_SANDBOX_DENIED`、`FS_ALREADY_EXISTS` 等，抛 `FsError` | Host 捕获后映射成结构化结果，不把异常抛过线 |
| 写受沙箱围栏 | 桌面 profile 挂的是 `dsh-fs-sandbox`；其 README：`read-only` 拒绝所有变更，`workspace-write` 只许工作区内，`danger-full-access` 不限制；策略来自 `ctx.sandboxPolicy.resolve({ session })` | 写必须带会话的真实策略；只读会话给明确提示 |
| 沙箱内编辑只在工作区内成立 | 同上：`workspace-write` 的白名单就是工作区根，工作区外的写必然被拒 | 编辑只对工作区内文件开放；不做「放宽会话权限」的旁路，见 3.2 |
| 行尾要自己还原 | `dsh-fs-local` 的 `writeText` 原样写入传入的字符串；`restoreLineEndings` 只在 `editText` / `patchText` 里用 | 写通道在落盘前按原文件的行尾风格还原，否则 CRLF 会被打成 LF（实测确认过） |
| 相对路径的根 | `dsh-api-workspace-files` 源码：`workspaceRoot = header.cwd ?? sandboxPolicy.workspaceRoot`，随后 `fs.resolve(path, { cwd })` | 写通道照抄，读写路径语义一致 |
| Agent 的 `edit` 不会被版本拦住 | 桌面 profile 条目 `/include:fs-observation-policy` 状态 `inactive`（该策略只在启用时拒绝「未读或被外部修改」） | 不能指望「Agent 会发现文件变了」；见 3.1 |
| 会话内变更摘要只给 GUI | Inspect `workspaceChanges`：按 session + seq 提供摘要与 diff | 不通知 Agent，不能当通知机制 |

### 3.1 Agent 怎么知道文件被改过

- DSH 官方的「文件变更通知」做法是从 watcher / 工具结果监听器调 `agent.inject()`；它把内容排进下一次模型请求，**不是唤醒**，空闲 agent 保持空闲。
- 主动注入会往会话里塞用户看不见的上下文，且每次保存都要花 token。本轮**不注入**。
- 改为在 P2a 已有的反馈 Markdown 附件里加一行：文件名那行的下一行写 `本文件已被用户修改，请重新读取。` 这句随批注一起进上下文，只花一次；Agent 拿到批注本来也要读文件，读到的是新内容。
- 这行只在「本次打开后保存过」时出现；没改过就不写，避免噪音。

### 3.2 为什么只编辑工作区内的文件

- `workspace-write` 模式下沙箱把可写范围就定为工作区根（加临时目录）。工作区外的文件即使能读、能渲染，写也会被拒。
- 为了「能编辑工作区外文件」去调 `sandboxPolicy.registerWritableRoot`，等于插件背着用户放宽这个会话的写权限；用户明确不要这种旁路，也确认了「在沙箱里编辑没有意义」。
- 所以入口就收在工作区内：工作区内文件在 `workspace-write` 与 `danger-full-access` 下都能正常编辑；`read-only` 会话整个不给编辑。工作区外的文件保持现在的只读预览，不加灰按钮、不加错误提示，就像本来就没有这个功能。
- 「另存为」也因此总是落在工作区内：与原文件同目录，必然可写。

## 4. Host 接口

### 4.1 契约

```ts
type WriteIntent =
  | { kind: 'replace', version: string }   // 读到的版本，守卫通过才写
  | { kind: 'overwrite' }                  // 用户确认覆盖，不带守卫
  | { kind: 'create' }                     // 另存为，目标必须不存在

interface WriteTextRequest {
  sessionId: string
  path: string        // 与读一致：相对工作区根或绝对路径
  text: string
  intent: WriteIntent
}

type WriteTextResult =
  | { status: 'saved', absolutePath: string, version: string, bytes: number }
  | { status: 'stale' }
  | { status: 'exists', absolutePath: string }
  | { status: 'denied', mode: 'read-only' | 'workspace-write' | 'danger-full-access' }
  | { status: 'too-large', limit: number }
  | { status: 'unsupported', reason: 'session' | 'symlink' | 'not-file' | 'fs' }
```

- 结果状态用返回值表达，不用异常：错误码映射在 Host 完成，客户端只做分支。`FS_STALE_VERSION` → `stale`；`FS_SANDBOX_DENIED` → `denied(mode)`；`FS_ALREADY_EXISTS` 与 `FS_NOT_OBSERVED`（本地后端对 `createIfAbsent` 撞名实际抛的码）→ `exists`；其余 → `unsupported/fs`。
- `stale` 不回传外部内容：重载走父级 `reload()`，避免和框架的 revision 刷新打架。
- `bytes` 是 `after` 的字节数，客户端用它做「已保存 · 12.4 KB」提示。

### 4.2 实现要点

```ts
const session = ctx.sessions.get(sessionId)            // 不在 → unsupported/session
const policy = ctx.sandboxPolicy.resolve({ session })
const root = session.header.cwd ?? policy.workspaceRoot
const target = await ctx.fs.resolve(path, { cwd: root, signal })
const info = await ctx.fs.lstat(path, { cwd: root }, signal)
if (info?.type === 'symlink') return unsupported('symlink')
const expected = intent.kind === 'replace' ? { kind: 'replaceIfVersion', version: intent.version }
  : intent.kind === 'create' ? { kind: 'createIfAbsent' }
  : undefined
try {
  const outcome = await ctx.fs.writeText(target, text, expected, signal, policy)
  return { status: 'saved', absolutePath: target.displayPath, version: outcome.version, bytes: text.length }
} catch (error) { /* FsError → 上表的 status */ }
```

- 1 MiB 上限在 Host 与客户端各判一次：Host 是权威（防止旧客户端），客户端提前把按钮关掉。
- 行尾：写之前读一次目标文件（`fs.readText`），原文含 `\r\n` 就把传入的 LF 文本转回 CRLF 再写。编辑器永远只持有 LF；保存失败或读不到原文时按 LF 原样写入。
- `fs` / `sandboxPolicy` / `sessions` 用 `ctx.inject` 拿，缺任一就返回 `unsupported/fs`，不让插件启动失败。
- 写不经过模型工具层，是用户显式动作；因此不注册 `fs/write-intent` 监听、不经过 `tools` 审批。

### 4.3 可编辑判定 `editCheck`

进编辑前先问一次 Host，避免把按钮做成「点了才报错」：

```ts
interface EditCheckRequest {
  sessionId: string
  path: string
  bytes: number        // 客户端已知的文件字节数
}

type EditCheckResult =
  | { status: 'ok', absolutePath: string, version: string }
  | { status: 'outside' }
  | { status: 'read-only', mode: 'read-only' }
  | { status: 'too-large', limit: number }
  | { status: 'unsupported', reason: 'session' | 'symlink' | 'not-file' | 'fs' }
```

- `outside`：`!ctx.fs.contains(workspaceTarget, target)`——工作区外的文件不给入口，也不解释成错误。
- `read-only`：会话策略为 `read-only` 时不给入口，提示「当前会话文件策略为只读」。
- 打开文档时查一次决定按钮形态；点「编辑」时再查一次（策略可能刚被用户切换过），通过才进编辑。

## 5. 客户端状态机

```ts
type Editing = null | {
  draft: string                 // 编辑器当前全文
  savedText: string             // 上次成功保存的全文，用来算 dirty
  version: string               // 当前已知版本（保存成功后替换）
  saving: boolean
  conflict: null | { reason: 'stale' }
  external: boolean             // 编辑中收到别处的更新
}
```

| 事件 | 行为 |
|---|---|
| 进入编辑 | `editCheck` 通过后：记下阅读态顶部块的源行号；`draft = state.text`；收起目录浮层与选区菜单 |
| 文本变化 | 只改 `draft`；`dirty = draft !== savedText` |
| Cmd/Ctrl+S / 保存 | `saving = true`，`intent: replace(version)` |
| 保存成功 | `savedText = draft`、`version = result.version`、**回到阅读态**，按行号还原阅读位置 |
| 保存 `stale` | `conflict = { reason: 'stale' }`，面板三出口 |
| 保存 `denied` | 顶栏错误条：当前会话文件策略不允许写；保留草稿，不退出编辑 |
| 外部 revision（非自己保存） | 不 dirty 时静默采纳新文本与新版本；dirty 时置 `external = true`，顶栏横幅「文件已在别处更新」。冲突面板打开时不显示这条横幅，两个入口说的是同一件事 |
| 退出 | dirty 先确认；退出后把**最后光标行**（没有光标就用进入编辑时的顶部行）对应的块滚到顶部附近 |

保存成功即回阅读态，是为了接上「先改完、再在结果上批注」的流程；连改多处时再点一次「编辑」即可。

### 5.1 互斥规则

| 当前状态 | 编辑 | 批注 | 翻译 |
|---|---|---|---|
| 原文、工作区内、可写会话、无未发送批注 | ✅ | ✅ | ✅ |
| 原文、有未发送批注 | ❌ 提示先发送或丢弃 | ✅ | ✅ |
| 编辑态 | ✅ | ❌ | ❌ |
| 译文视图 | ❌ 先切回原文 | ❌（P2a 已定） | ✅ |
| 工作区外 / `read-only` 会话 / 超 1 MiB | ❌ 不渲染入口 | ✅ | ✅ |

- 「有未发送批注」看当前文档的批注草稿条数（P2a 的 `annotationList`），不是「已加入输入框」的送审记录——只看 `pending` 会漏掉刚存下、还没加入对话的批注。此时「编辑」按钮仍可点，点了给提示条「先发送或丢弃 N 条批注」，比灰按钮更容易理解。
- 编辑态的工具栏只留「保存」「退出」与行数/字数；目录、翻译、批注入口整体不渲染，而不是灰掉。
- 从译文切回原文不清空译文缓存，回到阅读态仍可再切回译文。

## 6. 冲突

保存返回 `stale` 时弹冲突面板，三个出口，语义各不相同：

1. **重载**：丢弃草稿，退出编辑，`renderer.reload()` 看外部版本。按钮文案写「重载（丢弃我的修改）」。
2. **覆盖**：二次确认「这会用你的内容覆盖磁盘上的新版本，对方的改动会丢失」→ `intent: overwrite`。成功后按保存成功的路径回阅读态。
3. **另存为**：`intent: create` 写到原文件同目录 `<base>.conflict-<yyyyMMdd-HHmmss>.md`（同名存在就追加 `-2`、`-3`）；成功后回阅读态、`renderer.reload()` 原文件，并给一条提示「已另存为 `<绝对路径>`」，带「复制路径」按钮。

关闭面板（Esc / 点面板外）**不重载**，保留草稿继续编辑——误按 Esc 不能丢内容。冲突期间 Cmd+S 只重新尝试保存，不重复弹面板。

写入失败但不是 `stale`（文件被删、磁盘错误、后端异常）时，错误条里也给「另存为」，因为这时另存为还有可能成功；只有 `denied`（整体不可写）会连另存为一起拒掉。

另存为落在同目录而不是隐藏目录，是因为用户要找得到：文档就在眼前，文件树里也看得见。原文件必然在工作区内（见 3.2），同目录写不会被沙箱拒。

## 7. 编辑器接入

### 7.1 依赖与体积

| 包 | 用途 |
|---|---|
| `@codemirror/state` / `@codemirror/view` | 核心 |
| `@codemirror/commands` | 历史、默认快捷键 |
| `@codemirror/language` | 高亮框架、括号匹配、输入缩进 |
| `@codemirror/lang-markdown` | Markdown 解析与高亮 |
| `@lezer/highlight` | 自定义高亮样式 |

实测：以上全部 + 行号 / 历史 / 光标 / 括号匹配，esbuild 打包 **516KB minified / 179KB gzip**。现有 `client.js` 273KB，构建守卫 1.5 MiB，两件合一约 790KB，通过。

不引 `@codemirror/language-data`（会把所有语言拖进来）、不引 autocomplete / search / lint。围栏代码块内部不上色，作为已知限制写进 README。

`client.js` 是单文件 IIFE，没有代码分割，CodeMirror 必然进主包：首屏多约 179KB gzip 的传输和解析，验收里加一条「首次打开不卡」。

### 7.2 主题与样式

- 主题全用 `--dsw-alias-*`：背景、正文、光标、选区、活动行、行号、`HighlightStyle` 的标题/强调/链接/代码/引用色都写成 `var(--dsw-alias-…)`，明暗切换跟随，不写死颜色。
- 编辑态不吃正文的内边距：根节点 `padding: 0`、工具栏去掉负外边距，CodeMirror 从工具栏底边铺到侧栏底边，不画卡片边框（用户明确不要内框）。阅读态恢复原有内边距。字体用等宽栈。
- 不使用 CodeMirror 默认的 `oneDark` 之类成品主题。

### 7.3 高度与滚动

- 编辑根节点高度取父级滚动容器（现有 `scrollportOf`）的 `clientHeight`，`resize` 与 `ResizeObserver` 时重设；CodeMirror 在自己的 scroller 里滚动，不和外层 `.body` 形成双滚动条。
- 进入编辑时把编辑根节点滚到可视区顶部，退出时按记下的源行号还原阅读位置。

### 7.4 键位与无障碍

- 绑定 Cmd/Ctrl+S 保存；Esc 走「退出」同一个确认逻辑；不绑 Tab（让 Tab 移焦点，不当缩进键）。
- 编辑器容器 `aria-label` 用「编辑 <文件名>」；工具栏按钮有 `aria-pressed`（编辑态）。
- CodeMirror 自身持有文档，React 只持有影子 `draft`；外部采纳新文本时用一次 `dispatch` 替换全文，避免受控组件来回打架。
- 输入法组合期不触发保存快捷键。

## 8. 保存后的连锁

| 影响面 | 处理 |
|---|---|
| 正文 | `state.text` 与 `version` 就地更新，`parsed` 随 `useMemo` 重算，块 id 与锚点整体重建 |
| 阅读位置 | 按进入编辑时记的源行号，找新解析里包含该行的块，滚到顶部附近 |
| 目录 | 锚点变化，`collapsed` 清空；当前章节按新标题重算 |
| 更新标记 | 基线不变，diff 按新内容重算，自己的改动计入「更新了 N 处」 |
| 译文 | 保存成功后若当前有译文，直接清回未翻译并给一条「原文已更新，译文已失效」提示；不自动重译 |
| 批注锚点 | 保存前已保证没有未发送批注；已发送轮次的旧快照不动 |
| tab | 不重建、不换地址；chip 标题沿用打开时捕获的文件名（见 10） |

## 9. 测试

**单测（`node:test`，纯函数）**

- `writeIntentOf`：三种入口映射到正确的 `FsWriteIntent`，覆盖不带守卫。
- `writeResultOf`：`FS_STALE_VERSION` / `FS_SANDBOX_DENIED` / `FS_ALREADY_EXISTS` / `FS_NOT_OBSERVED` / 其他错误到 `WriteTextResult` 的映射。
- 行尾还原：原文是 CRLF 时写回 CRLF；LF 原文、读不到原文时按 LF 原样写。
- `editCheck`（假 facility）：工作区外、只读会话、符号链接、非普通文件、刚好 1 MiB 与正常六种结果。
- `sameText`：CRLF 与 LF 视为相同，末尾换行视为内容。
- `canEnterEdit`：互斥规则逐格，重点覆盖「译文视图」「未发送批注」「未检查」。
- `saveOutcomeOf`：六种写结果到界面动作的映射。
- `conflictFileName`：同目录、时间戳、撞名追加 `-2`、扩展名保留。
- `lineTarget`：文件头、文件尾、行号越界、空文档。

**Web 实测（每项都要真点）**

- 改一段 → 保存 → 回阅读态、正文立即更新；改标题后目录跟着变。
- 编辑中 Cmd+S、Esc、脏时退出确认。
- 有未发送批注时点「编辑」只给提示，不进入编辑；译文视图点编辑会先切回原文。
- 工作区外的文件、`read-only` 会话、超过 1 MiB 的文件都没有编辑入口。
- 外部改同一文件后保存 → 冲突面板；重载 / 覆盖（二次确认）/ 另存为各走一遍。
- 另存为生成的文件在原文件同目录、文件树可见，提示里有完整路径且「复制路径」可用。
- 符号链接文件没有编辑入口；CRLF 文件保存后仍是 CRLF。
- 明暗主题、窄栏（约 294px）、全屏下编辑器不溢出、无双滚动条。
- 保存后译文标过期；再次翻译与保存译文仍可用。

**实测范围**：2026-11-18 在 Web profile（会话策略 `workspace-write`）里逐项点过：进入编辑、打字、Cmd+S、脏退出确认、未发送批注拦截、冲突三出口、另存为落盘、CRLF 再保存、窄栏（760px 视口）布局。工作区外与只读会话的「没有入口」、符号链接拒绝、译文过期这三项只有单测与代码路径覆盖，没有在浏览器里造出来；下次动这一块时要补点。

## 10. 与 ROADMAP 的差异

- ROADMAP 的验收写「标题变化时 tab 标题同步」。核实后：tab chip 标题在打开时由 `title(address)` 捕获，要活更新得注册 `sidebar.right.pane.tab.title` 槽位，而这一轮改的是正文内容不是文件名。本轮验收改为「保存后 tab 不重建、地址不变」，标题槽位留到以后需要时再做。
- ROADMAP 写「重新加载（保留草稿可复制）/ 覆盖 / 取消」；本方案把「取消」拆成「关闭面板（保留草稿）」和「另存为」，理由是「取消」与「保持编辑」语义重叠，而用户改到一半的稿子必须能带走。

- ROADMAP 写「Agent 运行中进入编辑先提示并二次确认」；本方案没做这条。保存本身有版本守卫，Agent 真改过就进冲突态，弹窗提示只会多一次点击；ROADMAP 已同步改成「不额外拦截」。
- `editCheck` 实际在每个 version 变化时都会重查一次（打开、保存后、外部更新后），比「只在打开与点击时查」多一次廉价 RPC，换来策略切换与文件状态变化的及时入口更新。这是实现时的选择，不影响接口。

## 11. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 主包变大 179KB gzip | 首次打开变慢 | 只在编辑入口加载编辑器代码做不到（无代码分割）；验收里量化首次打开时间，必要时降级为纯文本编辑 |
| 双滚动条 / 高度跳变 | 编辑体验差 | 高度取父级 `clientHeight`，进入与退出各测一次；窄栏与全屏都验 |
| 保存触发父级 revision 刷新 | 草稿被覆盖 | 保存成功后先更新 `savedText`，revision 到来时按 dirty 分流；外部更新另起横幅 |
| 策略在编辑中被切成只读 | 保存失败 | 顶栏错误条说明当前策略，草稿留在内存可复制；不静默丢内容 |
| 大文档渲染 | 卡顿 | 1 MiB 上限 + 实时字数；超限只读 |

## 12. 已定与不再讨论

- 另存为落原文件同目录、固定文件名、不做改名；提示里给完整路径与复制按钮。
- 编辑范围只到工作区内文件；不为工作区外文件放宽会话权限。
- 保存成功回阅读态；上限 1 MiB。
- 自己保存带来的变化不单标，也不加「含你的修改」文案。
- 反馈附件提示语原文：`本文件已被用户修改，请重新读取。`，放在文件名那行之后。
- 冲突面板关闭不重载，草稿留在内存。
