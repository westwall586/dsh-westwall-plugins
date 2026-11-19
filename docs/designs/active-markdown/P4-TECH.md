# Active Markdown P4 技术方案：富渲染与阅读打磨

> 状态：已实现（2026-11-19），Web 版逐项实测，桌面端与亮色主题待验收。定位见 [POSITIONING.md](POSITIONING.md)，阶段见 [ROADMAP.md](ROADMAP.md)，块模型见 [P1-TECH.md](P1-TECH.md)，样式与批注壳见 [P2-ANNOTATION-TECH.md](P2-ANNOTATION-TECH.md)。
>
> 本文覆盖 P4：把“读得舒服”补齐。不做 WYSIWYG、主题系统、导出 PDF、Gherkin。代码块语法高亮复用平台 shiki，不另带高亮库。

## 1. 目标与非目标

**目标**

- 常见文档里的富内容一次到位：Callout、图（Mermaid、导图）、公式、代码、表格、图片、front matter。
- 重资源不进首屏：Mermaid 与公式各自是包内懒加载 chunk，文档里没有这类内容就一个字节都不加载。
- 每个富组件都带现有组件框（标签、复制、批注入口、更新标记），批注能落在图上、公式上、callout 上。
- 明暗、窄栏、全屏三种形态观感一致；200 段文档仍在 1 秒内打开。

**非目标**

- 自带一套高亮实现（直接复用 shell 的 shiki）、代码补全、编辑态富渲染。
- Markmap 之外的第三方图表库（Gherkin、PlantUML、思维导图以外的图种）。
- 主题系统、自定义配色、导出 PDF/HTML。
- 富组件里的行级批注（只到组件级）。

## 2. 本轮定下的结论

| 项 | 结论 |
|---|---|
| 顺序 | 懒加载基建 → 富组件 → Mermaid → 思维导图 → 数学 → 排版 |
| 重资源交付 | 包内动态 chunk：`client.math.js`、`client.mermaid.js`、`client.markmap.js`，按需 `require.async` |
| 数学 | KaTeX（与 chat 同一套渲染），chunk 只带 JS；CSS 与字体由 shell 全局加载，插件不打包 CSS |
| Mermaid | 全量图类型，不做白名单；`securityLevel: 'strict'`；错误回退源码 + 复制错误 |
| Mermaid 交互 | 照搬 friendly-expression 的缩放与主题：复用 `ui-primitives` 的 `ZoomControls`，不复用它的代码；全屏壳改为组件框统一弹框 |
| 思维导图 | Markmap 式：Markdown 大纲 → 可折叠导图，只取 `markmap-view`，大纲转树用本插件自己的块模型 |
| 图片放大 | 复用 `ui-primitives` 的 `ImageLightbox` |
| 代码块 | 已有复制与语言标签；本轮补换行开关，正文改用平台 `CodeBlock` 带 shiki 高亮 |
| 表格 | 横向滚动已有，只做视觉打磨 |
| front matter | 从原始 `<pre>` 改为元信息卡（key/value 行） |
| 公式与译文 | 公式、Mermaid、导图不参与翻译：译文视图里保留原文块，与代码块同规则 |
| 批注 | callout / math / mermaid / markmap 都套 `ComponentFrame`，组件级批注 |

## 3. DSH 能力边界（已核实）

