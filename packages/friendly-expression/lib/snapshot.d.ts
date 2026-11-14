/** One frozen prompt plus its capture time, stored per session. */
export interface PromptSnapshot {
    prompt: string;
    capturedAt: number;
}
/** Read a prompt by session id and persist one capture. */
export interface SnapshotStore {
    get(sessionId: string): string | undefined;
    capture(sessionId: string, prompt: string): Promise<void>;
    close(): Promise<void>;
}
export declare const promptSnapshotDomain: {
    name: string;
    version: number;
    layout: "per-record";
    invalidRecords: "backup-and-skip";
    tables: {
        sessions: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, PromptSnapshot>;
    };
};
interface SnapshotContext {
    get(name: string): unknown;
}
/** Process-local fallback. A capture is readable before its returned promise settles. */
export declare function createMemorySnapshotStore(now?: () => number): SnapshotStore;
/** Open the durable domain when the Host provides it, otherwise keep snapshots for this run. */
export declare function openSnapshotStore(ctx: SnapshotContext): Promise<SnapshotStore>;
/** Only a brand new, non-subagent, non-seeded, empty session captures a prompt. */
export declare function shouldCapture(input: {
    isSubagent: boolean;
    isSeeded: boolean;
    hasMessages: boolean;
}): boolean;
export {};
