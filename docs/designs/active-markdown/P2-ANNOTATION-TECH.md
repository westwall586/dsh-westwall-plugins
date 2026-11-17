# Active Markdown P2 技术方案：批注（P2a）

> 状态：设计定稿（2026-11-17），待实现。定位见 [POSITIONING.md](POSITIONING.md)，阶段见 [ROADMAP.md](ROADMAP.md)，地基见 [P0-TECH.md](P0-TECH.md)，翻译见 [P1-TECH.md](P1-TECH.md)。
>
> 本文只覆盖 P2a 批注。P2 原计划把「批注 + 变化」放在一个迭代；现在拆成两段：P2a 做选区批注、组件批注、反馈投递、草稿持久化、发送后清空与旧版全文快照；P2b 再做「只看变化」的块级 diff。本文不实现 diff，但把 P2b 需要的旧版基线先落下来。
>
> 本轮明确不做标签、不做译文批注、不做 AskUserQuestion、不做编辑、不写 DSH 源码。

## 1. 目标与非目标

**目标**

- 在原文上选中任意文字，右键「批注」，写意见；同一条选区可以跨行、跨段落、跨标题、跨列表与引用。
- 对表格、代码块以及后续富组件做整块批注；一类组件一个统一外壳，不为每个组件重写批注入口。
- 批注草稿在刷新页面、重启 DSH 后仍在；不把未发送的批注永久留在磁盘上。
- 反馈以 Markdown 文件附件加入输入框，由用户确认后发送；发送成功后自动清空对应文档的批注，并把发送前的文档全文快照留在隐藏目录。
- 两个文档的批注可以同时进入输入框，也可以只发其中一个；清理必须逐文档正确，不能串。

**非目标**

- 标签、优先级、审阅状态机。
- 译文上的批注。译文是视图，不是第二份真源。
- AskUserQuestion 或任何「组件问用户、答案回传 Agent」的能力。
- 源码编辑、保存、版本守卫。
- P2b 的块级 diff、只看变化、目录高亮。
- 富组件本身（Callout、Mermaid、Markmap）；本轮只预留组件外壳。

**一句话分工**：正文选区与组件外壳在 Client；批注草稿、附件、旧版快照在 Host；发送判定与逐文档提交由 session 级 committer 负责，不挂在某个文档 tab 上。

## 2. 本轮定下的结论

| 项 | 结论 |
|---|---|
| 文本批注 | 任意非空选区；同一行、跨行、跨文本块都可以 |
| 右键触发 | 只有非空选区才打开我们的菜单；没有选区走浏览器原生菜单 |
| 原文菜单 | `批注`、`复制` |
| 译文菜单 | `查看原文`、`复制`；不允许批注 |
| 组件批注 | 表格、代码块、后续非文本块；从组件右上角进入，不走右键 |
| 标签 | 不做。每条批注只有一个 `body`，没有 tag 字段 |
| 草稿范围 | `sessionId + 文档路径`，不是全局按文档 |
| 草稿寿命 | 刷新、重启不丢；20 份文档 / 30 天，LRU + TTL |
| 反馈形态 | Markdown 文件附件，插入输入框时不以正文文本复制 |
| 反馈身份 | `roundId` + `fileHash` + `draftAttachmentId` + 批注草稿存在性 |
| 发送判定 | session 级 committer 监听 `input.attachmentIds`、`phase` 与 `useChat` 的 `FileBlock` |
| 清空时机 | 附件真正进入会话后；发送失败、手动移除都不清 |
| 旧版基线 | 加入输入框时写 pending 全文快照；发送成功后转正到 `reviews/` |
| 快照保留 | 最近 5 轮 / 30 天 / 总量 50 MiB，最新一轮不淘汰 |
| 组件外壳 | `ComponentFrame` 统一标签、动作区、批注状态；全屏与折叠先留槽 |
| 译文 | 不批注，不自动保存译文 |

## 3. 概念与数据模型

### 3.1 文档键

批注草稿按 **`sessionId + 文档路径`** 存，不按文档单独存。

