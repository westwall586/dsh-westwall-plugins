# 架构

> 面向维护者。安装与配置见 [README](../README.md)。

## 一句话

双面插件：**Host 半**持有确定性 Jira 引擎与远程方法（月视图、日详情、就地生成、提交、暂存回显/放弃、
素材保存、查同事工时）；**Client 半**是侧栏「Jira 日志」菜单行 + 主栏面板页 + 插件页配置表单。
生成在组件内调用宿主默认模型；提交走纯程序路径（表单 → Host 重组计划 → 引擎写入，查重 / 回读 /
不确定不重写）。

## 目录结构

```
packages/jira-worklogs/
├── cordis.patch.yml        # 单行挂载：host service
├── client/client.js        # Client 半（单文件）：侧栏入口 + 面板页 + 配置表单
├── src/
│   ├── index.ts            # Host 接线：远程方法描述符、存储域与 LLM 注入、提交互斥
│   ├── flows.ts            # 流程编排（依赖注入，可测）
│   ├── generate.ts         # 生成：素材脱敏、SYSTEM_PROMPT、fail-closed 解析
│   ├── draft-store.ts      # 草稿缓存（issue key 不出 Host）
│   ├── service.ts          # 纯映射：视图族、提交重组、回报与暂存
│   ├── settings.ts         # 插件 Config（jira / gitInstances / repoFilter）
│   ├── gates.ts            # DayMutex 同日互斥
│   ├── store/domain.ts     # 平台存储域 dsh_jira_worklogs（outbox / notes）
│   └── engine/             # 确定性引擎：plan / submit / query / validate / jira / gitlab / http / dates
└── tests/                  # 离线测试（node --test，直接跑 .ts）
```

## 关键路径

- **打开面板**：client `overview()` → Host `overviewFlow`（配置缺失时给文字引导）→ 月历渲染
- **点选一天**：`dayDetail(date)` → 当日登记 + 任务名解析 + 当日 Git 摘要
- **生成**：`generate(date)` → 全量素材 → 脱敏 → 宿主默认模型（temperature 0）→ 解析（任一非法整体拒绝）→ 草稿表单
- **提交**：`submit({draftId, entries})` → 同日互斥 → 当日已填现查 → 计划文档 → 引擎写入（查重 / POST / 回读）
- **查同事工时**：`query({name, from?, to?})` → 凭据预检 → 解析用户（精确 → 全等 → 模糊候选）→ 只读采集 →
  空窗口回溯最后活跃自然周

## 外部约束

- 运行于 DSH 宿主；平台包（typert-protocol / dsh-tools / dsh-llm / dsh-settings / dsh-storage-domain /
  schemastery）由宿主提供，插件以 `peerDependencies` 声明
- 设置入口走包级 `plugins.bundle.config`（插件详情页内嵌表单），不用系统设置分区
- Jira 7.2+（`worklogAuthor` / `worklogDate` JQL）与 GitLab REST API；自签证书可按客户端关闭校验
- Host 半是 `.ts` 直载（Node 原生类型剥离），因此只用可擦除的 TS 语法

## 硬约束

- 凭据只在 Host 侧读取，不进入模型输入、结果明文或 Client 回传
- Jira 写入只经 submit 路径且必须显式确认；POST 前五维查重、POST 后回读；`uncertain` 不自动重试
- 生成纪律（禁止均摊、日报口径、不照搬提交标题、同一任务当天合并、无依据标「待用户确认」）在
  `SYSTEM_PROMPT`；确定性执行只在 Host 代码
- 引擎内部沿用参考实现的 snake_case 形态，插件契约在服务边界映射为 camelCase，两套形态不混用
- 模型调用只走平台通道与已注册提供方；一次性输入不持久化

## 非目标

不做多日批量生成、月历翻月、已填满日追加、调休/节假日声明（按周末默认口径）、移动端适配。
