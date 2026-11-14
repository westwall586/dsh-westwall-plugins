/**
 * Plugin configuration page for the readable copy folder.
 *
 * The conversation attachment remains DSH-owned; this page only controls where
 * a second, human-readable Markdown file is written. It registers into the
 * Plugin Manager's bundle/row configuration seats, never into host chrome.
 */
import { createElement, useEffect, useState } from 'react'

function valueOf(form) {
  const value = form?.state?.value
  if (value === null || typeof value !== 'object') return ''
  return typeof value.outputDirectory === 'string' ? value.outputDirectory : ''
}

/**
 * @param deps - `{ ctx, copy, t, desktop }`; `copy` is the remote facade.
 * @returns the component for `plugins.bundle.config` / `plugins.row.config`.
 */
export function createSettingsPage({ ctx, copy, t, desktop }) {
  function SettingsBody(props) {
    const form = props.form
    const stored = valueOf(form)
    const [draft, setDraft] = useState(stored)
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)
    const [directory, setDirectory] = useState(null)

    useEffect(() => { setDraft(stored) }, [stored])

    const refreshDirectory = async () => {
      try {
        const view = await copy.directory()
        setDirectory(view?.ok === true ? view : null)
        if (view?.ok !== true) {
          setStatus({ kind: 'error', text: view?.detail ?? t('settings.directoryUnavailable') })
        }
      } catch (error) {
        setDirectory(null)
        setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
      }
    }

    useEffect(() => { void refreshDirectory() }, [])

    const persist = async (value) => {
      if (form === undefined || form === null) throw new Error(t('settings.unavailable'))
      const accepted = await form.mutate(value === ''
        ? [{ op: 'unset', path: ['outputDirectory'] }]
        : [{ op: 'set', path: ['outputDirectory'], value }])
      if (accepted !== true) throw new Error(t('settings.saveRefused'))
      await refreshDirectory()
    }

    const run = async (operation) => {
      if (busy) return
      setBusy(true)
      setStatus(null)
      try {
        await operation()
      } catch (error) {
        setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
      } finally {
        setBusy(false)
      }
    }

    const save = (value) => run(async () => {
      await persist(value)
      setStatus({ kind: 'ok', text: t('settings.saved') })
    })

    const browse = () => run(async () => {
      const path = await ctx.uiWorkspace.pickDirectory()
      if (path === null || path === undefined) return
      setDraft(path)
      await persist(path)
      setStatus({ kind: 'ok', text: t('settings.saved') })
    })

    const open = () => run(async () => {
      if (draft !== stored) await persist(draft)
      const result = await copy.open()
      if (result?.ok !== true) throw new Error(result?.detail ?? t('settings.openFailed'))
      setStatus({ kind: 'ok', text: t('settings.opened', { path: result.path }) })
    })

    const reset = () => run(async () => {
      setDraft('')
      await persist('')
      setStatus({ kind: 'ok', text: t('settings.saved') })
    })

    const writable = form?.state?.status === 'ready' && form?.state?.writable !== false
    const disabled = busy || !writable
    const effective = directory?.resolved ?? ''
    const isDefault = directory?.isDefault === true

    return createElement('section', { className: 'dwc-settings' },
      createElement('p', { className: 'dwc-settings-hint' }, t('settings.copyHint')),
      createElement('div', { className: 'dwc-settings-current' },
        createElement('span', { className: 'dwc-settings-label' }, t('settings.currentFolder')),
        createElement('code', { className: 'dwc-settings-path' }, effective || t('settings.loading')),
        isDefault ? createElement('span', { className: 'dwc-settings-tag' }, t('settings.temporaryTag')) : null),
      createElement('label', { className: 'dwc-settings-field' },
        createElement('span', { className: 'dwc-settings-label' }, t('settings.folder')),
        createElement('input', {
          className: 'dwc-settings-input',
          type: 'text',
          value: draft,
          placeholder: t('settings.placeholder'),
          disabled,
          spellCheck: false,
          onChange: event => setDraft(event.target.value),
        })),
      createElement('p', { className: 'dwc-settings-hint' }, t('settings.defaultHint')),
      createElement('div', { className: 'dwc-settings-actions' },
        createElement('button', {
          type: 'button',
          className: 'dwc-settings-btn dwc-settings-btn--primary',
          disabled,
          onClick: () => { void save(draft.trim()) },
        }, t('settings.save')),
        createElement('button', {
          type: 'button',
          className: 'dwc-settings-btn',
          disabled,
          onClick: browse,
        }, t('settings.choose')),
        createElement('button', {
          type: 'button',
          className: 'dwc-settings-btn',
          disabled,
          onClick: open,
        }, t('settings.open')),
        createElement('button', {
          type: 'button',
          className: 'dwc-settings-btn dwc-settings-btn--quiet',
          disabled: disabled || stored === '',
          onClick: reset,
        }, t('settings.useDefault'))),
      status === null ? null : createElement('p', {
        className: `dwc-settings-status dwc-settings-status--${status.kind}`,
        role: 'status',
      }, status.text),
      desktop === false
        ? createElement('p', { className: 'dwc-settings-hint' }, t('settings.desktopOnly'))
        : null)
  }

  return function WebClipperSettings(props) {
    // The row/bundle configuration seats ask for `page`; a missing view is
    // treated as the page so a host that omits the marker still renders the
    // form instead of silently dropping it.
    if (props?.view === 'summary') return null
    return createElement(SettingsBody, props)
  }
}
