/**
 * Translation as a domain, not a wire concern: parse the request at the Host
 * boundary, resolve the model (an explicit choice wins over the session
 * default), run one model call, and return the complete translated document.
 * The Cordis service only maps typed failures onto Remote codes.
 */
import { type LlmLike } from './call.ts';
export declare const MAX_TEXT_BYTES: number;
export type TranslateErrorCode = 'invalid-session' | 'invalid-text' | 'text-too-large' | 'invalid-language' | 'no-model' | 'prompt-version' | 'provider-unknown' | 'llm-unavailable' | 'model-failed';
/** A boundary or model refusal; the service maps each code onto one Remote failure code. */
export declare class TranslateError extends Error {
    readonly code: TranslateErrorCode;
    constructor(code: TranslateErrorCode, message: string);
}
/** The subset of `agentDefaultModel` this Host half reads, declared structurally. */
export interface ModelSelection {
    readonly provider: string;
    readonly model: string;
}
export interface TranslateInput {
    readonly sessionId: string;
    readonly path: string;
    readonly text: string;
    readonly lang: string;
    readonly provider?: string;
    readonly model?: string;
    readonly promptVersion: string;
    readonly extraInstruction?: string;
}
export interface TranslateView {
    readonly text: string;
}
export interface DescribeView {
    readonly promptVersion: string;
}
export interface ValidatedInput {
    readonly sessionId: string;
    readonly path: string;
    readonly text: string;
    readonly lang: string;
    readonly provider?: string;
    readonly model?: string;
    readonly extraInstruction?: string;
}
/** Parse raw wire fields into the typed request, or refuse with a typed code. */
export declare function validateInput(input: TranslateInput): ValidatedInput;
/**
 * An explicit provider or model wins over the session default; the default
 * fills whichever half the caller omitted.
 */
export declare function resolveModel(input: {
    readonly provider?: string;
    readonly model?: string;
    readonly readDefault: () => ModelSelection | null;
}): ModelSelection;
/** Validate, resolve the model, prompt, call, and return one whole translated document. */
export declare function translateRequest(input: {
    readonly llm: LlmLike | null;
    readonly readDefault: () => ModelSelection | null;
    readonly request: TranslateInput;
}): Promise<TranslateView>;
