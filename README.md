# DSH 插件库

为 [DeepSeek Harness](https://www.deepseek.com/harness/)（DSH）提供的插件集合。
每个插件独立安装、独立升级；也可以一次装齐全部。

## 安装插件

按你的场景选一种方式。桌面版对应左侧栏 → **插件** → **Add plugin**，Web 版对应 `dsh plugin --profile <profile> add <spec>`。

### 从 npm 安装

适用于已经发布的插件：

```sh
dsh plugin --profile <profile> add @westwall/dsh-<插件名>
```

### 从 GitHub 安装

适用于尚未发布、或想固定某个提交的插件：

```sh
dsh plugin --profile <profile> add \
  "git+https://github.com/westwall586/dsh-westwall-plugins.git#<commit>&path:/packages/<插件目录>"
```

- `<commit>` 是 40 位提交 SHA，`<插件目录>` 是包所在的目录名。
- 固定提交意味着内容可复现；升级时换成新的 SHA 重新安装。
- 仓库是公开的，安装不需要登录 GitHub。

### 从本地目录安装

适用于开发调试：

```sh
dsh plugin --profile <profile> add link:/绝对路径/packages/<插件目录>
```

本地目录是符号链接，改动代码后重启宿主即可生效，不需要重新安装（除非改了依赖）。

### 一次性安装全部

仓库根目录本身是一个聚合 bundle，但它的依赖按 npm 版本解析：

```sh
dsh plugin --profile <profile> add \
  "git+https://github.com/westwall586/dsh-westwall-plugins.git#<commit>"
```

> 只有在**聚合里列出的插件都已发布**时才能这样装。当前仓库里的插件多为草稿（未发布），
> 请用上面的「从 GitHub 安装」逐个装子目录。

## 插件

| 插件 | 简介 | 状态 |
|---|---|---|
| [可交互 Markdown](packages/active-markdown/README.md) | 接管右侧栏的 Markdown 预览正文，按块渲染标题、列表、表格、代码与图片，路径与刷新仍用原生 | **草稿** · 推荐本地安装 |
| [Jira 工时记录](packages/jira-worklogs/README.md) | 月历查看工时缺口、日详情与 Git 素材，就地起草、确认后写入 Jira | **草稿** · 推荐本地安装 |
| [资讯工作台](packages/feed-ultra/README.md) | RSS、GitHub 榜单、每日早报与 X 书签收进一个工作区，按天阅读并做 AI 翻译 | **草稿** · 推荐本地安装 |
| [网页剪藏](packages/web-clipper/README.md) | 把侧栏浏览器当前页作为 Markdown 附件加进会话，并在可配置目录保存可读副本（桌面版） | **草稿** · 推荐本地安装 |
| [友好表达](packages/friendly-expression/README.md) | 用可编辑的提示词约束 Agent 的回复风格，并把 Mermaid 代码块渲染成可缩放的图 | **草稿** · 推荐本地安装 |

## 兼容性

- 每个插件在 `peerDependencies` 与 `dsh.engines.dsh` 中声明自己需要的 DSH 版本。
- 宿主在安装前与启动时都会校验版本，不满足会拒绝安装或加载。

## 卸载

```sh
dsh plugin --profile <profile> remove <包名>
```

桌面版与 Web 版也可以在 **插件** 页里直接移除。

## 文档

- [开发指南](docs/DEVELOPMENT.md)：目录结构、构建、测试、新增插件
- [插件文案与图标规范](docs/PLUGIN-GUIDE.md)：标题、描述、README 与图标写法
- [设计决定](docs/decisions.md)：命名、产物、分发与兼容性约定

## 许可证

[Apache-2.0](LICENSE)
