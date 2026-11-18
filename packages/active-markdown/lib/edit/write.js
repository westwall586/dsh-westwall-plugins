/**
 * The guarded write channel for the preview's source editor. The Host owns the
 * session's sandbox policy and version token; the client only picks an intent.
 * Every refusal is a return value, because a thrown error would reach the wire
 * as a Remote code the client cannot branch on.
 */
import { Buffer } from 'node:buffer';
/** The largest document the source editor accepts, client and Host alike. */
export const MAX_EDIT_BYTES = 1024 * 1024;
function unsupported(reason) {
    return { status: 'unsupported', reason };
}
function errorCodeOf(error) {
    if (error === null || typeof error !== 'object')
        return undefined;
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
}
/**
 * Map the client intent onto the filesystem guard. `overwrite` maps to an
 * absent intent, which is the provider's unconditional write.
 */
export function writeIntentOf(intent) {
    switch (intent.kind) {
        case 'replace':
            return { kind: 'replaceIfVersion', version: intent.version };
        case 'create':
            return { kind: 'createIfAbsent' };
        case 'overwrite':
            return undefined;
        default:
            throw new Error(`unknown write intent: ${String(intent.kind)}`);
    }
}
/**
 * Map one provider failure onto the wire contract. `FS_NOT_OBSERVED` is the
 * local backend's answer to `createIfAbsent` against an existing file, so it
 * shares the `exists` arm with `FS_ALREADY_EXISTS`.
 */
export function writeResultOf(error, mode, absolutePath) {
    switch (errorCodeOf(error)) {
        case 'FS_STALE_VERSION':
            return { status: 'stale' };
        case 'FS_ALREADY_EXISTS':
        case 'FS_NOT_OBSERVED':
            return { status: 'exists', absolutePath };
        case 'FS_SANDBOX_DENIED':
            return { status: 'denied', mode };
        default:
            return unsupported('fs');
    }
}
function policyOf(face, session) {
    try {
        return face.sandbox.resolve({ session });
    }
    catch {
        return null;
    }
}
/** Keep a CRLF file CRLF: the editor always hands over LF text. */
async function withExistingEol(face, target, text) {
    if (!text.includes('\n'))
        return text;
    try {
        const before = await face.fs.readText(target);
        if (!before.includes('\r\n'))
            return text;
        return text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    }
    catch {
        return text;
    }
}
/**
 * Answer whether the session may edit this file, without writing anything.
 * The version returned here is the token a later guarded save must send back.
 */
export async function editCheck(face, request) {
    const session = face.sessions.get(request.sessionId);
    if (session === undefined)
        return unsupported('session');
    const policy = policyOf(face, session);
    if (policy === null)
        return unsupported('fs');
    if (policy.mode === 'read-only')
        return { status: 'read-only', mode: 'read-only' };
    try {
        const root = policy.workspaceRoot;
        const rootTarget = await face.fs.resolve(root);
        const target = await face.fs.resolve(request.path, { cwd: root });
        if (!face.fs.contains(rootTarget, target))
            return { status: 'outside' };
        const entry = await face.fs.lstat(request.path, { cwd: root });
        if (entry === undefined)
            return unsupported('not-file');
        if (entry.type === 'symlink')
            return unsupported('symlink');
        if (entry.type !== 'file')
            return unsupported('not-file');
        const info = await face.fs.stat(target);
        if (info === undefined || info.type !== 'file')
            return unsupported('not-file');
        if ((info.size ?? request.bytes) > MAX_EDIT_BYTES)
            return { status: 'too-large', limit: MAX_EDIT_BYTES };
        return { status: 'ok', absolutePath: target.displayPath, version: info.version };
    }
    catch {
        return unsupported('fs');
    }
}
/**
 * Write one document behind its intent; every refusal is a typed result.
 * `writeText` stores the string it is given, unlike `editText`, so the file's
 * existing line-ending style is re-applied here before publication.
 */
export async function writeText(face, request) {
    const session = face.sessions.get(request.sessionId);
    if (session === undefined)
        return unsupported('session');
    const policy = policyOf(face, session);
    if (policy === null)
        return unsupported('fs');
    if (policy.mode === 'read-only')
        return { status: 'denied', mode: policy.mode };
    if (Buffer.byteLength(request.text, 'utf8') > MAX_EDIT_BYTES) {
        return { status: 'too-large', limit: MAX_EDIT_BYTES };
    }
    let displayPath = request.path;
    try {
        const expected = writeIntentOf(request.intent);
        const root = policy.workspaceRoot;
        const rootTarget = await face.fs.resolve(root);
        const target = await face.fs.resolve(request.path, { cwd: root });
        displayPath = target.displayPath;
        if (!face.fs.contains(rootTarget, target))
            return { status: 'denied', mode: policy.mode };
        const entry = await face.fs.lstat(request.path, { cwd: root });
        if (entry?.type === 'symlink')
            return unsupported('symlink');
        if (entry !== undefined && entry.type !== 'file')
            return unsupported('not-file');
        // A save-as has no file yet; every other intent writes a file that was read.
        if (entry === undefined && request.intent.kind !== 'create')
            return unsupported('not-file');
        const content = entry === undefined ? request.text : await withExistingEol(face, target, request.text);
        const outcome = await face.fs.writeText(target, content, expected, undefined, policy);
        return {
            status: 'saved',
            absolutePath: target.displayPath,
            version: outcome.version,
            bytes: Buffer.byteLength(outcome.after, 'utf8'),
        };
    }
    catch (error) {
        return writeResultOf(error, policy.mode, displayPath);
    }
}
//# sourceMappingURL=write.js.map