| 事实 | 核实方式 | 对方案的含义 |
|---|---|---|
| 客户端支持包内动态 chunk | `dsh-client-modules` 的 `client/system.ts`：`require.async('./client.<name>.js')` 只接受相对路径，文件名必须匹配 `^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$`；chunk 由宿主按同 revision 从 `/plugins/<包>/` 提供 | 重资源可以走懒加载，不必塞进 `client.js` |
| chunk 文件自己注册 | 同上 `register()`：chunk 脚本调 `window.__ModuleLoader__.load({ id, chunk, factory })`，`chunk` 字段是文件名；未注册则加载失败 | 我们的打包脚本要为 chunk 生成同形态的包装 |
| chunk 必须自包含 | 仓库规则：包内 chunk 不能保留同步的兄弟 `require('./client*.js')`，静态相对依赖要留在自己的产物里 | 每个 chunk 各自打全依赖，不做 chunk 间共享 |
| 包资源路由只服务图片 | `client/modules/src/assets.ts`：`PACKAGE_ASSET_MEDIA_TYPES` 只有 `.svg/.png/.webp/.jpg/.jpeg`，其它扩展名 404 | 字体不能当资源发；数学的字只能借 shell 或内联 |
| KaTeX 已随 shell 全局加载 | `ui-primitives/src/markdown/MarkdownText.tsx` 顶层 `import 'katex/dist/katex.min.css'`；`apps/web/katex-fonts.ts` 把 `@font-face` 收成 woff2 | chunk 只需带 KaTeX JS，观感与 chat 公式一致 |
| `ui-primitives` 是平台共享模块 | `client/web/src/seed.ts` 的 `PLATFORM_MODULES` 含 `@deepseek-ai/dsh-client-ui-primitives`，每个动态 bundle 隐式可用 | 直接 `require` 复用 `ImageLightbox` / `ZoomControls`，零体积 |
| 没有可复用的数学渲染入口 | `ui-primitives` 只导出 `FenceMathBlock`（行间）与 `MarkdownText`，`renderTexToReact` 未导出 | 行内公式要自己调 KaTeX |
| 体积基线 | 当前 `client.js` 829,280 字节 / gzip 281KB；`friendly-expression` 常驻 mermaid 后 3,358,534 字节 / gzip 916KB | 我们不常驻；chunk 也不进首屏 |

## 4. 阶段拆分

