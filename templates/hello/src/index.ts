/**
 * @westwall/dsh-hello — 最小宿主插件（本仓库所有插件的蓝本）。
 *
 * 导出形状只有三种合法形态之一，最简单的是：
 *   export const name / inject / apply
 * 需要配置校验时再加 `export const Config`（schemastery）。
 */
import type { Context } from '@deepseek-ai/cordis'

export interface Config {
  /** 挂载时打印一行日志（默认开）。 */
  announce?: boolean
}

export const name = 'hello'

/** 依赖的宿主服务名；不需要任何服务时就是空数组。 */
export const inject: string[] = []

export function apply(_ctx: Context, config?: Config): void {
  if (config?.announce === false) return
  console.log('[dsh-hello] mounted')
}
