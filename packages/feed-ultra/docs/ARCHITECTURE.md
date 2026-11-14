# 架构

## 定位

资讯工作台把资讯订阅收进 DSH 桌面端。RSS 只是其中一种来源，目标是把任何资讯源接进来，按天阅读，用 AI 加工。

抓取走本机 Ego Browser 的登录态和固定脚本，不依赖付费 API。数据是工作区里的普通 JSON，DSH 里的 Agent 可以直接读。

## 三个半体

| 半体 | 位置 | 职责 |
|---|---|---|
| 宿主 | `src/` | Cordis 服务，负责 RPC、调度、抓取、翻译、落盘 |
| 浏览器 | `client/`，打包成 `client.js` | 侧栏入口、面板、设置表单、RPC facade |
| 数据 | `<工作区>/.dsh-feeds/` | 事实、已读、译文、订阅库、健康 |

宿主用 `TypertRemoteService` 暴露 `feedUltra` 服务。浏览器半体通过 `CLIENT_CONTRIBUTION` 的描述符调用它，再经 `ctx.inject(['remote.feedUltra'])` 拿到命名空间。两边的契约在 `src/contract/`，客户端只消费投影后的视图。

## 数据契约

```text
<工作区>/.dsh-feeds/
  data/items/<day>/<sourceId>.json   一天一个来源的事实快照
  data/state/<day>.json              已读状态
  data/cache/<day>.json              译文缓存
  data/rss-library.json              渠道与订阅源
  health/<sourceId>.json             抓取健康与当日预算
```

事实文件（`FactFile`）记录 `version`、`source`、`day`、`fetch`、`items`。每条 item 有 `naturalKey`、`title`、`description`、`url`、`publishedAt`、`firstSeenAt`、`lastSeenAt`、`extra`。

状态文件（`StateFile`）按写入日分区。读取时按最新写入合并，已读状态因此跨天继承。

缓存文件（`CacheFile`）按条目 id 存译文。复用看简介哈希，不看日期，所以同一段简介换一天仍然命中。

健康文件（`HealthRecord`）记录最近尝试、连续失败、当日自动尝试和 pending 尝试。

所有 JSON 带 `version: 1`，读取时用 zod 校验。损坏文件跳过并上报，当天其他来源继续。写入走 `writeJsonAtomic`，同一工作区的写入由 `createSerialGate` 按天串行化。

## 源适配器

`src/sources/registry.ts` 是唯一把 source id 映射到能力的地方。

```ts
export interface SourceAdapter {
  type: string;
  label: string;
  writeMode: 'accumulate' | 'replace';
  fetch(ctx: FetchContext): Promise<FetchOutcome>;
}
```

`FetchOutcome` 有三种状态。`ok` 带回条目，`pending` 表示内容还没发布，`notPublished` 表示当天没有。

能力声明放在 `SourceRuntime.capabilities`，包含 `backfill`、`translation`、`locales`、`minScheduleAt`、`actions`、`manualBatch`、`emptyState`。引擎只读能力，不按 source id 分支。

当前来源：

| 来源 | 节奏 | 补拉 | 翻译 | 备注 |
|---|---|---|---|---|
| GitHub Trending | 每天 | 否 | 是 | HTML 解析 |
| BestBlogs 每日早报 | 每天 | 是 | 否 | zh 和 en 是两套编选 |
| X 书签 | 手动 | 否 | 否 | 通过 Ego Browser |
| RSS | 每天 | 否 | 是 | 汇总源，按渠道切片 |

新增来源等于 `src/sources/<id>/` 加 registry 一行，不在引擎里加分支。

## 抓取与调度

调度器 60 秒一拍，只在 DSH 运行时工作。

自动尝试每天最多 3 次，两次间隔至少 10 分钟。手动拉取不占预算。

`pending` 不算失败，30 分钟后重试，每天最多 3 次。

历史补拉不写 source health，范围限制在保留窗口内。

抓取成功后按 `writeMode` 合并。`replace` 整文件替换，`accumulate` 按 `naturalKey` 累积。

保留窗口默认 30 天，抓取时清理更早的分区。

## 翻译

翻译按渠道能力开关。每批最多 20 条，整次预算 60 秒。

先查哈希索引，简介没变就复用译文，中文简介跳过。

模型可以显式选择，也可以跟随 DSH 默认。翻译失败不回滚抓取，分区头给重试入口。

## Ego Browser 桥

`src/sources/x-bookmarks/bridge.ts` 启动 `ego-browser nodejs`，把内置脚本交给浏览器执行，在页面上下文里取数据。脚本只通过带 `@@FEEDULTRA@@` 前缀的 stdout 行回传结果。

路径解析顺序是渠道配置 `egoBrowserPath`、`EGO_BROWSER_PATH`、PATH、`~/.local/bin/ego-browser`。

抓取成本来自用户已经登录的浏览器会话。插件不调付费 API，也不需要自建抓取服务。代价是需要本机安装 Ego Browser 并登录目标站点，页面结构变化会让脚本 drift，单次拉取约 10 秒。

## 浏览器半体

`apply` 注册 locale 命名空间 `feedUltra`，注入作用域样式，注册 `sidebar.panellist`（id `feedUltra`，order 16）和 `main`（key `feedUltra`）。

面板通过 RPC facade 读数据，通过宿主 Settings 服务写配置叶子，插件不重载。

面板状态只存在于页面内。离开再回来时恢复上次的渠道、日期、筛选和滚动位置。

## 硬约束

- 包名 `@westwall/dsh-feed-ultra`、插件 id `dsh-feed-ultra`、目录 `packages/feed-ultra` 三处一致。id 被安装过就不能改，用户配置按 id 存。
- 客户端 bundle 的 `__ModuleLoader__.load` id 必须是带 scope 的包名 `@westwall/dsh-feed-ultra`。`CLIENT_CONTRIBUTION.package` 和 RPC 前缀是不带 scope 的 `dsh-feed-ultra`。
- 数据目录固定 `.dsh-feeds`，不做旧目录探测或迁移。
- 包是 TS 直载，`exports` 指向 `src/index.ts`，只用可擦除语法。浏览器半体由 esbuild 打包并入库。
- 不引入后台常驻进程。DSH 关闭期间不抓取，也不补历史天。
