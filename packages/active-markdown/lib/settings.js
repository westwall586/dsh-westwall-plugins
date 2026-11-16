/**
 * 插件设置：翻译模型、目标语言代码、代码注释策略。三项都是 volatile，插件页
 * 写入后不必重启服务；`configSnapshot` 每次调用都重新读，所以下一次翻译立即
 * 使用新值。模型为 null 表示跟随会话默认模型。
 */
import z from '@deepseek-ai/schemastery';
import { DEFAULT_LANGUAGE, isLanguageCode } from "./translate/language.js";
// The inferred builder type names a cosmokit helper, which the package does not
// depend on directly. `unknown` keeps the emitted declaration portable; the
// loader uses the runtime schema, and `configSnapshot` is the typed read.
export const Config = z.object({
    model: z.union([
        z.object({
            provider: z.string().required(),
            model: z.string().required(),
        }),
        z.const(null),
    ]).default(null).volatile(),
    lang: z.union([z.const('zh'), z.const('zh-Hant'), z.const('en')]).default(DEFAULT_LANGUAGE).volatile(),
    translateComments: z.boolean().default(true).volatile(),
});
function deref(value) {
    if (typeof value === 'object' && value !== null) {
        const candidate = value;
        if (typeof candidate.get === 'function')
            return candidate.get();
    }
    return value;
}
function recordOf(value) {
    const node = deref(value);
    if (typeof node !== 'object' || node === null || Array.isArray(node))
        return null;
    return node;
}
function modelOf(value) {
    const node = recordOf(value);
    if (node === null)
        return null;
    const provider = deref(node.provider);
    const model = deref(node.model);
    if (typeof provider !== 'string' || provider === '')
        return null;
    if (typeof model !== 'string' || model === '')
        return null;
    return { provider, model };
}
/** 解析后的设置；缺失或损坏的字段回落到产品默认值。 */
export function configSnapshot(raw) {
    const source = recordOf(raw) ?? {};
    const lang = deref(source.lang);
    const translateComments = deref(source.translateComments);
    return {
        model: modelOf(source.model),
        lang: isLanguageCode(lang) ? lang : DEFAULT_LANGUAGE,
        translateComments: typeof translateComments === 'boolean' ? translateComments : true,
    };
}
//# sourceMappingURL=settings.js.map