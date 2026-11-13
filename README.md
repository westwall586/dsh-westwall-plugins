# DSH 插件库

为 [DeepSeek Harness](https://www.deepseek.com/harness/)（DSH）提供的插件集合。
每个插件独立安装、独立升级；也可以一次装齐全部。

## 安装插件

按你的场景选一种方式。桌面版对应左侧栏 → **插件** → **Add plugin**，Web 版对应 `dsh plugin --profile <profile> add <spec>`。

### 从 npm 安装

适用于已经发布的插件：

```sh
dsh plugin --profile <profile> add @westwall/dsh-hello
```

### 从 GitHub 安装

适用于尚未发布、或想固定某个提交的插件：

```sh
dsh plugin --profile <profile> add \
  "git+https://github.com/westwall586/dsh-westwall-plugins.git#<commit>&path:/packages/<插件目录>"
```

- `<commit>` 是 40 位提交 SHA，`<插件目录>` 是包所在的目录名（如 `hello`）。
- 固定提交意味着内容可复现；升级时换成新的 SHA 重新安装。
- 仓库是公开的，安装不需要登录 GitHub。

### 从本地目录安装

适用于开发调试：

```sh
dsh plugin --profile <profile> add link:/绝对路径/packages/<插件目录>
```

本地目录是符号链接，改动代码后重启宿主即可生效，不需要重新安装（除非改了依赖）。

### 一次性安装全部

仓库根目录本身是一个聚合 bundle：

```sh
dsh plugin --profile <profile> add \
  "git+https://github.com/westwall586/dsh-westwall-plugins.git#<commit>"
```

> 前提：聚合里列出的插件都已发布到 npm。根 bundle 的依赖按 npm 版本解析；
> 有未发布的插件时，请用上面的「从 GitHub 安装」逐个装子目录。

## 插件

| 插件 | 说明 | 安装 |
|---|---|---|
| Hello（`@westwall/dsh-hello`） | 示例插件：只验证安装与挂载链路，没有界面 | `@westwall/dsh-hello` |

## 兼容性

- 需要 DSH **0.2.2-rc.2** 或更新版本；每个插件在 `dsh.engines.dsh` 与
  `peerDependencies` 中声明自己的兼容范围。
- 宿主在安装前与启动时都会校验版本，不满足会拒绝安装或加载。

## 卸载

```sh
dsh plugin --profile <profile> remove @westwall/dsh-hello
```

桌面版与 Web 版也可以在 **插件** 页里直接移除。

## 文档

- [开发指南](docs/DEVELOPMENT.md)：目录结构、构建、测试、新增插件
- [设计决定](docs/decisions.md)：命名、产物、分发与兼容性约定

## 许可证

[Apache-2.0](LICENSE)
