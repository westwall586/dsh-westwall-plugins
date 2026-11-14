/**
 * The one shared clip pipeline behind both entries.
 *
 * It resolves a browser tab, focuses it, waits two frames for the pane to
 * settle, captures the guest DOM, extracts one artifact, and hands it to the
 * composer. A single busy flag stops a second clip while the first runs.
 */

/** The active browser tab, else the first browser tab of this Session. */
export function resolveTarget(sidebarRight, sessionId) {
  const active = sidebarRight?.active?.()
  if (active?.kind === 'browser' && active.id !== undefined) {
    return { tabId: active.id, kind: 'browser' }
  }
  const first = (sidebarRight?.openTabs?.getSnapshot?.() ?? [])
    .find((tab) => tab.sessionId === sessionId && tab.kind === 'browser')
  return first === undefined ? undefined : { tabId: first.tabId, kind: 'browser' }
}

const failure = (code, detail) => (detail === undefined ? { ok: false, code } : { ok: false, code, detail })

/**
 * @param deps - `{ capture, extract, attach, toast, t, sidebarRight,
 *   conversationFor, desktop, now, waitFrames }`. Every host edge is injected.
 */
export function createClipper(deps) {
  const {
    capture,
    extract,
    attach,
    toast,
    t,
    sidebarRight,
    conversationFor,
    desktop,
    now = () => new Date(),
    waitFrames = () => Promise.resolve(),
  } = deps
  let busy = false

  const report = (code, detail) => {
    toast.show(t(`error.${code}`), 'error')
    return failure(code, detail)
  }

  /**
   * @param request - `{ sessionId, inputActions, tab? }`; `tab` is the owner
   *   share of a tab-menu click, omitted by the composer entry.
   * @returns `{ ok: true, title, fileName, mode }` or `{ ok: false, code, detail? }`.
   */
  async function clip(request = {}) {
    const { sessionId, inputActions, tab } = request
    const isDesktop = typeof desktop === 'function' ? desktop() : desktop === true
    if (!isDesktop) return failure('desktop-only')
    if (busy) return report('busy')

    busy = true
    try {
      const startedAt = now()
      if (tab !== undefined && tab.kind !== 'browser') return report('no-page')
      const target = tab === undefined
        ? resolveTarget(sidebarRight, sessionId)
        : { tabId: tab.id, kind: tab.kind }
      if (target === undefined || target.tabId === undefined) return report('no-page')

      if (sidebarRight?.isExpanded?.() === false) {
        sidebarRight.toggleExpanded?.()
        await waitFrames()
      }

      const activeId = sidebarRight?.active?.()?.id
      if (activeId !== target.tabId) sidebarRight?.focus?.(target.tabId)
      await waitFrames()

      // Focus must land on the tab we intend to capture; a stale active tab
      // would otherwise put a different page in the conversation.
      const focused = sidebarRight?.active?.()
      if (focused === undefined || focused.id !== target.tabId) {
        return report('no-page', 'target tab did not become active')
      }

      let captured
      try {
        captured = await capture()
      } catch (error) {
        return report('capture-failed', error instanceof Error ? error.message : String(error))
      }
      if (!captured?.ok) return report(captured?.code ?? 'capture-failed', captured?.detail)

      let artifact
      try {
        artifact = extract(captured.page, { clippedAt: startedAt })
      } catch (error) {
        return report('extract-failed', error instanceof Error ? error.message : String(error))
      }

      let conversation
      try {
        conversation = conversationFor(sessionId)
      } catch {
        conversation = undefined
      }

      const attached = await attach({ artifact, sessionId, inputActions, conversation })
      if (!attached?.ok) return report(attached?.code ?? 'attach-failed', attached?.detail)

      toast.show(t(artifact.kind === 'full-page' ? 'toast.successFullPage' : 'toast.success', {
        title: artifact.title,
      }), 'success')
      return { ok: true, title: artifact.title, fileName: artifact.name, mode: attached.mode }
    } catch (error) {
      return report('attach-failed', error instanceof Error ? error.message : String(error))
    } finally {
      busy = false
    }
  }

  return { clip, isBusy: () => busy }
}

/**
 * Wait for a number of animation frames, falling back to macrotasks when the
 * document is not painting yet.
 */
export function waitForFrames(count = 2, schedule = globalThis.requestAnimationFrame) {
  const next = typeof schedule === 'function' ? schedule : (callback) => globalThis.setTimeout(callback, 0)
  return new Promise((resolve) => {
    let remaining = count
    const step = () => {
      remaining -= 1
      if (remaining <= 0) resolve()
      else next(step)
    }
    next(step)
  })
}