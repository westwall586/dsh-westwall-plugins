/**
 * 自动缓存：一次成功翻译的整篇译文按内容身份存进插件存储，读者看不到它。
 * 键含源 hash、语言、实际用到的 provider/model、提示词版本、代码注释策略与
 * 补充要求 hash；任何一项不同都是一次新翻译，绝不拿旧结果冒充。缓存在一次会话结束后仍可
 * 复用，删掉它最多是重翻一次，所以落盘失败只警告、不打断翻译。
 */
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { cacheKeyOf, extraInstructionHash, normalizeSource, sha256Hex } from "./digest.js";
import { errorText, requireLanguage, requireText } from "./boundary.js";
import { resolveModel } from "./request.js";
/** 单条缓存记录的上限；更大的译文不缓存，避免插件存储无界增长。 */
export const CACHE_VALUE_MAX_BYTES = 64 * 1024;
const cachedMetaSchema = z.object({
    sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
    sourceLines: z.number().int().nonnegative(),
    translatedLines: z.number().int().nonnegative(),
    lang: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    promptVersion: z.string(),
    extraInstructionHash: z.string(),
    aligned: z.boolean(),
    cachedAt: z.string(),
}).strict();
const cachedTranslationSchema = z.object({
    text: z.string(),
    meta: cachedMetaSchema,
}).strict();
export const translationCacheDomain = defineDomain({
    name: 'active_markdown',
    version: 1,
    layout: 'per-record',
    invalidRecords: 'backup-and-skip',
    tables: {
        translations: domainTable(cachedTranslationSchema),
    },
});
/** 进程内回落；没有插件存储时，本次运行内仍可命中。 */
export function createMemoryCacheStore() {
    const records = new Map();
    return {
        get: (key) => records.get(key),
        async put(key, value) {
            records.set(key, value);
        },
    };
}
/**
 * 打开插件存储里的缓存 domain。`storageDomain` 不在（或 domain 打不开）时退回
 * 内存，翻译本身不受影响；domain 的生命周期由 facility 在插件卸载时收尾。
 */
export async function openCacheStore(facility) {
    if (facility === null)
        return createMemoryCacheStore();
    try {
        const domain = await facility.open(translationCacheDomain);
        const table = domain.table('translations');
        return {
            get: (key) => table.get(key),
            put: (key, value) => table.put(key, value),
        };
    }
    catch (error) {
        console.warn('[dsh-active-markdown] 翻译缓存 domain 打不开，本次运行改用内存缓存', error);
        return createMemoryCacheStore();
    }
}
function textField(value) {
    return typeof value === 'string' ? value : '';
}
function integer(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function encodedBytes(value) {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
function parseInput(input) {
    const provider = textField(input.provider).trim();
    const model = textField(input.model).trim();
    const extraInstruction = textField(input.extraInstruction).trim();
    return {
        text: requireText(input.text, '原文'),
        lang: requireLanguage(input.lang),
        ...(provider === '' ? {} : { provider }),
        ...(model === '' ? {} : { model }),
        promptVersion: textField(input.promptVersion),
        translateComments: input.translateComments === true,
        ...(extraInstruction === '' ? {} : { extraInstruction }),
    };
}
function resolveSelection(request, readDefault) {
    return resolveModel({
        ...(request.provider === undefined ? {} : { provider: request.provider }),
        ...(request.model === undefined ? {} : { model: request.model }),
        readDefault,
    });
}
function keyFor(request, selection) {
    return cacheKeyOf({
        sourceText: request.text,
        lang: request.lang,
        provider: selection.provider,
        model: selection.model,
        promptVersion: request.promptVersion,
        translateComments: request.translateComments,
        ...(request.extraInstruction === undefined ? {} : { extraInstruction: request.extraInstruction }),
    });
}
export function createTranslationCache(deps) {
    const now = deps.now ?? (() => new Date());
    return {
        async cacheGet(input) {
            const request = parseInput(input);
            const selection = resolveSelection(request, deps.readDefault);
            const record = deps.store.get(keyFor(request, selection));
            if (record === undefined)
                return null;
            return encodedBytes(record) > CACHE_VALUE_MAX_BYTES ? null : record;
        },
        async cachePut(input) {
            const request = parseInput(input);
            const translated = requireText(input.translated, '译文');
            const selection = resolveSelection(request, deps.readDefault);
            const record = {
                text: translated,
                meta: {
                    sourceHash: sha256Hex(normalizeSource(request.text)),
                    sourceLines: integer(input.sourceLines),
                    translatedLines: integer(input.translatedLines),
                    lang: request.lang,
                    provider: selection.provider,
                    model: selection.model,
                    promptVersion: request.promptVersion,
                    extraInstructionHash: extraInstructionHash(request.extraInstruction),
                    aligned: input.aligned === true,
                    cachedAt: now().toISOString(),
                },
            };
            if (encodedBytes(record) > CACHE_VALUE_MAX_BYTES)
                return {};
            try {
                await deps.store.put(keyFor(request, selection), record);
            }
            catch (error) {
                console.warn('[dsh-active-markdown] 写翻译缓存失败，本次结果仍可用', errorText(error));
            }
            return {};
        },
    };
}
//# sourceMappingURL=cache.js.map