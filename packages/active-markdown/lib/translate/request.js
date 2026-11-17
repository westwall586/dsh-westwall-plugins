/**
 * Translation as a domain, not a wire concern: parse the request at the Host
 * boundary, resolve the model (an explicit choice wins over the session
 * default), run one model call, and return the complete translated document.
 * The Cordis service only maps typed failures onto Remote codes.
 */
import { callTranslation, resolveMaxTokens } from "./call.js";
import { buildSystemPrompt, PROMPT_VERSION } from "./prompt.js";
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
/** A boundary or model refusal; the service maps each code onto one Remote failure code. */
export class TranslateError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'TranslateError';
        this.code = code;
    }
}
function textField(value) {
    return typeof value === 'string' ? value : '';
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Parse raw wire fields into the typed request, or refuse with a typed code. */
export function validateInput(input) {
    const sessionId = textField(input.sessionId).trim();
    if (sessionId === '')
        throw new TranslateError('invalid-session', '缺少会话标识');
    const text = input.text;
    if (typeof text !== 'string' || text.trim() === '') {
        throw new TranslateError('invalid-text', '原文为空，无法翻译');
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
        throw new TranslateError('text-too-large', `原文超过 ${MAX_TEXT_BYTES / 1024 / 1024} MiB，未发送请求`);
    }
    const lang = textField(input.lang).trim();
    if (lang === '')
        throw new TranslateError('invalid-language', '缺少目标语言');
    if (input.promptVersion !== PROMPT_VERSION) {
        throw new TranslateError('prompt-version', `提示词版本不匹配：期望 ${PROMPT_VERSION}，收到 ${textField(input.promptVersion) || '空'}`);
    }
    const extraInstruction = textField(input.extraInstruction).trim();
    const provider = textField(input.provider).trim();
    const model = textField(input.model).trim();
    return {
        sessionId,
        path: textField(input.path),
        text,
        lang,
        ...(provider === '' ? {} : { provider }),
        ...(model === '' ? {} : { model }),
        translateComments: input.translateComments === true,
        ...(extraInstruction === '' ? {} : { extraInstruction }),
    };
}
/**
 * An explicit provider or model wins over the session default; the default
 * fills whichever half the caller omitted.
 */
export function resolveModel(input) {
    const explicitProvider = textField(input.provider).trim();
    const explicitModel = textField(input.model).trim();
    if (explicitProvider !== '' && explicitModel !== '') {
        return { provider: explicitProvider, model: explicitModel };
    }
    const fallback = input.readDefault();
    const provider = explicitProvider !== '' ? explicitProvider : textField(fallback?.provider).trim();
    const model = explicitModel !== '' ? explicitModel : textField(fallback?.model).trim();
    if (provider === '' || model === '') {
        throw new TranslateError('no-model', '未配置翻译模型，请在插件设置里选择 provider 与模型');
    }
    return { provider, model };
}
async function maxTokensFor(llm, provider, model, signal) {
    try {
        return await resolveMaxTokens({ llm, provider, model, ...(signal === undefined ? {} : { signal }) });
    }
    catch (error) {
        throw new TranslateError('provider-unknown', `无法解析翻译模型 ${provider}/${model}：${errorText(error)}`);
    }
}
/** Validate, resolve the model, prompt, call, and return one whole translated document. */
export async function translateRequest(input) {
    const request = validateInput(input.request);
    if (input.llm === null)
        throw new TranslateError('llm-unavailable', '模型服务不可用');
    const { provider, model } = resolveModel({
        ...(request.provider === undefined ? {} : { provider: request.provider }),
        ...(request.model === undefined ? {} : { model: request.model }),
        readDefault: input.readDefault,
    });
    const maxTokens = await maxTokensFor(input.llm, provider, model, input.signal);
    const system = buildSystemPrompt({
        lang: request.lang,
        translateComments: request.translateComments,
        ...(request.extraInstruction === undefined ? {} : { extraInstruction: request.extraInstruction }),
    });
    const result = await callTranslation({
        llm: input.llm,
        provider,
        model,
        maxTokens,
        system,
        text: request.text,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (result.kind === 'failed')
        throw new TranslateError('model-failed', result.message);
    if (result.text.trim() === '')
        throw new TranslateError('model-failed', '模型没有返回译文');
    return { text: result.text };
}
//# sourceMappingURL=request.js.map