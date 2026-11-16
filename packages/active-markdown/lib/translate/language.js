export const DEFAULT_LANGUAGE = 'zh';
export const LANGUAGES = Object.freeze([
    { code: 'zh', label: '简体中文' },
    { code: 'zh-Hant', label: '繁體中文' },
    { code: 'en', label: 'English' },
]);
export function isLanguageCode(value) {
    return typeof value === 'string' && LANGUAGES.some(option => option.code === value);
}
export function languageLabelOf(code) {
    return LANGUAGES.find(option => option.code === code)?.label ?? code;
}
//# sourceMappingURL=language.js.map