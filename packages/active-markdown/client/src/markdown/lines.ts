/** Map one block's inline run onto the source lines it renders. */
import type { Inline } from './model.ts'

/** A run of inline nodes that renders on one source line. */
export interface SourceLine {
  /** 1-based against the whole source file. */
  line: number
  inline: Inline[]
  /** The break that ends this line, rendered after its nodes. */
  break?: 'soft' | 'hard'
}

/** Source breaks one inline node spans; nested containers are counted, not split. */
function breakCount(inline: Inline): number {
  switch (inline.kind) {
    case 'softbreak':
    case 'hardbreak':
      return 1
    case 'strong':
    case 'em':
    case 'del':
    case 'link':
      return inline.children.reduce((count, child) => count + breakCount(child), 0)
    default:
      return 0
  }
}

/**
 * Split a block's inline run at its top-level line breaks.
 * Nested breaks are counted so later segments still land on the right source line.
 * @param inlines - the block's inline tree.
 * @param startLine - 1-based source line the block starts on.
 * @returns one segment per rendered source line.
 */
export function splitSourceLines(inlines: readonly Inline[], startLine: number): SourceLine[] {
  const lines: SourceLine[] = []
  let segmentLine = startLine
  let nextLine = startLine
  let nodes: Inline[] = []
  for (const inline of inlines) {
    if (inline.kind === 'softbreak' || inline.kind === 'hardbreak') {
      lines.push({ line: segmentLine, inline: nodes, break: inline.kind === 'softbreak' ? 'soft' : 'hard' })
      nextLine += 1
      segmentLine = nextLine
      nodes = []
      continue
    }
    nodes.push(inline)
    nextLine += breakCount(inline)
  }
  lines.push({ line: segmentLine, inline: nodes })
  return lines
}
