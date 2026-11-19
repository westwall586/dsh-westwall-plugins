# 链接路由、代码高亮、组件全屏：实现简报

你是 poteto-mode 的一次委派。开工前依次读完（read 工具，全文）：

1. /Users/johnxi/Developer/DSH/dsh-pstack/agents/poteto-agent.md
2. /Users/johnxi/Developer/DSH/dsh-pstack/skill/poteto-mode/SKILL.md

要应用某条原则时再读对应 leaf skill。

## 用户目标

用户要看 Markdown 时不被踢出应用：链接统一在桌面版右侧栏打开，代码块要有高亮，所有富组件（不止 Mermaid）都能从组件顶栏进全屏，且全屏弹框的位置要正。验收样例是仓库根的 `design/showcase.md`。

## 必读上下文

- 方案：`docs/designs/active-markdown/P4-TECH.md`
- 链接分类：`packages/active-markdown/client/src/links.ts`，现在的 `openLink` 在 `client/src/body.tsx` 约 716 行
- 客户端装配：`packages/active-markdown/client/src/main.tsx`（`openResource` 的写法在 104 行附近），`client/src/context.ts` 的 `SidebarRight`
- 组件框：`packages/active-markdown/client/src/markdown/component-frame.tsx`
- 富组件视图与现有全屏：`client/src/rich/`（`mermaid.tsx`、`markmap.tsx`、`fullscreen.tsx`）
- 代码块渲染：`client/src/markdown/render.tsx` 的 `renderCode`
- 样式与文案：`client/src/styles.css`、`locales.ts`
- 参考实现（只读，不 import 它的代码）：`/Users/johnxi/Developer/Workspace/dsh-westwall-plugins/packages/friendly-expression/client/src/viewer.tsx` 与它的 `styles.css` 里 `.dfe-viewer` 一段
- 平台共享模块的代码块与缩放控件：`/Users/johnxi/Developer/Workspace/dsh-westwall-plugins/deepseek-harness/packages/client/ui-primitives/src/markdown/CodeBlock.tsx`、`src/ZoomControls.tsx`
- DSH 侧打开侧栏浏览器的调用先例：`/Users/johnxi/Developer/Workspace/dsh-westwall-plugins/deepseek-harness/packages/client/ui-chat/src/client/apply.ts` 约 285 行 `ctx.sidebarRight.openTab('browser', { params: { url } })`

## 任务 1：所有链接走右侧栏

- `context.ts` 的 `SidebarRight` 加 `openTab(kind: string, options?: { params?: Record<string, unknown> }): void`。
- `main.tsx` 在现有 `openResource` 同一处注入 `openExternal(url: string): void`：按 session scope 取 `sidebarRight`，有 `openTab` 就用 `openTab('browser', { params: { url } })`；服务缺失时退回 `window.open(url, '_blank', 'noopener,noreferrer')`。
- `body.tsx` 的 `openLink`：`external` 目标改调 `openExternal`；`file` 与 `resource` 保持走 `openResource`（它已经是侧栏预览）；`anchor` 不变。
- 行内图片点击仍开灯箱，图片作为链接目标时走链接规则。不要改图片放大。
- 新增的 `openExternal` 与 `openResource` 一起进 `BodyInjected`，并在所有构造 Body 的地方传进去。

## 任务 2：代码块高亮

- `render.tsx` 的代码块正文改用平台共享的 `CodeBlock`（`@deepseek-ai/dsh-client-ui-primitives`）：
  `showHeader={false}`、`wrap={wrap}`、`copyLabel`/`copiedLabel` 用现有文案、`code` 传 `content` 加一个结尾换行（对齐 chat 的围栏语义）、`lang` 传块的 `lang`。
- 我们自己组件框头部保留「复制」与「换行」按钮，`wrap` 状态继续由 `ComponentFrame` 持有并传给正文。
- 删掉 `.am-code-body` 那套逐行 span 渲染与对应样式；代码块不再有逐行 `data-line`，这是已知取舍，写进 `P4-TECH.md` 与包 README 的已知限制。
- 确认样式：`CodeBlock` 自带卡片背景与内边距，放进 `ComponentFrame` 后不要出现双层边框或双层背景，按需覆盖。

## 任务 3：全屏上移到组件框

- `ComponentFrame` 头部动作顺序改为「全屏、换行（仅 code）、批注、复制」，全部是同一套 `am-component-action` 文本按钮，不再由各个富组件自己放按钮。
- 全屏对每种组件都可用：code、table、mermaid、markmap。
- 重写弹框，按 friendly-expression 的布局：
  - 遮罩 `position: fixed; inset: 0; z-index: 30; background: rgba(0,0,0,0.62); display: flex; align-items: center; justify-content: center; padding: 24px`，`createPortal` 挂到 `document.body`。
  - 面板 `width: min(100%, clamp(940px, 72vw, 1600px)); height: min(100%, clamp(656px, 78vh, 1000px)); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-layer-1)`。
  - 头部：组件标签 + 右侧「关闭」按钮（图标或文字都行），下边框。
  - 正文：`flex: 1; min-height: 0; overflow: auto`，内容在弹框里居中；表格在弹框里撑满可滚动宽度，代码块保留当前换行偏好。
  - 底部只给可缩放的内容（mermaid、markmap）留一条，放 `ZoomControls`；code 与 table 不显示底栏。
- `children` 从固定节点改成渲染函数：`(context: { wrap: boolean, expanded: boolean }) => ReactNode`，`ComponentFrame` 在弹框里用 `expanded: true` 再渲染一次同样的内容。表格与代码用同一份；mermaid/markmap 的视图在 `expanded` 时自己挂缩放条，未展开时不挂。
- Esc、点遮罩、关闭按钮都能关；关闭后焦点回到「全屏」按钮；打开时面板内的关闭按钮自动聚焦。
- 删掉 `rich/fullscreen.tsx` 与各富视图里的展开按钮，`locales.ts` 里对应文案随之调整，不要留死键。

## 交付清单

- 三条任务全部落地；`design/showcase.md` 补一条文件链接样例（指向 `design/README.md`）与一条图片链接样例，方便验收
- 新文案进 `locales.ts`（zh + en）
- 测试：
  - `links` 分类不变，但如果 `openExternal` 是纯函数或可注入，补一条「外部链接走注入的打开器、服务缺失时退回 window.open」的行为测试
  - 组件框全屏的状态（展开/关闭）如果抽成纯函数或 reducer，补对应测试；纯组件的键盘行为可留浏览器验收
- 文档：`P4-TECH.md` 补「链接路由」「代码高亮」「组件全屏」三小节的现状与实测范围；包 `README.md` 的功能与已知限制同步
- 产物：`pnpm build` 重新生成 `client.js` 与两个 chunk 并一起提交

## 验证（全绿才交）

```sh
cd packages/active-markdown
pnpm typecheck && pnpm test && pnpm build
cd ../..
pnpm aggregate:check
```

提交一次，信息：
`feat(active-markdown): 链接走侧栏、代码高亮、组件全屏统一到顶栏`
不要 push，不要合 main。

## 边界

- 只改 `packages/active-markdown/`、`docs/designs/active-markdown/` 与 `design/`
- 不引新的第三方运行依赖；代码高亮只复用平台共享模块
- 不要动图片灯箱、批注与翻译链路
- 文档与代码不写本机绝对路径；注释英文，导出带 JSDoc
- 报告里给：改了哪些文件、跑过哪些命令与结果、没做的与风险
