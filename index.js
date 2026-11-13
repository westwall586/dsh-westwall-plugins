/**
 * 根包插件体（全家桶聚合 bundle 的载体）：没有宿主逻辑。
 * 安装根包 = 挂载根 cordis.patch.yml 里的全部插件行（由 pnpm aggregate 生成）。
 */
export const name = 'dsh-plugins'
export const inject = []
export function apply() {}
