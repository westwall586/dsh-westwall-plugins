# Jira 工时记录（草稿）

> **状态：草稿。** 接口与配置仍可能变；未发布 npm，**推荐从本地目录安装**。

把 Jira 工时搬进 DSH：在侧栏「Jira 日志」面板里查看工时缺口、当天 Git 提交，就地起草说明，
确认后写入 Jira。

## 功能简述

- **月历**：按月查看工作日与工时缺口
- **日详情**：当日已登记工时 + 当日 Git 提交摘要
- **就地生成**：面板内调用宿主默认模型起草说明，不新开会话
- **安全写入**：显式确认后才提交；同任务查重 → 写入 → 回读，结果不确定不自动重写
- **查同事工时**（只读）：按登录 ID 查询他人某段时间的工时记录

## 安装

推荐**本地目录安装**（草稿期改动频繁，改代码后重启即可生效）：

```sh
dsh plugin --profile <profile> add link:/绝对路径/packages/jira-worklogs
```

也可以固定某个提交，从 GitHub 安装：

```sh
dsh plugin --profile <profile> add \
  "git+https://github.com/westwall586/dsh-westwall-plugins.git#<commit>&path:/packages/jira-worklogs"
```

尚未发布 npm，也没有市场条目。卸载可以在插件页移除，或用：

```sh
dsh plugin --profile <profile> remove <包名>
```

包名见 `package.json` 的 `name` 字段。

## 配置

安装后在插件页的「Jira 日志」详情页填写：

| 项 | 说明 |
|---|---|
| Jira | 服务器地址、用户名、密码（或 API token）、是否校验 SSL |
| Git 实例 | 名称 → API 地址 + token，可配置多个；URL 与 token 成对才生效 |
| 仓库过滤 | 只统计匹配的仓库 |

调试期也可用环境变量覆盖：`JIRA_SERVER` / `JIRA_USERNAME` / `JIRA_PASSWORD` /
`JIRA_VERIFY_SSL`（优先级最高）。

暂存数据落在 `~/.dsh/storages/dsh_jira_worklogs/`。

## 开发

```sh
cd packages/jira-worklogs
pnpm test        # 离线测试（node --test）
pnpm typecheck   # tsc --noEmit
```

运行时平台包由 DSH 提供，声明在 `peerDependencies`；本地开发所需副本在 `devDependencies`。

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：双面结构与关键路径
- [docs/TOOLS.md](docs/TOOLS.md)：本地调试、命令与故障对照

## 许可

Apache-2.0