| 阶段 | 交付 | 验收 |
|---|---|---|
| P4a 懒加载基建 | `tools/client-bundle.mjs` 抽出的包装与构建函数、chunk 清单、`require.async` shim、`client/src/chunks.ts` 加载器、构建级断言 | 构建产物形态与 DSH 契约一致；用构造出来的 chunk 在 Node 里跑通注册、取回导出、并发去重 |
| P4b 富组件 | Callout（`> [!note]` 等）、front matter 元信息卡、图片放大、代码换行开关、组件框补齐 | 四种 callout 明暗都对；图片点开可关；批注落在组件上；窄栏不溢出 |
| P4c Mermaid | `client.mermaid.js` chunk、主题 token、全屏缩放、错误回退 | chunk 不进首屏；首次渲染不阻塞正文；错误不白屏且可复制 |
| P4d 思维导图 | `client.markmap.js` chunk、大纲转树、折叠/缩放 | 标题与列表都能成树；深文档不卡；错误回退源码 |
| P4e 数学 | 行内 `$…$`、行间 `$$…$$` 与 ```` ```math ````、`client.math.js` chunk | 与 chat 同一公式观感一致；无公式文档零成本；写错不白屏 |
| P4f 排版 | 正文宽度、字阶、行高、中文标点、窄栏与全屏复核 | 200 段 < 1s；明暗一致 |

每个阶段独立验收，前一个没验收不进入下一个。

## 5. 懒加载 chunk 契约

**产物**

- `client.js`：入口，注册形态不变。
- `client.<name>.js`：chunk，文件名固定 `client.math.js` / `client.mermaid.js` / `client.markmap.js`，与入口同目录、随包入库。
- 每个 chunk 有自己的体积门；`client.js` 的 1.5MB 门不再覆盖 chunk。

**入口侧**

- 包装器把模块加载器的 `require` 透出成自由变量 `__dshRequire`，bundle 内通过 `client/src/chunks.ts` 调 `__dshRequire.async('./client.<name>.js')`。
- 加载器按文件名缓存 Promise：同一 chunk 并发请求只加载一次；失败不缓存，下次重试。
- 失败向上抛结构化错误，由组件回退到源码 + 一句话提示，不吞异常。

**构建侧**

- `tools/client-bundle.mjs` 提供 `bundleModule()`（esbuild 选项）、`wrapEntry()` / `wrapChunk()`（注册包装，包装器给 bundle 注入 `var __dshRequire = require`）与 `assertLimit()`；`tools/build-client.mjs` 只做编排与体积门。
- chunk 清单是 `tools/build-client.mjs` 里的 `CHUNKS` 常量；每个 chunk 自带 4 MiB 门，入口仍是 1.5 MiB 门，两者互不影响。
- 断言：入口产物里不出现 `chunk:` 注册字段；chunk 产物里带且只带自己的文件名。机制由 `test/chunk-build.test.ts` 用 fixture 入口 + fixture chunk 在 Node 里执行两个产物来验证：注册、`require.async` 路径、导出取回、并发去重、失败后重试。浏览器端首次实测并入 P4c（第一个真实 chunk 的消费者）。

## 6. 富组件

已实现（P4b，P4f 统一外壳）。所有非文本块共用一个 `ComponentFrame`：同一个头部、同一套图标按钮、同一个弹框，`inline` 与 `panel` 两种形态只差容器样式和「全屏 / 关闭」按钮。按钮与底栏由 `client/src/markdown/model.ts` 的 `COMPONENT_REGISTRY` 能力表生成，组件之间不再各写一套头部。

| 组件 | fullscreen | clickToExpand | zoom | pan | wrap | copy | annotate |
|---|---|---|---|---|---|---|---|
| table | ✓ | | | | | | ✓ |
| code | ✓ | | | | ✓ | ✓ | ✓ |
| mermaid | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ |
| markmap | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ |
| callout | | | | | | | ✓ |

- 头部：左侧类型图标与标签（callout 用规范图标、类型名与标题），右侧 28×28、圆角 6 的图标按钮（16 网格、1.3 描边，与顶栏工具栏同一套画法），悬停 `--dsw-alias-bg-layer-3`。顺序固定为换行（仅 code）、复制、批注、全屏；能力关掉、没有可复制文本或视图只读时对应按钮不出现。面板里的全屏按钮换成关闭图标。
- 图标：`client/src/rich/icons.tsx` 里的内联 SVG（`ExpandIcon`、`CloseIcon`、`CopyIcon`、`WrapIcon`、`AnnotateIcon`、`FitIcon`、`ActualIcon`），15–16px、`currentColor`、`stroke-width 1.7`，每个按钮都带 `aria-label` 与 `title`。
- 面板：遮罩 `rgba(0, 0, 0, 0.62)`；面板 `width: min(100%, clamp(940px, 72vw, 1600px))`、`height: min(100%, clamp(656px, 78vh, 1000px))`、14px 圆角、`--dsw-alias-bg-layer-1`。Esc、点遮罩与关闭按钮三条路径都关，打开时聚焦关闭按钮，关闭后焦点回到全屏按钮并恢复 `body` 滚动。
- 底栏：只在 `zoom` 能力下出现，居中为 `−`、百分比、`+`、分隔线、「适配」与「实际大小」；百分比以适配为 100%。表格与代码的正文不挂底栏，也不铺点状底。
- 点击放大：`clickToExpand` 的组件把内联正文设成 `role="button"`、`tabIndex=0`，点内容或按 Enter / Space 打开面板；代码与表格点击保持选区行为。
- Callout：顶层引用首行是 `[!type]` 时识别。13 个规范类型、别名、label 与图标照抄组件规范的 `component.json`，映射到 7 个语义族；未知类型、`-`/`+` 折叠语法、列表内与嵌套引用都保持普通引用，读侧不报错。标题行去掉标记，剩余块照常渲染；`[!note] - 标题`（标记后有空格）仍算标题。视觉保留语义色，头部换进外壳的图标按钮，正文不进面板。批注落在 callout 整体，正文选区落在组件区间时按现有规则拒绝，只到组件级。
- front matter：顶格 `key: value` 行拆成两列卡片，缩进续行并入上一条；不做 YAML 语义，原始文本仍可整块复制。
- 图片：点图（或聚焦后按 Enter / Space）开 `ImageLightbox`，Esc、遮罩与关闭按钮都能关，关闭后焦点回到图片。
- 代码块：注入平台 `CodeBlock` 并传 `showHeader={false}`；头部的换行按钮切 `wrap`，默认不换行，状态只在组件本地，不入文档。
- 颜色：family 到 token 的映射固定，样式只走 `--dsw-*` 与 `color-mix`，没有字面色值。

| family | token |
|---|---|
| info | `--dsw-alias-state-business-primary` |
| abstract | `color-mix(in oklch, business 50%, success 50%)`（主题里没有青色 token，按它位于 info 与 success 之间的位置混出来） |
| success | `--dsw-alias-state-success-primary` |
| warning | `--dsw-alias-state-warn-primary` |
| danger | `--dsw-alias-state-error-primary` |
| example | `--dsw-alias-state-done-primary` |
| quote | `--dsw-alias-label-tertiary` |

实测范围：`test/component-frame.test.ts` 按能力表断言四种组件的按钮顺序与图标集，`test/callout.test.ts` 覆盖 13 个规范类型、大小写、别名、未知类型、折叠语法、列表内与嵌套引用、空标题与行号，`test/blocks.test.ts` 覆盖 front matter 条目；`pnpm build` 产出 `client.js` 870,031 字节（850KB），低于 1.5 MiB 门。Web 端本轮未重做实测。

## 7. Mermaid

已实现（P4c）。文档里出现 Mermaid 围栏时，主包才通过 `loadChunk('client.mermaid.js')` 取回 `client/src/rich/mermaid/chunk.tsx`；入口产物里没有 mermaid 库代码。

- 兜底：`securityLevel: 'strict'`，不执行图内 HTML。
- 渲染：chunk 内首次渲染时 `mermaid.initialize` 一次；主题由 `--dsw-alias-*` token 解析成 palette，palette 指纹变化时重新初始化并重渲染。同一源码 + 同一主题指纹走内存缓存（24 条上限），多个图在一条 Promise 队列里串行渲染。
- 错误：捕获解析/渲染异常，回退显示源码 + 错误首行 + 「复制错误」；源码仍走组件框的复制按钮，渲染失败不白屏。
- 全屏：走组件框的统一弹框与底栏（见 7.1），内联正文可点击放大；Esc、关闭按钮与遮罩点击都能关，关闭后焦点回到全屏按钮。
- 缓存：同一源码 + 同一主题指纹只渲染一次，SVG 留在内存。

实测范围：`test/blocks.test.ts` 覆盖 mermaid 围栏成块；`pnpm build` 产出 `client.mermaid.js` 3,317,876 字节，低于 chunk 的 4 MiB 门；入口 `client.js` 870,031 字节里 `flowchart`、`sequenceDiagram`、`mermaidAPI` 的 grep 计数都是 0。浏览器端的渲染、错误回退与缩放本轮未重做实测。

## 7.1 图的全屏交互

两个图种在面板里共用同一条底栏：`−`、百分比、`+`、分隔线、「适配」、「实际大小」，百分比以适配为 100%。换算都在 `client/src/rich/stage-math.ts`（`fitTransform`、`actualTransform`、`fitPercent`、`actualFactor`），由 `test/stage-math.test.ts` 覆盖。

- Mermaid：本插件驱动平移与缩放（`translate` + `scale`，滚轮以指针为中心）。「适配」用 `fitTransform` 重新算并把这次的 scale 记作 100%，「实际大小」用 `actualTransform` 回到 scale 1 并居中。
- 导图：平移与滚轮缩放沿用 markmap 自带的 d3 zoom。chunk 在挂载时适配一次，把当时的 k 记为 `fitScale`；「适配」调 `fit()`，并在过渡结束后把 `fitScale` 更新为当前 k；「实际大小」调 `rescale(fitScale / k)`（`rescale` 是相对倍率），视图用 `k / fitScale` 显示百分比。
- 导图的标签裁切是 markmap 自身把每个标签盒设成 9999px 宽导致的，样式里改成 `max-content` 后测量与渲染一致。

## 8. 思维导图

已实现（P4d）。语言为 `markmap` / `mindmap` 的围栏走 `client.markmap.js`。chunk 只带 `markmap-view` 与它必需的 peer `markmap-common`，没有引入 `markmap-lib`，因此不会把 katex / prism / highlight.js / yaml 拖进来。

- 入口：代码块语言为 `markmap` / `mindmap` 时走导图，不吃 Mermaid 的图类型。
- 转换：H1–H6 与嵌套列表转成 Markmap 的节点树；段落并入最近节点的描述行，用第一个换行分隔。转树是 `client/src/rich/tree.ts` 的纯函数，只读本插件块模型。
- 视图：`markmap-view` 只读模式，初始展开层级 2，支持缩放与拖拽；节点文本先转义再加换行，不执行图内 HTML；分支色从 palette 的语义色取；单个顶层标题直接作为根节点，不再套一个空根；节点文字与连线颜色由 `svg.am-markmap-canvas` 上的 `--markmap-*` 变量从主题 token 重设（markmap 自带的深色文字会压到 0.1 的层级）。
- 全屏：走组件框的统一弹框；打开时新挂一个导图实例，底栏与 Mermaid 同一套（见 7.1）。chunk 的 handle 暴露 `scale()`、`fitScale()`、`rescale()`、`fit()`，视图按 `k / fitScale` 显示百分比。批注：整个导图是一个组件，可复制源码。

实测范围：`test/rich-trees.test.ts` 覆盖标题层级、列表嵌套、段落并入与多个 H1；`pnpm build` 产出 `client.markmap.js` 119,310 字节，低于 4 MiB 门；入口 `client.js` 里 `markmap-view`、`markmap-common`、`initialExpandLevel` 的 grep 计数都是 0。浏览器端的拖拽、折叠与明暗重渲染本轮未重做实测。

## 9. 数学

已实现（P4e）。行内 `$…$`、行间 `$$…$$` 与 ```` ```math ```` 都渲染成 KaTeX，宽公式在组件框里横向滚动；没有公式的文档不加载 `client.math.js`。

