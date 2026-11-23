/**
 * `codegraph_status`：模型唯一能碰的 CodeGraph 入口，且只读。
 *
 * 开启与关闭会写 `.codegraph/`、改工作区开关，所以只给用户界面。模型能问
 * "当前工作区的 CodeGraph 是什么状态"，但改不了它。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CodegraphStore } from './state.ts';
import type { SessionMounts } from './sessions.ts';
export declare function registerTools(ctx: Context, store: CodegraphStore, mounts: SessionMounts): void;
