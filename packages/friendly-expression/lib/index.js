import z from '@deepseek-ai/schemastery';
import { DEFAULT_STYLE_PROMPT, MAX_PROMPT_CHARS, SECTION_NAME, SECTION_ORDER } from "./prompt.js";
import { openSnapshotStore, shouldCapture } from "./snapshot.js";
export const name = 'friendly-expression';
export const inject = ['systemPrompt'];
export const Config = z.object({
    stylePrompt: z.string().max(MAX_PROMPT_CHARS).default(DEFAULT_STYLE_PROMPT).volatile(),
});
/** Read a volatile config field whether the Host handed back a raw string or a reference. */
export function readStylePrompt(value) {
    if (typeof value === 'string')
        return value;
    return value?.get() ?? '';
}
function hasWebSurface(ctx) {
    return ctx.get('webApp') !== undefined || ctx.get('webServer') !== undefined;
}
function warn(message, error) {
    console.warn(`[dsh-friendly-expression] ${message}`, error);
}
export async function apply(ctx, config) {
    const store = await openSnapshotStore(ctx);
    const sections = new Map();
    const registerSection = (agent, prompt) => {
        const sessionId = agent.session.id;
        if (prompt.length === 0 || sections.has(sessionId))
            return;
        const promptCtx = agent.ctx;
        const dispose = agent.ctx.effect(() => promptCtx.systemPrompt.section({
            name: SECTION_NAME,
            order: SECTION_ORDER,
            text: prompt,
        }), 'friendly-expression prompt section');
        sections.set(sessionId, dispose);
    };
    ctx.effect(() => () => store.close(), 'friendly-expression snapshot store');
    ctx.effect(() => () => {
        for (const dispose of sections.values())
            dispose();
        sections.clear();
    }, 'friendly-expression prompt sections');
    ctx.on('agent/created', ({ agent, source }) => {
        if (!hasWebSurface(ctx))
            return undefined;
        if (agent.session.header.origin === 'subagent')
            return undefined;
        if (sections.has(agent.session.id))
            return undefined;
        let prompt = store.get(agent.session.id);
        if (prompt === undefined) {
            if (source !== 'startup')
                return undefined;
            const fresh = shouldCapture({
                isSubagent: false,
                isSeeded: agent.session.header.isSeeded,
                hasMessages: agent.session.surface.nodes.length > 0,
            });
            if (!fresh)
                return undefined;
            prompt = readStylePrompt(config.stylePrompt);
            void store.capture(agent.session.id, prompt).catch((error) => {
                warn(`failed to capture the prompt snapshot for session ${agent.session.id}`, error);
            });
        }
        registerSection(agent, prompt);
        return undefined;
    });
    ctx.on('agent/disposed', ({ agent }) => {
        sections.delete(agent.session.id);
    });
    const registry = ctx.get('agents');
    if (registry !== undefined && hasWebSurface(ctx)) {
        for (const agent of registry.list()) {
            if (agent.session.header.origin === 'subagent')
                continue;
            const prompt = store.get(agent.session.id);
            if (prompt !== undefined)
                registerSection(agent, prompt);
        }
    }
}
//# sourceMappingURL=index.js.map