理由：反馈附件属于某个会话的输入框。同一份文档在两个会话各开一个 tab 时，如果草稿只按文档存，两份 `pendingReview` 会抢同一个 key。按会话隔离后，每个会话各有自己的草稿与附件，互不覆盖。

- 路径统一用 `readBytes` 返回的规范绝对路径；相对地址会随工作目录变化，不能让两份草稿抢同一个键。
- Host 记录键是 `sha1(sessionId + '\0' + 绝对路径)` 的十六进制串，记录里保留 `sessionId` 与完整路径。
- 反馈文本里的 `文件路径` 仍用适合 Agent 读的显示路径；身份判定不依赖它。
- 刷新页面、重启 DSH 后 sessionId 不变，草稿仍能恢复。

### 3.2 文本行原子

批注锚点不拿整块 `innerText` 或 `Range.toString()` 直接算偏移。渲染器按源行产出带 `data-line` 的元素，每个元素就是一行文本的原子：

```ts
interface TextLineAtom {
  line: number          // 1-based，相对整份源文件
  blockId: string
  text: string          // 这一行的纯文本投影
}
```

选区起止落在两个 line atom 上；跨行时把中间的 line atom 按文档顺序串起来，行与行之间用 `\n`。这样列表、引用嵌套、软换行、硬换行都不会把偏移算歪，反馈里的行号也能精确到选中行的起止，而不是整块起止。

### 3.3 批注

```ts
type AnnotationKind = 'text' | 'block'

interface Annotation {
  id: string
  seq: number                 // 文档内只增不重排
  kind: AnnotationKind
  body: string                // 唯一用户内容；没有 tag
  quote: string               // 选中的原文，或组件的标签
  prefix: string              // 前 32 个 UTF-16 单元，组件为空
  suffix: string              // 后 32 个 UTF-16 单元，组件为空
  startOffset: number         // 文本批注在行拼接串里的偏移；组件为 0
  blockStartId: string
  blockEndId: string
  blockSignature: string      // 组件批注用；文本批注为空
  section: string             // 捕获时的标题路径，供抽屉分组与无法定位时参考
  lineStart: number           // 1-based，选中行的起止
  lineEnd: number
  createdAt: string
}
```

- 文本批注：`kind: 'text'`，`blockSignature` 为空。
- 组件批注：`kind: 'block'`，`quote` 是组件标签，例如 `表格 · 3 列 × 5 行` 或 `代码块 · ts`；一个组件只允许一条。
- 没有 `tag`、没有 `priority`、没有 `status`。反馈里也不会出现标签。

### 3.4 待发送记录

```ts
interface PendingReview {
  roundId: string
  draftAttachmentId: string
  fileName: string
  fileBytes: number
  fileHash: string            // 反馈文件的 sha256，hex
  sourceHash: string          // 加入输入框时原文的 sha256
  annotations: Annotation[]   // 加入输入框时冻结的副本
  feedback: string            // 加入输入框时冻结的反馈正文
  createdAt: string
}
```

一个批注草稿最多一条 `PendingReview`。它是「这份文档的批注附件」的唯一凭据，也是发送判定与旧版快照的关联点。

`annotations` 与 `feedback` 是冻结副本。加入输入框后继续编辑批注会重做附件并更新这两个字段；一旦进入发送阶段就不再更新，提交时用冻结副本，避免「发出去的是旧文件、元数据写的是新批注」。

### 3.5 草稿记录

```ts
interface AnnotationDraft {
  sessionId: string
  path: string
  annotations: Annotation[]
  pending?: PendingReview
  updatedAt: string
  createdAt: string
}
```

### 3.6 审阅轮次

发送成功后落一轮：

```ts
interface ReviewRound {
  roundId: string
  sessionId: string
  path: string
  sourceHash: string
  feedback: string            // 生成的反馈 Markdown
  sentText: string            // 发送时输入框里的文本，可能为空
  annotations: Annotation[]
  fileName: string
  createdAt: string
}
```

对应的全文快照与元数据落在工作区隐藏目录，见第 8 节。

## 4. 选区、右键与恢复

### 4.1 取消「右键任意行看原文」

P1 的「译文里右键任意一行查看原文」在 P2a 去掉。统一改成：

