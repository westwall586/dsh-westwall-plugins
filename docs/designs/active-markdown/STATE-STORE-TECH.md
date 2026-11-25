# Active Markdown 状态统一：单文档键易失 Store 方案

> 状态：方案（2026-11-25）。尚未实施。本方案把批注、翻译、编辑草稿、阅读位置等
> “切走时必须存活”的状态收归进一个统一 store，替换当前散落的多个状态容器。
> 宽度与字号、批注归档等后续事项见 [BACKLOG.md](BACKLOG.md)。
>
> **结构已由 [STATE-STORE-SYNTHESIS.md](STATE-STORE-SYNTHESIS.md) 取代**：本文保留定位、
> 三条规则与验收，但第 3 至第 6 节（键、快照、接口、生命周期）按合成设计实现。两份文档
> 冲突时以合成设计为准。

## 0. 定位：只读工具的临时状态

Active Markdown 是右侧栏的阅读器，附带一个临时编辑。它对文档的一切占用都是
**易失的**，这不只是实现取舍，而是产品定位：

- **不成为文档的第二个人工编辑入口**。插件永远不阻碍 Agent 或任何外部渠道修改
  同一份文件；文件变了，插件的临时状态让路。
- **批注**：集中批注、交还 Agent 后即完成使命。归档是将来独立的功能
  （见 [BACKLOG.md](BACKLOG.md)），不在本 store 内。
- **翻译**：低成本派生副本，重翻不贵。
- **编辑**：附带的临时编辑，不是专业编辑器；除非用户主动保存，否则视为可丢。

因此本 store **不做持久化**。它在进程内存里活着，遵循三条规则：

| 场景 | 规则 |
|---|---|
| 切走（切页签、切会话、隐藏侧栏、全屏） | **全部保留**，这就是本方案要解决的问题 |
| 用户主动关闭页签 | **全清**：终止翻译，清批注、翻译、编辑草稿、视图状态 |
| 文档在外部被修改 | **让路**：清批注、翻译、编辑草稿；阅读位置保留 |

## 1. 问题

右侧栏文档页签的 body 在**切换会话时会被宿主卸载**：document preview 的页签类型
（`ui-sidebar-documentpreview/src/client/definition.ts:45`）没有声明 `keepMounted`，
dockkit 的 `TabLayout` 在 `retained || (active && selected)` 为假时直接不渲染
`TabBody`（`ui-dockkit/src/components/TabLayout.tsx:105`）。组件里的 `useState` /
`useRef` 随卸载销毁。后果按严重程度排序：

1. **编辑草稿丢失**：切走再切回，未保存的修改直接消失。
2. **翻译被打断**：`AbortController` 随组件卸载被 `stopRun()` abort
   （`client/src/body.tsx:533`、`1810`），切回来要重新发请求，已翻好的块也不保留。
3. **阅读位置归零**：插件完全不上报滚动位置。宿主为 `TextPreview` 实现了恢复，但
   那是 renderer 自己的职责，文档正文的滚动容器需要 renderer 自己上报。
4. **视图偏好重置**：`view`（原文/译文）、目录折叠 `collapsed`、更新标记游标
   `updateCursor` 都在切回后回到初始值。

## 2. 为什么是一个 store 而不是按类型拆

- **键是同一个**：全部状态都归属于“这份文档”。拆成多个容器意味着多套 `ensure` /
  `subscribe` / 快照逻辑，而它们唯一的差别只是字段。
- **决策要放在一起看**：“切走保留、关闭清空、外部变更让路”是对整个文档快照的
  判断，写成三份 store 反而要在调用方拼起来看。
- **扩展成本**：往统一快照里加一个字段 ≈ 一个分支；拆成多个 store 则每次都要
  重新决定“归哪个”。

## 3. 键：一个文档键

```ts
/** 文档身份：会话 + 规范绝对路径。 */
export interface DocumentKey {
  sessionId: string
  path: string
}
```

**按文档而不是按页签**：同一篇文档开两个页签时，译文、批注、编辑冲突都应当共用
判断。阅读位置也按文档合并，代价是两个页签共享位置（可接受，记为已知取舍）。
`body.tsx:544` 已经算了 `sessionId + path` 的 `documentKey`，只是没喂给翻译与滚动。

