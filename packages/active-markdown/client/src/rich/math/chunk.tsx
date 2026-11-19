/** KaTeX renderer loaded on demand; the entry bundle never carries KaTeX code. */
import katex from 'katex'

export default {
  /**
   * Render one formula as KaTeX markup.
   * @param tex - the TeX source between the delimiters.
   * @param display - display mode for a block formula, inline mode otherwise.
   * @returns the markup, which the caller inserts as HTML.
   * @throws when KaTeX cannot parse the source, so the caller can fall back to it.
   */
  render(tex: string, display: boolean): string {
    return katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: 'ignore', trust: false })
  },
}
