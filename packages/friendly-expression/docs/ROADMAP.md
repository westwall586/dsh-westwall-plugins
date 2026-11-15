# 迭代路线

> 状态：v0.1 MVP。功能以 `designs/friendly-expression/` 的设计稿为准，实现方式以 DSH 当前插件最佳实践为准。

## v0：设计与骨架（已完成）

- 建立 `@westwall/dsh-friendly-expression` 包骨架、bundle patch、locale 与图标占位。
- 写清定位、注入机制、默认提示词、MVP 范围与验收（[DESIGN.md](DESIGN.md)）。
- 安装后不改变宿主行为。

## v0.1：MVP（当前）

目标：一段可编辑的提示词，加上一个能看的 Mermaid 图。

Host：

- `Config`：`stylePrompt`（≤800 字符，`.volatile()`，默认 164 字正文；注册时另加一行固定英文引导语，不计入这 800 字符）。
- 按 Agent 注册 system prompt section，仅 Web/桌面注入。
- 新会话创建时把提示词写入 `storageDomain` 快照；已有会话使用快照，重启/恢复不变。子代理不注入。
- 设置页：`settings.section` + `settings.section.icon`，用 `ctx.configForms` 读写，自绘 textarea，不加 `ConfigField` 依赖。

客户端：

- 声明 `dsh.client`，注册 `conversation.chat.markdown.fence` 的 `mermaid` 层。
- 流式显示源码，落定渲染；解析/渲染失败回退源码块，并提供「复制错误给 Agent」。
- 内联卡片：源码切换、复制、放大。
- 浮窗：滚轮缩放、拖拽平移、适合窗口、1:1、复制源码、下载 SVG。
- `shell.overlay` 承载浮窗；`<img>` + Blob URL 显示 SVG，避免重复 id 和脚本执行。
- 主题跟随、`code + theme` 缓存、可视区懒渲染。
- 会话头部「友好表达已开启」小徽章；插件级状态，提示词为空时隐藏。
- Mermaid 11.15.0，构建进 `client.js`；动态加载，初始化时固定 `securityLevel: 'strict'`、`maxTextSize: 20000`、`maxEdges: 500`。

验收：

- Web 会话里模型输出 Mermaid 代码块能渲染成图，点击可放大查看。
- 非法语法不影响整条消息，错误信息可复制给 Agent。
- 800 字符超限被拒绝；恢复默认回落到推荐文案。
- 旧会话保持快照，重启/恢复后 system prompt 不变；子代理不注入。
- CLI/headless 不注入提示词。
- 设置页、徽章、浮窗在 Web/桌面实际界面可用。
- 记录 `client.js` 体积（当前 3.28 MiB）；首屏解析耗时待补测。

## v0.2：打磨

- 主题令牌映射细化，暗色模式对比度检查。
- 错误提示与重试、空图/超大图的边界。
- 可访问性：标题/描述、键盘操作、焦点管理。
- 国际化补齐：配置页、错误文案、浮窗和徽章全部走 locale。
- 源码切换、复制、下载之外的操作为实际需要再加。
- 测试补齐：层渲染、回退、浮窗交互、配置页 reset。
- 评估严格的逐会话徽章状态；现在徽章只表示插件已开启。
- 评估 Mermaid 12.x：用真实模型输出做 11.15.0 与 12.x 的 A/B，若成功率不劣再升级。

## v1.0：手动触发的 skill

目标：在用户明确需要「更丰富的视觉表达」时，提供比 Mermaid 更自由、但成本更高的形态。

- skill 手动触发，不进入默认提示词；加载时才把形态说明与约束放进上下文。
- 先实现渲染层支持的形态，再写 skill 说明；候选是消毒后的 SVG 或受约束的图文卡片/时间线。
- skill 的说明要写清触发条件、体积/成本边界和失败回退，避免模型滥用。
- 验收：未触发时行为与 v0.2 完全一致；触发时输出可渲染、可回退，且不污染普通回复。

## 候选（未排期）

这些能力都可以从「表达方式」入口扩展，不需要改渲染层：

- 语气预设：幽默、调皮、正式、简洁；每段称呼用户。
- 语言约束：回复中不出现英文、术语必须给中文解释。
- 长度约束：先给一句话结论，展开不超过 N 段。
- 按 profile 或按会话切换风格（当前是 profile 级）。
- 更多形态：数据图表、交互式卡片；只在有稳定需求时评估。

## 明确不采用

- **A2UI / AG-UI / Vercel Generative UI 全栈**：它们是「agent 生成应用界面」的协议，不是聊天里的低成本图形表达；引入 SDK + catalog + surface 状态不划算。
- **通用图表 DSL / Graphviz / D2 / PlantUML**：渲染器更重、模型先验更弱，收益不如 Mermaid + 表格。
- **图片生成**：延迟、成本、不可复现，不适合每轮表达。
- **CLI 注入**：终端没有渲染面，Mermaid 源码比 ASCII 更难读。
- **工具卡片/详情页渲染**：本插件只处理对话里的 assistant 消息，工具结果有自己的展示机制。

## 发布节奏

- v0.1 之前保持 `private: true`，只走本地 `link:` 或固定 commit。
- 首次发布在 v0.1 打磨完成、走完 [RELEASING.md](../../../docs/RELEASING.md) 之后；tag 形如 `dsh-friendly-expression@<version>`。