- 没有非空选区：不打开我们的菜单，保留浏览器原生菜单。
- 选区在原文里：菜单是 `批注`、`复制`。
- 选区在译文里：菜单是 `查看原文`、`复制`。`查看原文` 显示选中行对应的原文行；跨行就显示多行，不再只显示一行。
- 译文未对齐：只给 `复制`，不给 `查看原文`；提示切回原文。
- 选区跨到表格或代码块：不弹文本批注菜单，保留原生菜单，并用 toast 提示「选区包含组件，请单独批注该组件」。
- 组件不通过右键批注；组件有自己的右上角动作区。

### 4.2 选区捕获

1. `contextmenu` 只在选区非空、且右击点落在选区内时处理。
2. 在 `.am-doc` 内找到起止 `[data-line]` 元素；取 `data-line` 与 `data-block-id`。
3. 在起止行元素内用 `Range.cloneRange()` 量出字符偏移，映射到 line atom 的纯文本。
4. 从起止 line atom 之间依次拼接文本，行间用 `\n`；去掉首尾空白后作为 `quote`。
5. 记录前 32 / 后 32 个 UTF-16 单元作为 `prefix` / `suffix`，记录拼接串内的 `startOffset`。
6. `lineStart` / `lineEnd` 取起止行的真实行号；`section` 取起始块的标题路径。
7. 选区中间夹着组件块时拒绝；只允许纯文本块。
8. 一次性把选区值、矩形与文档实例 id 放进菜单 target；菜单打开后即使选区被浏览器清掉，也不再依赖 DOM 选区。

### 4.3 恢复

文本批注的恢复顺序：

1. 按 `startOffset` 取原文，且 `prefix` / `suffix` 都对上：定位成功。
2. 否则在全文按 `quote + prefix + suffix` 唯一搜索：命中一条则定位成功。
3. 零命中或多命中：标记「无法定位」，保留原文与意见，不放到相近文本上。

刻意不做「块级降级」：文本批注被模糊放到另一段会静默错位，比明确失败更糟。

组件批注按 `blockStartId` + 类型 + `blockSignature` 恢复。块 id 找不到、类型变了、签名变了，都标「无法定位 / 内容已变化」，条目保留，允许编辑或删除。

### 4.4 展示

- 正文高亮优先用 CSS Custom Highlight API，不往 React 文本树里插 `<mark>`。不支持时退化为只在抽屉里定位。
- 行号侧或正文右侧放编号 pin；同一起始行有多条时纵向错开。点 pin 打开编辑浮窗。
- 编号按 `seq` 只增不重排；删除不回收编号。
- 抽屉按 `section` 分组；每条显示编号、行号、原文摘要、意见、定位/编辑/删除。
- 删除提供 6 秒撤销；撤销复用原 `id` 与 `seq`。

## 5. 组件批注标准

### 5.1 组件定义

P2a 的组件是**非文本块**：当前是 `table`、`code`；后续扩展 Callout、Mermaid、Markmap 等。段落、标题、列表、引用仍然只走文本选区，不套组件外壳。

```ts
type ComponentKind = 'table' | 'code' | 'callout' | 'mermaid' | 'markmap'

interface ComponentDefinition {
  kind: ComponentKind
  label: string
  actions: readonly ('annotate' | 'copy' | 'fullscreen' | 'collapse')[]
}
```

`componentOf(block)` 负责把块投影成组件；文本块返回 `null`。

### 5.2 ComponentFrame

所有组件共用一个 `ComponentFrame`：

- 顶部：类型标签、可选语言/维度、右侧动作区。
- 动作区：当前放 `批注`；代码块保留 `复制`；`全屏`、`展开/折叠` 先留位置，后续接入。
- 正文：组件自己的渲染内容。
- 外层带 `data-component`、`data-block-id`、`data-source-line`，并显示批注状态。
- 一个组件只允许一条整块批注；已批注时按钮进入「编辑」，不新增第二条。
- 组件批注的 `quote` 用标签，不复制组件全文；行号与块 id 足够让 Agent 定位。

