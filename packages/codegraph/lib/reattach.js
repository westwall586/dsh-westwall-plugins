/**
 * 监听会话激活，对尚未挂载的会话补一次 `attach`。
 * @param ctx - 插件上下文。
 * @param mounts - 会话挂载面；已挂载的会话会被跳过。
 * @returns 注销函数。
 */
export function registerReattach(ctx, mounts) {
    const attempt = (sessionId) => {
        if (mounts.rootFor(sessionId) !== undefined)
            return;
        const agent = ctx.agents.get(sessionId);
        if (agent === undefined)
            return;
        void mounts.attach(agent);
    };
    const offOpened = ctx.on('session/event', (session) => { attempt(session.id); });
    return offOpened;
}
//# sourceMappingURL=reattach.js.map