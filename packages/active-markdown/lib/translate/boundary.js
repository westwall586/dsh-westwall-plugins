/** 缓存与保存共用的边界守卫。 */
import { MAX_TEXT_BYTES, TranslateError } from "./request.js";
export const MAX_TRANSLATED_BYTES = 2 * MAX_TEXT_BYTES;
function requireBounded(value, what, limit) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new TranslateError('invalid-text', `${what}为空`);
    }
    if (Buffer.byteLength(value, 'utf8') > limit) {
        throw new TranslateError('text-too-large', `${what}超过 ${limit / 1024 / 1024} MiB`);
    }
    return value;
}
export function requireText(value, what) {
    return requireBounded(value, what, MAX_TEXT_BYTES);
}
export function requireTranslatedText(value) {
    return requireBounded(value, '译文', MAX_TRANSLATED_BYTES);
}
const UNSAFE_SEGMENT = /[\\/\u0000-\u001f]/;
export function requireLanguage(value) {
    const lang = typeof value === 'string' ? value.trim() : '';
    if (lang === '')
        throw new TranslateError('invalid-language', '缺少目标语言');
    if (lang === '.' || lang === '..' || UNSAFE_SEGMENT.test(lang)) {
        throw new TranslateError('invalid-language', `目标语言不能用作文件名：${lang}`);
    }
    return lang;
}
export function requireSessionId(value) {
    const sessionId = typeof value === 'string' ? value.trim() : '';
    if (sessionId === '')
        throw new TranslateError('invalid-session', '缺少会话标识');
    return sessionId;
}
export function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=boundary.js.map