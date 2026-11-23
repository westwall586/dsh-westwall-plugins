/**
 * 监听 `session/event` 里的目录变化，并让对应会话重新挂载。
 * @param ctx - 插件上下文。
 * @param mounts - 会话挂载面；`detach` 之后 `attach` 会按新目录重新选择项目。
 * @returns 注销函数。
 */
export function registerDirectoryChanges(ctx, mounts) {
    return ctx.on('session/event', (session, event) => {
        if (event.type !== 'working-directory/change')
            return;
        const agent = ctx.agents.get(session.id);
        if (agent === undefined)
            return;
        void mounts.detach(agent).then(() => mounts.attach(agent));
    });
}
//# sourceMappingURL=reconnect.js.map