组件外壳是后续富渲染的扩展点：新增组件只注册类型、标签和可用动作，不再各写一套批注入口。

## 6. 反馈文件与身份

### 6.1 为什么用附件

反馈不再以正文文本插入输入框。文本指纹依赖反馈格式、路径行、标题和用户编辑，任何一处改动都可能让「是否已发送」判断失真。改成 Markdown 文件附件后：

- 文件有稳定文件名与内容 hash，身份与反馈正文格式解耦。
- 输入框里是一个附件卡片，用户可另写一句话，也可只发附件。
- Agent 通过 `FileBlock` 拿到文件名与只读路径，直接读取反馈。
- 发送成功时，input facade 会从草稿里移除已发送的 attachment id，给出去确定的「已发送」信号。

### 6.2 文件形态

文件名：

```text
<文档名>-review-<roundId>.md
```

`roundId` 用短随机串，只含 `[a-z0-9]`，保证文件名被 sanitize 后仍然带得住。

文件头：

```md
---
dsh-active-markdown-review: <roundId>
source: docs/designs/active-markdown/P2-ANNOTATION-TECH.md
---

文件路径：docs/designs/active-markdown/P2-ANNOTATION-TECH.md

## 我的反馈

行号：42-44
原文：
> ...

意见：
> ...

请根据以上反馈修改该文件，尽量只改动相关部分。
```

`roundId` 是稳定标识；`fileHash` 是文件字节的 sha256。以后反馈正文格式怎么改，判定只看 `roundId` / `fileHash`。

### 6.3 加入输入框

- 用 `conversation.createDrafts(sessionId, [file], true)` 创建 file draft。
- 用 `inputActions.addAttachments(ids)` 把 id 放进当前输入框。
- 失败时用 `conversation.releaseDraftAttachments(drafts)` 释放 draft，保留批注与草稿。
- 不调用 `inputActions.submit()`，不自动发送。
- 不退回正文插入。附件通道不可用时明确报错，避免出现两套身份判定。

### 6.4 批注改动后的附件同步

附件是快照，不是实时视图。批注增、删、改后，如果附件还在输入框里：

1. 用同一 `roundId` 重新生成文件内容。
2. 创建新的 draft，得到新的 `draftAttachmentId`。
3. `addAttachments` 新 id，再移除旧 id。
4. 更新 `pendingReview` 的 `fileHash`、`fileBytes`、`draftAttachmentId`。

这样不会把旧内容的附件发出去。若用户已手动移除附件，只更新草稿，不自动重建；重新点「加入输入框」时再创建。

如果用户已经在发送中（`phase` 为 `sending` 或 `submitting`），不再重建附件。提交时使用 `PendingReview` 里冻结的 `annotations` 与 `feedback`，与已经上传的文件字节保持一致。发送中的批注编辑不会进入这一轮。

若加入输入框后源文件变化，批注会按锚点重算；旧附件与旧 pending 快照不再代表当前内容。此时提示重新加入，重新加入生成新的 `roundId` 与新 pending 快照。

同一份文档只允许一个待发送附件。已加入时按钮显示「已在输入框」，重复点击复用，不新建。

## 7. 发送判定

### 7.1 四重绑定

| 条件 | 作用 |
|---|---|
| 本文件批注草稿里有 `pendingReview`，且 `annotations.length > 0` | 证明来源是批注 |
| `input.attachmentIds` 包含 `pendingReview.draftAttachmentId` | 证明附件还在输入框 |
| 该 id 解析出的 descriptor 是 `file`，且 `name` / `size` / sha256 与 `pendingReview` 一致 | 证明是这份文件 |
| 发送后的 `FileBlock.attachment.name` 含 `roundId`，或 `attachment.attachmentId` 去掉 `sha256:` 前缀后与 `fileHash` 一致 | 证明已进入会话 |

绝不扫描 `input.attachmentIds` 里的任意 id。Web Clipper 的附件 id 不在任何批注草稿的 `pendingReview` 里，第一、二条就过不了；手动同名文件过不了第三条的 hash。

### 7.2 输入状态

`InputState` 提供：

