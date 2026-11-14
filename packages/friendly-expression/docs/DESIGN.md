# 友好表达 · 设计

> 状态：设计阶段。本文件定义产品边界与实现方向，代码尚未开始。

## 1. 定位

本插件不负责「命令的渲染」，也不负责工具卡片的渲染；它负责 **Agent 的友好表达**。

友好表达分成两层，后续所有能力都归到其中一层：

| 层 | 解决什么 | 由谁定义 | 当前载体 |
|---|---|---|---|
| 表达方式 | 说什么、按什么结构说、信息密度、语气、称呼、语言约束 | 用户可编辑的提示词 | system prompt section |
| 表达形态 | 用什么承载：图、表、列表 | 渲染层 | Mermaid；后续由 skill 提供更丰富的形态 |

Mermaid 和后续 skill 只属于形态层。方式层不依赖具体形态：用户可以把提示词改成「不要用英文」「每段先称呼我」，渲染层不变；反过来，以后加 SVG 或别的形态，也不要求用户改提示词。

这条边界是插件的核心：**方式可配置、形态可扩展，两者不互相绑架。**

## 2. 产品原则

1. **默认可用，允许修改，随时恢复。** 默认提示词是一份可直接使用的推荐文案，不是空模板。
2. **只承诺渲染层支持的形态。** 默认提示词里不写 SVG、PlantUML 或未安装的 skill，否则模型会输出渲染层接不住的东西。
3. **图形服务解释，不服务装饰。** 三步以内的线性过程用有序列表说清；不要为了「看起来专业」而画图。
4. **成本封顶。** 提示词上限 800 字符（默认约 300 字），每轮都会随 system prompt 发送；这是用户可感知的硬上限，不做隐式扩写。
5. **作用域跟随 profile。** 配置是 profile 级的；不同 profile 可以有不同的表达风格。

## 3. 表达方式：可编辑提示词

### 3.1 配置

Host 半体声明 `Config`：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enabled` | boolean | `true` | 关闭后不注入提示词；渲染层仍按普通代码块显示 |
| `stylePrompt` | string | 推荐文案 | 最长 800 字符；`.volatile()`，保存后不重启插件即可生效 |

`stylePrompt` 使用 `.volatile()` 的原因：DSH 的设置服务只投影 volatile 字段，普通字段只能改 YAML；volatile 还能让配置在运行中直接更新，下一次 prompt 装配就读取新值。

### 3.2 注入点

在 Host 半体里注册 system prompt section：

```ts
ctx.systemPrompt.section({
  name: 'westwall:friendly-expression',
  order: 9500,
  text: () => enabled() && webSurfacePresent()
    ? config.stylePrompt.get()
    : '',
})
```

选择 `section` 而不是下面两种方案：

- **不用 `agent-instructions`。** 它是文件驱动的上下文插件：读取 `~/.dsh/AGENTS.md`、`~/.agents/AGENTS.md` 和项目链上的 `AGENTS.md`/`CLAUDE.md`，注入一条 durable 的 user 消息。那是用户自己的全局文件，会影响所有项目，插件不应该去写它，也没有「设置项」概念。
- **不用 `systemPrompt.context`。** 那是 user-role 的「当前运行上下文」快照（工作目录、沙箱策略这一类），可被 `includeRuntimeContext: false` 抑制，语义上不是行为规则。

`section` 的好处：

- 每个请求都在，历史被压缩后仍然生效；
- 语义上就是「系统级规则」，和用户显式指令的优先级关系清楚；
- 用户改设置后，下一轮装配读取新文本；agent-loop 的 system prompt projection 会按路由能力追加或替换 system 消息，不需要重启会话。

### 3.3 只在 Web/桌面注入

CLI 和 headless profile 没有 Mermaid 渲染面，注入「用 Mermaid 表达」只会让终端里出现源码块，比 ASCII 更难读。因此 section provider 在装配时检查 Web/桌面渲染面是否存在（`ctx.get('webApp')`，实现时以实际服务名为准），不存在就返回空串。

这也是插件公开分发时的默认安全行为：同一个 profile 里的会话、子代理、定时任务都跟随当前运行面。

### 3.4 默认提示词

默认文案把格赖斯四原则翻译成可执行动作，再加形态规则；约 300 字，给用户留出修改空间。

````text
友好表达：
1. 紧扣问题，先给结论，再给必要依据；只讲相关信息，不复述已知内容。
2. 不确定的地方明确标注，不编造；有依据时给出依据。
3. 长内容分点，按重要性排序；语气自然直接，不堆客套。
表达形式：
4. 流程、时序、状态、关系用 ```mermaid 代码块（flowchart、sequenceDiagram、
   stateDiagram-v2、erDiagram）；禁止用 ASCII 方框和箭头画图。
5. 对比用表格，线性步骤用有序列表，文件树保留缩进。
6. 单图不超过 12 个节点；三步以内能说清的不画图。
用户明确要求其他形式时，以用户要求为准。
````

设计取舍：

- **把四原则写成动作，不抄原文。** 「信息充分、真实、相关、清晰」对模型的行为改变很弱，还容易和基础提示词里的简洁要求打架；写成「先结论后依据、只讲相关信息、不编造、分点排序」更可执行。
- **明确「三步以内不画图」。** 否则只是把 ASCII 泛滥换成 Mermaid 泛滥。
- **保留例外条款。** 用户明确要求 ASCII 草图或其他形式时听用户的，避免规则和直接指令冲突。
- **默认不用满 800 字。** 上限是给用户改的，不是默认目标。

## 4. 表达形态：Mermaid

