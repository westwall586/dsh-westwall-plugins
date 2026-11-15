/** Prompt budget, default copy, hidden prefix, and the per-agent system prompt seat. */
/** Hard cap shared by the Host schema and the settings counter. It measures the editable body, not the registered section. */
export declare const MAX_PROMPT_CHARS = 800;
/**
 * Fixed English lead-in prepended at capture. Settings never see it: the
 * textarea, the counter, and 恢复默认 all deal in the body alone. Capture
 * freezes prefix and body together, so changing this text cannot alter a
 * session that already has a snapshot.
 */
export declare const SECTION_PREFIX = "When talking with the user, follow these principles:";
/** Recommended copy. UTF-16 length is 164. */
export declare const DEFAULT_STYLE_PROMPT = "\u7D27\u6263\u95EE\u9898\uFF0C\u5148\u7ED9\u7ED3\u8BBA\uFF0C\u518D\u7ED9\u5FC5\u8981\u4F9D\u636E\u3002\u4E0D\u786E\u5B9A\u7684\u5730\u65B9\u660E\u786E\u6807\u6CE8\uFF0C\u4E0D\u7F16\u9020\u3002\u53EA\u8BB2\u76F8\u5173\u4FE1\u606F\uFF0C\u4E0D\u590D\u8FF0\u5DF2\u77E5\u5185\u5BB9\u3002\u957F\u5185\u5BB9\u5206\u70B9\uFF0C\u6309\u91CD\u8981\u6027\u6392\u5E8F\uFF1B\u8BED\u6C14\u81EA\u7136\u76F4\u63A5\uFF0C\u4E0D\u5806\u5BA2\u5957\u3002\u7981\u6B62\u4F7F\u7528 ASCII \u65B9\u6846\u548C\u7BAD\u5934\u753B\u56FE\uFF1B\u9ED8\u8BA4\u7528 Mermaid 11.x\u8868\u8FBE\uFF0C\u7B80\u5355\u5185\u5BB9\u4E0D\u5F3A\u884C\u753B\u56FE\u3002\u5BF9\u6BD4\u7528\u8868\u683C\uFF0C\u7EBF\u6027\u6B65\u9AA4\u7528\u6709\u5E8F\u5217\u8868\uFF0C\u6587\u4EF6\u6811\u4FDD\u7559\u7F29\u8FDB\u3002\u7528\u6237\u660E\u786E\u8981\u6C42\u5176\u4ED6\u5F62\u5F0F\u65F6\uFF0C\u4EE5\u7528\u6237\u8981\u6C42\u4E3A\u51C6\u3002";
/** Longest stored section: the prefix, one newline, and a maximum-length body. */
export declare const MAX_SECTION_CHARS: number;
/** Compose the text registered for a session. An empty body means no section at all. */
export declare function renderSection(prompt: string): string;
/** Stable section name, registered per agent rather than globally. */
export declare const SECTION_NAME = "westwall:friendly-expression";
/** Sits after first-party guidance and before deployment paths. */
export declare const SECTION_ORDER = 9500;
