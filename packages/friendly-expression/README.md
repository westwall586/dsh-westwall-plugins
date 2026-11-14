# 友好表达 使用手册

> **状态：设计阶段。** 尚未实现，安装后不会改变任何行为。设计与实现顺序见 [设计文档](docs/DESIGN.md) 与 [迭代路线](docs/ROADMAP.md)。

Agent 的回复常常信息堆砌、结构松散；需要解释流程或关系时，又容易甩出一张用方框和箭头拼的 ASCII 图。友好表达把这件事拆成两层：用一段可编辑的提示词约束「怎么说」，用 Mermaid 渲染解决「怎么呈现」。

## 快速开始

当前版本只有包骨架，没有可用的运行时行为。开发调试可以先装进 profile：

```sh
dsh plugin --profile <profile> add link:/绝对路径/packages/friendly-expression
```

启用后插件行会出现在「插件」页；v0.1 起才会有配置项与 Mermaid 渲染。

## 配置

规划中的配置（v0.1）：

| 项 | 说明 |
|---|---|
| 表达提示词 | 最长 800 字符，默认给出一段推荐文案；可修改，可恢复默认 |
| 启用 | 关闭后不注入提示词；Mermaid 代码块按普通代码块显示 |

配置入口在「插件」页的本插件详情，不在 DSH 的通用设置页。

## 日常使用

规划中的行为（v0.1）：

1. 打开「插件」页，在本插件详情里按需修改表达提示词。
2. 新会话中，Agent 按提示词组织回复；结构、流程、状态、关系用 Mermaid 表达。
3. Mermaid 代码块在消息里渲染成图；点击图可以弹窗放大、滚动、缩放；解析失败时回退为源码块。

CLI / headless profile 不注入这段提示词：终端里没有渲染面，Mermaid 源码会比 ASCII 更难读。

## 故障排查

| 现象 | 先查 |
|---|---|
| 回复里出现 Mermaid 源码块 | 当前 profile 是否走 Web/桌面渲染面；插件是否启用 |
| 图渲染失败 | 看块内源码和错误提示；Mermaid 语法错误会回退为代码块 |

## 卸载与清理

```sh
dsh plugin --profile <profile> remove @westwall/dsh-friendly-expression
```

卸载后提示词不再注入，Mermaid 代码块恢复为普通代码块；不保留额外数据。

## 相关链接

- 插件仓库 [dsh-westwall-plugins](https://github.com/westwall586/dsh-westwall-plugins)
- 设计文档 [docs/DESIGN.md](docs/DESIGN.md)
- 迭代路线 [docs/ROADMAP.md](docs/ROADMAP.md)

### 维护者文档

- [设计文档](docs/DESIGN.md)：定位、注入机制、默认提示词、验收标准
- [迭代路线](docs/ROADMAP.md)：v0 到 skill 的拆分与不采用的方向

### 许可

Apache-2.0，见仓库根 [LICENSE](../../LICENSE)。