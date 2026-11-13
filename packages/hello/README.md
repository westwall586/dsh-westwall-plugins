# Hello

示例插件：用来验证「构建 → 打包 → 安装 → 挂载」整条链路。它没有界面，只在宿主启动时
输出一行日志。正式插件以它为模板（见 [开发指南](../../docs/DEVELOPMENT.md)）。

## 安装

从 npm：

```sh
dsh plugin --profile <profile> add @westwall/dsh-hello
```

从 GitHub 固定提交：

```sh
dsh plugin --profile <profile> add \
  "git+https://github.com/westwall586/dsh-westwall-plugins.git#<commit>&path:/packages/hello"
```

本地开发：

```sh
dsh plugin --profile <profile> add link:/绝对路径/packages/hello
```

## 卸载

```sh
dsh plugin --profile <profile> remove @westwall/dsh-hello
```
