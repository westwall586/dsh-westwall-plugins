/** Compact composer control shown while the Session has a browser tab open. */
import { createElement, useState, useSyncExternalStore } from 'react'
import { PagePlusIcon } from './icons.mjs'
import { useActivePageLoading } from './page-loading.mjs'
import { composerButtonVisible, isDesktopGlobal } from './visibility.mjs'

/** Stable per-Session filtered snapshots; `useSyncExternalStore` needs reference equality. */
function createTabReader(openTabs) {
  const cache = new Map()
  return (sessionId) => {
    const source = openTabs.getSnapshot()
    const cached = cache.get(sessionId)
    if (cached !== undefined && cached.source === source) return cached.tabs
    const tabs = source.filter((tab) => tab.sessionId === sessionId && tab.kind === 'browser')
    cache.set(sessionId, { source, tabs })
    return tabs
  }
}

/**
 * @param deps - `{ clip, t, openTabs }`.
 * @returns the slot component for `conversation.input.left`.
 */
export function createComposerButton({ clip, t, openTabs }) {
  if (openTabs === undefined || openTabs === null
    || typeof openTabs.getSnapshot !== 'function' || typeof openTabs.subscribe !== 'function') {
    return function ComposerButtonUnavailable() { return null }
  }
  const readTabs = createTabReader(openTabs)
  const subscribe = (onChange) => openTabs.subscribe(onChange)

  return function ComposerButton(props) {
    const { sessionId, inputActions } = props
    const tabs = useSyncExternalStore(subscribe, () => readTabs(sessionId))
    const [busy, setBusy] = useState(false)
    const loading = useActivePageLoading()
    if (!composerButtonVisible({ desktop: isDesktopGlobal(), sessionId, tabs })) return null
    const label = t('composer.label')

    const run = async () => {
      if (busy || loading) return
      setBusy(true)
      try {
        await clip({ sessionId, inputActions })
      } finally {
        setBusy(false)
      }
    }

    return createElement('button', {
      type: 'button',
      className: 'dwc-composer-btn',
      'aria-label': loading ? t('composer.loading') : label,
      title: loading ? t('composer.loading') : label,
      'aria-busy': busy ? 'true' : undefined,
      'aria-disabled': loading ? 'true' : undefined,
      disabled: busy || loading,
      onClick: run,
    }, createElement(PagePlusIcon, { size: 14 }))
  }
}