# 发布流程

只在**决定发布**某个插件时使用。日常开发用本地 `link:`，分享用 GitHub 固定 commit，
两者都不需要发布。

## 原则

- 一个 tag 只发布一个包：`dsh-<name>@<version>`。
- npm 上已发布的 `包名@版本` 永久占用，不能复用。
- 发布前必须过一遍 CI 与产物核对；发布是不可撤销动作。

## 前置条件

1. CI 通过（`.github/workflows/ci.yml`）。
2. 发布凭据可用：优先 **trusted publishing（OIDC）**；未配置时用人工 2FA（`pnpm publish` 会提示验证码）。
3. 目标 DSH 版本满足该包声明的 `engines.dsh` / `peerDependencies`。
4. 目标包不能是 `private: true`，否则 `npm publish` 直接拒绝；未打磨到位的包保持 private（`jira-worklogs` 当前如此）。
5. 发布顺序：被随附的包先发，组合 bundle 后发。`web-clipper` 必须在 `feed-ultra` 之前发布；
   组合的依赖按 npm 版本解析，被随附包缺失时安装会失败。

## 一次性配置（开启自动发布）

只在第一次配置或更换仓库时做一次。

1. **npm 上给每个要发布的包配 trusted publisher**：
   - 打开 `https://www.npmjs.com/package/@westwall/dsh-<name>/access`
   - Trusted publisher → GitHub Actions
   - Repository：`westwall586/dsh-westwall-plugins`
   - Workflow：`release.yml`
   - Environment：留空（除非使用了 GitHub Environment）
2. **仓库里打开发布开关**：
   - Settings → Secrets and variables → Actions → Variables → New variable
   - Name `PUBLISH_ENABLED`，Value `true`
   - 不设或设成其他值：release workflow 只校验、不发布。
3. 之后发布 = 打 tag 并推送（见下）。

> 首次发布一个尚不存在的包时，也可以先手动
> `pnpm --filter @westwall/dsh-<name> publish --access public`（会提示 2FA 验证码），
> 发布成功后在 npm 包页面配上 trusted publisher，后续再走自动发布。
> npm 正在收紧 bypass-2FA token 的直接发布权限，优先用 trusted publishing。

## 步骤

```sh
# 0. 干净起点
git switch main && git pull --ff-only

# 1. bump 版本（只改这个包）
npm version patch --no-git-tag-version -w @westwall/dsh-<name>

# 2. 聚合清单钉新版本
pnpm aggregate

# 3. 同步 lockfile
pnpm install --lockfile-only

# 4. 构建并核对产物
pnpm -r build
npm pack --dry-run -w @westwall/dsh-<name>

# 5. 自检
pnpm aggregate:check
node scripts/release.mjs --tag dsh-<name>@<version>

# 6. 提交并打 tag
git add -A
git commit -m "chore(release): dsh-<name>@<version>"
git tag dsh-<name>@<version>
git push origin main
git push origin dsh-<name>@<version>
```

推 tag 后由 `.github/workflows/release.yml` 校验并发布（需仓库变量 `PUBLISH_ENABLED=true`；
未开启时 workflow 只做校验，不发布）。

## 发布后验证

```sh
# registry 上真的可见（首次发布可能有 1–2 分钟延迟）
npm view @westwall/dsh-<name>@<version> version --registry=https://registry.npmjs.org/

# 装一遍冒烟：自动备份/恢复验证用 profile
node scripts/smoke-install.mjs @westwall/dsh-<name>@<version>
```

首次发布一个新包时，registry 上可能先出现 `0.0.0-stage` 占位（stub），真实版本随后出现；
**不要因为看不到就重复发布同一个版本**。

## 出问题时

- 版本已占用但内容有问题：发新的 `patch` 版本修复，必要时 `npm deprecate` 旧版本。
- 不想让人安装某个版本：`npm deprecate @westwall/dsh-<name>@<version> "reason"`。
- 撤销发布（72 小时内且无依赖者时才可能）：`npm unpublish @westwall/dsh-<name>@<version>`。

## 不需要发布的情况

- 插件还没打磨到位 → 本地 `link:` 或 GitHub commit 分发。
- 只改文档、测试、CI。
