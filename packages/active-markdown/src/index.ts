/**
 * @westwall/dsh-active-markdown — 宿主半体。
 *
 * P0 的接管全部在浏览器半体：注册一个文档预览渲染器与它的正文。
 * 这里刻意保持空 `apply`，只保证 bundle 行存在；翻译、批注的存储与
 * 模型调用要到 P1/P2 才需要宿主服务。
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'active-markdown'

/** 宿主半体不读取任何服务。 */
export const inject: string[] = []

export function apply(_ctx: Context): void {}
