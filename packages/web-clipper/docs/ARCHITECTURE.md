# 网页剪藏架构

面向维护者。用户安装、操作与卸载见包根 [README](../README.md)。

## 目标

在 DSH 桌面版右侧栏浏览器里，把当前页面变成一个会话附件。两个官方入口共享同一条流水线，不注入工具栏、不挂 DOM 观察器。

## 数据流

```text
入口（tab 菜单 / 输入框按钮）
  → 定位浏览器标签并 focus
  → 等两帧
  → webview.executeJavaScript 读取已渲染 DOM
  → extractor：defuddle 正文 → Markdown
  → metadata：title / url / clipped_at / note
  → attach：createDrafts → inputActions.addAttachments
  → toast 反馈
```

结果类型是判别联合：

```js
{ ok: true, title, fileName, mode: 'draft' | 'drop' }
{ ok: false, code, detail? }
```

错误码：`desktop-only`、`no-page`、`page-loading`、`busy`、`capture-timeout`、`capture-failed`、`extract-failed`、`composer-busy`、`attach-failed`。UI 用 `webClipper` 命名空间的 `error.<code>` 翻译。

## 模块

| 文件 | 职责 |
|---|---|
| `client/src/main.mjs` | 模块装载入口、locale 与样式注册、两个 Slot 注册 |
| `client/src/clip.mjs` | 共享流水线、忙锁、目标标签解析、两帧等待 |
| `client/src/webview.mjs` | 定位可见 webview、8 秒超时、4 MB HTML 上限 |
| `client/src/extractor.mjs` | defuddle 装配、四字段元数据、整页与纯文本降级、文件名合法化 |
| `client/src/attach.mjs` | 直接 draft 路径与合成 drop 兜底 |
| `client/src/toast.mjs` | 轻量反馈浮层 |
| `client/src/ui/visibility.mjs` | 纯可见性判断 |
| `client/src/ui/tab-menu-item.mjs` | `sidebar.right.tab.menu.item` 条目 |
| `client/src/ui/composer-button.mjs` | `conversation.input.left` 按钮 |
| `client/src/styles.css` | 只使用宿主主题令牌 |

`defuddle/full` 在构建期内联；`react` 由宿主 loader 的 `require` 提供，不进入 bundle。

## 元数据契约

Markdown frontmatter 固定四个字段，顺序为 `title`、`url`、`clipped_at`、`note`。字符串用 `JSON.stringify`，`clipped_at` 用本地时间加数字偏移。整页 HTML 不用 frontmatter，四个字段变成 doctype 之后的一条 `dsh-clip` JSON 注释，payload 里的 `--` 会被拆开以保持注释合法。

`note` 是固定英文常量，只出现在元数据里。不要添加站点、作者、发布时间、语言、字数、抓取模式，也不要发 feed 事件。

## 附件入口

主路径读取 `ctx.get('conversation')`；没有时退回 `ctx.sessions.scope(sessionId).get('conversation')`。命中具体服务后调用 `createDrafts(sessionId, [file], true)`，再用公开的 `inputActions.addAttachments(ids)`。

`addAttachments` 返回 `false` 时调用 `releaseDraftAttachments(drafts)` 并报 `composer-busy`。只有直接路径完全不可用时才合成 `document` 级 `drop`，并轮询 `[data-slot="conversation.input.attachments"]` 确认入位。两条路径都不会提交消息。

## 平台

桌面判定只认 `globalThis.dshDesktop.protocolVersion === 1`。Web 版不渲染入口；直接调用流水线返回 `desktop-only`。

## 测试

`pnpm test` 先构建再跑 `node:test`。覆盖：四字段 frontmatter 与注释头、本地时间、降级分支、文件名、webview 选择与超时、draft 与 drop 两条附件路径、流水线错误映射与忙锁、入口可见性、构建契约、包清单、聚合去重。

## 构建

```sh
pnpm --filter @westwall/dsh-web-clipper build
```

`tools/build.mjs` 用 esbuild 打 IIFE，包进 `window.__ModuleLoader__` 的注册壳，产物 `client.js` 入库，体积守卫 1.2 MB。