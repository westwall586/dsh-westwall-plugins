# @westwall/dsh-hello

最小插件模板。`pnpm create-plugin <name>` 以它为蓝本生成新的插件包。

- `cordis.patch.yml`：把 `hello` 这一行插进 profile 阵容
- `src/index.ts`：宿主半体，导出 `name` / `inject` / `apply`
- `locale/*.json`：插件页显示用的标题与描述
- `icon.svg`：插件页图标

结构与约定见 [开发指南](../../docs/DEVELOPMENT.md)。

## 安装

```sh
dsh plugin --profile <profile> add @westwall/dsh-hello
```
