/**
 * The one place a translation reaches a provider: drain `llm.stream` into the
 * complete translated document. The Host `llm` service is declared
 * structurally because `@deepseek-ai/dsh-llm` is not a package dependency.
 */
export const TRANSLATE_PURPOSE = 'activeMarkdown.translate';
/** Used only when the resolved model info does not disclose an output default. */
export const FALLBACK_MAX_TOKENS = 8192;
/** Prefer the model's disclosed output cap; 8192 is only the fallback. */
export async function resolveMaxTokens(input) {
    if (typeof input.llm.resolveModelInfo !== 'function')
        return FALLBACK_MAX_TOKENS;
    const info = await input.llm.resolveModelInfo(input.provider, input.model);
    const disclosed = info?.defaultMaxTokens;
    return typeof disclosed === 'number' && Number.isSafeInteger(disclosed) && disclosed > 0
        ? disclosed
        : FALLBACK_MAX_TOKENS;
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
function failureText(failure) {
    if (failure?.message !== undefined && failure.message !== '')
        return failure.message;
    if (failure?.code !== undefined && failure.code !== '')
        return failure.code;
    return '模型调用失败';
}
/** One model request for one document; the full translated text comes back at the end. */
export async function callTranslation(input) {
    let text = '';
    let sawText = false;
    let finish;
    try {
        for await (const chunk of input.llm.stream({
            provider: input.provider,
            model: input.model,
            system: input.system,
            messages: [{ role: 'user', content: [{ type: 'text', text: input.text }] }],
            temperature: 0,
            maxTokens: input.maxTokens,
            purpose: TRANSLATE_PURPOSE,
        })) {
            if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
                sawText = true;
                text += chunk.text;
            }
            else if (chunk.type === 'block-end'
                && !sawText
                && chunk.block?.type === 'text'
                && typeof chunk.block.text === 'string') {
                // Delta-only streams are the common case; a block-complete stream is still readable.
                sawText = true;
                text = chunk.block.text;
            }
            else if (chunk.type === 'finish') {
                finish = chunk.reason;
            }
        }
    }
    catch (error) {
        return { kind: 'failed', message: errorText(error) };
    }
    if (finish?.kind === 'aborted')
        return { kind: 'failed', message: '翻译已取消' };
    if (finish?.kind === 'error')
        return { kind: 'failed', message: failureText(finish.failure) };
    return { kind: 'ok', text };
}
//# sourceMappingURL=call.js.map