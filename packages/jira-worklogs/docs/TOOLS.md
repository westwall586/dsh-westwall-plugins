# 本地调试与命令

## 前置

- Node.js ≥ 22.19（测试用 Node 原生类型剥离直接跑 `src`；运行时加载入库的 `lib/`）
- pnpm ≥ 10
- DSH：满足本包 `peerDependencies` / `dsh.engines.dsh` 的版本

## 装进验证用 profile

```sh
# 构建运行时产物；改完 src/ 后重跑，安装与重启才读到新代码
cd packages/jira-worklogs && pnpm build

# 装（用 link，加载入库的 lib/）
dsh plugin --profile web add link:/绝对路径/packages/jira-worklogs

# 启动；确认没有「did not activate」等告警
dsh --profile web --port 18787 --no-open

# 试完后摘除
dsh plugin --profile web remove <包名>   # 包名见 package.json
```

仓库根还提供了自动化的「装 → 启 → 检查 → 摘除还原」（先 `pnpm build`）：

```sh
node scripts/smoke-install.mjs link:$(pwd)/packages/jira-worklogs
```

## 测试与类型

```sh
cd packages/jira-worklogs
pnpm build       # 构建运行时产物 → lib/（入库）
pnpm test        # node --test 'tests/**/*.test.{ts,mjs}'（测试直接跑 src 的 .ts）
pnpm typecheck   # tsc --noEmit
```

## 环境变量

| 变量 | 作用 |
|---|---|
| `JIRA_SERVER` / `JIRA_USERNAME` / `JIRA_PASSWORD` | 覆盖插件配置里的连接信息（优先级最高） |
| `JIRA_VERIFY_SSL` | `true` 时校验 SSL；默认跳过（自签证书环境） |
| `JWL_DEBUG_PARSE_FAIL=1` | 让生成走「输出无法解析」失败路径 |
| `JWL_DEBUG_STORE_FAIL=open` / `=io` | 存储域开域失败 / 读写抛错的故障注入 |

## 故障对照

| 现象 | 先查 |
|---|---|
| 宿主报 `failed to import` | peer 声明是否齐全、区间是否覆盖宿主版本 |
| 打开面板就提示缺少配置 | 插件页「Jira 工时记录」详情页里是否保存了 Jira 连接 |
| 查询报「凭据无效」 | 该 Jira 网关对无效凭据可能返回 200 空体；空 `myself` 视为异常 |
| 提交后没有写入 | 查重命中，或当日总工时低于下限；日期已填满只会隐藏生成入口，不阻止提交 |

## 数据位置

- 暂存回显：`~/.dsh/storages/dsh_jira_worklogs/`
- 配置：当前 profile 的插件入口配置（`cordis.patch.yml` 的用户层）

## 安全

- 凭据只由 Host 读取，不进入模型输入、结果明文或客户端回传
- 写入只在面板「提交」按钮后发生，且同日互斥
