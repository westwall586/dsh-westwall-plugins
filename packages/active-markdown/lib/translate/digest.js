/**
 * 缓存与保存共用的内容身份：源文本按 client 的口径归一化后取 SHA-256，再拼出
 * 缓存键。行尾与末尾换行对校验不可见，对 hash 也必须不可见，否则同一份源文件
 * 会算出两个键，缓存和过期判断都会假失手。
 */
import { createHash } from 'node:crypto';
export function normalizeSource(text) {
    return text.replace(/\r\n/g, '\n').replace(/\n$/, '');
}
export function countSourceLines(text) {
    return normalizeSource(text).split('\n').length;
}
export function sha256Hex(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
export function sha1Hex(text) {
    return createHash('sha1').update(text, 'utf8').digest('hex');
}
/** 空串表示「没有补充要求」，这样普通结果永远不会回答一次特调查询。 */
export function extraInstructionHash(extraInstruction) {
    const text = typeof extraInstruction === 'string' ? extraInstruction.trim() : '';
    return text === '' ? '' : sha256Hex(text);
}
export function cacheKeyOf(input) {
    return [
        sha256Hex(normalizeSource(input.sourceText)),
        input.lang,
        input.provider,
        input.model,
        input.promptVersion,
        input.translateComments ? 'comments' : 'plain-code',
        extraInstructionHash(input.extraInstruction),
    ].join(':');
}
//# sourceMappingURL=digest.js.map