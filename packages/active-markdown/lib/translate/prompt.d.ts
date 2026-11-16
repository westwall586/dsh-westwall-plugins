/** Changing the prompt requires bumping this, because it is part of every cache key. */
export declare const PROMPT_VERSION = "am.translate.v1";
export interface PromptInput {
    /** The language code from the wire; the prompt interpolates its label. */
    readonly lang: string;
    readonly translateComments: boolean;
    readonly extraInstruction?: string;
}
/** Substitute the language label and comment rule, then append the optional retranslation block from 4.3. */
export declare function buildSystemPrompt(input: PromptInput): string;
