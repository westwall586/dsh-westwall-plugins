/** Route one external link to the right sidebar's browser, or out to a new tab when it cannot take it. */
import type { SidebarRight } from './context.ts'

/** The opener used when the right sidebar cannot show the page. */
export type ExternalFallback = (url: string) => void

/**
 * Open one external destination without leaving the document.
 *
 * The right sidebar can show a page beside the document that links to it; a
 * host without the browser page type, or without a Session on screen, throws
 * instead and falls back to a new tab.
 * @param url - the http(s) or mailto destination.
 * @param sidebar - the sidebar's navigation face, when the host exposes one.
 * @param fallback - the opener for a host that cannot take the page.
 */
export function openExternal(
  url: string,
  sidebar: Pick<SidebarRight, 'openTab'> | undefined,
  fallback: ExternalFallback,
): void {
  if (sidebar?.openTab !== undefined) {
    try {
      sidebar.openTab('browser', { params: { url } })
      return
    } catch {
      // A column with no Session on screen throws instead of no-oping; a new
      // tab still takes the reader where the document pointed.
    }
  }
  fallback(url)
}
