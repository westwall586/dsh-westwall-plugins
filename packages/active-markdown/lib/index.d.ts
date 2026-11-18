/**
 * @westwall/dsh-active-markdown — 宿主半体。
 *
 * P1 的接管与翻译之外，这里还管翻译结果的两级留存：每次成功翻译写插件存储的
 * 自动缓存，用户点保存时把译文镜像进工作区的 `.dsh-active-markdown/translate/`。
 * 客户端发来它正在显示的原文，Host 不读盘做翻译；读取已保存译文时，Host 用
 * 同一份源文件重算 hash，把「原文已更新」交给客户端展示。调用方没给模型时，
 * Host 自己解析会话默认模型，因为客户端读不到 agentDefaultModel。
 */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type AnnotationSaveView } from './annotate/store.ts';
import type { Annotation, AnnotationDraft, PendingReview } from './annotate/schema.ts';
import { type ReviewCommitView, type ReviewDetachView, type ReviewLatestView, type ReviewPrepareView } from './annotate/reviews.ts';
import { type CachedTranslation, type CachePutView } from './translate/cache.ts';
import { type DescribeView, type TranslateView } from './translate/request.ts';
import { type TranslationLoadView, type TranslationSaveView } from './translate/store.ts';
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface RemoteErrorDetailsMap {
        'activeMarkdown/invalid-request': {};
        'activeMarkdown/unknown-session': {};
        'activeMarkdown/invalid-path': {};
        'activeMarkdown/text-too-large': {};
        'activeMarkdown/prompt-version': {};
        'activeMarkdown/no-model': {};
        'activeMarkdown/unknown-provider': {};
        'activeMarkdown/llm-unavailable': {};
        'activeMarkdown/model-failed': {};
        'activeMarkdown/read-failed': {};
        'activeMarkdown/write-failed': {};
    }
}
export default class ActiveMarkdown extends TypertRemoteService {
    static Config: unknown;
    constructor(ctx: Context);
    translate(sessionId: string, path: string, text: string, lang: string, provider?: string, model?: string, promptVersion?: string, extraInstruction?: string, translateComments?: boolean, signal?: AbortSignal): Promise<TranslateView>;
    describe(): DescribeView;
    /** Read an automatic cache entry without touching the model. */
    cacheGet(text: string, lang: string, provider?: string, model?: string, promptVersion?: string, extraInstruction?: string, translateComments?: boolean): Promise<CachedTranslation | null>;
    /** Store a successful translation under the same key `cacheGet` will use. */
    cachePut(text: string, translated: string, lang: string, provider?: string, model?: string, promptVersion?: string, extraInstruction?: string, aligned?: boolean, sourceLines?: number, translatedLines?: number, translateComments?: boolean): Promise<CachePutView>;
    /** Write the mirrored Markdown + JSON pair under `.dsh-active-markdown/translate/`. */
    translationSave(sessionId: string, path: string, text: string, translated: string, lang: string, provider?: string, model?: string, promptVersion?: string, extraInstruction?: string, aligned?: boolean): Promise<TranslationSaveView>;
    /** Read a saved pair from the workspace and say whether the source moved on. */
    translationLoad(sessionId: string, path: string, lang: string): Promise<TranslationLoadView | null>;
    /** Read one document's annotation draft for a session. */
    annotationLoad(sessionId: string, path: string): Promise<AnnotationDraft | null>;
    /** Persist one document's annotations; a too-large draft is refused without writing. */
    annotationSave(sessionId: string, path: string, annotations: Annotation[], pending: PendingReview | null): Promise<AnnotationSaveView>;
    /** Clear one document's draft for a session. */
    annotationClear(sessionId: string, path: string): Promise<Record<string, never>>;
    /** Every draft of one session that holds a pending attachment. */
    annotationPending(sessionId: string): Promise<AnnotationDraft[]>;
    /** Write the pending full-text snapshot the annotation round was based on. */
    reviewPrepare(sessionId: string, path: string, roundId: string, text: string): Promise<ReviewPrepareView>;
    /**
     * Promote the pending snapshot, write the round metadata and delete the
     * draft. A missing pending snapshot is not a failure: the round is marked
     * `snapshotMissing` and the send is allowed to complete.
     */
    reviewCommit(sessionId: string, path: string, roundId: string, sentText: string): Promise<ReviewCommitView>;
    /** Clear one matching pending record and its snapshot; annotations stay. */
    reviewDetach(sessionId: string, path: string, roundId: string): Promise<ReviewDetachView>;
    /** The newest committed round's full text, or null when it cannot baseline a diff. */
    reviewLatest(sessionId: string, path: string): Promise<ReviewLatestView | null>;
    private call;
    private callAnnotation;
    /**
     * The effective settings, read fresh so a plugin-page write applies to the
     * next run. A client that sends its own comment policy still wins, because
     * that run's cache key must match the prompt that produced it.
     */
    private settings;
    private commentsFor;
    private fileStoreValue?;
    private cacheValue?;
    private annotationValue?;
    private reviewValue?;
    private fileStore;
    private annotation;
    private reviews;
    private cache;
    /**
     * The directory a session's writes belong to: the committed working directory
     * when the Host is running that session, otherwise the header's original cwd
     * for a session loaded from persistence. A live session that names no
     * directory is refused rather than guessed.
     */
    private workspaceOf;
    /**
     * Host services this plugin consumes structurally. `ctx.get` is cast once
     * here instead of augmenting the global Context: `dsh-llm`, `dsh-agent-default-model`,
     * `dsh-session` and the other consumers are intentionally not package dependencies.
     */
    private serviceOf;
    private llm;
    private readDefaultSelection;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Active Markdown translation, registered by the plugin row. */
        activeMarkdown: ActiveMarkdown;
    }
}
