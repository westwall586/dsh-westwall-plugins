/**
 * @westwall/dsh-friendly-expression — 友好表达（设计阶段）。
 *
 * 本包当前只占位：不注册提示词、不渲染 Mermaid，也不改变宿主行为。
 * 设计见 docs/DESIGN.md，实现顺序见 docs/ROADMAP.md。
 */
import type { Context } from '@deepseek-ai/cordis'

/** Cordis 插件 id；由 cordis.patch.yml 的 insert 行引用。 */
export const name = 'friendly-expression'

/** 当前不需要宿主服务；v0.1 起会声明 systemPrompt。 */
export const inject: string[] = []

/** 设计阶段占位：v0.1 在此注册表达提示词，客户端半体再接入 Mermaid 渲染。 */
export function apply(_ctx: Context): void {}