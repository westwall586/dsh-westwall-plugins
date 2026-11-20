import { type ModelSelection } from './request.ts';
export declare const STORE_ROOT = ".dsh-active-markdown";
export declare const TRANSLATE_ROOT = ".dsh-active-markdown/translate";
export declare const INDEX_ROOT = ".dsh-active-markdown/index";
export declare const EXTERNAL_ROOT = "_external";
export declare const STORE_GITIGNORE = "*\n!.gitignore\n";
export interface TranslationMeta {
    readonly sourcePath: string;
    readonly sourceHash: string;
    readonly sourceLines: number;
    readonly lang: string;
    readonly model: string;
    readonly provider: string;
    readonly promptVersion: string;
    readonly extraInstructionHash: string;
    readonly aligned: boolean;
    readonly savedAt: string;
}
export interface TranslationSaveInput {
    readonly sessionId: string;
    readonly path: string;
    readonly text: string;
    readonly translated: string;
    readonly lang: string;
    readonly provider?: string;
    readonly model?: string;
    readonly promptVersion: string;
    readonly extraInstruction?: string;
    readonly aligned: boolean;
}
export interface TranslationSaveView {
    /** 相对工作区、以 `/` 分隔的 Markdown 镜像路径。 */
    readonly file: string;
    readonly meta: TranslationMeta;
}
export interface TranslationLoadInput {
    readonly sessionId: string;
    readonly path: string;
    readonly lang: string;
}
export interface TranslationLoadView {
    readonly text: string;
    readonly meta: TranslationMeta;
    readonly stale: boolean;
    /** 相对工作区的正文镜像路径，与 save 返回的 `file` 同形，用来在界面上指认文件。 */
    readonly file: string;
}
/** 读写工作区的一层薄端口；测试用同一个端口指向临时目录。 */
export interface FilePort {
    read(path: string): Promise<string | null>;
    write(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
}
export declare const nodeFiles: FilePort;
export interface StoreDeps {
    readonly files: FilePort;
    readonly workspaceOf: (sessionId: string) => Promise<string | null> | string | null;
    readonly readDefault: () => ModelSelection | null;
    readonly now?: () => Date;
}
export interface TranslationStore {
    save(input: TranslationSaveInput): Promise<TranslationSaveView>;
    load(input: TranslationLoadInput): Promise<TranslationLoadView | null>;
}
export interface MirrorPath {
    /** 相对 `translate/<code>/`、以 `/` 分隔的目标路径；文件名与源文件一致。 */
    readonly relative: string;
    /** 元数据里的源路径：工作区内是相对路径，工作区外是绝对路径。 */
    readonly sourcePath: string;
}
/**
 * 纯路径计算：源路径 → `translate/<code>/` 之下的镜像路径。`..` 一律拒绝；
 * 工作区内的绝对路径先归一成相对路径，再按同一套目录镜像。这样从侧栏打开
 * 和从文档内链接打开同一份文件，译文落在同一个位置。写盘目标永远在
 * `translate/` 下。
 */
export declare function mirrorOf(input: {
    readonly path: string;
    readonly workspace: string;
}): MirrorPath;
export declare function createTranslationStore(deps: StoreDeps): TranslationStore;
