/**
 * 目标语言只有三行，两个消费者：code 进 wire、缓存键与保存路径，label 只进
 * system prompt 与插件页的选项文字。扩展一种语言就是加一行，并在 Config 的
 * 枚举里加一个成员。
 */
export interface LanguageOption {
    readonly code: string;
    readonly label: string;
}
export declare const DEFAULT_LANGUAGE = "zh";
export declare const LANGUAGES: readonly LanguageOption[];
export declare function isLanguageCode(value: unknown): value is string;
export declare function languageLabelOf(code: string): string;