- 语法：行内要求 `$` 后与闭合 `$` 前都不是空白，`$$` 不当行内，`\$` 是转义，行内代码与围栏内不解析，未闭合的 `$` 留作文本。行间 `$$…$$` 必须独占一段，可跨行；空行结束候选，所以未闭合的 `$$` 不会吞掉后文。围栏语言为 `math` 时直接成为公式块。
- 模型：`Inline` 增加 `{ kind: 'math', tex }`；`Block` 增加 `{ type: 'math', tex, display: true }`，`COMPONENT_REGISTRY.math` 只开复制与批注，因此公式块共用组件外壳但没有全屏。
- 渲染：主包只带加载器与回退，KaTeX 在 `client.math.js` 里，第一次出现公式时 `loadChunk` 取回。chunk 用 `throwOnError: true`、`strict: 'ignore'`、`trust: false` 调 `katex.renderToString`，写坏的公式抛错而不是输出错误色文本。
- 失败：行间公式回退成 `RichError`（源码 + 错误首行 + 复制错误）；行内公式回退成 `$…$` 源码 span，段落其余部分照常显示，不白屏。
- 字体：不打包 KaTeX 的 CSS 与字体，依赖 shell 全局加载的 `katex/dist/katex.min.css` 与 woff2 字体；插件只补 1em 字号与容器布局。shell 若换渲染方案，公式会退到系统衬线。
- 与翻译：提示词第 2 版要求行内与行间公式逐字保留，缓存键随 `PROMPT_VERSION` 升级，旧自动缓存不再命中；译文重新解析后按同样规则渲染。

