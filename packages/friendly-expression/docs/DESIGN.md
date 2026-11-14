# 友好表达 · 设计

> 状态：v0.1 MVP 已实现（功能以 `designs/friendly-expression/` 的三张设计稿为准）。
> 设计稿与本文冲突时，功能以设计稿为准；实现方式以 DSH 当前插件最佳实践为准。

## 1. 定位

本插件不负责「命令的渲染」，也不负责工具卡片的渲染；它负责 **Agent 的友好表达**。

友好表达分成两层，后续所有能力都归到其中一层：

| 层 | 解决什么 | 由谁定义 | 当前载体 |
|---|---|---|---|
| 表达方式 | 说什么、按什么结构说、信息密度、语气、称呼、语言约束 | 用户可编辑的提示词 | system prompt section |
| 表达形态 | 用什么承载：图、表、列表 | 渲染层，自动内置 | Mermaid；后续由 skill 提供更丰富的形态 |

Mermaid 和后续 skill 只属于形态层。方式层不依赖具体形态：用户可以把提示词改成「不要用英文」「每段先称呼我」，渲染层不变；反过来，以后加 SVG 或别的形态，也不要求用户改提示词。

这条边界是插件的核心：**方式可配置、形态可扩展，两者不互相绑架。**

## 2. 产品原则

1. **默认可用，允许修改，随时恢复。** 默认提示词是一份可直接使用的推荐文案，不是空模板。
2. **只承诺渲染层支持的形态。** 默认提示词里不写 SVG、PlantUML 或未安装的 skill，否则模型会输出渲染层接不住的东西。
3. **图形服务解释，不服务装饰。** 三步以内的线性过程用有序列表说清；不要为了「看起来专业」而画图。
4. **成本封顶。** 提示词上限 800 字符（默认 282 字），每轮都会随 system prompt 发送；这是用户可感知的硬上限，不做隐式扩写。
5. **作用域跟随 profile。** 配置是 profile 级的；不同 profile 可以有不同的表达风格。
6. **新会话生效，会话内冻结。** 提示词注入 system prompt；为了不破坏模型的前缀缓存，每个会话在创建时固化一份提示词快照，之后修改设置不影响已存在会话，重启/恢复后也从快照恢复。
7. **不注入子代理。** 友好表达面向用户和 Agent 的对话；子代理的输出是给父代理看的结构化文本，不需要表达风格和图形。
8. **形态自动内置。** 不提供「表达形态」开关；插件启用后自动接管 mermaid 围栏。用户改不了渲染器，也不需要改。
9. **失败可自救。** Mermaid 渲染失败时给出错误摘要和「复制给 Agent」按钮，让用户能直接把问题交回给模型重生成，而不是只看到一坨源码。

## 3. 表达方式：可编辑提示词

### 3.1 设置页

- **入口**：设置面板左侧一级导航「友好表达」，对应宿主 `settings.section`，**不是**插件详情页的 bundle/row 配置。
- **页面结构**（设计稿定版）：标题「友好表达」与副标题「让 Agent 说得清楚，也画得明白。」；一张「表达方式」卡片；卡片内是 textarea、`282 / 800` 计数、`恢复默认` 与 `保存`；底部提示「恢复默认会回到系统推荐文案；已有会话保持原提示词。」
- **没有「表达形态」卡片**：Mermaid 渲染是内置行为，不需要配置。
- **控件自绘**：使用宿主主题 token 和自绘 textarea/按钮，不引入 `@deepseek-ai/dsh-client-ui-primitives`；宿主不保证这些客户端 primitives 的跨版本兼容。
- **保存语义**：保存后只对新会话生效；已经打开/已存在的会话保持其快照，不因这次保存改变 system prompt。
- **恢复默认语义**：移除用户覆盖、回落到 schema 默认值；已存在会话的快照不变。

### 3.2 配置

Host 半体声明 `Config`：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `stylePrompt` | string | 推荐文案（282 字） | 最长 800 字符；`.volatile()`，保存后不重启插件即可被 Host 读取 |

