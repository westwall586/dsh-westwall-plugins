/**
 * The translation prompt and its version. This module is Host-only: the
 * browser half must never import it, so the prompt never reaches client.js.
 */
/** Changing the prompt requires bumping this, because it is part of every cache key. */
export declare const PROMPT_VERSION = "am.translate.v1";
export interface PromptInput {
    readonly lang: string;
    readonly extraInstruction?: string;
}
/** Substitute the target language, and append the optional retranslation block from 4.3. */
export declare function buildSystemPrompt(input: PromptInput): string;
