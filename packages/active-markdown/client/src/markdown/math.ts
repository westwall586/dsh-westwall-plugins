/**
 * TeX delimiters, scanned on plain text so the inline and display rules share
 * one tested definition and MarkdownIt only has to wire them in.
 */

/** One inline `$…$` formula found at a source index. */
export interface InlineMathAt {
  /** The TeX between the delimiters, untrimmed. */
  tex: string
  /** Index just past the closing `$`. */
  end: number
}

/** One display `$$…$$` formula found at the start of a run of source lines. */
export interface DisplayMathAt {
  /** The TeX between the delimiters, trimmed. */
  tex: string
  /** Lines consumed from the opening one through the closing one. */
  lines: number
}

function isSpace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char)
}

/**
 * Find an inline formula starting exactly at `start`.
 * `$$` is display syntax, a blank after the opening `$` or before the closing
 * one is prose, a line break ends the candidate, and a backslash escapes.
 * @param src - the parser's inline source.
 * @param start - index of the candidate opening `$`.
 * @param end - exclusive end of the parsable range.
 * @returns the TeX and the first index after it, or null when this is not a formula.
 */
export function inlineMathAt(src: string, start: number, end: number): InlineMathAt | null {
  if (src[start] !== '$') return null
  const opened = src[start + 1]
  if (opened === undefined || opened === '$' || isSpace(opened)) return null
  for (let index = start + 1; index < end; index += 1) {
    const char = src[index]
    if (char === '\n') return null
    if (char === '\\') {
      index += 1
      continue
    }
    if (char !== '$') continue
    // `$ x $` and `$x $` are prose, and the closing delimiter cannot open `$$`.
    if (isSpace(src[index - 1]) || src[index + 1] === '$') return null
    return { tex: src.slice(start + 1, index), end: index + 1 }
  }
  return null
}

/**
 * Find a display formula whose opening `$$` starts the first line (leading
 * spaces aside). The delimiter may close on that line or on any following line;
 * a blank line ends the candidate, so an unclosed `$$` stays prose instead of
 * swallowing the rest of the document.
 * @param lines - source lines from the candidate opening line onward.
 * @param start - index of the candidate opening line.
 * @returns the trimmed TeX and how many lines the block holds, or null.
 */
export function displayMathAt(lines: readonly string[], start: number): DisplayMathAt | null {
  const first = lines[start]
  if (first === undefined) return null
  const open = first.indexOf('$$')
  if (open === -1 || first.slice(0, open).trim() !== '') return null
  let text = first
  let close = first.indexOf('$$', open + 2)
  let consumed = 1
  while (close === -1 && start + consumed < lines.length) {
    const next = lines[start + consumed]
    if (next === undefined || next.trim() === '') return null
    text = `${text}\n${next}`
    consumed += 1
    close = text.indexOf('$$', open + 2)
  }
  if (close === -1) return null
  const lineEnd = text.indexOf('\n', close)
  const trailing = text.slice(close + 2, lineEnd === -1 ? text.length : lineEnd)
  if (trailing.trim() !== '') return null
  const tex = text.slice(open + 2, close).trim()
  if (tex === '') return null
  return { tex, lines: consumed }
}
