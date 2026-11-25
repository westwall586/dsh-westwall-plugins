# Active Markdown 组件规范

> 面向要新增或修改 Markdown 组件的人。当前组件是表格、代码块、callout、Mermaid、
> Markmap、公式；这份规范定义的是**下一个**组件该遵守什么，而不是只描述现状。

## 1. 组件只有一个挂载点

组件是 `client/src/markdown/model.ts` 的 `COMPONENT_REGISTRY` 里的一条记录，外形、头部、
展开面板、批注都由 `markdown/component-frame.tsx` 提供。新增组件**不写新的外壳**，只做两件事：

1. 在 `ComponentKind` 加一个 kind，并在 `COMPONENT_REGISTRY` 补一条记录；
2. 渲染函数返回 body，包进 `ComponentFrame` 的 `children`。

`COMPONENT_REGISTRY` 的类型是 `Record<ComponentKind, ComponentDefinition>`，所以加了 kind
却不补记录会编译失败；`ComponentDefinition` 的每个字段都是必填，所以也漏不掉下面这两项。

## 2. 两条必填的声明

| 字段 | 回答的问题 | 已有的取值 |
|---|---|---|
| `capabilities` | 用户能用它做什么 | 全屏、点击放大、缩放、平移、换行、复制、批注 |
| `measure` | 它在宽的侧栏里占多宽 | `prose` · `wide` · `graphic` |

### `capabilities`

按需开。开了 `zoom` / `pan` 就要有能响应的 body；开了 `fullscreen` 才有展开面板；
`clickToExpand` 只对“点开才看得清”的图成立，文本型组件不要开——点一下就把阅读打断。
`copy` 只在有可复制的纯文本时开。

### `measure`：宽度档位

这是本轮定下的核心规则。**组件按“内容该怎么读”分档，不按“内容有多宽”分档**：

| 档位 | 定义 | 当前组件 | 上限 |
|---|---|---|---|
| `prose` | 读起来像一段话，参与正文的行宽 | callout | `66em` |
| `wide` | 宽度就是信息，压窄要横向滚动或把单元格挤成一字一行 | 表格、代码块、公式 | 铺满，不设上限 |
| `graphic` | 是一张图，要能一眼看出结构 | Mermaid、Markmap | `96em` |

判据按顺序问，第一个“是”就是答案：

1. 它本质是一段可以用文字读下来的话吗（包括套了个框的话）→ `prose`。
   这一档保证它和上下文的正文左右对齐，不会在宽栏里缩成一小块。
2. 它需要整行气力去看结构、字词之间有关系、靠空间位置表达含义吗 → `graphic`。
   这一档是给图的：给满整个侧栏会把节点拉散、只能开全屏看；给它正文宽度又小到看不清。
3. 都不是 → `wide`。

**为什么图和组件要分档。** 散文的行宽是给“眼睛扫行”用的，超过约 66em 眼跳会丢行；表格和代码
的行宽是给“对齐”用的，限宽只会换来横向滚动。图两者都不是：它的可读性取决于节点间距和图幅，
在 700px 和 1100px 的侧栏里最优值不同，所以单独给一个介于两者之间的上限。

**所有档位都再被侧栏本身钳一次**（`min(上限, 100%)`）。档位决定“宽侧栏怎么用”，
绝不决定“窄侧栏放不放得下”。窄侧栏里三档看起来一样，这是对的。

实测（1800px 视口、正文 14px）：散文 924px、图 1344px（96em 上限生效）、表格与代码
1683px（铺满）。侧栏窄于上限时三档都等于栏宽，只有拉开侧栏才看出区别。

## 3. 样式怎么接

CSS 只有一处按档位排版，就是 `client/src/styles.css` 顶部那组 `data-measure` 规则。散文
不按类名列举，而是由渲染层统一包进 `.am-prose-row`：

```css
.am-component-slot[data-measure='prose']   { max-width: min(var(--am-measure-prose), 100%); }
.am-component-slot[data-measure='graphic'] { max-width: min(var(--am-measure-graphic), 100%); }
.am-component-slot[data-measure='wide']    { max-width: none; }
```