- `attachmentIds`：当前输入框里的运行时 draft id。
- `phase`：`plain` / `adjudicating` / `claimed` / `submitting` / `sending`。
- `draft`：输入框的纯文本投影。

`submit()` 会把草稿与附件冻结进 `SubmitAttempt`，成功后才 `commit-draft` 清空；失败保留。发送成功时，已发送的 attachment id 会从 `attachmentIds` 移除。

### 7.3 在线判定

1. `phase === 'sending'` 且 `attachmentIds` 包含本文件的 `draftAttachmentId`：记为候选发送。
2. 回到 `plain` 后：
   - id 已消失：发送成功，提交本文件的 round。
   - id 还在：发送失败，保留草稿与批注。
3. `phase === 'plain'` 时 id 消失，且此前没有候选发送：用户手动移除附件，标记「已移除」，保留批注。
4. 排队发送只要 input facade 接受并移除 id，就算已进入会话；后续从队列撤回不自动恢复批注。
5. 只处理普通消息。slash 命令带附件时 `phase` 会走 `submitting` 而不是 `sending`，本版不把命令提交当成批注发送；附件与批注保留，需要用户手动清空。

### 7.4 兜底确认

刷新、关 tab、或 session manager 晚挂载时，用 `useChat` 扫最近几条用户消息：

- 只认 `kind: 'file'` 的 `FileBlock`。
- `attachment.name` 含 `roundId`，或 `attachment.attachmentId` 去掉 `sha256:` 前缀后与 `fileHash` 一致。
- 同时本文件仍有 `pendingReview`。
- 命中即补做提交与清理。

Web Clipper 的文件名与 hash 都不匹配，不会被误认。

### 7.5 两个文档的场景

| 场景 | 结果 |
|---|---|
| 只把 A 的附件放进输入框并发送 | A 提交；B 完全不动 |
| A、B 的附件同时发送 | 两个 id 都在候选集，成功后各自按 `roundId` 提交 |
| A 的附件 + Web Clipper 文件 | 只处理 A；Web Clipper 没有 `roundId` |
| 手动移除 A 的附件 | A 标记已移除，批注保留 |
| 发送失败 | 两个 id 都还在，A、B 都不提交 |
| A 的 tab 未激活或已关闭 | session manager 不依赖 tab，照常提交 |
| 同一文档两个 tab | 共享一个 `pendingReview`，只允许一个附件 |
| 两个文档各发一次 | 两次独立的 `sending → plain`，各自提交 |

## 8. Session 级 committer

### 8.1 为什么不放在文档 Body 里

我看了右栏 tab：document tab 没有 `keepMounted`，非当前 tab 的 Body 会卸载。把 watcher 放在每个文档 Body 里时，只有当前 tab 能及时处理发送；另一个文档的附件虽然发出去了，却没人提交，只能等重新打开再补。

所以把「提交/清理」从文档 Body 提到 session 级 committer。文档 Body 只负责渲染、编辑、加入输入框；committer 负责判发送、清草稿、落旧版。

### 8.2 挂载位置

注册一个不渲染的组件到 `conversation.input.left`：

- 它是 session 作用域，标准 props 带 `sessionId`、`useInput`、`useChat`。
- 只要 composer 挂着，它就在；能点发送就说明它一定在。
- 每个会话一个，不随右栏 tab 切换而卸载。
- 它订阅一个 session 级 pending store；文档 Body 加入输入框时更新这个 store。

### 8.3 职责

- 按 session 加载全部 `pendingReview`。
- 监听 `phase`、`attachmentIds` 与最近用户消息里的 `FileBlock`。
- 发送成功时逐个提交；提交用 `PendingReview` 的冻结副本，不用当前草稿；一个 round 的快照失败不影响另一个。
- 手动移除时标记 detached，不删批注。
- 清空当前文档时同步删草稿、快照与附件。
- 提交后通知仍打开的文档 Body 清空 UI；已关闭的 tab 不需要通知。

### 8.4 同一文档两个 tab

- 共享同一个 `pendingReview` 与批注草稿。
- 已加入输入框时按钮为「已在输入框」，不重复创建附件。
- 若并发创建了第二个附件，committer 以 `pendingReview.draftAttachmentId` 为准，移除多余的那个。
- 两个 tab 的编辑都写同一个 session + 文档的草稿；client store 做序列化，避免后写覆盖先写。

