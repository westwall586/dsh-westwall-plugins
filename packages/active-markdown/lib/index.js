import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { createTranslationCache, openCacheStore, } from "./translate/cache.js";
import { LANGUAGES } from "./translate/language.js";
import { PROMPT_VERSION } from "./translate/prompt.js";
import { translateRequest, TranslateError, } from "./translate/request.js";
import { Config, configSnapshot } from "./settings.js";
import { createTranslationStore, nodeFiles, } from "./translate/store.js";
const REMOTE_CODES = {
    'invalid-session': 'activeMarkdown/invalid-request',
    'unknown-session': 'activeMarkdown/unknown-session',
    'invalid-path': 'activeMarkdown/invalid-path',
    'invalid-text': 'activeMarkdown/invalid-request',
    'invalid-language': 'activeMarkdown/invalid-request',
    'text-too-large': 'activeMarkdown/text-too-large',
    'prompt-version': 'activeMarkdown/prompt-version',
    'no-model': 'activeMarkdown/no-model',
    'provider-unknown': 'activeMarkdown/unknown-provider',
    'llm-unavailable': 'activeMarkdown/llm-unavailable',
    'model-failed': 'activeMarkdown/model-failed',
    'read-failed': 'activeMarkdown/read-failed',
    'write-failed': 'activeMarkdown/write-failed',
};
export default class ActiveMarkdown extends TypertRemoteService {
    static Config = Config;
    constructor(ctx) {
        super(ctx, 'activeMarkdown');
    }
    async translate(sessionId, path, text, lang, provider, model, promptVersion, extraInstruction, translateComments, signal) {
        const request = {
            sessionId,
            path,
            text,
            lang,
            ...(provider === undefined ? {} : { provider }),
            ...(model === undefined ? {} : { model }),
            promptVersion: textField(promptVersion),
            translateComments: this.commentsFor(translateComments),
            ...(extraInstruction === undefined ? {} : { extraInstruction }),
        };
        return this.call(() => translateRequest({
            llm: this.llm(),
            readDefault: () => this.readDefaultSelection(),
            request,
            ...(signal === undefined ? {} : { signal }),
        }));
    }
    describe() {
        const settings = this.settings();
        return {
            promptVersion: PROMPT_VERSION,
            settings: {
                lang: settings.lang,
                model: settings.model,
                translateComments: settings.translateComments,
            },
            languages: LANGUAGES,
        };
    }
    /** Read an automatic cache entry without touching the model. */
    async cacheGet(text, lang, provider, model, promptVersion, extraInstruction, translateComments) {
        return this.call(async () => {
            const cache = await this.cache();
            return cache.cacheGet({
                text,
                lang,
                ...(provider === undefined ? {} : { provider }),
                ...(model === undefined ? {} : { model }),
                promptVersion: textField(promptVersion),
                translateComments: this.commentsFor(translateComments),
                ...(extraInstruction === undefined ? {} : { extraInstruction }),
            });
        });
    }
    /** Store a successful translation under the same key `cacheGet` will use. */
    async cachePut(text, translated, lang, provider, model, promptVersion, extraInstruction, aligned, sourceLines, translatedLines, translateComments) {
        return this.call(async () => {
            const cache = await this.cache();
            return cache.cachePut({
                text,
                translated,
                lang,
                ...(provider === undefined ? {} : { provider }),
                ...(model === undefined ? {} : { model }),
                promptVersion: textField(promptVersion),
                translateComments: this.commentsFor(translateComments),
                ...(extraInstruction === undefined ? {} : { extraInstruction }),
                aligned: aligned === true,
                sourceLines: sourceLines ?? 0,
                translatedLines: translatedLines ?? 0,
            });
        });
    }
    /** Write the mirrored Markdown + JSON pair under `.dsh-active-markdown/translate/`. */
    async translationSave(sessionId, path, text, translated, lang, provider, model, promptVersion, extraInstruction, aligned) {
        return this.call(() => this.fileStore().save({
            sessionId,
            path,
            text,
            translated,
            lang,
            ...(provider === undefined ? {} : { provider }),
            ...(model === undefined ? {} : { model }),
            promptVersion: textField(promptVersion),
            ...(extraInstruction === undefined ? {} : { extraInstruction }),
            aligned: aligned === true,
        }));
    }
    /** Read a saved pair from the workspace and say whether the source moved on. */
    async translationLoad(sessionId, path, lang) {
        return this.call(() => this.fileStore().load({ sessionId, path, lang }));
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
     * The effective settings, read fresh so a plugin-page write applies to the
     * next run. A client that sends its own comment policy still wins, because
     * that run's cache key must match the prompt that produced it.
     */
    settings() {
        try {
            return configSnapshot(this.ctx.fiber?.rawConfig);
        }
        catch {
            return configSnapshot(undefined);
        }
    }
    commentsFor(explicit) {
        return typeof explicit === 'boolean' ? explicit : this.settings().translateComments;
    }
    fileStoreValue;
    cacheValue;
    fileStore() {
        this.fileStoreValue ??= createTranslationStore({
            files: nodeFiles,
            workspaceOf: (sessionId) => this.workspaceOf(sessionId),
            readDefault: () => this.readDefaultSelection(),
            now: () => new Date(),
        });
        return this.fileStoreValue;
    }
    cache() {
        this.cacheValue ??= openCacheStore(this.serviceOf('storageDomain')).then((store) => createTranslationCache({
            store,
            readDefault: () => this.readDefaultSelection(),
            now: () => new Date(),
        }));
        return this.cacheValue;
    }
    /**
     * The directory a session's writes belong to: the committed working directory
     * when the Host is running that session, otherwise the header's original cwd
     * for a session loaded from persistence. A live session that names no
     * directory is refused rather than guessed.
     */
    async workspaceOf(sessionId) {
        const sessions = this.serviceOf('sessions');
        let session;
        try {
            session = sessions?.get(sessionId);
        }
        catch {
            session = undefined;
        }
        if (session !== undefined) {
            const workingDirectory = this.serviceOf('workingDirectory');
            if (workingDirectory !== null) {
                try {
                    const directory = workingDirectory.get(session);
                    if (typeof directory === 'string' && directory !== '')
                        return directory;
                }
                catch {
                    // Fall through to the immutable header directory.
                }
            }
            const cwd = session.header?.cwd;
            return typeof cwd === 'string' && cwd !== '' ? cwd : null;
        }
        const persistence = this.serviceOf('sessionPersistence');
        if (persistence === null)
            return null;
        try {
            const snapshot = await persistence.stat(sessionId);
            const cwd = snapshot?.header?.cwd;
            return typeof cwd === 'string' && cwd !== '' ? cwd : null;
        }
        catch {
            return null;
        }
    }
    /**
     * Host services this plugin consumes structurally. `ctx.get` is cast once
     * here instead of augmenting the global Context: `dsh-llm`, `dsh-agent-default-model`,
     * `dsh-session` and the other consumers are intentionally not package dependencies.
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
const METHODS = ['describe', 'translate', 'cacheGet', 'cachePut', 'translationSave', 'translationLoad'];
Object.defineProperty(ActiveMarkdown.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods', {
    configurable: true,
    value: Object.freeze(structuredClone({ version: 1, methods: METHODS.map((method) => ({ method, invocation: { kind: 'direct' } })) })),
});
//# sourceMappingURL=index.js.map