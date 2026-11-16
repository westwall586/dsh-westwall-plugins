/**
 * @westwall/dsh-active-markdown — 宿主半体。
 *
 * P0 的接管全部在浏览器半体。P1 这里只多两件事：一份仅存于 Host 的翻译
 * 提示词，和一次整篇翻译的模型调用。客户端发来它正在显示的原文，Host
 * 不再读盘；返回整篇译文，由客户端做行数与结构校验。调用方没给模型时，
 * Host 自己解析会话默认模型，因为客户端读不到 agentDefaultModel。
 */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type DescribeView, type TranslateView } from './translate/request.ts';
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface RemoteErrorDetailsMap {
        'activeMarkdown/invalid-request': {};
        'activeMarkdown/text-too-large': {};
        'activeMarkdown/prompt-version': {};
        'activeMarkdown/no-model': {};
        'activeMarkdown/unknown-provider': {};
        'activeMarkdown/llm-unavailable': {};
        'activeMarkdown/model-failed': {};
    }
}
export default class ActiveMarkdown extends TypertRemoteService {
    constructor(ctx: Context);
    translate(sessionId: string, path: string, text: string, lang: string, provider?: string, model?: string, promptVersion?: string, extraInstruction?: string): Promise<TranslateView>;
    describe(): DescribeView;
    private call;
    /**
     * Host services this plugin consumes structurally. `ctx.get` is cast once
     * here instead of augmenting the global Context: `dsh-llm` and
     * `dsh-agent-default-model` are intentionally not package dependencies.
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
