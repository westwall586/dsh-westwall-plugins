/**
 * 用户保存：把一份译文写成工作区里的镜像文件对，Markdown 给读，JSON 给机器。
 * 路径从源路径直接算出，不维护中央清单：语言是目录，正文保持源文件名，元数据
 * 在平行的 index 树里。`docs/a/README.md` + `zh` 落到
 * `.dsh-active-markdown/translate/zh/docs/a/README.md`，元数据落到
 * `.dsh-active-markdown/index/translate/zh/docs/a/README.json`。不同目录的同名
 * 文档、同一文档的不同语言因此都不会互相覆盖。工作区外的文档没有相对路径可
 * 镜像，按路径 sha1 收进 `_external/<前 8 位>/`，完整路径记在元数据里。
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { countSourceLines, extraInstructionHash, normalizeSource, sha1Hex, sha256Hex } from "./digest.js";
import { errorText, requireLanguage, requireSessionId, requireText } from "./boundary.js";
import { resolveModel, TranslateError } from "./request.js";
export const STORE_ROOT = '.dsh-active-markdown';
export const TRANSLATE_ROOT = `${STORE_ROOT}/translate`;
export const INDEX_ROOT = `${STORE_ROOT}/index`;
export const EXTERNAL_ROOT = '_external';
export const STORE_GITIGNORE = '*\n!.gitignore\n';
const translationMetaSchema = z.object({
    sourcePath: z.string().min(1),
    sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
    sourceLines: z.number().int().nonnegative(),
    lang: z.string().min(1),
    model: z.string().min(1),
    provider: z.string().min(1),
    promptVersion: z.string(),
    extraInstructionHash: z.string(),
    aligned: z.boolean(),
    savedAt: z.string(),
}).strict();
export const nodeFiles = {
    async read(path) {
        try {
            return await readFile(path, 'utf8');
        }
        catch (error) {
            const code = error.code;
            if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR')
                return null;
            throw error;
        }
    },
    async write(path, content) {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content, 'utf8');
    },
    async exists(path) {
        try {
            await stat(path);
            return true;
        }
        catch {
            return false;
        }
    },
};
function isInside(root, candidate) {
    const path = relative(root, candidate);
    return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}
function requireFileName(name) {
    if (name === '' || name === '.' || name === '..') {
        throw new TranslateError('invalid-path', `不是有效的文档文件名：${name}`);
    }
}
/**
 * 纯路径计算：源路径 → `translate/<code>/` 之下的镜像路径。`..` 与指向工作区
 * 内的绝对路径在这里拒绝，保证写盘目标永远在 `translate/` 下。
 */
export function mirrorOf(input) {
    const source = typeof input.path === 'string' ? input.path.trim() : '';
    if (source === '')
        throw new TranslateError('invalid-path', '缺少文档路径');
    const slash = source.replace(/\\/g, '/');
    if (slash.split('/').includes('..')) {
        throw new TranslateError('invalid-path', `路径不能包含 ..：${source}`);
    }
    if (isAbsolute(source)) {
        const absolute = resolve(source);
        if (isInside(resolve(input.workspace), absolute)) {
            throw new TranslateError('invalid-path', `工作区内的文档请使用会话相对路径：${source}`);
        }
        const name = basename(absolute);
        requireFileName(name);
        return { relative: `${EXTERNAL_ROOT}/${sha1Hex(absolute).slice(0, 8)}/${name}`, sourcePath: absolute };
    }
    const segments = slash.split('/').filter(segment => segment !== '' && segment !== '.');
    if (segments.length === 0)
        throw new TranslateError('invalid-path', `文档路径为空：${source}`);
    requireFileName(segments[segments.length - 1]);
    return { relative: segments.join('/'), sourcePath: segments.join('/') };
}
/** 正文镜像路径 → 平行 index 树里的元数据路径：换掉最后一个扩展名。 */
function metadataPathOf(mirrorRelative) {
    const ext = extname(mirrorRelative);
    return `${mirrorRelative.slice(0, mirrorRelative.length - ext.length)}.json`;
}
function parseMeta(raw) {
    let value;
    try {
        value = JSON.parse(raw);
    }
    catch {
        return null;
    }
    const parsed = translationMetaSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}