`stylePrompt` 使用 `.volatile()` 的原因：DSH 的设置服务只投影 volatile 字段，普通字段只能改 YAML；volatile 还能让配置在运行中更新。插件在会话创建时读取它并固化快照，因此新会话用新值，已有会话保持不变。

字符上限按 UTF-16 长度（`string.length`）计算，与 Host schema 的 `max(800)` 保持一致；设置页的计数器使用同一口径。

### 3.3 注入机制与会话快照

在 Host 半体里注册 system prompt section：

```ts
ctx.agents // 逐 Agent 注册
agent.ctx.systemPrompt.section({
  name: 'westwall:friendly-expression',
  order: 9500,
  text: snapshot, // static string, captured once per session
})
```

- **按 Agent 注册 scoped section**，不注册全局 section。这样每个会话可以有不同的快照，并且能自然排除子代理。
- **只对 Web/桌面注入**：装配时检查 `ctx.get('webApp')`（必要时兼容 `webServer`）；CLI/headless 没有客户端渲染面，不注入，避免终端里出现 Mermaid 源码块。
- **子代理不注入**：`agent.session.header.origin === 'subagent'` 的 Agent 不注册 section。
- **每个会话一份持久化快照**：使用 `ctx.storageDomain` 打开域 `friendly_expression`，表 `sessions` 以 `SessionId` 为 key，值为 `{ prompt, capturedAt }`。新会话在 `agent/created` 时捕获当前 `stylePrompt`；判定依据是「`source === 'startup'`、没有快照、没有既有消息、非 seeded、非 subagent」。已有会话没有快照就不注册 section，避免在会话中途改变 system prompt。
- **恢复会话**：只读快照；有快照就注册同样的文本，没有就视为「该会话不启用友好表达」。重启/恢复不会改用最新设置。
- **前缀缓存**：同一会话内每次请求的 system prompt 文本保持逐字节一致，模型的前缀缓存不会因为设置变更而失效；新会话才换新文案。
- **存储依赖与降级**：`storageDomain` 是声明依赖，插件在它可用后才激活；打开失败或写入失败时退回进程内 `Map<SessionId, string>`，当前运行内行为不变，重启/恢复后失去快照。不阻塞会话创建。
- **数据保留**：快照是插件卸载也不会自动清理的持久数据（会话级 <1 KB）。README 需要说明这一点，并提供清理位置；不在会话删除时做不可靠的自动清理。

选择 scoped section 而不是下面两种方案：

- **不用 `agent-instructions`。** 它是文件驱动的上下文插件：读取用户全局或项目里的 `AGENTS.md`，注入 durable 的 user 消息。那是用户自己的文件，插件不应该去写，也没有「设置项」概念。
- **不用 `systemPrompt.context`。** 那是 user-role 的「当前运行上下文」快照，可被 `includeRuntimeContext: false` 抑制，语义上不是行为规则。

### 3.4 默认提示词

默认文案采用设计稿的 282 字版本：

````text
友好表达：
1. 紧扣问题，先给结论，再给必要依据；只讲相关信息，不复述已知内容。
2. 不确定的地方明确标注，不编造；有依据时给出依据。
3. 长内容分点，按重要性排序；语气自然直接，不堆客套。
表达形式：
4. 流程、时序、状态、关系用 mermaid 代码块（flowchart、sequenceDiagram、stateDiagram-v2、erDiagram）；禁止用 ASCII 方框和箭头画图。
5. 对比用表格，线性步骤用有序列表，文件树保留缩进。
6. 单图不超过 12 个节点；三步以内能说清的不画图。
用户明确要求其他形式时，以用户要求为准。
````

设计取舍：

- **把格赖斯四原则写成动作，不抄原文。** 「信息充分、真实、相关、清晰」对模型的行为改变很弱，还容易和基础提示词里的简洁要求打架；写成「先结论后依据、只讲相关信息、不编造、分点排序」更可执行。
- **明确「三步以内不画图」。** 否则只是把 ASCII 泛滥换成 Mermaid 泛滥。
- **保留例外条款。** 用户明确要求 ASCII 草图或其他形式时听用户的，避免规则和直接指令冲突。
- **默认不用满 800 字。** 上限是给用户改的，不是默认目标。
- **允许保存空字符串。** 空字符串表示新会话不注入任何表达提示词；设置页不额外做开关。

