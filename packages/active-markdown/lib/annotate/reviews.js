/**
 * 审阅轮次的全文快照与元数据：加入输入框时把批注所看的原文写进
 * `reviews/pending/<roundId>.md`，发送成功后再 rename 到
 * `reviews/<镜像路径>/<roundId>.md`，并在旁边写同名 JSON。所有写入先落同目录
 * 临时文件再 rename，半截文件不会变成一轮合法的旧版。
 *
 * 清理只在 prepare/commit 时顺手做：pending 30 天，轮次按文档最近 5 轮、
 * 30 天、全局 50 MiB；每个文档最新一轮永不淘汰。
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AnnotationError, canonicalDocumentPath, requireRoundId, requireSessionId } from "./paths.js";
import { reviewRoundSchema } from "./schema.js";
import { mirrorOf, STORE_GITIGNORE, STORE_ROOT } from "../translate/store.js";
export const REVIEWS_DIR = 'reviews';
export const PENDING_DIR = 'pending';
export const REVIEW_LIMITS = {
    maxRoundsPerDocument: 5,
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    maxTotalBytes: 50 * 1024 * 1024,
};
export const PENDING_TTL_MS = REVIEW_LIMITS.maxAgeMs;
async function missing(error) {
    const code = error.code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}
export const nodeReviewFiles = {
    async read(path) {
        try {
            return await readFile(path, 'utf8');
        }
        catch (error) {
            if (await missing(error))
                return null;
            throw error;
        }
    },
    async write(path, content) {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content, 'utf8');
    },
    async rename(from, to) {
        await mkdir(dirname(to), { recursive: true });
        await rename(from, to);
    },
    async remove(path) {
        try {
            await rm(path, { force: true });
        }
        catch (error) {
            if (!(await missing(error)))
                throw error;
        }
    },
    async exists(path) {
        try {
            await stat(path);
            return true;
        }
        catch (error) {
            if (await missing(error))
                return false;
            throw error;
        }
    },
    async mkdir(path) {
        await mkdir(path, { recursive: true });
    },
    async list(path) {
        let names;
        try {
            names = await readdir(path);
        }
        catch (error) {
            if (await missing(error))
                return [];
            throw error;
        }
        const entries = [];
        for (const name of names) {
            const child = join(path, name);
            try {
                const info = await stat(child);
                entries.push({ name, path: child, directory: info.isDirectory(), size: info.size, mtimeMs: info.mtimeMs });
            }
            catch (error) {
                if (!(await missing(error)))
                    throw error;
            }
        }
        return entries;
    },
};
function rootsOf(workspace) {
    const reviews = resolve(workspace, STORE_ROOT, REVIEWS_DIR);
    return { workspace, reviews, pending: resolve(reviews, PENDING_DIR) };
}
function isInside(root, candidate) {
    const path = relative(root, candidate);
    return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}
/** One document's mirror path, accepting the canonical absolute path annotations use. */
export function documentMirror(workspace, path) {
    const absolute = resolve(path);
    const inside = relative(resolve(workspace), absolute);
    if (inside !== '' && !inside.startsWith(`..${sep}`) && inside !== '..' && !isAbsolute(inside)) {
        return mirrorOf({ path: inside.split(sep).join('/'), workspace });
    }
    return mirrorOf({ path: absolute, workspace });
}
function roundDirectory(root, mirror) {
    const directory = resolve(root.reviews, mirror.relative);
    if (!isInside(root.reviews, directory) || directory === root.reviews) {
        throw new AnnotationError('invalid-path', `轮次目录越出 reviews：${mirror.relative}`);
    }
    return directory;
}
function pendingFileOf(root, roundId) {
    return resolve(root.pending, `${roundId}.md`);
}
function normalizedSourceText(text) {
    return text.replace(/\r\n/g, '\n').replace(/\n$/, '');
}
async function sha256Of(text) {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
let tempCounter = 0;
/** Write beside the target, then rename so a reader never sees a half file. */
async function writeAtomic(files, target, content) {
    const temp = `${target}.${process.pid}.${(tempCounter += 1).toString(36)}.tmp`;
    await files.write(temp, content);
    try {
        await files.rename(temp, target);
    }
    catch (error) {
        await files.remove(temp);
        throw error;
    }
}
async function ensureGitignore(files, workspace) {
    const path = resolve(workspace, STORE_ROOT, '.gitignore');
    if (await files.exists(path))
        return;
    await files.write(path, STORE_GITIGNORE);
}
async function walk(files, directory) {
    const entries = await files.list(directory);
    const all = [];
    for (const entry of entries) {
        if (entry.directory)
            all.push(...await walk(files, entry.path));
        else
            all.push(entry);
    }
    return all;
}
function timeOf(meta, fallback) {
    const time = Date.parse(meta.createdAt);
    return Number.isFinite(time) ? time : fallback;
}
async function collectRounds(files, root) {
    const entries = await walk(files, root.reviews);
    const byStem = new Map();
    for (const entry of entries) {
        if (!entry.path.endsWith('.json'))
            continue;
        const raw = await files.read(entry.path);
        if (raw === null)
            continue;
        let value;
        try {
            value = JSON.parse(raw);
        }
        catch {
            continue;
        }
        const parsed = reviewRoundSchema.safeParse(value);
        if (!parsed.success)
            continue;
        const base = entry.path.slice(0, -'.json'.length);
        byStem.set(base, {
            metaPath: entry.path,
            markdownPath: `${base}.md`,
            meta: parsed.data,
            metaBytes: entry.size,
        });
    }
    const records = [];
    for (const item of byStem.values()) {
        const md = entries.find(entry => entry.path === item.markdownPath);
        records.push({
            metaPath: item.metaPath,
            markdownPath: item.markdownPath,
            meta: item.meta,
            bytes: item.metaBytes + (md?.size ?? 0),
            createdAt: timeOf(item.meta, 0),
        });
    }
    return records;
}
export function createReviewStore(deps) {
    const now = deps.now ?? (() => new Date());
    const limits = { ...REVIEW_LIMITS, ...deps.limits };
    const warn = deps.warn ?? ((message, error) => console.warn(message, error));
    const workspaceOf = async (sessionId) => {
        const workspace = await deps.workspaceOf(sessionId);
        if (workspace === null || workspace === '') {
            throw new AnnotationError('unknown-session', `未知会话：${sessionId}`);
        }
        return workspace;
    };
    const removeRound = async (files, record) => {
        await files.remove(record.markdownPath);
        await files.remove(record.metaPath);
    };
    const prune = async (sessionId) => {
        const workspace = await workspaceOf(sessionId);
        const root = rootsOf(workspace);
        const current = now().getTime();
        let removed = 0;
        for (const entry of await deps.files.list(root.pending)) {
            if (entry.directory)
                continue;
            if (current - entry.mtimeMs > PENDING_TTL_MS) {
                await deps.files.remove(entry.path);
                removed += 1;
            }
        }
        const records = await collectRounds(deps.files, root);
        if (records.length === 0)
            return removed;
        const sorted = [...records].sort((left, right) => right.createdAt - left.createdAt);
        const protectedRounds = new Set();
        const groups = new Map();
        for (const record of sorted) {
            const source = record.meta.sourcePath;
            const group = groups.get(source) ?? [];
            if (group.length === 0)
                protectedRounds.add(record.metaPath);
            group.push(record);
            groups.set(source, group);
        }
        const doomed = new Set();
        for (const record of sorted) {
            if (protectedRounds.has(record.metaPath))
                continue;
            if (current - record.createdAt > limits.maxAgeMs)
                doomed.add(record.metaPath);
        }
        for (const group of groups.values()) {
            for (const record of group.slice(limits.maxRoundsPerDocument)) {
                if (!protectedRounds.has(record.metaPath))
                    doomed.add(record.metaPath);
            }
        }
        let total = 0;
        for (const record of sorted) {
            if (!doomed.has(record.metaPath))
                total += record.bytes;
        }
        if (total > limits.maxTotalBytes) {
            for (let index = sorted.length - 1; index >= 0 && total > limits.maxTotalBytes; index -= 1) {
                const record = sorted[index];
                if (protectedRounds.has(record.metaPath) || doomed.has(record.metaPath))
                    continue;
                doomed.add(record.metaPath);
                total -= record.bytes;
            }
        }
        for (const record of sorted) {
            if (!doomed.has(record.metaPath))
                continue;
            await removeRound(deps.files, record);
            removed += 1;
        }
        return removed;
    };
    return {
        async prepare(input) {
            const sessionId = requireSessionId(input.sessionId);
            const documentPath = canonicalDocumentPath(input.path);
            const roundId = requireRoundId(input.roundId);
            if (typeof input.text !== 'string')
                throw new AnnotationError('invalid-request', '缺少原文');
            const workspace = await workspaceOf(sessionId);
            const root = rootsOf(workspace);
            // Validate the document mirror before writing: an unmappable path must
            // not leave a pending snapshot no commit could promote.
            documentMirror(workspace, documentPath);
            try {
                await ensureGitignore(deps.files, workspace);
                await deps.files.mkdir(root.pending);
                await writeAtomic(deps.files, pendingFileOf(root, roundId), input.text);
            }
            catch (error) {
                throw new AnnotationError('write-failed', `写入 pending 快照失败（${roundId}）：${String(error)}`);
            }
            const sourceHash = await sha256Of(normalizedSourceText(input.text));
            await prune(sessionId).catch(error => warn('[dsh-active-markdown] 清理审阅快照失败', error));
            return { sourceHash, snapshotWritten: true, bytes: Buffer.byteLength(input.text, 'utf8') };
        },
        async commit(input) {
            const sessionId = requireSessionId(input.sessionId);
            const documentPath = canonicalDocumentPath(input.path);
            const roundId = requireRoundId(input.roundId);
            const workspace = await workspaceOf(sessionId);
            const root = rootsOf(workspace);
            const mirror = documentMirror(workspace, documentPath);
            const directory = roundDirectory(root, mirror);
            const markdownPath = resolve(directory, `${roundId}.md`);
            const metaPath = resolve(directory, `${roundId}.json`);
            const pending = input.pending;
            if (pending === null || pending.roundId !== roundId) {
                // A retry after the draft was already deleted is answered by the meta file.
                const existing = await deps.files.exists(metaPath);
                return { roundId, committed: existing, snapshotMissing: false };
            }
            let snapshotMissing = false;
            try {
                await deps.files.mkdir(directory);
                const pendingPath = pendingFileOf(root, roundId);
                if (await deps.files.exists(pendingPath)) {
                    if (await deps.files.exists(markdownPath))
                        await deps.files.remove(pendingPath);
                    else
                        await deps.files.rename(pendingPath, markdownPath);
                }
                else if (!(await deps.files.exists(markdownPath))) {
                    snapshotMissing = true;
                }
            }
            catch (error) {
                throw new AnnotationError('write-failed', `转正 pending 快照失败（${roundId}）：${String(error)}`);
            }
            const meta = {
                roundId,
                sessionId,
                sourcePath: mirror.sourcePath,
                sourceHash: pending.sourceHash,
                feedback: pending.feedback,
                sentText: input.sentText,
                fileName: pending.fileName,
                annotations: pending.annotations,
                ...(snapshotMissing ? { snapshotMissing: true } : {}),
                createdAt: now().toISOString(),
            };
            const parsed = reviewRoundSchema.safeParse(meta);
            if (!parsed.success) {
                throw new AnnotationError('invalid-request', `审阅元数据不正确：${parsed.error.message}`);
            }
            try {
                await writeAtomic(deps.files, metaPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
            }
            catch (error) {
                throw new AnnotationError('write-failed', `写入审阅元数据失败（${roundId}）：${String(error)}`);
            }
            await prune(sessionId).catch(error => warn('[dsh-active-markdown] 清理审阅快照失败', error));
            return { roundId, committed: true, snapshotMissing };
        },
        async detach(input) {
            const sessionId = requireSessionId(input.sessionId);
            const roundId = requireRoundId(input.roundId);
            const workspace = await workspaceOf(sessionId);
            const root = rootsOf(workspace);
            try {
                await deps.files.remove(pendingFileOf(root, roundId));
            }
            catch (error) {
                throw new AnnotationError('write-failed', `删除 pending 快照失败（${roundId}）：${String(error)}`);
            }
            return { detached: true };
        },
        prune,
    };
}
//# sourceMappingURL=reviews.js.map