## 4. 快照：一份文档的全部易失状态

```ts
export interface DocumentSnapshot {
  annotations: AnnotationSnapshot   // 已有，原样搬入
  translation: TranslationSnapshot  // 翻译状态 + 载入探测 + 运行令牌
  edit: EditState                   // 已有 reducer 的输出，原样搬入
  view: DocumentViewSnapshot        // 视图偏好
}

export interface DocumentViewSnapshot {
  scroll: { reading: number, translated: number }   // px，两个视图各记一份
  mode: 'source' | 'translated'
  collapsed: readonly string[]                      // 目录折叠的锚点
  updateCursor: number                              // “更新 N 处”的游标
}
```

**不放进去的状态**：弹层（`peek` / `ask` / 抽屉 / 错误气泡 / TOC 面板）、文档内容
`state`、图片解析器。它们要么是一次交互的临时态，要么宿主已有权威来源（文档内容
来自 `content` 协议）。放进 store 只会制造“该什么时候清”的问题。

## 5. Store 接口

```ts
export interface DocumentStore {
  subscribe(key: DocumentKey, listener: () => void): () => void
  getSnapshot(key: DocumentKey): DocumentSnapshot
  /** 主动关闭页签：终止翻译并清空该文档的全部状态。 */
  forget(key: DocumentKey): void
  /** 文档被外部修改：让路，清批注、翻译与编辑草稿，保留阅读位置。 */
  invalidate(key: DocumentKey): void

  annotations: AnnotationActions   // 已有接口全部搬入
  translation: TranslationActions  // start / stop / restored / persist / dismiss
  edit: EditActions                // reduce(event) / save() / exit()
  view: ViewActions                // scrolled(view, px) / setMode / toggleCollapsed / setCursor
}
```

`annotations` 的接口**原样保留**（`withLock`、`load`、`write`、`attach`、
`regenerate`、`detach`、`commit`、`clear`），实现逻辑不改，只是宿主从
`createAnnotationStore()` 变成 `createDocumentStore().annotations`。落盘 domain 保留
——它是“同一轮批注的跨会话归属”（刷新页面后批注还在），与“关闭页签即清”不冲突：
`forget` 会同时清内存与盘。

`subscribe` / `getSnapshot` 的粒度是整个文档。一次刷新通知该文档的全部订阅者，
当前规模下不构成问题；需要细分时给 `useDocumentStore` 加 `selector`（内部
`useSyncExternalStore` + 浅比较），不改 store。

## 6. 生命周期

| 状态 | 切走 | 关闭页签 | 外部修改 |
|---|---|---|---|
| 批注 | 保留 | 清（内存 + 盘） | 清（内存 + 盘） |
| 翻译运行 | **继续跑完**，不 abort | 终止 | **终止**（源文已变，结果不再适用） |
| 翻译结果 | 保留 | 清 | 清 |
| 编辑草稿 | 保留 | 丢弃 | 丢弃 |
| 滚动 / 折叠 / 视图 / 游标 | 保留 | 清 | 保留（由用户自己决定滚到哪） |

**关键点一：abort 从“组件卸载”移到“显式取消”。** 这是最容易做错的地方。
`stopRun()` 现在挂在 `useEffect` cleanup 上，必须先把它从卸载路径摘掉，否则
store 做完了翻译照样被打断。abort 只由三种情况触发：用户点“返回原文”/“重新翻译”、
关闭页签、文档外部修改。

**关键点二：区分“切走”与“关闭”需要一个比 body 活得久的观察者。**
~~唯一可靠信号是 `tabInfo.tab.signal`，在 body 的 effect 里监听它。~~
这条已被实测推翻：切走时 body 卸载，监听器随之消失，隐藏状态下关闭页签就没人听见。
可行的做法是 `apply` 作用域里常驻的观察者订阅宿主的 `openTabs`，细节见
[STATE-STORE-SYNTHESIS.md](STATE-STORE-SYNTHESIS.md) 第 5 节。

**关键点三：外部修改由文档重新加载路径触发。** `body.tsx` 在 `loadDocument`
拿到新 `version` 时调 `store.invalidate(key)`：终止翻译、丢弃编辑草稿（改为直接
退出编辑，不再走 `external: true` 的对比流程）、清批注（内存 + 盘）。同时在页面
上留一条**告知**（不是确认）：文档已更新，批注与草稿已清空。这条提示能避免用户
面对“状态莫名没了”的困惑，成本极低。

