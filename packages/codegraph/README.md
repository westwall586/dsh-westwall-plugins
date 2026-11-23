# CodeGraph 代码图 使用手册

> **状态：草稿。** 还没发布到 npm；按下面的本地目录方式安装。

Agent 查代码时常常先 grep、再从一堆文件里拼上下文，既慢又容易拼错。CodeGraph 把仓库索引成一张代码知识图，一次调用就能拿到符号的源码和它周围的调用路径。

这个插件把 CodeGraph 按**工作区**接进 DSH：在某个工作区打开它，该工作区里的会话就多一个 `codegraph_explore` 工具；关掉它就完全消失，不会再出现那种"残留的工具把模型带偏"的情况。开关由你在界面上决定，不写你的 `AGENTS.md`，也不改 CodeGraph 自己生成的 `.codegraph/`。

## 快速开始

前置条件：本机装好 CodeGraph 命令行（`codegraph --version` 能跑），并且它在 `PATH` 或 `~/.local/bin` 里。

1. 安装插件并重启 DSH。
2. 打开「插件」页，找到「CodeGraph 代码图」，确认状态是「运行中」。
3. 回到侧栏，鼠标移到要用的工作区上，点行尾的「⋯」。
4. 选「在此工作区启用 CodeGraph」，等它从「正在建立索引」走到「已开启」。
5. 在该工作区新建会话，模型就能用 `codegraph_explore` 了。

```sh
dsh plugin --profile <profile> add link:/绝对路径/packages/codegraph
```

## 配置

| 项 | 说明 |
|---|---|
| `command` | `codegraph` 可执行文件的绝对路径。省略时依次找 `PATH` 与 `~/.local/bin` |
| `initOnEnable` | 打开工作区时是否自动执行 `codegraph init`。默认 `true` |
| `initTimeoutMs` | `codegraph init` 的超时。默认 10 分钟，后台执行，不阻塞会话 |
| `startupTimeoutMs` | 连接与首次工具同步的上限。默认 8 秒 |
| `closeTimeoutMs` | 断开上限。默认 1.5 秒 |
| `reminder` | 是否在系统提示里加一段 CodeGraph 用法说明。默认 `false`，因为连接本身已经带着说明，再写一遍会重复占 token |
| `warnGlobalInstall` | 发现同名的全局安装时提示。默认 `true` |

## 日常使用

### 打开与关闭

1. 鼠标移到工作区名上，点「⋯」。
2. 「在此工作区启用 CodeGraph」→ 面板或状态会依次显示「正在建立索引 → 正在验证 → 已开启」。
3. 要关掉时选「关闭 CodeGraph」。已经建好的索引留在工作区里，下次开启不会重建。
4. 想知道当前状态，选「CodeGraph：打开面板」，里面列出每个工作区的状态与失败原因。

开启那一刻会做三件事：确保索引存在、连上 CodeGraph、用它查一个真实的符号确认索引确实属于这个仓库。三步都过才算「已开启」。

### 在会话里用它

同一个工作区的会话会自动带上工具，不用逐个开。会话中途 `cd` 到别的目录时，插件会拆掉旧连接并按新目录重新选项目；如果新旧不一致而连接还没换好，这次工具调用会被拒绝并说明原因，而不是让模型拿到另一个仓库的答案。

### 模型能做什么、不能做什么

模型只有一个只读的 `codegraph_status`，能看状态，不能开启或关闭。开关一律由你在界面上动。

## 故障排查

| 现象 | 先查 |
|---|---|
| 面板显示「未找到 codegraph 命令行工具」 | `codegraph --version` 能不能跑；不能就在配置里写 `command` 的绝对路径 |
| 状态是「失败」，原因是「这个工作区没有找到可索引的源码」 | 该目录里确实没有源码文件，换一个工作区 |
| 状态是「失败」，原因是 init 超时 | 仓库太大；调大 `initTimeoutMs`，或先手动跑一次 `codegraph init` |
| 状态卡在「正在验证」 | 连接失败或索引答不出预期的符号；再点一次「重试」 |
| 面板提示「存储不可用」 | 宿主存储域没起来，这一次运行的开关不会保留 |

## 卸载与清理

```sh
dsh plugin --profile <profile> remove @westwall/dsh-codegraph
```

插件只在自己的存储域里记开关，卸载后这份记录随之失效。工作区里的 `.codegraph/` 是 CodeGraph 自己的索引，插件从不改写它；不需要时按 CodeGraph 的说明删除。

## 相关链接

- 作者主页 [github.com/westwall586](https://github.com/westwall586)
- 插件仓库 [dsh-westwall-plugins](https://github.com/westwall586/dsh-westwall-plugins)

### 更多插件

更多插件见 [dsh-westwall-plugins](https://github.com/westwall586/dsh-westwall-plugins)。固定提交安装。

```sh
dsh plugin --profile <profile> add \
  "git+https://github.com/westwall586/dsh-westwall-plugins.git#<commit>&path:/packages/codegraph"
```

### 维护者文档

- [docs/CLIENT-NOTES.md](docs/CLIENT-NOTES.md)：浏览器半体的槽位与网关信封约束
- [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)：验收记录与已知限制
- [docs/LOCAL-VERIFICATION.md](docs/LOCAL-VERIFICATION.md)：本地把宿主依赖跑起来的方法

### 许可

Apache-2.0，见仓库根 [LICENSE](../../LICENSE)。
