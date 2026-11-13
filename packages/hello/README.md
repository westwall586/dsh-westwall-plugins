# @westwall/dsh-hello

最小插件模板，`pnpm create-plugin <name>` 以它为蓝本。

- `cordis.patch.yml`：把 `hello` 这一行插进 profile 阵容
- `src/index.ts`：宿主半体，导出 `name` / `inject` / `apply`
- `locale/*.json`：插件页显示用的标题与描述
- `icon.svg`：插件页图标

本地调试：

```sh
pnpm --filter @westwall/dsh-hello build
dsh plugin --profile web add link:$(pwd)/packages/hello
dsh web
```