`ComponentFrame` 把 `measure` 写成 `data-measure`，所以**新组件不用碰这几条规则**。
上限是 CSS 变量，改全局度量改 `[data-active-markdown]` 上的 `--am-measure-prose` /
`--am-measure-graphic` 即可。

文本块（标题、段落、列表、引用、分隔线、callout、front matter）不走 registry：`renderBlock`
把所有非组件块包进 `.am-prose-row`，宽度由那一层决定，块自己不加任何限宽类。新加文本型块
不需要做任何事；新加组件块时把它加进 `COMPONENT_BLOCKS`，否则它会被包进阅读列而失去自己的档位。

**为什么限宽在行容器上而不是块上**：`max-width` 里的 `em` 按**元素自身**的字号解析，而标题
的字号是主题放大的（14px 正文上 h1 是 21px）。同一个 `66em` 写在 h1 上会得到 1386px、写在
段落上得到 924px，整列就对不齐。在继承根字号的 `.am-prose-row` 上解析 `em` 才是正文的字号，
所以所有散文块物理同宽，且随宿主“内容字号”一起变。这是实测出来的，不要把它“简化”回
块上一行 `max-width`。

**内部布局不要自己再写一遍 max-width。** 组件已经被外壳钳住了，body 内部再限一次宽会和
外壳的居中打架；需要局部限宽时用 `%` 而不是 `em`，避免跟着字号二次缩放。

## 4. 变宽时怎么应对

档位管的是外宽，内宽变化是另一件事，按这个顺序处理：

1. **先让它铺满**：`width: 100%` / `min-width: max-content`（需要时配父级 `overflow-x: auto`）。
   表格就是这么做的：窄栏里横向滚动，而不是把每格挤成一字。
2. **再考虑换行**：只有“横向滚动比换行更难读”时，才给换行开关，并且要区分就地和展开面板
   ——面板宽，换行才划算（见 `panelWrap` 与代码块的 `wrap`）。
3. **最后才设上限**：确实需要上限时，用 `min(X, 100%)` 而不是裸 `X`，并对齐到已有的档位
   变量，不要新造一个数。

## 5. 检查清单

新增一个组件，合并前逐条过：

- [ ] `ComponentKind` 加了 kind，`COMPONENT_REGISTRY` 补了整条记录（含 `measure`）；
- [ ] `componentOf` 里能返回它，`label` 有对应的 `ComponentLabel` 分支与 locale 文案；
- [ ] `measure` 按第 2 节的判据选，并在 PR 里一句话说明为什么是这一档；
- [ ] 组件 block type 已加进 `COMPONENT_BLOCKS`，否则它会被包进阅读列；
- [ ] 没有新增按 class 名列举宽度的 CSS；宽度只来自 `data-measure` 与 `.am-prose-row`；
- [ ] 任一上限都写成 `min(…, 100%)`；
- [ ] 窄栏（约 320px）与宽栏（约 1100px）都看过：窄栏不溢出，宽栏按档位行为正确；
- [ ] `test/component-frame.test.ts` 的分类测试按新组件更新。

## 6. 已知不打算做的

- **不做用户可调的阅读宽度开关**：档位是编辑判断，不是偏好。
- **不做 JS 测量排版**：插件根已有 `container-type: inline-size`，需要按栏宽分档时用
  `@container`，不要读 `clientWidth` 再 setState，那会在拖拽时逐帧重排。文字体量也同理，
  不按内容宽度动态调上限。
- **不给图形档补“适应宽度”档位**：图该多大由它自己的内容决定，看全图有展开面板。

## 7. 与字号的关系

宽度上限用 `em`，所以跟随宿主“内容字号”。用户调大内容字号时行宽按字符数保持，
不是按像素变窄。源码编辑器与正文一样绑定 `--dsh-content-font-size`（见
`client/src/edit/editor.tsx`），渲染视图和源码视图切换时不跳字号；代码块仍用
`--dsh-code-font-size`，因为那是“被引用的代码”，不是“被阅读的正文”。
