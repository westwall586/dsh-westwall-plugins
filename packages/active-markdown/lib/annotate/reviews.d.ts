import { type PendingReview } from './schema.ts';
import { type MirrorPath } from '../translate/store.ts';
export declare const REVIEWS_DIR = "reviews";
export declare const PENDING_DIR = "pending";
/** 快照需要的文件操作；测试用内存实现，生产用 node 实现。 */
export interface ReviewFilePort {
    read(path: string): Promise<string | null>;
    write(path: string, content: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    remove(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    mkdir(path: string): Promise<void>;
}
export declare const nodeReviewFiles: ReviewFilePort;
export interface ReviewStoreDeps {
    readonly files: ReviewFilePort;
    readonly workspaceOf: (sessionId: string) => Promise<string | null> | string | null;
    readonly now?: () => Date;
}
export interface ReviewPrepareInput {
    readonly sessionId: string;
    readonly path: string;
    readonly roundId: string;
    readonly text: string;
}
export interface ReviewPrepareView {
    readonly sourceHash: string;
    readonly snapshotWritten: boolean;
    readonly bytes: number;
}
export interface ReviewCommitInput {
    readonly sessionId: string;
    readonly path: string;
    readonly roundId: string;
    readonly pending: PendingReview | null;
    readonly sentText: string;
}
export interface ReviewCommitView {
    readonly roundId: string;
    readonly committed: boolean;
    readonly snapshotMissing: boolean;
}
export interface ReviewDetachInput {
    readonly sessionId: string;
    readonly roundId: string;
}
export interface ReviewDetachView {
    readonly detached: boolean;
}
export interface ReviewStore {
    prepare(input: ReviewPrepareInput): Promise<ReviewPrepareView>;
    commit(input: ReviewCommitInput): Promise<ReviewCommitView>;
    /** Remove one round's pending snapshot; the draft record is the caller's. */
    detach(input: ReviewDetachInput): Promise<ReviewDetachView>;
}
/** One document's mirror path, accepting the canonical absolute path annotations use. */
export declare function documentMirror(workspace: string, path: string): MirrorPath;
export declare function createReviewStore(deps: ReviewStoreDeps): ReviewStore;
