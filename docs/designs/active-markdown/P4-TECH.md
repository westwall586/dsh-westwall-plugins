# Active Markdown P4 技术方案：富渲染与阅读打磨

> 状态：进行中（2026-11-19）。定位见 [POSITIONING.md](POSITIONING.md)，阶段见 [ROADMAP.md](ROADMAP.md)，块模型见 [P1-TECH.md](P1-TECH.md)，样式与批注壳见 [P2-ANNOTATION-TECH.md](P2-ANNOTATION-TECH.md)。
>
> 本文覆盖 P4：把“读得舒服”补齐。不做 WYSIWYG、主题系统、导出 PDF、Gherkin、代码块语法高亮。

## 1. 目标与非目标

**目标**

- 常见文档里的富内容一次到位：Callout、图（Mermaid、导图）、公式、代码、表格、图片、front matter。
- 重资源不进首屏：Mermaid 与公式各自是包内懒加载 chunk，文档里没有这类内容就一个字节都不加载。
- 每个富组件都带现有组件框（标签、复制、批注入口、更新标记），批注能落在图上、公式上、callout 上。
- 明暗、窄栏、全屏三种形态观感一致；200 段文档仍在 1 秒内打开。

**非目标**

- 语法高亮（shell 用 shiki，插件不带第二套）、代码补全、编辑态富渲染。
- Markmap 之外的第三方图表库（Gherkin、PlantUML、思维导图以外的图种）。
- 主题系统、自定义配色、导出 PDF/HTML。
- 富组件里的行级批注（只到组件级）。

## 2. 本轮定下的结论

| 项 | 结论 |
|---|---|
| 顺序 | 懒加载基建 → 富组件 → Mermaid → 思维导图 → 数学 → 排版 |
| 重资源交付 | 包内动态 chunk：`client.math.js`、`client.mermaid.js`、`client.markmap.js`，按需 `require.async` |
| 数学 | KaTeX（与 chat 同一套渲染），chunk 只带 JS；CSS 与字体由 shell 全局加载，chunk 自带一份去 `@font-face` 的 CSS 兜底 |
| Mermaid | 全量图类型，不做白名单；`securityLevel: 'strict'`；错误回退源码 + 复制错误 |
| Mermaid 交互 | 照搬 friendly-expression 的全屏 / 缩放 / 主题：复用 `ui-primitives` 的 `ZoomControls`，不复用它的代码 |
| 思维导图 | Markmap 式：Markdown 大纲 → 可折叠导图，只取 `markmap-view`，大纲转树用本插件自己的块模型 |
| 图片放大 | 复用 `ui-primitives` 的 `ImageLightbox` |
| 代码块 | 已有复制与语言标签；本轮补换行开关，不加语法高亮 |
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

已实现（P4b）。实测范围：`test/callout.test.ts` 覆盖 13 个规范类型、大小写、别名、未知类型、折叠语法、列表内与嵌套引用、空标题、`-` 开头的标题、标记行与正文同段时的切分与行号；`test/blocks.test.ts` 覆盖 front matter 条目（续行、空行、无冒号行）。`pnpm build` 产出 `client.js` 842KB，低于 1.5 MiB 门。明暗、窄栏、全屏三形态的观感，以及图片放大与代码换行的交互，尚未在浏览器实测。

- Callout：顶层引用首行是 `[!type]` 时识别。13 个规范类型、别名、label 与图标照抄组件规范的 `component.json`，映射到 7 个语义族；未知类型、`-`/`+` 折叠语法、列表内与嵌套引用都保持普通引用，读侧不报错。标题行去掉标记，剩余块照常渲染；`[!note] - 标题`（标记后有空格）仍算标题。批注落在 callout 整体，正文选区落在组件区间时按现有规则拒绝，只到组件级。
- front matter：顶格 `key: value` 行拆成两列卡片，缩进续行并入上一条；不做 YAML 语义，原始文本仍可整块复制。
- 图片：点图（或聚焦后按 Enter / Space）开 `ImageLightbox`，Esc、遮罩与关闭按钮都能关，关闭后焦点回到图片。
- 代码块：头部加「换行 / 不换行」开关，作用到 `.am-code-body[data-wrap]`；默认不换行，状态只在组件本地，不入文档。
- 组件框：callout 用自己的 `section.am-callout` 头部（图标、类型名、标题），保留 `data-component` 锚点与组件级批注入口；math / mermaid / markmap 仍按各自阶段接入 `ComponentFrame`。
- 颜色：family 到 token 的映射固定，样式只走 `--dsw-*` 与 `color-mix`，没有字面色值。

