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
    constructor(ctx: Context);
    translate(sessionId: string, path: string, text: string, lang: string, provider?: string, model?: string, promptVersion?: string, extraInstruction?: string): Promise<TranslateView>;
    describe(): DescribeView;
    /** Read an automatic cache entry without touching the model. */
    cacheGet(text: string, lang: string, provider?: string, model?: string, promptVersion?: string, extraInstruction?: string): Promise<CachedTranslation | null>;
    /** Store a successful translation under the same key `cacheGet` will use. */
    cachePut(text: string, translated: string, lang: string, provider?: string, model?: string, promptVersion?: string, extraInstruction?: string, aligned?: boolean, sourceLines?: number, translatedLines?: number): Promise<CachePutView>;
    /** Write the mirrored Markdown + JSON pair under `.dsh-active-markdown/translate/`. */
    translationSave(sessionId: string, path: string, text: string, translated: string, lang: string, provider?: string, model?: string, promptVersion?: string, extraInstruction?: string, aligned?: boolean): Promise<TranslationSaveView>;
    /** Read a saved pair from the workspace and say whether the source moved on. */
    translationLoad(sessionId: string, path: string, lang: string): Promise<TranslationLoadView | null>;
    private call;
    private fileStoreValue?;
    private cacheValue?;
    private fileStore;
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
