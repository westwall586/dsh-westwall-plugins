export const name = 'hello';
/** 依赖的宿主服务名；不需要任何服务时就是空数组。 */
export const inject = [];
export function apply(_ctx, config) {
    if (config?.announce === false)
        return;
    console.log('[dsh-hello] mounted');
}
//# sourceMappingURL=index.js.map