实测范围：`test/math.test.ts` 覆盖行内（多公式、空白边界、转义、行内代码、未闭合）、行间（同行、跨行、紧随正文、尾随文字、未闭合）、`math` 围栏、列表与 callout 内的公式、组件能力与中英文案，以及 `inlineMathAt` / `displayMathAt` 的边界；`pnpm build` 产出 `client.math.js` 261,969 字节，低于 chunk 的 4 MiB 门；入口 `client.js` 874,378 字节，`Katex` 与 `renderToString` 的 grep 计数都是 0，剩下的 `katex` 字样只有插件自己针对 shell KaTeX 类名的布局规则。Web 端本轮未实测公式观感与暗色。

已知限制：行内公式在文本批注的投影里按 TeX 源码计长，而 KaTeX 渲染后的 DOM 文本不是源码，所以含行内公式的一行里做文本批注时偏移可能漂移；行间公式是组件，选区跨过它时只能整块批注。

## 10. 排版

已实现（P4f）。字号、行高与字重回主题的 markdown token，不自己写数值：正文用 `font: var(--dsw-font-markdown-base)`，H1–H3 用对应的 token，H4–H6 用 h4 token；实测 H1 21/30、H2 19/28、H3 18/26，字重随主题（当前主题里是 600）。正文保持 44em 阅读宽度，代码、表格、公式等组件可以撑满容器宽度；在 900px 宽的面板里实测正文 616px、组件 788px。中文侧开了 `text-spacing-trim: trim-start`、`text-autospace: normal` 与 `line-break: strict`，段落加 `text-wrap: pretty`；窄栏左右内边距从 24px 起降到 16px。段落与列表间距按 24px 行高收成 0.85em 与 1.6em 缩进。200 段 3.4 万字节的文档在页面内合成渲染用时 8ms（`innerHTML` 加一次强制布局，属于下限值，不含 React 与解析）。明暗与窄栏、全屏三态的人工观看留给桌面端验收。

