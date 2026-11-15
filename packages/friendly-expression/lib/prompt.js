/** Prompt budget, default copy, hidden prefix, and the per-agent system prompt seat. */
/** Hard cap shared by the Host schema and the settings counter. It measures the editable body, not the registered section. */
export const MAX_PROMPT_CHARS = 800;
/**
 * Fixed English lead-in prepended at capture. Settings never see it: the
 * textarea, the counter, and 恢复默认 all deal in the body alone. Capture
 * freezes prefix and body together, so changing this text cannot alter a
 * session that already has a snapshot.
 */
export const SECTION_PREFIX = 'When talking with the user, follow these principles:';
/** Recommended copy. UTF-16 length is 164. */
export const DEFAULT_STYLE_PROMPT = `紧扣问题，先给结论，再给必要依据。不确定的地方明确标注，不编造。只讲相关信息，不复述已知内容。长内容分点，按重要性排序；语气自然直接，不堆客套。禁止使用 ASCII 方框和箭头画图；默认用 Mermaid 11.x表达，简单内容不强行画图。对比用表格，线性步骤用有序列表，文件树保留缩进。用户明确要求其他形式时，以用户要求为准。`;
/** Longest stored section: the prefix, one newline, and a maximum-length body. */
export const MAX_SECTION_CHARS = SECTION_PREFIX.length + 1 + MAX_PROMPT_CHARS;
/** Compose the text registered for a session. An empty body means no section at all. */
export function renderSection(prompt) {
    return prompt.length === 0 ? '' : `${SECTION_PREFIX}\n${prompt}`;
}
/** Stable section name, registered per agent rather than globally. */
export const SECTION_NAME = 'westwall:friendly-expression';
/** Sits after first-party guidance and before deployment paths. */
export const SECTION_ORDER = 9500;
//# sourceMappingURL=prompt.js.map