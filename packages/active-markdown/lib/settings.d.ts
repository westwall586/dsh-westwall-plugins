import type { ModelSelection } from './translate/request.ts';
export declare const Config: unknown;
export interface ActiveMarkdownConfig {
    readonly model: ModelSelection | null;
    readonly lang: string;
    readonly translateComments: boolean;
}
/** 解析后的设置；缺失或损坏的字段回落到产品默认值。 */
export declare function configSnapshot(raw: unknown): ActiveMarkdownConfig;
