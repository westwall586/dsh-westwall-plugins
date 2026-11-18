import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { AnnotationError, canonicalDocumentPath, requireRoundId, requireSessionId } from "./annotate/paths.js";
import { openAnnotationStore, } from "./annotate/store.js";
import { createReviewStore, nodeReviewFiles, } from "./annotate/reviews.js";
import { createTranslationCache, openCacheStore, } from "./translate/cache.js";
import { LANGUAGES } from "./translate/language.js";
import { PROMPT_VERSION } from "./translate/prompt.js";
import { MAX_TEXT_BYTES, translateRequest, TranslateError, } from "./translate/request.js";
import { Config, configSnapshot } from "./settings.js";
import { createTranslationStore, nodeFiles, } from "./translate/store.js";
import { editCheck as checkEditable, writeText as writeDocument, } from "./edit/write.js";
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
const ANNOTATION_CODES = {
    'invalid-request': 'activeMarkdown/invalid-request',
    'invalid-path': 'activeMarkdown/invalid-path',
    'unknown-session': 'activeMarkdown/unknown-session',
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
    /** Read one document's annotation draft for a session. */
    async annotationLoad(sessionId, path) {
        return this.callAnnotation(async () => (await this.annotation()).load({ sessionId, path }));
    }
    /** Persist one document's annotations; a too-large draft is refused without writing. */
    async annotationSave(sessionId, path, annotations, pending) {
        return this.callAnnotation(async () => (await this.annotation()).save({ sessionId, path, annotations, pending }));
    }
    /** Clear one document's draft for a session. */
    async annotationClear(sessionId, path) {
        return this.callAnnotation(async () => (await this.annotation()).clear({ sessionId, path }));
    }
    /** Every draft of one session that holds a pending attachment. */
    async annotationPending(sessionId) {
        return this.callAnnotation(async () => (await this.annotation()).pending(sessionId));
    }
    /** Write the pending full-text snapshot the annotation round was based on. */
    async reviewPrepare(sessionId, path, roundId, text) {
        return this.callAnnotation(async () => {
            if (typeof text !== 'string' || text === '') {
                throw new AnnotationError('invalid-request', '缺少原文');
            }
            if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
                throw new AnnotationError('invalid-request', `原文超过 ${MAX_TEXT_BYTES / 1024 / 1024} MiB`);
            }
            return this.reviews().prepare({
                sessionId: requireSessionId(sessionId),
                path,
                roundId,
                text,
            });
        });
    }
    /**
     * Promote the pending snapshot, write the round metadata and delete the
     * draft. A missing pending snapshot is not a failure: the round is marked
     * `snapshotMissing` and the send is allowed to complete.
     */
    async reviewCommit(sessionId, path, roundId, sentText) {
        return this.callAnnotation(async () => {
            const session = requireSessionId(sessionId);
            const canonical = canonicalDocumentPath(path);
            const round = requireRoundId(roundId);
            const annotations = await this.annotation();
            const draft = await annotations.load({ sessionId: session, path: canonical });
            const view = await this.reviews().commit({
                sessionId: session,
                path: canonical,
                roundId: round,
                pending: draft?.pending ?? null,
                sentText: textField(sentText),
            });
            if (view.committed && draft?.pending?.roundId === round) {
                const sent = new Map(draft.pending.annotations.map(annotation => [annotation.id, JSON.stringify(annotation)]));
                const remaining = draft.annotations.filter(annotation => sent.get(annotation.id) !== JSON.stringify(annotation));
                if (remaining.length === 0) {
                    await annotations.clear({ sessionId: session, path: canonical });
                }
                else {
                    // Annotations added or changed after the frozen round are a new, unsent draft.
                    await annotations.save({ sessionId: session, path: canonical, annotations: remaining, pending: null });
                }
            }
            return view;
        });
    }
    /** Clear one matching pending record and its snapshot; annotations stay. */
    async reviewDetach(sessionId, path, roundId) {
        return this.callAnnotation(async () => {
            const session = requireSessionId(sessionId);
            const canonical = canonicalDocumentPath(path);
            const round = requireRoundId(roundId);
            const annotations = await this.annotation();
            const draft = await annotations.load({ sessionId: session, path: canonical });
            if (draft?.pending?.roundId !== round) {
                // An attach can fail before its pending record is saved; removing the
                // orphan snapshot by round id keeps a retry from inheriting stale text.
                return this.reviews().detach({ sessionId: session, roundId: round });
            }
            await this.reviews().detach({ sessionId: session, roundId: round });
            await annotations.save({
                sessionId: session,
                path: canonical,
                annotations: draft.annotations,
                pending: null,
            });
            return { detached: true };
        });
    }
    /** The newest committed round's full text, or null when it cannot baseline a diff. */
    async reviewLatest(sessionId, path) {
        return this.callAnnotation(() => this.reviews().latest({ sessionId, path }));
    }
    /** Whether this session may edit the file, and the version a guarded save must send back. */
    async editCheck(sessionId, path, bytes) {
        const face = this.editFacility();
        if (face === null)
            return { status: 'unsupported', reason: 'fs' };
        return checkEditable(face, {
            sessionId: typeof sessionId === 'string' ? sessionId : '',
            path: typeof path === 'string' ? path : '',
            bytes: typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0 ? bytes : 0,
        });
    }
    /** Write one edited document; a missing service or session is a status, never a rejection. */
    async writeText(sessionId, path, text, intent) {
        const face = this.editFacility();
        if (face === null)
            return { status: 'unsupported', reason: 'fs' };
        if (typeof text !== 'string' || typeof path !== 'string' || typeof sessionId !== 'string') {
            return { status: 'unsupported', reason: 'fs' };
        }
        if (intent === null || typeof intent !== 'object' || typeof intent.kind !== 'string') {
            return { status: 'unsupported', reason: 'fs' };
        }
        return writeDocument(face, { sessionId, path, text, intent });
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
    async callAnnotation(operation) {
        try {
            return await operation();
        }
        catch (error) {
            if (error instanceof AnnotationError)
                throw new RemoteError(ANNOTATION_CODES[error.code], error.message, {});
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
    annotationValue;
    reviewValue;
    fileStore() {
        this.fileStoreValue ??= createTranslationStore({
            files: nodeFiles,
            workspaceOf: (sessionId) => this.workspaceOf(sessionId),
            readDefault: () => this.readDefaultSelection(),
            now: () => new Date(),
        });
        return this.fileStoreValue;
    }
    annotation() {
        this.annotationValue ??= openAnnotationStore(this.serviceOf('storageDomain'), { now: () => new Date() });
        return this.annotationValue;
    }
    reviews() {
        this.reviewValue ??= createReviewStore({
            files: nodeReviewFiles,
            workspaceOf: (sessionId) => this.workspaceOf(sessionId),
            now: () => new Date(),
        });
        return this.reviewValue;
    }
    cache() {
        this.cacheValue ??= openCacheStore(this.serviceOf('storageDomain')).then((store) => createTranslationCache({
            store,
            readDefault: () => this.readDefaultSelection(),
            now: () => new Date(),
        }));
        return this.cacheValue;
    }
    editFacility() {
        const fs = this.serviceOf('fs');
        const sandbox = this.serviceOf('sandboxPolicy');
        const sessions = this.serviceOf('sessions');
        if (fs === null || sandbox === null || sessions === null)
            return null;
        return { fs, sandbox, sessions };
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
const METHODS = [
    'describe', 'translate', 'cacheGet', 'cachePut', 'translationSave', 'translationLoad',
    'annotationLoad', 'annotationSave', 'annotationClear', 'annotationPending',
    'reviewPrepare', 'reviewCommit', 'reviewDetach', 'reviewLatest',
    'editCheck', 'writeText',
];
Object.defineProperty(ActiveMarkdown.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods', {
    configurable: true,
    value: Object.freeze(structuredClone({ version: 1, methods: METHODS.map((method) => ({ method, invocation: { kind: 'direct' } })) })),
});
//# sourceMappingURL=index.js.map