## 4. 表达形态：Mermaid

### 4.1 渲染接入

- 客户端半体声明 `dsh.client`（`platform: 'web'`），在 `apply` 里注册围栏层：

```ts
ctx.slots.inject('conversation.chat.markdown.fence', () => ctx.slots.register({
  name: 'conversation.chat.markdown.fence',
  id: '@westwall/dsh-friendly-expression/fence/mermaid',
  key: 'mermaid',
}, MermaidFenceLayer))
```

- 槽位按小写围栏语言分发，`key: 'mermaid'` 即接管 mermaid 语言的代码块。
- 流式阶段渲染 `children`（普通代码块），落定后再解析渲染；避免半截语法报错。
- 层内部捕获 mermaid 的解析/渲染异常，回退到源码块并附错误提示；框架本身也会在层崩溃时回退到 `children`。
- 按可视区懒渲染：`IntersectionObserver` + 单并发渲染队列，避免一屏外几十张图同时解析；缓存键包含 `code + theme`。

### 4.2 内联卡片

按设计稿：

- 卡片头部：Mermaid 图标 + `MERMAID` 标识；右侧 `源码` 切换、复制源码、放大查看。
- 图区域：按容器宽度自适应，限制最大高度；右下角保留「点击放大」提示。
- 点击图（或放大按钮）打开浮窗；工具栏按钮不触发打开。
- 流式阶段显示源码；落定后显示图；用户切到「源码」时也显示源码。
- 解析失败时显示错误块，而不是空白或半截图；源码仍然可见。

### 4.3 浮窗

