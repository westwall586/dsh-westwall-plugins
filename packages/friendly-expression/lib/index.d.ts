/** Host half freezes one expression prompt per new Web session and injects it scoped to that agent. */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "friendly-expression";
export declare const inject: string[];
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    stylePrompt: z<string, string, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    stylePrompt: z<string, string, "volatile-defined">;
}>>, "plain">;
interface FriendlyExpressionConfig {
    stylePrompt: string | {
        get(): string;
    } | undefined;
}
/** Read a volatile config field whether the Host handed back a raw string or a reference. */
export declare function readStylePrompt(value: FriendlyExpressionConfig['stylePrompt']): string;
export declare function apply(ctx: Context, config: FriendlyExpressionConfig): Promise<void>;
export {};
