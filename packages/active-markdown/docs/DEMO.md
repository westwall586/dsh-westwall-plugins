---
title: P0 演示文档
tags: [p0, markdown]
---

# 可交互 Markdown

这份文档覆盖 P0 的渲染面：标题、段落、行内样式、列表、表格、代码、链接与 front matter。

行内样式包含 **加粗**、*斜体*、~~删除线~~、`内联代码`，以及一个 [站外链接](https://example.com)。

## 列表

- 无序项一
- 无序项二
  - 嵌套项
- [ ] 待办项
- [x] 已完成项

1. 有序项一
2. 有序项二

## 表格

| 名称 | 状态 | 说明 |
| --- | :---: | ---: |
| 接管 | 完成 | 默认渲染器 |
| 链接 | 完成 | 锚点与相对路径 |

## 代码

```ts
export function hello(name: string): string {
  return `hello ${name}`
}
```

## 引用与链接

> 引用第一段。
>
> 引用第二段，带一个 [相对链接](#可交互-markdown)。

- 回到本文开头：[可交互 Markdown](#可交互-markdown)
- 外部链接：[Example](https://example.com)
- 不执行的协议：[危险链接](javascript:alert(1))