| family | token |
|---|---|
| info | `--dsw-alias-state-business-primary` |
| abstract | `--dsw-alias-link` |
| success | `--dsw-alias-state-success-primary` |
| warning | `--dsw-alias-state-warn-primary` |
| danger | `--dsw-alias-state-error-primary` |
| example | `--dsw-alias-state-done-primary` |
| quote | `--dsw-alias-label-tertiary` |

## 7. Mermaid

- 兜底：`securityLevel: 'strict'`，不执行图内 HTML。
- 渲染：懒加载 chunk 内单例 `mermaid.initialize` 一次，主题由 `--dsw-alias-*` token 解析成 palette，明暗切换重建。
- 错误：捕获解析/渲染异常，回退显示源码 + 错误首行 + 「复制错误」。
- 全屏：`ZoomControls` 缩放、可复位、Esc 关闭，遮罩点击关闭。
- 缓存：同一源码 + 同一主题指纹只渲染一次，SVG 留在内存。

## 8. 思维导图

- 入口：代码块语言为 `markmap` / `mindmap` 时走导图，不吃 Mermaid 的图类型。
- 转换：H1–H6 与嵌套列表转成 Markmap 的节点树，行内 Markdown 保留文本；转树用本插件块模型，不引入 `markmap-lib`（它会把 katex / prism / highlight.js / yaml 全拖进 chunk）。
- 视图：`markmap-view` 只读模式，初始展开层级 2，支持缩放与拖拽；全屏复用 Mermaid 那套壳。
- 批注：整个导图是一个组件，可复制源码。

## 9. 数学

- 语法：行内 `$…$`（避开 `$ ` 与转义）、行间 `$$…$$`、```` ```math ````。
- 渲染：`katex.renderToString` 后置入容器，行内 `displayMode: false`，行间 `true`。
- 失败：`throwOnError: false` 的错误色文本 + 复制原文；严格模式先试一次再降级，与 chat 的三段式一致。
- 字体：依赖 shell 已加载的 KaTeX `@font-face`；chunk 内注入去字体声明的 CSS 兜底，字体缺失时退系统衬线。
- 与翻译：公式节点不翻译、不参与行对齐改写。

## 10. 排版

已实现（P4b）的阅读宽度与中文标点部分。正文与 front matter 卡都是 `max-width: 44em` 居中，`.am-doc` 加 `text-spacing-trim: trim-start`；字阶、行高与标题层级不动。窄栏下 44em 大于可用宽度，观感与改动前一致；全屏下正文不再随窗口拉长。明暗、窄栏、全屏三形态复核与 200 段计时还没做，作为 P4f 的验收项。

- 正文宽度：窄栏与全屏都限制阅读宽度，超出时居中；不与目录浮层抢位。
- 字阶与行高：沿用 `--dsh-content-font-size` 与 1.7 行高，标题层级在 P3 已调过，本轮只补段间距与列表缩进。
- 中文标点：`text-spacing-trim: trim-start`，纯 CSS，不做文本改写。
- 复核：明暗、窄栏、全屏三形态各看一遍；200 段文档计时（待 P4f）。

## 11. 风险与不做

- **产物变大**：`client.mermaid.js` 约 3MB（gzip 约 620KB）入库；构建时间与仓库体积上涨，换来首屏零成本。
- **隐式依赖**：数学的字来自 shell 全局 CSS。shell 若换渲染方案，公式会退到系统衬线；兜底方案是 chunk 内联字体（+296KB 原始字体）。
- **chunk 首次加载**：文档里有图/公式时多一次本地请求，宿主按 revision 缓存，不做预取。
- **不做**：Markmap 之外的大纲视图、语法高亮、主题系统、导出 PDF、Gherkin、行级富组件批注。
