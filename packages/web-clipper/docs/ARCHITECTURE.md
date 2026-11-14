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
  → Host copy：按设置目录写一份可读副本
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
| `client/src/main.mjs` | 模块装载入口、locale 与样式注册、两个剪藏 Slot 与配置页注册 |
| `client/src/clip.mjs` | 共享流水线、忙锁、目标标签解析、两帧等待 |
| `client/src/webview.mjs` | 定位可见 webview、8 秒超时、4 MB HTML 上限 |
| `client/src/extractor.mjs` | defuddle 装配、四字段元数据、整页与纯文本降级、文件名合法化 |
| `client/src/attach.mjs` | 直接 draft 路径与合成 drop 兜底 |
| `client/src/remote.mjs` | `remote.webClipper` 描述符、懒挂载与结果解包 |
| `client/src/ui/settings.mjs` | Plugin Manager 的副本目录配置页 |
| `client/src/ui/detail.mjs` | 随 Feed Ultra 安装时的行详情使用说明 |
| `client/src/ui/page-loading.mjs` | 活动 webview 的加载态，用于禁用两个入口 |
| `src/index.ts` | Host 服务：读取 volatile 配置、保存副本、打开目录 |
| `src/copy.ts` | 目录解析、文件名合法化、原子写入、Finder/Explorer 打开 |
| `client/src/toast.mjs` | 轻量反馈浮层 |
| `client/src/ui/visibility.mjs` | 纯可见性判断 |
| `client/src/ui/tab-menu-item.mjs` | `sidebar.right.tab.menu.item` 条目 |
| `client/src/ui/composer-button.mjs` | `conversation.input.left` 按钮 |
| `client/src/styles.css` | 只使用宿主主题令牌 |

`defuddle/full` 在构建期内联；`react` 由宿主 loader 的 `require` 提供，不进入 bundle。

## 可读副本

副本是附件之外的额外文件，不替代 DSH 附件。`outputDirectory` 是 volatile 配置，改路径不重启插件；空值解析为 `<系统临时目录>/dsh-web-clipper`，非绝对路径直接拒绝。Host 写入时先落同目录临时文件，再用排他硬链接发布；文件名冲突追加 ` (2)`，永不覆盖。

Host 服务用 `effectiveConfig` 和 `settings.describe()` 读取实时目录；只读 `rawConfig` 会在 volatile 写入后滞后。三个方法通过 Typert 的 `remote-methods` 原型标记导出，客户端描述符才能命中 `/api/webClipper/*`。

配置页注册在 `plugins.bundle.config`（单独安装，key 为包名）和 `plugins.row.config`（随 Feed Ultra 安装，key 为 `@westwall/dsh-feed-ultra#dsh-web-clipper`；另注册单独安装的 row key）。行详情页不渲染包 README，因此 `plugins.detail.section` 额外给出一段紧凑使用说明。页面只负责目录输入、选择、保存、恢复默认和打开，不注入宿主 chrome。

两个入口在活动 webview 报加载中时禁用并变灰；`page-loading.mjs` 监听 `did-start-loading` / `did-stop-loading` 等事件，并用短轮询覆盖标签切换。抓取流水线仍然自己检查加载态，键盘或竞态点击仍会得到 `page-loading`。

副本写入失败只发 warning toast，不改变附件成功结果。`openDirectory` 在 macOS 用 `open`，Windows 用 `explorer.exe`，Linux 用 `xdg-open`；只 spawn 参数数组，不经过 shell。

## 元数据契约

Markdown frontmatter 固定四个字段，顺序为 `title`、`url`、`clipped_at`、`note`。字符串用 `JSON.stringify`，`clipped_at` 用本地时间加数字偏移。整页 HTML 不用 frontmatter，四个字段变成 doctype 之后的一条 `dsh-clip` JSON 注释，payload 里的 `--` 会被拆开以保持注释合法。

`note` 是固定英文常量，只出现在元数据里。不要添加站点、作者、发布时间、语言、字数、抓取模式，也不要发 feed 事件。

文件名是 `YYYY-MM-DD_HH-mm-ss_<合法标题>.md`，本地时间，全部用短横线避免 Windows 非法字符。整页降级时扩展名是 `.html`，前缀规则相同。

## 附件入口

主路径读取 `ctx.get('conversation')`；没有时退回 `ctx.get('sessions')?.scope(sessionId)?.get('conversation')`。命中具体服务后调用 `createDrafts(sessionId, [file], true)`，再用公开的 `inputActions.addAttachments(ids)`。

`addAttachments` 返回 `false` 时调用 `releaseDraftAttachments(drafts)` 并报 `composer-busy`。只有直接路径完全不可用时才合成 `document` 级 `drop`，并轮询 `[data-slot="conversation.input.attachments"]` 确认入位。两条路径都不会提交消息。

## 平台

桌面判定只认 `globalThis.dshDesktop.protocolVersion === 1`。Web 版不渲染入口；直接调用流水线返回 `desktop-only`。

## 测试

`pnpm test` 先构建再跑 `node:test`。覆盖：四字段 frontmatter 与注释头、本地时间、时间戳文件名、降级分支、webview 选择与超时、draft 与 drop 两条附件路径、副本目录解析与写入、打开目录、Remote 描述符与解包、流水线错误映射与忙锁、入口可见性、构建契约、包清单、聚合去重。

## 构建

```sh
pnpm --filter @westwall/dsh-web-clipper build
```

`tools/build.mjs` 用 esbuild 打 IIFE，包进 `window.__ModuleLoader__` 的注册壳，产物 `client.js` 入库，体积守卫 1.2 MB。