## 7. 不做的部分（本轮）

- **不落盘任何 store 状态**。编辑草稿不设 domain，不做崩溃恢复；它随进程消失。
- **不做关闭 dirty 页签的确认弹窗**。关闭即放弃，后续在 UI 层补二次确认。
- **不做批注归档**。清批注就是清。归档是独立功能，将来清批注的操作改为“清入归档”。
- **不做“切走暂停翻译”**。用户的翻译请求是明确的，除非点了终止就继续跑完。

以上三项见 [BACKLOG.md](BACKLOG.md) 的“后续事项”一节。

## 8. 挂载边界：放在 `apply`，不新开 React Context

`main.tsx` 的 `apply` 覆盖插件整个存活期，现在 `annotationStore` 就是在这里创建
（`main.tsx:45`）。统一 store 同样在这里 `createDocumentStore({ host })`，通过
`BodyInjected` 传进 body。不要放进 React Context：宿主注入面只有“注册选项 +
inject 返回值”一个口子（见 `packages/client/AGENTS.md` 的 ctx 纪律），插件再开
Context 是另立体系。

## 9. 迁移路径

每步独立可验证、可回滚，独立 worktree / 分支：

1. **搭骨架**：新建 `client/src/store/document.ts`，实现 store 外壳、`DocumentKey`、
   含批注部分的快照；`annotate/store.ts` 的实现搬入为 `store.annotations`。
   `main.tsx` 改为 `createDocumentStore`，`BodyInjected` 传 store。
   验收：批注相关单测全绿，Web 实测批注 / 加入对话 / 更新标记不受影响。
2. **阅读位置**：把 `am-root` 绑到宿主 `tabInfo.tab.actions.scrollportRef`，
   `scroll` 写 `view.scrolled`，内容 ready 后读回（参照 `TextPreview.tsx:143-149`
   的 `Math.max` 模式，避免内容高度变化时跳位）。
   验收：读一半切会话再切回，回到原位。
3. **翻译外提**：`translation` 的 `useState`/`useRef` 换成 store 桶，abort 从卸载摘掉。
   验收：翻译中切会话 30 秒后切回，进度连续且不重发请求；切走期间完成则切回直接看到译文。
4. **编辑草稿**：`edit` reducer 输出存进 store；文档外部变更时丢弃草稿。
   验收：切会话再切回草稿完整；外部改文件后编辑器关闭、草稿丢弃、有告知。
5. **视图偏好**：`view` / `collapsed` / `updateCursor` 迁入。
   验收：切回来仍是译文视图、目录折叠状态与更新游标不变。
6. **关闭页签全清**：接 `tabInfo.tab.signal` → `forget`。
   验收：关闭页签后重开，翻译、批注、草稿、视图全部从初始状态开始。

## 10. 风险与取舍

| 风险 | 应对 |
|---|---|
| 翻译在后台继续跑会消耗 token | 这是本方案的本意（用户没点终止就继续）；README 写清该行为 |
| 两个页签共享阅读位置 | 接受，记为已知取舍 |
| 外部修改清批注是有损的 | 按定位可接受；加一条告知提示；归档功能将来接管 |
| store 常驻内存（每个打开过的文档一份） | 快照是轻量数据；`forget` 挂在页签关闭上；可加条目上限兜底 |
| 上游若实现 `keepMounted` | 本方案仍正确（少一次卸载），不重复劳动 |

## 11. 验收总清单

- 切会话、切换页签、关闭侧栏、全屏切换后：阅读位置、视图模式、目录折叠、更新游标保留。
- 翻译中切走再切回：进度连续，不重发请求，不 abort；切走期间完成则回来直接显示译文。
- 编辑中切走再切回：草稿完整，光标行保留，dirty 状态正确。
- 文档被外部修改：批注、翻译、编辑草稿清空并终止运行；阅读位置保留；有告知。
- 关闭页签后重开同一文档：全部状态为初始值，批注磁盘记录也已清。
- 批注、评论附件、更新标记、翻译保存全链路回归通过。
- 插件卸载：无控制台错误，重载后无残留。