- 正文宽度：窄栏与全屏都限制阅读宽度，超出时居中；不与目录浮层抢位。
- 字阶与行高：沿用 `--dsh-content-font-size` 与 1.7 行高，标题层级在 P3 已调过，本轮只补段间距与列表缩进。
- 中文标点：`text-spacing-trim: trim-start`，纯 CSS，不做文本改写。
- 复核：明暗、窄栏、全屏三形态各看一遍；200 段文档计时（待 P4f）。

## 11. 链接路由、代码高亮与组件全屏

已实现。三件事都落在浏览器半体，块模型与批注数据结构没有改动。

### 11.1 链接路由

- 分类仍是 `client/src/links.ts` 的 `classifyLink`，四种去向不变：`#标题` 在文内跳转，`http(s)` / `mailto` 与协议相对地址算外部，`dsh-resource://` 原样交侧栏，相对路径按文档目录解析成会话文件地址。
- 外部地址不再由 `Body` 直接 `window.open`：`Body` 调注入的 `openExternal(url)`，`main.tsx` 按文档所在 session scope 取 `sidebarRight`，在 `browser` 页签已注册时调 `openTab('browser', { params: { url } })`，否则退回 `window.open(url, '_blank', 'noopener,noreferrer')`。页签类型按点击时刻查询，宿主晚些挂上浏览器也能用。
- 文件与资源链接继续走 `openResource`（本来就是侧栏预览）；`#标题` 走现有滚动。图片点击仍是灯箱，图片作为链接目标时按链接规则打开预览。
- 实测范围：`test/external.test.ts` 覆盖三条，「侧栏可打开时走侧栏浏览器」「侧栏服务缺失退回新标签页」「侧栏拒绝打开（没有 browser 页签或没有会话）时退回新标签页」。打开动作先尝试 `openTab('browser')`，抛错才退回新标签页，不做页签类型的预判。Web 版实测（该 profile 没有 `browser` 页签）：点外部链接开系统新标签页、点文件链接在侧栏开 `README.md`、点图片链接在侧栏开图片预览且不弹灯箱。桌面版侧栏浏览器未实测。