export function createTranslationStore(deps) {
    const now = deps.now ?? (() => new Date());
    return {
        async save(input) {
            const sessionId = requireSessionId(input.sessionId);
            const text = requireText(input.text, '原文');
            const translated = requireText(input.translated, '译文');
            const lang = requireLanguage(input.lang);
            const workspace = await deps.workspaceOf(sessionId);
            if (workspace === null)
                throw new TranslateError('unknown-session', `未知会话：${sessionId}`);
            const selection = resolveModel({
                ...(input.provider === undefined ? {} : { provider: input.provider }),
                ...(input.model === undefined ? {} : { model: input.model }),
                readDefault: deps.readDefault,
            });
            const mirror = mirrorOf({ path: input.path, workspace });
            const meta = {
                sourcePath: mirror.sourcePath,
                sourceHash: sha256Hex(normalizeSource(text)),
                sourceLines: countSourceLines(text),
                lang,
                model: selection.model,
                provider: selection.provider,
                promptVersion: typeof input.promptVersion === 'string' ? input.promptVersion : '',
                extraInstructionHash: extraInstructionHash(input.extraInstruction),
                aligned: input.aligned === true,
                savedAt: now().toISOString(),
            };
            const translateRoot = resolve(workspace, TRANSLATE_ROOT, lang);
            const indexRoot = resolve(workspace, INDEX_ROOT, 'translate', lang);
            const markdownPath = resolve(translateRoot, mirror.relative);
            const metadataPath = resolve(indexRoot, metadataPathOf(mirror.relative));
            if (!isInside(translateRoot, markdownPath) || !isInside(indexRoot, metadataPath)) {
                throw new TranslateError('invalid-path', `镜像路径越出保存目录：${mirror.relative}`);
            }
            try {
                const gitignorePath = resolve(workspace, STORE_ROOT, '.gitignore');
                if (!(await deps.files.exists(gitignorePath))) {
                    await deps.files.write(gitignorePath, STORE_GITIGNORE);
                }
                await deps.files.write(markdownPath, translated);
                await deps.files.write(metadataPath, `${JSON.stringify(meta, null, 2)}\n`);
            }
            catch (error) {
                throw new TranslateError('write-failed', `保存译文失败（${mirror.relative}）：${errorText(error)}`);
            }
            return { file: `${TRANSLATE_ROOT}/${lang}/${mirror.relative}`, meta };
        },
        async load(input) {
            const sessionId = requireSessionId(input.sessionId);
            const lang = requireLanguage(input.lang);
            const workspace = await deps.workspaceOf(sessionId);
            if (workspace === null)
                throw new TranslateError('unknown-session', `未知会话：${sessionId}`);
            const mirror = mirrorOf({ path: input.path, workspace });
            const translateRoot = resolve(workspace, TRANSLATE_ROOT, lang);
            const indexRoot = resolve(workspace, INDEX_ROOT, 'translate', lang);
            const markdownPath = resolve(translateRoot, mirror.relative);
            const metadataPath = resolve(indexRoot, metadataPathOf(mirror.relative));
            try {
                const [text, rawMeta] = await Promise.all([deps.files.read(markdownPath), deps.files.read(metadataPath)]);
                if (text === null || rawMeta === null)
                    return null;
                const meta = parseMeta(rawMeta);
                if (meta === null)
                    return null;
                // The requested path, not the JSON, decides which source is current:
                // metadata is a record, never an instruction.
                const current = await deps.files.read(resolve(workspace, mirror.sourcePath));
                const stale = current === null || sha256Hex(normalizeSource(current)) !== meta.sourceHash;
                return { text, meta, stale };
            }
            catch (error) {
                throw new TranslateError('read-failed', `读取已保存译文失败（${mirror.relative}）：${errorText(error)}`);
            }
        },
    };
}
//# sourceMappingURL=store.js.map