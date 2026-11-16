# 可交互 Markdown 使用手册

> **状态：草稿。** 尚未发布，推荐用本地目录或固定提交安装。当前只有 P0 的阅读与渲染能力。

在右侧栏预览 Markdown 时，原生预览把整篇文档当成一页文本：长文档没有块级结构，图片与链接的行为也受限。可交互 Markdown 接管正文，把标题、段落、列表、表格、代码与图片渲染成可交互的块，同时保留原生的路径、刷新、外部打开与全屏。

可验证的亮点：打开任意 `.md` 文件，预览器下拉里出现「可交互 Markdown」并默认选中；切回「Markdown」后，原生预览照常工作。

## 快速开始

1. 安装插件：

   ```sh
   dsh plugin --profile <profile> add link:/绝对路径/packages/active-markdown
   ```

2. 重启 DSH，或等待桌面版热加载完成。
3. 从右侧栏「工作区文件」打开任意 `.md` 文件。
4. 预期结果：文件在右侧栏打开，正文由可交互 Markdown 渲染；右上角「打开方式」显示「可交互 Markdown」。

## 配置

| 项 | 说明 |
|---|---|
| 无 | P0 不提供配置项。渲染器跟随 DSH 的明暗主题与字号。 |

## 日常使用

### 阅读文档

1. 在「工作区文件」里点开 `.md` 文件。
2. 标题、段落、嵌套列表、任务列表、引用、表格、代码块与图片按块渲染。
3. 点击标题里的 `#锚点` 会滚到对应章节；点击相对链接会在右侧栏打开目标文件。

### 切回原生预览

1. 点右上角「打开方式」。
2. 选择「Markdown」。
3. 预期结果：正文回到原生 Markdown 预览；再选回「可交互 Markdown」即可恢复。

### 图片与代码

- 本地图片通过宿主的文件接口读取，滚动到附近才加载；缺失图片显示 alt 文本。
- 代码块右上角有「复制」按钮；P0 不做语法高亮。

## 故障排查

| 现象 | 先查 |
|---|---|
| 打开 `.md` 仍是原生预览 | 「打开方式」里是否选了「可交互 Markdown」；插件是否已启用 |
| 显示「文档较大」 | 文件超过 2 MB；用「打开方式」切回「Markdown」查看 |
| 显示「不是可读文本」 | 文件不是 UTF-8 或含二进制内容；切回原生预览 |
| 图片不显示 | 图片路径是否相对当前文档；文件是否存在于工作区 |

## 卸载与清理

```sh
dsh plugin --profile <profile> remove @westwall/dsh-active-markdown
```

卸载并重启后，`.md` 恢复原生预览。P0 不写文件、不建存储，没有需要清理的数据。

## 相关链接

- 作者主页 [github.com/westwall586](https://github.com/westwall586)
- 插件仓库 [dsh-westwall-plugins](https://github.com/westwall586/dsh-westwall-plugins)

### 更多插件

更多插件见 [dsh-westwall-plugins](https://github.com/westwall586/dsh-westwall-plugins)。固定提交安装：

```sh
dsh plugin --profile <profile> add \
  "git+https://github.com/westwall586/dsh-westwall-plugins.git#<commit>&path:/packages/active-markdown"
```

### 维护者文档

- 定位与路线：[docs/designs/active-markdown](../../docs/designs/active-markdown/POSITIONING.md)
- P0 技术方案：[docs/designs/active-markdown/P0-TECH.md](../../docs/designs/active-markdown/P0-TECH.md)

### 许可

Apache-2.0，见仓库 [LICENSE](../../LICENSE)。
