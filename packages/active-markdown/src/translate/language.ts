/**
 * 目标语言只有三行，两个消费者：code 进 wire、缓存键与保存路径，label 只进
 * system prompt 与插件页的选项文字。扩展一种语言就是加一行，并在 Config 的
 * 枚举里加一个成员。
 */
export interface LanguageOption {
  readonly code: string
  readonly label: string
}

export const DEFAULT_LANGUAGE = 'zh'

export const LANGUAGES: readonly LanguageOption[] = Object.freeze([
  { code: 'zh', label: '简体中文' },
  { code: 'zh-Hant', label: '繁體中文' },
  { code: 'en', label: 'English' },
])

export function isLanguageCode(value: unknown): value is string {
  return typeof value === 'string' && LANGUAGES.some(option => option.code === value)
}

export function languageLabelOf(code: string): string {
  return LANGUAGES.find(option => option.code === code)?.label ?? code
}