## 9. 存储

### 9.1 草稿 domain

单独开一个 storageDomain，不和翻译缓存混版本：

```ts
defineDomain({
  name: 'active_markdown_annotations',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: {
    drafts: domainTable<string, AnnotationDraft>(annotationDraftSchema),
  },
})
```

- key：`sha1(sessionId + '\0' + canonicalPath)` 的十六进制串。`per-record` JSON 后端只接受 `[A-Za-z0-9_-]`，不能用 `sessionId + '\0' + path` 直接做 key；`sessionId` 与完整路径存在记录里，`annotationPending` 用记录字段过滤。
- 读取同步，写入 durable；domain 打不开时退回内存并提示，不阻塞批注。
- 单份草稿上限 512 KiB；超过拒绝落盘，保留内存并提示。
- 清理：最多 20 份文档草稿，按 `updatedAt` LRU；超过 30 天未更新删除；当前打开的文档不淘汰。
- 在打开 domain 与每次写入时顺手清理，不开定时器。
- 抽屉里提供当前文档「清空」；插件页后续提供「清空全部批注草稿」。

### 9.2 pending 全文快照

加入输入框时，先把当前原文全文写入：

```text
.dsh-active-markdown/reviews/pending/<roundId>.md
```

- 用 `state.text`，不是重新读盘；保证快照就是批注所看的版本。
- 发送成功前，它只是 pending；用户清空或 30 天 TTL 时删除。
- 为什么不等发送成功再写：Agent 可能已经开始改文件，发送瞬间再读会拿到新内容。pending 是旧版的唯一可靠来源。

### 9.3 审阅轮次快照

发送成功后：

1. pending 用 rename 转正到 `.dsh-active-markdown/reviews/<文档>/<roundId>.md`。
2. 写同名 `.json`：

```ts
interface ReviewRoundMeta {
  roundId: string
  sessionId: string
  sourcePath: string
  sourceHash: string
  feedback: string
  sentText: string
  fileName: string
  annotations: Annotation[]
  createdAt: string
  snapshotMissing?: true
}
```

3. 元数据里的 `annotations` 与 `feedback` 取 `PendingReview` 的冻结副本，不取当前草稿。
4. 删草稿与 `pendingReview`。
5. 通知 UI 清空。

顺序是「写快照 → 写元数据 → 删草稿 → 清 UI」。元数据写失败时不清草稿，保留可重试；`roundId` 幂等，重试不会产生重复轮次。

如果 pending 快照在加入输入框时就没写成，不阻塞发送：元数据写 `snapshotMissing: true`，照常清空，提示「旧版未保留」。P2b 对这一轮直接跳过 diff。

### 9.4 清理

- 草稿：20 份文档 / 30 天。
- 快照：每个文档最近 5 轮 / 30 天 / 全局总量 50 MiB；当前最新一轮不淘汰。
- pending：跟草稿一起清，或 30 天 TTL。
- 全部在 `.dsh-active-markdown/` 下，复用现有 `.gitignore`（`*` + `!.gitignore`）。
- 工作区外文档按路径 hash 收进 `reviews/_external/<前 8 位>/`。
- 快照写入先落同目录临时文件再 rename，避免半截文件。

## 10. 反馈文本

附件内容固定为：

```text
文件路径：docs/example.md

## 我的反馈

行号：12-14
原文：
> 原文第一行
> 原文第二行

意见：
> 用户意见

行号：40
原文：
> 表格 · 3 列 × 5 行

意见：
> 表格第三列的时间范围不对

请根据以上反馈修改该文件，尽量只改动相关部分。
```

- 路径只出现一次，写在最前；每条不重复路径。
- 每条只有行号、原文、意见；没有标签、没有优先级、没有版本号。
- 原文按行加 `>`；意见同样按行加 `>`。
- 无法定位的条目排最后，行号写捕获时的行号并注明「原文可能已变化」。
- 组件批注的「原文」用组件标签与维度/语言，不复制组件全文。
- 条数、总字节受草稿 512 KiB 上限约束；超出时提示用户删减，不静默截断。

