/**
 * Heading alignment: compare every heading's source line and level in document
 * order. Paragraph, code, table, and inline content stay outside the check.
 */
import type { Block } from '../markdown/model.ts'
import { parseDocument } from '../markdown/blocks.ts'
import { countLines } from './plan.ts'

export interface HeadingAnchor {
  readonly line: number
  readonly level: number
}

/** The first heading difference; `mismatch` carries both sides, the other two carry the one that exists. */
export type HeadingBreak =
  | { readonly kind: 'mismatch', readonly source: HeadingAnchor, readonly translated: HeadingAnchor }
  | { readonly kind: 'missing', readonly source: HeadingAnchor }
  | { readonly kind: 'extra', readonly translated: HeadingAnchor }

/** Both line counts and the first heading difference, so one value answers every alignment question. */
export interface Alignment {
  readonly sourceLines: number
  readonly translatedLines: number
  readonly headingBreak: HeadingBreak | null
}

function headingsOf(blocks: readonly Block[]): HeadingAnchor[] {
  const anchors: HeadingAnchor[] = []
  const walk = (list: readonly Block[]): void => {
    for (const block of list) {
      if (block.type === 'heading') {
        anchors.push({ line: block.sourceStartLine, level: block.level })
      } else if (block.type === 'list') {
        for (const item of block.items) walk(item.blocks)
      } else if (block.type === 'quote') {
        walk(block.blocks)
      }
    }
  }
  walk(blocks)
  return anchors
}

function firstBreak(source: readonly HeadingAnchor[], translated: readonly HeadingAnchor[]): HeadingBreak | null {
  const shared = Math.min(source.length, translated.length)
  for (let index = 0; index < shared; index += 1) {
    const left = source[index]!
    const right = translated[index]!
    if (left.line !== right.line || left.level !== right.level) {
      return { kind: 'mismatch', source: left, translated: right }
    }
  }
  if (source.length > shared) return { kind: 'missing', source: source[shared]! }
  if (translated.length > shared) return { kind: 'extra', translated: translated[shared]! }
  return null
}

/**
 * Compare a source document's headings and line count with its translation's.
 * @param sourceText - the whole source file.
 * @param translatedText - the whole translated file.
 * @returns both line counts and the first heading difference, if any.
 */
export function alignOf(sourceText: string, translatedText: string): Alignment {
  return {
    sourceLines: countLines(sourceText),
    translatedLines: countLines(translatedText),
    headingBreak: firstBreak(
      headingsOf(parseDocument(sourceText).blocks),
      headingsOf(parseDocument(translatedText).blocks),
    ),
  }
}

/** True only when both line counts match and every heading matched. */
export function aligned(alignment: Alignment): boolean {
  return alignment.sourceLines === alignment.translatedLines && alignment.headingBreak === null
}
