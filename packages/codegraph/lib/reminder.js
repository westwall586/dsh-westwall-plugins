/** 与 CodeGraph 安装器写进 CLAUDE.md / AGENTS.md 的那段一致（CodeGraph #704）。 */
export const REMINDER_BLOCK = `<system-reminder>
## CodeGraph

In repositories indexed by CodeGraph (a \`.codegraph/\` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): \`codegraph_explore\` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): \`codegraph explore "<symbol names or question>"\` prints the same output.

If there is no \`.codegraph/\` directory, skip CodeGraph entirely — indexing is the user's decision.
</system-reminder>`;
/** 本插件在系统提示里的段落名，便于别的插件或测试定位它。 */
export const SECTION_NAME = 'codegraph:reminder';
export function registerReminder(ctx, deps, store) {
    if (!deps.config.reminder)
        return;
    ctx.on('system-prompt/assemble', async (assembly, { agent }, next) => {
        const result = await next();
        if (agent === undefined)
            return result;
        const directory = ctx.workingDirectory.get(agent.session);
        if (entryFor(store, directory) === undefined)
            return result;
        if (result.sections.some(section => section.name === SECTION_NAME))
            return result;
        return { ...result, sections: [...result.sections, { name: SECTION_NAME, text: REMINDER_BLOCK }] };
    });
}
/** 从会话目录向上找最近的已开启工作区；说明只在真正打开过的项目里出现。 */
function entryFor(store, directory) {
    let cursor = directory;
    while (true) {
        const record = store.get(cursor);
        if (record !== undefined && record.enabled)
            return record;
        const parent = cursor.slice(0, Math.max(cursor.lastIndexOf('/'), 1));
        if (parent === cursor)
            return undefined;
        cursor = parent;
    }
}
//# sourceMappingURL=reminder.js.map