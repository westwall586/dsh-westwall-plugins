# 资讯工作台 使用手册

> **状态：草稿。** 未发布。推荐用本地目录安装，或从 GitHub 固定提交安装。

RSS 只是起点。榜单、每日早报、X 书签和任意订阅源都可以收进 DSH 桌面端的一个工作区，按天阅读，已读状态跨天继承，简介可按渠道用 AI 翻译。

抓取走本机 Ego Browser 的登录态和固定脚本，不需要付费 API。数据是工作区里的普通 JSON，Agent 也能直接读。

## 快速开始

1. 安装插件，任选一种。

```sh
dsh plugin --profile <profile> add link:/绝对路径/packages/feed-ultra
```

```sh
dsh plugin --profile <profile> add \
  "git+https://github.com/westwall586/dsh-westwall-plugins.git#<commit>&path:/packages/feed-ultra"
```

2. 重启 DSH。
3. 打开左侧栏 **插件** →「资讯工作台」→「我的设置」，选择一个工作区。
4. 打开侧栏「资讯工作台」，点「拉取」。

预期：工作区里出现 `.dsh-feeds/`，面板出现当天内容与渠道列表。

## 配置

| 项 | 说明 |
|---|---|
| 工作区 | 数据全部落在 `<工作区>/.dsh-feeds/`。换工作区就换一套订阅与已读状态 |
| 保留天数 | 默认 30。改小后，更早的分区在下一次抓取时清理，已读状态一起删除 |
| 渠道定时 | 每个渠道单独开关与时间，按本地时间；只有 DSH 在运行时才会自动拉取 |
| 渠道翻译 | 按渠道能力决定是否出现；中文简介跳过，译文按简介哈希跨天复用 |
| 模型 | 翻译使用的模型。「跟随 DSH 默认」沿用宿主当前选择，也可显式指定 |
| Ego Browser 路径 | X 书签渠道使用。留空时依次找渠道配置、`EGO_BROWSER_PATH`、PATH、`~/.local/bin/ego-browser` |

## 日常使用

### 按天阅读

1. 打开侧栏「资讯工作台」，默认是今天。
2. 点日历里的日期看历史；点「今天」回到当天。
3. 切「未读」只看没读的，或用「选择」批量标记已读。
4. 点条目标题在右栏阅读原文；点行尾图标在系统浏览器打开。

点标题会把绑定的工作区注册为 DSH 工作区，打开它的空白会话，再在右栏打开阅读页。Web 版没有 Browser 标签页时直接开新标签页。离开再回来时，面板恢复上次的渠道、日期、筛选和滚动位置。

### 渠道

| 渠道 | 自动拉取 | AI 翻译 |
|---|---|---|
| GitHub Trending | 每天一次 | 是 |
| BestBlogs 每日早报 | 每天一次 | 否 |
| X 书签 | 手动「拉取 N 条」 | 否 |
| RSS 订阅 | 每天一次 | 是，只翻摘要 |

BestBlogs 支持在保留窗口内补拉历史期，中英文是两套各自编选的版本，不是译文。早报约 07:00 发布，早于这个时间算未发布，客户端会拦。

### RSS 订阅

- 收集箱只存不抓：粘一个 RSS / Atom 地址先放着，点「预览」看内容，再决定收进哪个渠道。
- 收进渠道后按渠道定时抓取；换渠道不影响已读与历史。
- 支持导入 OPML。上限：收集箱 5000 个源，渠道内共 200 个，渠道 20 个。
- 订阅库跟着工作区走：换工作区就换一套订阅。

### X 书签

- 走 Ego Browser：插件启动它执行内置脚本，在页面上下文里调用书签接口。
- 需要 Ego Browser 里已经登录 x.com；一次拉取约 10 秒。
- 删除是在推文详情页点「移除书签」，删除后本地卡片标记「已从 X 删除」。

## 数据布局

```text
<workspace>/.dsh-feeds/
  data/items/<day>/<sourceId>.json   一天一个来源的快照，整文件替换
  data/state/<day>.json              已读状态，按写入日分区，跨天合并
  data/cache/<day>.json              模型产物，按条目 id 存译文
  data/rss-library.json              渠道与订阅源
  health/<sourceId>.json             最近尝试、连续失败与当日计数
```

文件都是普通 JSON，Agent 可以直接读。

## 故障排查

| 现象 | 先查 |
|---|---|
| 面板提示「先绑定一个工作区」 | 到「我的设置」选一个可写目录 |
| 提示「工作区不可用」 | 目录被移动或没有写权限，重新选一次 |
| 定时没有触发 | DSH 关闭期间不会拉取；到点后打开面板会补抓当天 |
| 翻译失败 | 检查模型与网络；分区头有「重试」 |
| X 书签拉取失败 | Ego Browser 是否已登录 x.com；路径配置是否正确 |

## 卸载与清理

1. 在插件页移除，或执行 `dsh plugin --profile <profile> remove @westwall/dsh-feed-ultra`。
2. 工作区里的 `.dsh-feeds/` 会保留。确认不再需要后可以手动删除。
3. 没有需要撤销的凭据；X 书签用的是 Ego Browser 自己的登录态。

## 相关链接

- 作者主页 [github.com/westwall586](https://github.com/westwall586)
- 插件仓库 [dsh-westwall-plugins](https://github.com/westwall586/dsh-westwall-plugins)

### 更多插件

更多插件见 [dsh-westwall-plugins](https://github.com/westwall586/dsh-westwall-plugins)。列出全部插件与安装方式。

```sh
dsh plugin --profile <profile> add \
  "git+https://github.com/westwall586/dsh-westwall-plugins.git#<commit>&path:/packages/feed-ultra"
```

### 维护者文档

- 架构与数据契约：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 设计取舍：[docs/DECISIONS.md](docs/DECISIONS.md)

本包是 TS 直载包：`exports` 指向 `src/index.ts`，没有 `lib/`，只使用可擦除的 TS 语法。浏览器半体由 esbuild 打成 `client.js` 并入库。

```sh
pnpm -C packages/feed-ultra build
pnpm -C packages/feed-ultra typecheck
pnpm -C packages/feed-ultra test
```

### 许可

[Apache-2.0](../../LICENSE)
