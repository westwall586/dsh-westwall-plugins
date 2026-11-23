# 本地验证环境搭建记录（2026-11-23）

工作树里让插件能编译、能跑宿主侧探针所需的全部非源码步骤。**目标是在不把任何本机路径、链接形态写进仓库的前提下，让下一台机器能复现同一套验证。**

## 为什么需要这套东西

`packages/codegraph` 依赖 `@deepseek-ai/*`（宿主包）。DSH 的插件在用户机器上由宿主提供这些包，但本仓库的 `pnpm install` 不会从 registry 拉它们（`autoInstallPeers: false`）。所以在开发机上验证插件，必须让这些包可解析，有两条路：

1. 从 npm 装同名版本，但插件侧类型会和宿主侧合并成两份，`Context` 声明不同，`ctx.plugin(McpClient, …)` 直接类型不兼容；
2. 从 `deepseek-harness` submodule 的源码构建出一份，两边共用同一个实例。

本仓库用第 2 条。下面是完整步骤，命令都在工作树根目录执行。

## 步骤

### 1. submodule 里构建宿主包

```sh
cd deepseek-harness
pnpm install --ignore-scripts --filter '@deepseek-ai/dsh-*'
```

- `--filter` 只装 harness 自己的 workspace 包；不加会把 `apps/`、`website/` 也拉进来，`website` 缺 vite 依赖会报一堆无关错误。
- 耗时与网络：约 4 分钟、下载约 680 个包。

### 2. 编译出运行时代码

```sh
# 把源码闭包（vendor + packages/*/*/src + native/system/packages/*/src）打成 lib/
node_modules/.bin/tsdown --config tsdown.cg.config.ts
# vendor 的 cordis / schemastery / cosmokit 也要有自己的 lib/，否则会被解析成 registry 版本
node_modules/.bin/tsdown --config tsdown.vendor.config.ts
mkdir -p node_modules/@deepseek-ai
ln -sfn ../../vendor/cosmokit node_modules/@deepseek-ai/cosmokit
ln -sfn ../../vendor/cordis node_modules/@deepseek-ai/cordis
ln -sfn ../../vendor/schemastery node_modules/@deepseek-ai/schemastery
```

`tsdown.cg.config.ts` 必须带 `decoratorPlugin()`（`packages/typert/generator/lib/types/tsdown-plugin.js`），否则 `@Remote` 装饰器会原样留在产物里，Node 直接语法错误。

### 3. 生成类型声明

harness 的宿主编译单元（`tsconfig.host.json`）在缺了 client 面源码时会连带编译失败，所以用一份独立的 emit 配置：

```sh
node --max-old-space-size=8192 node_modules/typescript/bin/tsc -p tsconfig.cg.json
```

- `tsconfig.cg.json` 的 `compilerOptions` 要关掉 `exactOptionalPropertyTypes`，否则 `session-format` 系列会报与关闭项无关的类型错误。
- 排除项：`packages/client/**`、`packages/api/**`（这两棵树是 client 面，混进 host 编译单元会类型冲突）、`**/tests/**`。
- 产出的 `.d.ts` 默认落在 `src/` 旁边；插件按 `package.json#exports.types` 去 `lib/types/**` 找，所以要拷一次：

```sh
# 把每个包 src 下的 .d.ts 拷到 lib/types/，并把相对 import 的 .ts 改成 .js
node dtsfix.mjs   # 见仓库外的本地 notes；逻辑是 copy + 正则替换
```

### 4. 让插件解析到这份 harness

`packages/codegraph/node_modules/@deepseek-ai/*` 全部指向工作树内 harness 的同一份实例；不能混用 registry 版本，否则 `cordis` 出现两份，类型互不兼容：

```sh
node /tmp/relink.mjs "$PWD/packages/codegraph" "$PWD/deepseek-harness"
```

`pnpm install` 之后这些链接会被覆盖回 `link:` 目标，需要重跑一次。

### 5. 跑验证

```sh
cd packages/codegraph && pnpm typecheck && pnpm test
```

## 已知限制

- 这套流程只在本机能跑。插件包的 devDependencies 已改为正常的版本区间（`^0.2.2-rc.5`），仓库里不保留任何 `link:` 指向本地 submodule 的写法；本机为了让 `tsc` 解析到同一份实例，才临时用符号链接，见上面第 4 步。
- 宿主 `agent` 包在运行时仍缺一个深层 `.d.ts`（`dsh-llm/lib/types/brand.d.ts`），所以 harness 内部的 `agent-loop-testkit` 目前只能做类型检查，不能端到端跑。这不影响插件：插件的宿主侧验证全部用替身注入完成。
- 这台机器上 `@deepseek-ai/*` 无法从 registry 安装（本机 pnpm 的执行环境限制），所以上述步骤是当前唯一可行的路径。

## 这次验证用到的命令都是临时的

临时脚本（`relink.mjs`、`dtsfix.mjs`、`tsdown.cg.config.ts`、`tsconfig.cg.json`）在 `deepseek-harness/` 下，那个目录是 submodule，不随本仓库提交。复现时按上面的步骤重写即可。
