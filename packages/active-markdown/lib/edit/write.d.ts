export declare const MAX_EDIT_BYTES: number;
export type EditMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type EditUnsupportedReason = 'session' | 'symlink' | 'not-file' | 'fs';
export type WriteIntent = {
    kind: 'replace';
    version: string;
} | {
    kind: 'overwrite';
} | {
    kind: 'create';
};
export interface WriteTextRequest {
    sessionId: string;
    path: string;
    text: string;
    intent: WriteIntent;
}
export type WriteTextResult = {
    status: 'saved';
    absolutePath: string;
    version: string;
    bytes: number;
} | {
    status: 'stale';
} | {
    status: 'exists';
    absolutePath: string;
} | {
    status: 'denied';
    mode: EditMode;
} | {
    status: 'too-large';
    limit: number;
} | {
    status: 'unsupported';
    reason: EditUnsupportedReason;
};
export interface EditCheckRequest {
    sessionId: string;
    path: string;
    bytes: number;
}
export type EditCheckResult = {
    status: 'ok';
    absolutePath: string;
    version: string;
} | {
    status: 'outside';
} | {
    status: 'read-only';
    mode: 'read-only';
} | {
    status: 'too-large';
    limit: number;
} | {
    status: 'unsupported';
    reason: EditUnsupportedReason;
};
interface EditTargetLike {
    readonly targetKey: unknown;
    readonly displayPath: string;
}
interface EditPathInfoLike {
    readonly type: 'file' | 'directory' | 'symlink' | 'other';
    readonly size?: number;
}
interface EditInfoLike {
    readonly type: 'file' | 'directory' | 'other';
    readonly size?: number;
    readonly version: string;
}
interface EditWriteOutcomeLike {
    readonly version: string;
    readonly after: string;
}
type EditExpectedLike = {
    kind: 'createIfAbsent';
} | {
    kind: 'replaceIfVersion';
    version: string;
};
export interface EditSandboxPolicyLike {
    readonly mode: EditMode;
    readonly workspaceRoot: string;
}
export interface EditFsLike {
    resolve(path: string, opts?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<EditTargetLike>;
    lstat(path: string, opts?: {
        cwd?: string;
    }, signal?: AbortSignal): Promise<EditPathInfoLike | undefined>;
    stat(target: EditTargetLike, signal?: AbortSignal): Promise<EditInfoLike | undefined>;
    readText(target: EditTargetLike, signal?: AbortSignal): Promise<string>;
    contains(parent: EditTargetLike, child: EditTargetLike): boolean;
    writeText(target: EditTargetLike, content: string, expected?: EditExpectedLike, signal?: AbortSignal, sandboxPolicy?: EditSandboxPolicyLike): Promise<EditWriteOutcomeLike>;
}
export interface EditSandboxLike {
    resolve(request: {
        session: unknown;
    }): EditSandboxPolicyLike;
}
export interface EditSessionsLike {
    get(id: string): unknown | undefined;
}
export interface EditFacility {
    readonly fs: EditFsLike;
    readonly sandbox: EditSandboxLike;
    readonly sessions: EditSessionsLike;
}
/**
 * Map the client intent onto the filesystem guard. `overwrite` maps to an
 * absent intent, which is the provider's unconditional write.
 */
export declare function writeIntentOf(intent: WriteIntent): EditExpectedLike | undefined;
/**
 * Map one provider failure onto the wire contract. `FS_NOT_OBSERVED` is the
 * local backend's answer to `createIfAbsent` against an existing file, so it
 * shares the `exists` arm with `FS_ALREADY_EXISTS`.
 */
export declare function writeResultOf(error: unknown, mode: EditMode, absolutePath: string): WriteTextResult;
export declare function editCheck(face: EditFacility, request: EditCheckRequest): Promise<EditCheckResult>;
/**
 * Write one document behind its intent; every refusal is a typed result.
 * `writeText` stores the string it is given, unlike `editText`, so the file's
 * existing line-ending style is re-applied here before publication.
 */
export declare function writeText(face: EditFacility, request: WriteTextRequest): Promise<WriteTextResult>;
export {};