### 4.1 渲染接入

- 客户端半体声明 `dsh.client`（`platform: 'web'`），在 `apply` 里注册围栏层：

```ts
ctx.slots.inject('conversation.chat.markdown.fence', () => ctx.slots.register({
  name: 'conversation.chat.markdown.fence',
  key: 'mermaid',
  id: '@westwall/dsh-friendly-expression/fence/mermaid',
}, MermaidFenceLayer))
```

- 槽位按小写围栏语言分发，`key: 'mermaid'` 即接管 mermaid 语言的代码块。
- 流式阶段渲染 `children`（普通代码块），落定后再解析渲染；避免半截语法报错。
- 层内部捕获 mermaid 的解析/渲染异常，回退到源码块并附一行错误提示；框架本身也会在层崩溃时回退到 `children`。

### 4.2 观看体验

- 消息内按容器宽度自适应，限制最大高度；
- 点击图打开弹窗，支持缩放（按钮 + 滚轮）、拖拽平移、适应窗口、滚动；
- 工具栏提供复制源码、下载 SVG；源码切换是可选的。
- 主题跟随宿主：用 mermaid `base` 主题 + 从宿主主题令牌映射的变量，主题切换时重绘；缓存键包含 `code + theme`。
- 长会话里按可视区懒渲染，避免一屏外几十张图同时解析。

### 4.3 安全与降级

- `securityLevel: 'strict'`；设置 `maxTextSize`、`maxEdges` 上限，防止超图拖垮页面。
- 解析失败、渲染超时、空内容一律回退代码块，不阻塞消息其余部分。
- 只处理 assistant 消息里的围栏；工具卡片、详情页、用户消息不在 MVP 范围。

### 4.4 体积

mermaid 全量约 3.4MB（gzip 后 <1MB），不在 DSH 客户端 baseline 里，需要打进本包的 `client.js`。首屏下载与解析成本是 MVP 必须实测的指标；如果不可接受，再评估裁剪图类型或按需加载方案，而不是先假设没问题。

## 5. 设置入口

- 位置：「插件」页 → 本插件 bundle 详情 → `plugins.bundle.config` 槽位（不是 DSH 的通用设置页）。
- 控件：`ConfigField`（ui-primitives）自带 textarea（按行数撑高）与 Reset 按钮；Reset 的语义是移除用户覆盖、回落到 schema 默认值，正好满足「恢复默认」。
- 校验：`stylePrompt` 超过 800 字符时拒绝保存并显示错误；不需要 token 估算提示。
- 随附客户端目前不会按 schema 自动生成表单，因此这个小页面需要插件自己提供；它属于 MVP 工作量，不是零成本。

## 6. MVP 范围

| 做 | 不做 |
|---|---|
| Config（enabled + 800 字提示词，volatile） | SVG / 图表 / 其他围栏语言 |
| 自定义配置页（textarea + reset + 字符校验） | 按 schema 自动生成表单 |
| Host 端 system prompt section，仅 Web/桌面注入 | CLI/headless 注入 |
| Mermaid 围栏渲染、流式回退、错误降级 | 工具卡片、详情页、用户消息的 Mermaid |
| 弹窗缩放/平移、主题跟随、缓存、懒渲染 | 多套风格预设、按会话切换 |
| 复制源码、下载 SVG | 图片生成、A2UI/Generative UI |

## 7. 验收标准

Host：

- Web/桌面 profile 中，system prompt 包含本 section；关闭 `enabled` 后为空。
- 修改提示词后，下一轮装配生效；当前会话不需要重启。
- CLI/headless profile 不注入。
- 恢复默认后，文本回落到 schema 默认值。

客户端：

- 流式阶段显示代码块，落定后显示图；图不溢出消息容器。
- 点击可弹窗缩放、平移、滚动；主题切换后重绘。
- 非法 Mermaid 回退为源码块并给出提示，其余消息不受影响。
- 同一 `code + theme` 只渲染一次；长会话滚动不卡顿。

端到端：

- 在 Web 会话中要求解释一段流程，模型输出 Mermaid 代码块，界面渲染成图。
- 卸载插件后，Mermaid 恢复为普通代码块，提示词不再注入。

## 8. 风险与待验证

1. **bundle 体积与首屏**：3.4MB 的单文件 bundle 是否可接受，需要真机测量；这是最可能推翻「直接打包 mermaid」假设的点。
2. **提示词重复与冲突**：默认文案与基础 system prompt 有部分重叠；靠「可编辑 + 可关闭」兜底，发布后观察行为是否真的改善。
3. **Mermaid 语法错误**：模型对 flowchart/sequence 的把握较好，对 gantt/timeline 等类型容易出错；默认白名单只列常用类型，出错走回退。
4. **pre-stable API**：围栏槽位与 system prompt 注册都属于 DSH 的 pre-stable 接口，升级 DSH 版本时要回归。
5. **配置页成本**：自定义页面、表单状态、reset 语义都要测；不要低估这部分工作量。
6. **子代理**：section 会对同 profile 的子代理生效；它们的输出是给父代理看的文本，画图收益低。MVP 接受，后续再评估是否按 agent 作用域收窄。

## 9. 与后续 skill 的关系

- skill 手动触发，只在被调用时把更丰富的形态说明加载进上下文，不增加每轮成本。
- skill 提供的形态必须先在渲染层实现；默认提示词不提及它们，避免模型输出接不住的内容。
- 候选形态：消毒后的 SVG、受约束的图文卡片/时间线。具体取舍放到 skill 阶段再定，不提前写进默认提示词。