## 11. 交互与 UI

- 工具栏显示批注数「批注 N」；点击打开抽屉。
- 原文视图支持选区批注；译文视图隐藏批注入口，只保留 `查看原文` 与 `复制`。
- 抽屉在译文视图仍可打开；点条目自动切回原文并滚动到对应行。
- 选择文字后不自动弹浮层；只有右键菜单。避免与宿主选择菜单打架。
- 组件右上角动作区常驻可聚焦；窄栏不溢出。
- 批注浮窗：引用原文、textarea、保存/取消；`Cmd/Ctrl+Enter` 保存。
- 抽屉条目：编号、行号、原文摘要、意见、定位、编辑、删除；删除 6 秒撤销。
- 「加入输入框」把反馈文件挂到 composer；已挂时显示「已在输入框」，可移除后重新加入。
- 发送成功后抽屉清空，显示 toast「已发送并保留旧版」；快照失败时保留批注并提示。
- 全部使用 `--dsw-alias-*` token，不硬编码颜色。

## 12. 失败矩阵

| 失败 | 行为 |
|---|---|
| 选区为空 | 不弹菜单，原生菜单 |
| 选区跨到组件 | 原生菜单 + toast「请单独批注组件」 |
| 译文未对齐 | 只给复制；不能查看原文 |
| 附件服务不可用 | 报错，保留批注，不退回正文插入 |
| composer 忙 | `addAttachments` 返回 false；释放 draft，保留批注 |
| 附件上传失败 | 显示失败，允许重试或移除；不判发送 |
| 草稿 domain 打不开 | 内存模式 + 警告；刷新会丢 |
| 草稿超过 512 KiB | 拒绝落盘，保留内存并提示 |
| pending 快照写失败 | 允许继续编辑与发送；round 标记 `snapshotMissing`，提示旧版未保留 |
| 发送失败 | attachment id 保留，草稿与批注保留 |
| 手动移除附件 | 标记已移除，批注保留 |
| 发送后元数据写失败 | 快照已写，草稿保留，可重试提交 |
| 源文件在批注期间变化 | 锚点重算；无法定位的条目标记，不静默挪位 |
| 加入输入框后源文件变化 | 旧附件与旧 pending 标记过期；提示重新加入，新 roundId / 新快照 |
| 组件内容变化 | 组件批注标记「无法定位 / 内容已变化」，保留意见 |
| 同一文档两个 tab 并发加入 | 只保留一个 pending 附件；多余 draft 移除 |

## 13. 模块划分

Client：

| 文件 | 职责 |
|---|---|
| `client/src/annotate/model.ts` | Annotation、PendingReview、DraftRecord、校验 |
| `client/src/annotate/selection.ts` | line atom、选区捕获、锚点恢复 |
| `client/src/annotate/store.ts` | session 级草稿 store、订阅、加入/移除/清空 |
| `client/src/annotate/feedback.ts` | 反馈 Markdown、文件名、frontmatter、sha256 |
| `client/src/annotate/attachment.ts` | createDrafts / addAttachments / release / 重新生成 |
| `client/src/annotate/committer.tsx` | 挂在 `conversation.input.left` 的 session 级 committer |
| `client/src/annotate/drawer.tsx` | 批注列表、编辑、删除、加入输入框 |
| `client/src/annotate/composer.tsx` | 选区浮窗与组件浮窗 |
| `client/src/markdown/component-frame.tsx` | ComponentFrame、组件注册与动作区 |
| `client/src/menus.ts` | 由 line menu 改为 selection menu |

Host：

| 文件 | 职责 |
|---|---|
| `src/annotate/store.ts` | 草稿 domain、20/30 清理、512 KiB 限制 |
| `src/annotate/reviews.ts` | pending 快照、轮次快照、元数据、5/30/50MiB 清理 |
| `src/annotate/schema.ts` | zod 记录结构 |
| `src/index.ts` | annotationLoad / annotationSave / annotationClear / reviewPrepare / reviewCommit / reviewDetach / annotationPending |

