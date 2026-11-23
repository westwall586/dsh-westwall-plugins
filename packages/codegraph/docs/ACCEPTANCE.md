# 验收记录 2026-11-23

环境：DSH 0.2.2-rc.5，Node v24.21.0，macOS。
CodeGraph CLI 1.6.2（`~/.local/bin/codegraph`），索引演示仓库（两个 JS 文件，含 `alphaOnlySymbol`）。

装法走正规路径：`DSH_HOME=/tmp/cg-home`，`dsh cg-verify --from-default-profile web` 生成基础 profile，再
`dsh plugin --profile cg-verify add link:<插件路径>`。这是 `dsh plugin add` 的真实链路，不是手改 `node_modules`。

## 通过项

| 项 | 证据 |
|---|---|
| 插件被 loader 挂载 | `dsh --profile cg-verify --dump-config` 里有 `- id: codegraph` |
| 宿主启动无告警 | 启动日志无 `did not activate`、无 `duplicate loader entry` |
| client bundle 加载 | boot 图里我们的条目在 application batch，浏览器请求了该 batch |
| 工作区「⋯」菜单出现 CodeGraph 项 | 菜单项为 `CodeGraph：打开面板`、`在此工作区启用 CodeGraph` |
| 插件详情页面板渲染 | `[data-codegraph-panel]` 文本正确，无 `data-slot-error` |
| 三关验证 | `cg-demo` 从 `disabled` → `indexing` → `verifying` → `ready` |
| 开关落库 | `durable: true`，宿主重启后 `enabled: true` 仍在 |
| 工具按工作区出现 | 会话的工具列表含 `mcp__codegraph__codegraph_explore`，挂载根指向演示仓库 |
| 关闭后工具消失 | `setEnabled(false)` 后 `tools: {}`、`mounted: {}` |
| 重新开启后工具回来 | `setEnabled(true)` 后工具与挂载同一会话重新出现 |
| 空目录工作区如实报错 | 空目录得到 `failed: 这个工作区没有找到可索引的源码` |
| 干净 profile 全链路 | 从零建 profile → 装插件 → 建工作区 → 开启 → 建会话 → Agent 创建 → 工具出现；关闭后消失，再开启又出现 |
| 单元测试 | 29 个，全绿 |
| 类型检查与构建 | `pnpm typecheck`、`pnpm build` 全绿，`client.js` 10541 字节 |

## 未验到的项（环境限制）

- **模型实际调用 `codegraph_explore`**：临时 profile 没有 LLM 凭据，报 `MISSING_CREDENTIAL`（`DEEPSEEK_API_KEY` 未配置）。工具已注册进会话作用域，但"模型能调用并拿到结果"这一步依赖凭据，没有在本机跑通。
  旁证：同一索引上直接执行 `codegraph explore "alphaOnlySymbol"` 返回了预期格式，且插件首调验证用的正是这份输出格式。

## 本轮修掉的实质缺陷

1. **客户端信封少剥一层**：网关响应是 `result.value` 里再套 `{ok, value}`，只剥一层导致 `view.workspaces` 为 `undefined`，面板首帧崩溃、菜单 `resolve` 抛错。这是面板与菜单同时失效的根因。
2. **存储键路径不安全**：per-record 键要求 `^[a-zA-Z0-9_-]+$`，绝对值路径直接写盘报错。改成路径 sha256 前缀，记录体保留真实路径。
3. **存储域被提前关闭**：`ctx.inject` 回调里的 `close` 交给了外层 async，作用域一结束域就关了，之后所有写盘报 `domain 'codegraph' is closed`。改成在作用域 disposer 里关闭。
4. **工具注册到错误作用域**：DSH 给 Agent 的作用域 key 是 agent 对象本身（`createScope(loopCtx, this)`），早期版本用 `agent.session` 当 key，连接挂上了但工具落在另一个作用域，模型看不到。改为直接挂进 `agent.ctx`，查询也用 agent 作用域。
5. **关闭工作区不拆连接**：只改开关不拆挂载，工具会继续存在。现在关闭与开启都会对在册会话做一次挂载同步。
6. **运行中的会话不补挂**：`agent/created` 只在创建时发一次，重启恢复的会话收不到。补了 `session/event` 上的补齐路径。
7. **两条挂载路径互相撞车**：补齐路径与创建事件会并发到达，mcp-client 以作用域作 `serverName` 占用键，第二次挂载直接报 `already in use`。加了按会话的挂载互斥。

## 已知文档级约束

`plugins.detail.section` 与 `shell.overlay` 都是 list 型槽位：条目崩过一次就永久退休（`abdicated` 是 `WeakSet`，没有清除路径），本次页面生命周期内不再渲染。所以 client 组件必须自己用错误边界兜住异常，不能让它冒到槽位边界。这一条写进了 `docs/CLIENT-NOTES.md`。
