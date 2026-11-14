/** Prompt budget, default copy, and the per-agent system prompt seat. */

/** Hard cap shared by the Host schema and the settings counter. */
export const MAX_PROMPT_CHARS = 800

/** Recommended copy from the design draft. UTF-16 length is 282. */
export const DEFAULT_STYLE_PROMPT = `友好表达：
1. 紧扣问题，先给结论，再给必要依据；只讲相关信息，不复述已知内容。
2. 不确定的地方明确标注，不编造；有依据时给出依据。
3. 长内容分点，按重要性排序；语气自然直接，不堆客套。
表达形式：
4. 流程、时序、状态、关系用 mermaid 代码块（flowchart、sequenceDiagram、stateDiagram-v2、erDiagram）；禁止用 ASCII 方框和箭头画图。
5. 对比用表格，线性步骤用有序列表，文件树保留缩进。
6. 单图不超过 12 个节点；三步以内能说清的不画图。
用户明确要求其他形式时，以用户要求为准。`

/** Stable section name, registered per agent rather than globally. */
export const SECTION_NAME = 'westwall:friendly-expression'

/** Sits after first-party guidance and before deployment paths. */
export const SECTION_ORDER = 9500