### 11.2 代码块高亮

- 正文改用平台共享模块 `@deepseek-ai/dsh-client-ui-primitives` 的 `CodeBlock`：`showHeader={false}`（组件框自己给头部）、`wrap` 跟随组件框的换行状态、`code` 传 `content + '\n'` 对齐围栏语义、`lang` 传围栏语言。高亮由平台 shiki 完成，不新增依赖；`client.js` 里 `shiki` 的 grep 计数是 0。
- 样式按需覆盖：平台卡片自带背景与内边距，组件框把它的 `margin` 与圆角清零、内边距收成 `12px 16px 16px`，外边框与头部分隔线仍由组件框负责，避免双层卡片。
- 取舍：旧实现的逐行 `<span data-line>` 删除，代码块不再有行级锚点。组件级批注、复制与更新标记不受影响；译文里选中代码块文字不再出现「查看原文」。
- 实测范围：`pnpm build` 入口 `client.js` 870,031 字节，低于 1.5 MiB 门。此前的 Web 实测里 ts 围栏有高亮、头部的换行按钮把 `data-code-wrap` 在 `true` / `false` 间切换且 `white-space` 从 `pre` 变 `pre-wrap`，无双层边框；本轮换成图标按钮后行为不变，未重做实测。

### 11.3 组件全屏

- 统一外壳与能力表见第 6 节。`ComponentFrame` 出两种形态（`inline` 与 `panel`）：同一个头部、同一条按钮顺序（换行、复制、批注、全屏），面板里的全屏按钮换成关闭图标；按钮集合由 `COMPONENT_REGISTRY` 的能力表生成。
- `children` 是渲染函数 `({ wrap, expanded }) => ReactNode`；弹框内以 `expanded: true` 再渲染一次同一份内容。Mermaid 与导图在 `expanded` 时挂各自的舞台与同一条底栏，code 与 table 不挂底栏。
- 弹框结构：遮罩 `position: fixed; inset: 0; z-index: 30; background: rgba(0, 0, 0, 0.62)`，`createPortal` 到 `document.body`；面板 `width: min(100%, clamp(940px, 72vw, 1600px))`、`height: min(100%, clamp(656px, 78vh, 1000px))`、14px 圆角、`--dsw-alias-bg-layer-1` 与阴影；头部是外壳同款，正文是可滚动的 flex 区，`zoom` 能力的正文铺点状底并在底部留底栏。
- 关闭：Esc（捕获阶段）、点遮罩、关闭按钮三条路径都关；打开时聚焦关闭按钮，关闭后焦点回到全屏按钮并恢复 `body` 滚动。
- 实测范围：`test/component-frame.test.ts` 断言能力表、按钮顺序与图标集；本轮 `pnpm build` 入口 `client.js` 870,031 字节。Web 端本轮未重做实测：亮色与暗色下的面板、底栏与关闭后的焦点待验收。

## 12. 风险与不做

- **产物变大**：`client.mermaid.js` 3.2MB（gzip 约 887KB）与 `client.markmap.js` 116KB（gzip 约 39KB）入库；构建时间与仓库体积上涨，换来首屏零成本。
- **隐式依赖**：数学的字来自 shell 全局 CSS。shell 若换渲染方案，公式会退到系统衬线；兜底方案是 chunk 内联字体（+296KB 原始字体）。
- **chunk 首次加载**：文档里有图/公式时多一次本地请求，宿主按 revision 缓存，不做预取。
- **全屏层级**：弹框固定 `z-index: 30`，与 friendly-expression 一致；宿主若出现高于 30 的常驻浮层，弹框会压在它下面。
- **侧栏浏览器是宿主能力**：Web profile 没有 `browser` 页签，外部链接退回系统新标签页；侧栏浏览器只在桌面版出现。
- **不做**：Markmap 之外的大纲视图、自带高亮库、主题系统、导出 PDF、Gherkin、行级富组件批注。