- 注册在根 `shell.overlay` 槽位，覆盖整个窗口；组件用 `position: fixed` 自己撑满视口，带 `role="dialog"`、`aria-modal`、焦点陷阱、Esc 关闭、点遮罩关闭，关闭后焦点回到触发卡片。
- 标题：围栏本身没有标题。优先取 Mermaid frontmatter 的 `title:` 或围栏 `meta`（如 ` ```mermaid 加载流程 `）；都没有时，用 `mermaid.detectType(code)` 识别图类型并显示本地化名称（流程图、时序图、状态图、ER 图等），失败则显示「Mermaid 图表」。**不**从节点标签猜测标题。
- 头部操作：复制源码、下载 SVG、关闭。
- 底部缩放条：`−`、当前百分比、`+`、`适合窗口`、`1:1`；滚轮缩放以指针为中心，拖拽平移，缩放范围约 20%–800%；打开时默认「适合窗口」。
- 主题跟随宿主：用 `base` 主题 + 从宿主 token 映射的变量，监听 `theme/change` 重绘；缓存键包含主题标识。
- 内联卡片和浮窗都用 Blob `<img>` 显示 SVG，避免同一份 inline SVG 在页面里出现两次导致 id 冲突；下载也直接用这份 SVG 字符串。
- 设计稿已去掉的操作说明文字（「滚轮缩放 · 拖拽平移 · Esc 关闭」「Mermaid · 4 个节点」）不再添加。

### 4.4 错误与自救

- 解析失败、渲染超时、空内容一律回退为源码块，并显示一行错误摘要；不阻塞消息其余部分。
- 错误块提供：
  - `复制错误给 Agent`：复制以下文本，用户粘贴回会话即可让模型重生成：
    ```text
    Mermaid 渲染失败，请重新生成。错误信息：
    <错误摘要>
    ```
  - `查看源码`：切换到源码块，方便用户手动检查或修改。
- 复制成功后给轻量反馈（「已复制，粘贴发送给 Agent」）；不自动发送。
- 错误摘要截断到一行或一个短段落，避免把整段 parser 输出塞进 UI；完整的错误细节可以保留在开发者控制台。

### 4.5 会话徽章

- 位置：`conversation.session.header.utilities`，会话头部右上角的小图标/徽章，悬停或键盘聚焦时显示提示「友好表达已开启」。
- 显示条件：插件启用且当前 `stylePrompt` 非空。提示词为空时隐藏；CLI/headless 没有客户端，不显示。
- 徽章是**插件级**状态，不逐会话判断是否已经捕获快照；如果后续需要严格的「当前会话已开启」精度，再增加 Host 侧的会话状态查询或会话投影。
- 仅作为轻量标记，不改变布局、不占工具栏宽度；配色使用主题 token，暗色/亮色都可读。

### 4.6 安全、体积与版本

- `securityLevel: 'strict'`；设置 `maxTextSize: 20000`、`maxEdges: 500` 上限，防止超图拖垮页面；`suppressErrorRendering: true`，异常时清理临时节点。
- 只处理 assistant 消息里的围栏；工具卡片、详情页、用户消息不在 MVP 范围。
- 体积（实测 `dist/mermaid.min.js`，raw / gzip）：
  - mermaid 11.15.0：约 3.31 MB / 0.91 MB
  - mermaid 12.3.0：约 5.54 MB / 1.59 MB
- 版本选择：12.3.0 很新（12.0.0 于 2026-09 发布），主要变化是 ELK 成为默认布局、`neo` 成为默认外观、解析器升级；四种白名单图类型的基础语法没有变。模型对 11.x 的先验更强，因此 **MVP 默认锁 11.15.0**；发布前用一组真实模型输出的固定语料做 11.15.0 vs 12.3.0 的 A/B，若 12.3.0 的解析成功率不劣于 11.15.0，则升级到 12.3.0（安全修复与后续维护更好）。如果用 12.3.0，显式设置 `layout: 'dagre'`、`look: 'classic'`、`theme: 'base'`，抵消默认布局/外观变化。
- 当前锁文件已解析到 DOMPurify 3.4.17；升级 Mermaid 时保持该下限，并在发布前做一次依赖审计。
- mermaid 采用 MIT 许可，`client.js` 内联其版权声明；构建产物加体积护栏，记录实际大小。

## 5. 设置页读写

- 注册 `settings.section`（`id: 'friendly-expression'`，`order` 约 15.5，位于「内置插件」和「OpenCode 调色板」之间），并用 `settings.section.icon` 注册同 id 的导航图标。
- 数据读写走客户端 `ctx.configForms`：
  - `ctx.inject(['slots', 'configForms'], ...)`，避免把 Mermaid 渲染能力绑在设置服务上。
  - `ctx.configForms.whileServed(['friendly-expression'], register)`：只有当 Host 正在服务该配置命名空间时才显示页面；`whileServed` 不存在时（更旧版本）退化为直接注册。
  - `ctx.configForms.get('friendly-expression')` 返回 `getSnapshot / subscribe / set / unset / mutate`；保存用 `set('stylePrompt', text)`，恢复默认用 `unset('stylePrompt')`，revision 冲突由 `configForms` 处理。
  - `snapshot.writable === false` 时只读；`snapshot.status === 'unavailable'` 时显示不可用提示。
- **不使用自定义 Host Remote**：设置页只需要读写本插件 Config，`configForms` 已经覆盖传输、schema 校验和 revision 冲突。
- `namespace` 是 Loader 行 id `friendly-expression`，不是包名；这个 id 一旦安装过就不要改。

## 6. MVP 范围

| 做 | 不做 |
|---|---|
| Config（800 字提示词，volatile） | SVG / 图表 / 其他围栏语言 |
| 设置面板一级页（textarea + 计数 + 保存 + 恢复默认） | 按 schema 自动生成表单、`ConfigField` 依赖 |
| Host 端按 Agent 注册 system prompt section，仅 Web/桌面注入 | CLI/headless 注入 |
| 每个会话持久化提示词快照，新会话生效、会话内冻结 | 已存在会话的追溯注入 |
| 子代理排除 | 按 agent 类型/来源做更细的排除策略 |
| Mermaid 围栏渲染、流式回退、错误降级 | 工具卡片、详情页、用户消息的 Mermaid |
| 内联卡片（源码/复制/放大）与浮窗（缩放/平移/适合窗口/1:1） | 多套风格预设、按会话切换风格 |
| 错误块「复制错误给 Agent」 | 自动重试、自动改写 prompt |
| 会话头部「友好表达已开启」小徽章 | 严格的逐会话徽章状态（后续再加） |
| 复制源码、下载 SVG、主题跟随、缓存、懒渲染 | 图片生成、A2UI/Generative UI |

## 7. 验收标准

Host：

- 新会话在创建时捕获当前提示词；之后修改设置，已有会话的 system prompt 文本不变。
- 重启/恢复会话后，持有快照的会话继续使用快照；没有快照的旧会话不注入。
- 子代理不注册 section，输出中不出现友好表达提示词。
- CLI/headless profile 不注入。
- 恢复默认后，新会话回落到 schema 默认值；旧会话保持快照。
- 存储不可用时降级为进程内快照，当前运行行为不变。

客户端：

- 流式阶段显示代码块，落定后显示图；图不溢出消息容器。
- 点击可弹窗缩放、平移、滚动；主题切换后重绘。
- 非法 Mermaid 回退为源码块和错误块；「复制错误给 Agent」写入正确的文案。
- 同一 `code + theme` 只渲染一次；长会话滚动不卡顿。
- 设置页保存、恢复默认、800 字校验、只读状态和冲突提示都可用。
- 提示词非空时，会话头部出现徽章；提示词清空后消失。

端到端：

- 在 Web 会话中要求解释一段流程，模型输出 Mermaid 代码块，界面渲染成图。
- 修改设置后新开会话使用新文案；旧会话回复风格不变。
- 卸载插件后，Mermaid 恢复为普通代码块，新会话不再注入。

## 8. 风险与待验证

1. **会话快照的持久化依赖**：新增 `storageDomain` + `zod` 依赖；需要验证最低 DSH 版本、存储后端路由、域打开失败时的降级，以及卸载后数据保留的用户告知。
2. **快照捕获时机**：`agent/created` 的 `source` 与 `SessionHeader` 是否足以区分「新会话 / 恢复 / fork / 子代理」；需要在真实桌面端和 Web 端各验证一遍。
3. **缓存收益的可观测性**：目前只能通过 system prompt 文本稳定和 provider cache 命中日志间接验证；需要在真实 DeepSeek 账户下观察 `cacheReadTokens` 或等价指标。
4. **mermaid 12 的默认布局/外观**：ELK 和 `neo` 会改变图的观感；若升级 12，必须显式固定 `layout`、`look`、`theme` 并回归视觉。
5. **一次生成成功率**：默认提示词只列四种图类型；仍可能出现节点 id 冲突、括号/引号不配对、`end` 缺失等错误。错误块和复制自救是兜底，但发布前要用真实模型输出做 A/B 语料测试。
6. **bundle 体积与首屏**：11.15.0 约 3.3 MB（gzip 约 0.9 MB），12.3.0 约 5.5 MB（gzip 约 1.6 MB）；需要实测页面启动解析耗时和首次渲染延迟。
7. **徽章精度**：当前是插件级状态，不区分旧会话是否真的持有快照；文案避免过度承诺「当前会话」。
8. **非交互会话**：定时任务、工作流等会话没有可靠的类型标记，当前会按普通会话处理；若需要排除，后续再加判断。
9. **pre-stable API**：围栏槽位、`settings.section`、`configForms`、`systemPrompt` 都是 DSH 的 pre-stable 接口，升级 DSH 版本时要回归。
10. **设置页成本**：自定义页面、计数器、保存/恢复默认、只读和冲突状态都要测；不要低估这部分工作量。
11. **主题映射**：Mermaid 的 `base` 主题变量与宿主 token 不是一一对应；需要在亮色/暗色下检查对比度，特别是 sequence/state/ER。
12. **安全**：strict、`maxTextSize`/`maxEdges`、SVG 下载内容都要检查；停留在 11.x 时要覆盖 DOMPurify 版本并记录残余风险。

## 9. 与后续 skill 的关系

- skill 手动触发，只在被调用时把更丰富的形态说明加载进上下文，不增加每轮成本。
- skill 提供的形态必须先在渲染层实现；默认提示词不提及它们，避免模型输出接不住的内容。
- 候选形态：消毒后的 SVG、受约束的图文卡片/时间线。具体取舍放到 skill 阶段再定，不提前写进默认提示词。