import type { Context } from '@deepseek-ai/cordis';
import type { GlobalInstall } from './deps.ts';
/** 会被检查的 patch 文件：home 级一份，每个 profile 一份。 */
export declare function patchCandidates(home?: string): string[];
/**
 * 找第一个含 CodeGraph 服务行的 patch。
 * @param ctx - 未使用；保留参数形状让单测能替换环境。
 * @returns 命中的文件，或 undefined。
 */
export declare function detectGlobalInstall(_ctx: Context): Promise<GlobalInstall | undefined>;
