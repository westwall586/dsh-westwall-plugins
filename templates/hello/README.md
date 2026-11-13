# <标题> 使用手册

> **状态：草稿。** 发布前保留这一行。发布后改成正式状态与安装方式。

<问题、亮点与承诺。先写用户面对的问题，再写插件带来的结果和一个可验证的亮点。>

## 快速开始

1. 安装 `@westwall/dsh-hello`。
2. 重启 DSH。
3. 在「插件」页完成配置。
4. 打开侧栏「<入口标签>」，预期看到 <首屏>。

```sh
dsh plugin --profile <profile> add link:/绝对路径/packages/hello
```

## 配置

| 项 | 说明 |
|---|---|
| <配置项> | <含义、默认值与前置条件> |

## 日常使用

### <主流程>

<用真实 UI 标签写步骤与预期结果。>

## 故障排查

| 现象 | 先查 |
|---|---|
| <现象> | <原因与动作> |

## 卸载与清理

<移除方式、可选的数据清理、需要撤销的凭据。>

## 相关链接

- 作者主页 [github.com/westwall586](https://github.com/westwall586)
- 插件仓库 [dsh-westwall-plugins](https://github.com/westwall586/dsh-westwall-plugins)

### 更多插件

更多插件见 [dsh-westwall-plugins](https://github.com/westwall586/dsh-westwall-plugins)。固定提交安装。

```sh
dsh plugin --profile <profile> add \
  "git+https://github.com/westwall586/dsh-westwall-plugins.git#<commit>&path:/packages/hello"
```

### 维护者文档

- <架构说明，例如 docs/ARCHITECTURE.md>
- <本地调试与命令，例如 docs/TOOLS.md>

### 许可

<许可证，例如 Apache-2.0，指向仓库 LICENSE。>

模板说明。复制后替换标题、承诺、各节内容、链接与图标，并删除本行。完整规则见 [插件文案与图标规范](../../docs/PLUGIN-GUIDE.md)。
