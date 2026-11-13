# packages/

每个子目录 = 一个独立插件包（= 一个 DSH bundle）。

新增：`pnpm create-plugin <name> [id]`，然后 `pnpm install && pnpm -r build && pnpm aggregate`。
聚合清单（根 `cordis.patch.yml` 与根 `dependencies`）由脚本生成，**不要手改**。