## 14. 实施切片

1. **P2a-1 选区与草稿**：line atom、右键菜单、锚点恢复、session+文档草稿 domain、抽屉、删除撤销。
2. **P2a-2 组件外壳**：ComponentFrame、表格/代码接入、组件批注、统一动作区。
3. **P2a-3 附件与 committer**：反馈文件、createDrafts/addAttachments、四重身份、session committer、两文档同时发送。
4. **P2a-4 旧版快照**：pending 全文、发送后转正、元数据、清理、失败重试。
5. **P2a-5 打磨**：高亮、pin、键盘、空态、文案、性能与浏览器验收。

每一片都可独立验收；P2a-1 不依赖附件，P2a-3 之前可以先用手动清空验证草稿。

## 15. 验收清单

- 原文选中同一行、跨行、跨三个段落，右键都有「批注」；保存后正文高亮与编号正确。
- 没有选区时右键是原生菜单；译文里选中文字只有「查看原文」「复制」，没有「批注」。
- 选区跨到表格或代码块时被拒绝，并提示用组件按钮；组件按钮能创建、编辑、删除一条整块批注。
- 刷新页面、重启 DSH，未发送的批注草稿还在；超过 20 份或 30 天的草稿按规则清理。
- 加入输入框后是一个 `.md` 附件，不是正文；附件的文件名带 `roundId`，内容格式正确。
- 两个文档的附件同时发送，两个文档各自清空并各落一份旧版快照；只发一个时另一个不受影响。
- 附件 id 换成 Web Clipper 的文件不会触发任何批注清理。
- 手动移除附件后批注保留；发送失败后附件与批注都保留。
- 发送成功后草稿删除、旧版快照与元数据存在；元数据写失败时草稿保留并可重试；pending 快照缺失时标记 `snapshotMissing` 并继续发送。
- 同一文档两个 tab 共享草稿，不会创建两个待发送附件。
- 批注编辑后，附件内容同步更新；发送出去的是最新内容。
- 无法定位的文本批注与组件批注有明确标记，不静默错位。
- 译文未对齐时「查看原文」不出现；对齐时跨行选区能显示对应多行原文。
- 全程没有标签字段、没有标签 UI、没有标签进入反馈。
- 没有修改 DSH 源码；只新增本插件 Client/Host 代码与宿主公开 API 调用。

## 16. 待验证与风险

- `conversation.createDrafts` / `addAttachments` 在文档预览 slot 里是否与 web-clipper 的 composer slot 一样可用；需要桌面版与 Web 版各验一次。
- `conversation.resolveDraftAttachments` 是否在具体服务上公开；不可用时保留 `createDrafts` 返回的 descriptor，在线校验仍成立。
- `InputState.attachmentIds` 在发送成功时移除的顺序是否稳定；以 `phase` 回 `plain` 后 id 消失为准，并用 `useChat` 的 `FileBlock` 兜底。
- `FileAttachmentRef.name` 是否完整保留 `roundId`；文件头标记与 `fileHash` 作为后备。
- CSS Custom Highlight API 在 DSH Web / Desktop 的可用性；不可用时退化为抽屉定位。
- session committer 挂 `conversation.input.left` 是否在全部布局（全屏、窄栏、只读预览）都挂载；不挂载时靠重新打开文档时补提交。
- 20 份 / 30 天 / 5 轮 / 50 MiB 是默认值，实测后再调；当前不做用户可配置。
- 同一文档两个会话各有草稿，用户可能误以为共享；README 要写清。
- slash 命令带附件的提交走 `submitting`，本版不清理；这是刻意限制，不是漏判。

## 17. 变更记录

- 2026-11-17：P2a 设计定稿。批注只做文本选区与组件整块，不设标签；反馈改为 Markdown 文件附件，用 `roundId` + `fileHash` + `draftAttachmentId` + 草稿存在性四重绑定；发送判定从文档 Body 提到 session 级 committer，解决两个文档/未激活 tab 的清理；草稿按 session + 文档存，20 份 / 30 天；发送成功写全文旧版快照，保留 5 轮 / 30 天 / 50 MiB；译文不允许批注。
