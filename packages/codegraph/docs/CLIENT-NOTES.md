# 浏览器半体的两条硬约束

这份笔记只写踩过的坑，供后来者少走一轮。都来自 2026-11-23 的实测。

## 1. list 型槽位：崩一次就永久退休

`plugins.detail.section` 与 `shell.overlay` 都是 `kind: 'list'`。条目首次渲染抛错时，
渲染器会调用 `reportEntryError(..., { abdicate: true })`，把条目加进一个 `WeakSet`，
而且**整个代码库里没有清除路径**：本页面生命周期内它不再进 `entriesOfSlot`，界面上只留
`<div data-slot-error>`，刷新页面才恢复。

后果：任何想在 list 槽位里放复杂 UI 的插件，首帧异常会让它"消失且不报错"。

对策：

- 条目组件自己用错误边界兜住异常，别让它冒到槽位边界。
- 首帧尽量不读数据、不订阅；把会抛的工作放到 `useEffect` 里。
- 一个条目只做一件事。入口按钮和面板分开挂，按钮坏了不牵连面板。

## 2. 网关响应有两层信封

调 `/api/<namespace>/<method>` 时，响应形状是：

```json
{ "type": "server-response", "rpcId": "…",
  "result": { "ok": true, "value": { "ok": true, "value": <你在 Host 上返回的东西> } } }
```

外层是传输结果，内层是 Host 方法的返回值。只剥一层会拿到 `{ok, value}` 当数据用，
典型症状是读一个不存在的字段得到 `undefined`，再读 `.length` 就抛错；配合上面第 1 条，
表现成"面板和菜单一起消失"，很容易被误判成槽位时序问题。

请求体也要对齐：`{ type: 'client-request', rpcId, endpoint, method, payload: { args: {...} } }`，
其中 `endpoint` 与 `method` 都是 `命名空间/方法`，`args` 必须是对象（空参数传 `{}` 而不是 `[]`）。

## 3. 工具注册的作用域 key 是 Agent 对象本身

DSH 在 `agent-loop` 里用 `createScope(loopCtx, agent)` 建会话作用域，key 是 agent 实例。
插件的 MCP 连接若再包一层 `createScope(agent.ctx, 别的 key)`，工具会落在子作用域里，
`tools.schemas(agent.session)` 看不到它们，模型也就拿不到工具。

对策：直接 `ctx.plugin(McpClient, config)` 挂进 `agent.ctx`；查询与守卫也用 agent 作用域。

## 4. `agent/created` 只发一次

宿主重启后恢复的会话不会再触发 `agent/created`。只靠这个事件挂载，重启后工具就没了。
需要在 `session/event` 等会话活动的信号上补一次"未挂载则挂载"。
