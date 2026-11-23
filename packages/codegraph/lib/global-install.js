/**
 * 同名全局安装探测。
 *
 * CodeGraph 自己的安装器会往 `$DSH_HOME/cordis.patch.yml`（以及各 profile 的同名
 * 文件）写一行 `serverName: codegraph` 的 mcp-client。同一台机器上同时存在全局行和
 * 本插件的会话行时，工具名与系统提示里的说明都会出现两份，用户无法判断哪份在生效。
 * 这里只负责发现它，怎么处理交给界面。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
/** `serverName: codegraph`，允许引号与行内 `{}` 写法。 */
const NAMES_CODEGRAPH = /(^|[\s{,])["']?serverName["']?\s*:\s*["']?codegraph["']?\s*([,}#]|$)/m;
function dshHome() {
    const override = process.env.DSH_HOME;
    return override !== undefined && override.trim() !== '' ? override : join(homedir(), '.dsh');
}
/** 会被检查的 patch 文件：home 级一份，每个 profile 一份。 */
export function patchCandidates(home = dshHome()) {
    const files = [join(home, 'cordis.patch.yml')];
    let profiles = [];
    try {
        profiles = readdirSync(join(home, 'profiles'));
    }
    catch {
        profiles = [];
    }
    for (const name of profiles)
        files.push(join(home, 'profiles', name, 'cordis.patch.yml'));
    return files.filter(file => existsSync(file));
}
/**
 * 找第一个含 CodeGraph 服务行的 patch。
 * @param ctx - 未使用；保留参数形状让单测能替换环境。
 * @returns 命中的文件，或 undefined。
 */
export async function detectGlobalInstall(_ctx) {
    for (const file of patchCandidates()) {
        let text;
        try {
            text = readFileSync(file, 'utf8');
        }
        catch {
            continue;
        }
        if (NAMES_CODEGRAPH.test(text))
            return { file };
    }
    return undefined;
}
//# sourceMappingURL=global-install.js.map