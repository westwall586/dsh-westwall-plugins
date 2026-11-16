import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { PROMPT_VERSION } from "./translate/prompt.js";
import { translateRequest, TranslateError, } from "./translate/request.js";
const REMOTE_CODES = {
    'invalid-session': 'activeMarkdown/invalid-request',
    'invalid-text': 'activeMarkdown/invalid-request',
    'invalid-language': 'activeMarkdown/invalid-request',
    'text-too-large': 'activeMarkdown/text-too-large',
    'prompt-version': 'activeMarkdown/prompt-version',
    'no-model': 'activeMarkdown/no-model',
    'provider-unknown': 'activeMarkdown/unknown-provider',
    'llm-unavailable': 'activeMarkdown/llm-unavailable',
    'model-failed': 'activeMarkdown/model-failed',
};
export default class ActiveMarkdown extends TypertRemoteService {
    constructor(ctx) {
        super(ctx, 'activeMarkdown');
    }
    async translate(sessionId, path, text, lang, provider, model, promptVersion, extraInstruction) {
        const request = {
            sessionId,
            path,
            text,
            lang,
            ...(provider === undefined ? {} : { provider }),
            ...(model === undefined ? {} : { model }),
            promptVersion: textField(promptVersion),
            ...(extraInstruction === undefined ? {} : { extraInstruction }),
        };
        return this.call(() => translateRequest({
            llm: this.llm(),
            readDefault: () => this.readDefaultSelection(),
            request,
        }));
    }
    describe() {
        return { promptVersion: PROMPT_VERSION };
    }
    async call(operation) {
        try {
            return await operation();
        }
        catch (error) {
            if (error instanceof TranslateError)
                throw new RemoteError(REMOTE_CODES[error.code], error.message, {});
            throw error;
        }
    }
    /**
     * Host services this plugin consumes structurally. `ctx.get` is cast once
     * here instead of augmenting the global Context: `dsh-llm` and
     * `dsh-agent-default-model` are intentionally not package dependencies.
     */
    serviceOf(name) {
        const ctx = this.ctx;
        if (typeof ctx.get !== 'function')
            return null;
        const service = ctx.get(name);
        return service === undefined || service === null ? null : service;
    }
    llm() {
        return this.serviceOf('llm');
    }
    readDefaultSelection() {
        const service = this.serviceOf('agentDefaultModel');
        if (service === null)
            return null;
        try {
            const selection = service.currentSelection();
            if (selection === null || selection === undefined)
                return null;
            if (typeof selection.provider !== 'string' || typeof selection.model !== 'string')
                return null;
            return { provider: selection.provider, model: selection.model };
        }
        catch {
            return null;
        }
    }
}
function textField(value) {
    return typeof value === 'string' ? value : '';
}
const METHODS = ['describe', 'translate'];
Object.defineProperty(ActiveMarkdown.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods', {
    configurable: true,
    value: Object.freeze(structuredClone({ version: 1, methods: METHODS.map((method) => ({ method, invocation: { kind: 'direct' } })) })),
});
//# sourceMappingURL=index.js.map