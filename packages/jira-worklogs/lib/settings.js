// 插件配置（rc.1 Config 迁移）：插件 Config schema 与取值映射。
// schema 即主服务的 static Config：顶层子对象 volatile → 设置界面在线编辑、
// 活 fiber 内经 .get() 活读取；值落 profile 补丁（SettingsForms 读写），
// role('secret') 字段读取脱敏；引擎消费走 engineConfigFrom（每调用快照）。
import z from '@deepseek-ai/schemastery';
import { envJiraOverrides } from './engine/env.js';
/** 设置写回用的命名空间（rc.1：ns = profile 补丁行 entry id）。 */
export const SETTINGS_NS = 'dsh-jira-worklogs';
/** Git 实例：名称 → 连接配置（GitLab API；url+token 成对才生效）。
 * 用 dict 而非 array：mutate 路径写（['gitInstances', 名, 字段]）可保全
 * 其他实例的密钥——数组整组覆写会丢失读不回的 secret。
 * secret 字段不带 .default('')：默认空串会进解析值，使 describe 的
 * secrets[].set（键出现即真）无法区分「从未保存」。 */
export const gitInstanceSchema = z.object({
    url: z.string().default(''),
    token: z.string().role('secret'),
    verifySsl: z.boolean().default(false),
});
/** 插件全部配置。顶层子对象 volatile：整棵子树可在线编辑（不重挂载）。
 * project 子树已随专用项目机制移除（2026-09-24 Wave，SPEC D12/D15）。 */
export const settingsSchema = z.object({
    jira: z.object({
        server: z.string().default(''),
        username: z.string().default(''),
        password: z.string().role('secret'),
        verifySsl: z.boolean().default(false),
    }).volatile(),
    gitInstances: z.dict(gitInstanceSchema).default({}).volatile(),
    repoFilter: z.array(z.string()).default([]).volatile(),
});
/** volatile 引用（带 .get() 的包装对象）→ 当前值；普通值原样返回。 */
function derefVolatile(value) {
    if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
        return value.get();
    }
    return value;
}
/** 以 schema 解析任意输入（undefined/局部值 → 带默认的完整值）。
 * 输入先 structuredClone：冻结值会被 schemastery 的 resolve 原地赋值（T04 实测）。
 * volatile 标注使 resolve 输出的顶层字段为引用对象——解引用必须在输出侧
 * （喂入侧解引用会被再次包裹；审计 F-A，本机 schemastery 3.18.4 实测）。 */
export function schemaValue(input) {
    const resolved = settingsSchema(structuredClone(input));
    return Object.fromEntries(Object.entries(resolved).map(([key, value]) => [key, derefVolatile(value)]));
}
/** JIRA_* 进程环境变量覆盖（调试后门，优先级最高；helper 归属 env.ts——findings D13/m2）。 */
function applyEnvOverrides(value) {
    const overrides = envJiraOverrides();
    return {
        ...value,
        jira: {
            ...value.jira,
            ...(overrides.server !== undefined ? { server: overrides.server } : {}),
            ...(overrides.username !== undefined ? { username: overrides.username } : {}),
            ...(overrides.password !== undefined ? { password: overrides.password } : {}),
            ...(overrides.verifySsl !== undefined ? { verifySsl: overrides.verifySsl } : {}),
        },
    };
}
/** settings 值 → 引擎配置：dict 实例 url+token 成对才收录（与现状成对语义一致），server 尾斜杠归一。 */
export function engineConfigFrom(input) {
    const value = applyEnvOverrides(schemaValue(input));
    const gitlab = [];
    for (const row of Object.values(value.gitInstances ?? {})) {
        const url = String(row?.url ?? '').replace(/\/+$/, '');
        const token = String(row?.token ?? '');
        if (url && token)
            gitlab.push({ url, token, verifySsl: !!row?.verifySsl });
    }
    return {
        jira: {
            server: value.jira.server.replace(/\/+$/, ''),
            username: value.jira.username,
            password: String(value.jira.password ?? ''),
            verifySsl: !!value.jira.verifySsl,
        },
        gitlab,
        repoFilter: value.repoFilter,
    };
}
// ---- config 持有（模块级单例：主服务行同进程同模块实例共享）----
let boundConfig;
/** 主服务构造器绑定 fiber config（volatile 字段为带 .get() 的引用对象）。
 * fiber 重载会重新构造并重绑；卸载后的旧绑定随模块实例一起消亡。 */
export function bindPluginConfig(config) {
    boundConfig = config;
}
/** 当前配置快照（plain SettingsValue）。每调用重读 volatile 引用——热生效（F17）；
 * 输入侧先解引用使 structuredClone 安全（引用对象不可克隆）。 */
export function pluginConfigSnapshot() {
    const raw = boundConfig ?? {};
    return schemaValue(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, derefVolatile(value)])));
}
export function requireEngineConfig() {
    if (boundConfig === undefined) {
        throw new Error('缺少 Jira 配置：插件设置不可用，请在插件页 Jira 工时记录 详情页完成配置');
    }
    return engineConfigFrom(pluginConfigSnapshot());
}
//# sourceMappingURL=settings.js.map