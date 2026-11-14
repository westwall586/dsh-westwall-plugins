/** Per-session prompt snapshots stay durable when storage is present and in memory otherwise. */
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { MAX_PROMPT_CHARS } from "./prompt.js";
const WARNING_PREFIX = '[dsh-friendly-expression]';
const promptSnapshotSchema = z.object({
    prompt: z.string().max(MAX_PROMPT_CHARS),
    capturedAt: z.number().int().nonnegative(),
}).strict();
export const promptSnapshotDomain = defineDomain({
    name: 'friendly_expression',
    version: 1,
    layout: 'per-record',
    invalidRecords: 'backup-and-skip',
    tables: {
        sessions: domainTable(promptSnapshotSchema),
    },
});
function warn(message, error) {
    if (error === undefined)
        console.warn(`${WARNING_PREFIX} ${message}`);
    else
        console.warn(`${WARNING_PREFIX} ${message}`, error);
}
function createCachedStore(now, table, closeDomain) {
    const cache = new Map();
    return {
        get(sessionId) {
            const cached = cache.get(sessionId);
            if (cached !== undefined)
                return cached.prompt;
            const stored = table?.get(sessionId);
            if (stored !== undefined)
                cache.set(sessionId, stored);
            return stored?.prompt;
        },
        async capture(sessionId, prompt) {
            const snapshot = { prompt, capturedAt: now() };
            cache.set(sessionId, snapshot);
            if (table === undefined)
                return;
            try {
                await table.put(sessionId, snapshot);
            }
            catch (error) {
                warn(`failed to persist the prompt snapshot for session ${sessionId}`, error);
                throw error;
            }
        },
        async close() {
            cache.clear();
            await closeDomain?.();
        },
    };
}
/** Process-local fallback. A capture is readable before its returned promise settles. */
export function createMemorySnapshotStore(now = Date.now) {
    return createCachedStore(now);
}
/** Open the durable domain when the Host provides it, otherwise keep snapshots for this run. */
export async function openSnapshotStore(ctx) {
    const facility = ctx.get('storageDomain');
    if (facility === undefined) {
        warn('storageDomain unavailable; keeping prompt snapshots in memory for this run');
        return createMemorySnapshotStore();
    }
    try {
        const domain = await facility.open(promptSnapshotDomain);
        return createCachedStore(Date.now, domain.table('sessions'), () => domain.close());
    }
    catch (error) {
        warn('failed to open the friendly_expression snapshot domain; keeping prompt snapshots in memory for this run', error);
        return createMemorySnapshotStore();
    }
}
/** Only a brand new, non-subagent, non-seeded, empty session captures a prompt. */
export function shouldCapture(input) {
    return !input.isSubagent && !input.isSeeded && !input.hasMessages;
}
//# sourceMappingURL=snapshot.js.map