/** Turn a document's block tree into the node tree a mind map renders. */
import { blockText, type Block, type ListBlock } from '../markdown/model.ts'

/** One mind-map node; the first line is the label and later lines are its description. */
export interface MarkmapNode {
  content: string
  children: MarkmapNode[]
}

/**
 * Convert headings and nested lists into a mind-map tree.
 * Headings nest by level, list items nest by list, and a paragraph extends the node
 * created just before it. Blocks that are not outline material are skipped.
 * @param blocks - top-level blocks of one Markdown document.
 * @returns the flat root of the tree; the document itself is its content.
 */
export function outlineToTree(blocks: readonly Block[]): MarkmapNode {
  const root: MarkmapNode = { content: '', children: [] }
  const headingStack: { level: number, node: MarkmapNode }[] = []
  let last = root

  const attach = (node: MarkmapNode, parent: MarkmapNode): void => {
    parent.children.push(node)
    last = node
  }

  const extend = (text: string): void => {
    const trimmed = text.trim()
    if (trimmed === '') return
    last.content = last.content === '' ? trimmed : `${last.content}\n${trimmed}`
  }

  const walkList = (list: ListBlock, parent: MarkmapNode): void => {
    for (const item of list.items) {
      const texts: string[] = []
      const nested: ListBlock[] = []
      for (const child of item.blocks) {
        if (child.type === 'list') nested.push(child)
        else texts.push(blockText(child).trim())
      }
      const node: MarkmapNode = { content: texts.filter(text => text !== '').join('\n'), children: [] }
      attach(node, parent)
      for (const child of nested) walkList(child, node)
    }
  }

  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= block.level) headingStack.pop()
        const node: MarkmapNode = { content: block.text, children: [] }
        attach(node, headingStack.length === 0 ? root : headingStack[headingStack.length - 1]!.node)
        headingStack.push({ level: block.level, node })
        break
      }
      case 'paragraph':
        extend(block.text)
        break
      case 'list':
        walkList(block, headingStack.length === 0 ? root : headingStack[headingStack.length - 1]!.node)
        break
      default:
        break
    }
  }
  return root
}
