/**
 * The one place a translation reaches a provider: drain `llm.stream` into the
 * complete translated document. The Host `llm` service is declared
 * structurally because `@deepseek-ai/dsh-llm` is not a package dependency.
 */
export declare const TRANSLATE_PURPOSE = "activeMarkdown.translate";
/** Used only when the resolved model info does not disclose an output default. */
export declare const FALLBACK_MAX_TOKENS = 8192;
export interface LlmTextContent {
    readonly type: 'text';
    readonly text: string;
}
export interface LlmMessage {
    readonly role: 'user';
    readonly content: readonly LlmTextContent[];
}
export interface LlmCallOptions {
    readonly provider: string;
    readonly model: string;
    readonly messages: readonly LlmMessage[];
    readonly system?: string;
    readonly temperature?: number;
    readonly maxTokens?: number;
    readonly purpose?: string;
}
export interface LlmFailure {
    readonly code?: string;
    readonly message?: string;
}
export interface LlmStreamChunk {
    readonly type: string;
    readonly text?: string;
    readonly block?: {
        readonly type: string;
        readonly text?: string;
    };
    readonly reason?: {
        readonly kind: string;
        readonly failure?: LlmFailure;
    };
}
export interface LlmResolvedModelInfo {
    /** Adapter-configured per-request output cap materialized when callers omit one. */
    readonly defaultMaxTokens?: number;
}
export interface LlmLike {
    stream(options: LlmCallOptions): AsyncIterable<LlmStreamChunk>;
    resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
}
export interface ResolveMaxTokensInput {
    readonly llm: LlmLike;
    readonly provider: string;
    readonly model: string;
}
/** Prefer the model's disclosed output cap; 8192 is only the fallback. */
export declare function resolveMaxTokens(input: ResolveMaxTokensInput): Promise<number>;
export interface CallTranslationInput {
    readonly llm: LlmLike;
    readonly provider: string;
    readonly model: string;
    readonly maxTokens: number;
    readonly system: string;
    readonly text: string;
}
export type CallTranslationResult = {
    readonly kind: 'ok';
    readonly text: string;
} | {
    readonly kind: 'failed';
    readonly message: string;
};
/** One model request for one document; the full translated text comes back at the end. */
export declare function callTranslation(input: CallTranslationInput): Promise<CallTranslationResult>;
