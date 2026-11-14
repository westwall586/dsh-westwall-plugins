/**
 * Pure visibility rules shared by both entries. Keeping them free of React and
 * host services lets tests pin the exact conditions the UI uses.
 */

/** The desktop app publishes this carrier before any client plugin loads. */
export function isDesktopGlobal(value = globalThis) {
  return value?.dshDesktop?.protocolVersion === 1
}

export function tabMenuItemVisible({ desktop, tabKind }) {
  return desktop === true && tabKind === 'browser'
}

export function composerButtonVisible({ desktop, sessionId, tabs }) {
  if (desktop !== true || sessionId === undefined || sessionId === null) return false
  if (!Array.isArray(tabs)) return false
  return tabs.some((tab) => tab.sessionId === sessionId && tab.kind === 'browser')
}