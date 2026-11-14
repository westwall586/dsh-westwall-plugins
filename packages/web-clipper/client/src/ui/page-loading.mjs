/**
 * Reactive "the active sidebar page is still loading" state for the two entry
 * buttons. The webview element owns the authoritative loading flag; this hook
 * only mirrors it so a click that would end in `page-loading` is disabled
 * beforehand.
 */
import { useEffect, useState } from 'react'
import { findActiveWebview, isWebviewLoading } from '../webview.mjs'
import { isDesktopGlobal } from './visibility.mjs'

const EVENTS = [
  'did-start-loading',
  'did-stop-loading',
  'dom-ready',
  'did-fail-load',
  'did-navigate',
  'did-navigate-in-page',
]

/** One cheap read for callers that do not need to subscribe. */
export function activePageLoading(doc = globalThis.document) {
  const webview = findActiveWebview(doc)
  return webview === undefined ? false : isWebviewLoading(webview)
}

/**
 * Subscribe to the active guest. A short poll covers tab switches, which do not
 * change the open-tab inventory.
 */
export function useActivePageLoading(doc = globalThis.document) {
  const [loading, setLoading] = useState(() => activePageLoading(doc))
  useEffect(() => {
    if (!isDesktopGlobal()) return
    let webview
    const update = () => {
      const next = findActiveWebview(doc)
      if (next !== webview) {
        detach()
        webview = next
        attach()
      }
      setLoading(webview === undefined ? false : isWebviewLoading(webview))
    }
    const attach = () => {
      if (webview === undefined) return
      for (const name of EVENTS) webview.addEventListener(name, update)
    }
    const detach = () => {
      if (webview === undefined) return
      for (const name of EVENTS) webview.removeEventListener(name, update)
    }
    update()
    const timer = setInterval(update, 500)
    return () => {
      clearInterval(timer)
      detach()
    }
  }, [doc])
  return loading
}
