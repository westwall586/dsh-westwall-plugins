---
title: 富组件验收
tags: 阅读, callout
status: draft
---

# 富组件验收

## Callout 全族

> [!note] 说明这一族的颜色
> 正文里可以有 **粗体**、`行内代码` 与[链接](https://example.com)。

> [!abstract] 摘要
> 七族各自的左边线与底色都来自 `--dsw-*` token。

> [!tip] 建议
> 阅读宽度现在限制在 44em。

> [!success] 成功
> 表格、代码、图片都在下面。

> [!question] 问题
> 标题可以省略吗？

> [!warning] 注意
> 未知类型会退回普通引用。

> [!danger] 危险
> 折叠语法 `[!note]-` 也退回普通引用。

> [!example] 示例
> 示例族的颜色应该和 danger 明显不同。

> [!quote] 引用
> 引用族走中性色。

> [!note]
> 没有标题的 callout 也要正常。

## 普通引用保持原样

> 这是一段普通引用。
> 第二行。

列表里的标记不识别：

- 列表项
  > [!note] 这里保持引用
  > 不该变成 callout

## 代码与换行

```ts
const veryLongLine = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
```

## 表格

| 列一 | 列二 |
|---|---|
| 值 | 另一个值 |

## 图片

![示例图](pic.png)
