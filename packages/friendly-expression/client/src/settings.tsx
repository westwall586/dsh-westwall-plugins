/** Settings section and navigation icon for the expression prompt. */
import * as React from 'react'
import { MAX_PROMPT_CHARS, readPromptValue } from './core.ts'
import type { ConfigForm, Translate } from './context.ts'
import { SpeechIcon } from './ui.tsx'

type Status = { kind: 'ok' | 'error'; text: string } | null

interface SectionProps {
  t: Translate
}

export function createSettingsSection(form: ConfigForm): React.ComponentType<SectionProps> {
  return function FriendlyExpressionSettings({ t }: SectionProps): React.ReactElement {
    const subscribe = React.useCallback((listener: () => void) => form.subscribe(listener), [form])
    const readSnapshot = React.useCallback(() => form.getSnapshot(), [form])
    const snapshot = React.useSyncExternalStore(subscribe, readSnapshot, readSnapshot)
    const stored = readPromptValue((snapshot.value as { stylePrompt?: unknown } | undefined)?.stylePrompt)
    const [draft, setDraft] = React.useState(stored)
    const [saving, setSaving] = React.useState(false)
    const [status, setStatus] = React.useState<Status>(null)

    React.useEffect(() => { setDraft(stored) }, [stored])

    const writable = snapshot.status === 'ready' && snapshot.writable !== false
    const loading = snapshot.status === 'loading'
    const unavailable = snapshot.status === 'unavailable'
    const overLimit = draft.length > MAX_PROMPT_CHARS
    const changed = draft !== stored
    const user = snapshot.user
    const hasOverride = user !== undefined && user !== null && typeof user === 'object'
      && Object.prototype.hasOwnProperty.call(user, 'stylePrompt')
    const canSave = writable && !saving && changed && !overLimit

    const save = async (): Promise<void> => {
      if (!canSave) return
      setSaving(true)
      setStatus(null)
      try {
        const accepted = await form.set('stylePrompt', draft)
        setStatus(accepted
          ? { kind: 'ok', text: t('settings.saved') }
          : { kind: 'error', text: t('settings.saveFailed') })
      } catch (error) {
        setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
      } finally {
        setSaving(false)
      }
    }

    const reset = async (): Promise<void> => {
      if (!writable || saving) return
      setSaving(true)
      setStatus(null)
      try {
        const accepted = await form.unset('stylePrompt')
        setStatus(accepted
          ? { kind: 'ok', text: t('settings.saved') }
          : { kind: 'error', text: t('settings.saveFailed') })
      } catch (error) {
        setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
      } finally {
        setSaving(false)
      }
    }

    return React.createElement('section', { className: 'dfe-settings' },
      React.createElement('h1', { className: 'dfe-settings-title' }, t('settings.title')),
      React.createElement('p', { className: 'dfe-settings-subtitle' }, t('settings.subtitle')),
      React.createElement('div', { className: 'dfe-settings-card' },
        React.createElement('div', { className: 'dfe-settings-card-head' },
          React.createElement('h2', { className: 'dfe-settings-card-title' }, t('settings.cardTitle')),
          React.createElement('span', { className: 'dfe-settings-card-note' }, t('settings.cardNote'))),
        React.createElement('p', { className: 'dfe-settings-description' }, t('settings.description')),
        React.createElement('textarea', {
          className: `dfe-textarea${overLimit ? ' dfe-textarea--over' : ''}`,
          value: draft,
          rows: 10,
          spellCheck: false,
          disabled: !writable || saving,
          placeholder: t('settings.placeholder'),
          'aria-label': t('settings.cardTitle'),
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value),
        }),
        React.createElement('div', { className: 'dfe-settings-row' },
          React.createElement('span', {
            className: `dfe-counter${overLimit ? ' dfe-counter--over' : ''}`,
            role: overLimit ? 'alert' : undefined,
          }, t('settings.counter', { count: draft.length, max: MAX_PROMPT_CHARS })),
          React.createElement('div', { className: 'dfe-settings-actions' },
            React.createElement('button', {
              type: 'button',
              className: 'dfe-btn',
              disabled: !writable || saving || !hasOverride,
              onClick: () => { void reset() },
            }, t('settings.reset')),
            React.createElement('button', {
              type: 'button',
              className: 'dfe-btn dfe-btn--primary',
              disabled: !canSave,
              onClick: () => { void save() },
            }, saving ? t('settings.saving') : t('settings.save')))),
        React.createElement('p', { className: 'dfe-settings-hint' }, t('settings.hint'))),
      loading
        ? React.createElement('p', { className: 'dfe-settings-status', role: 'status' }, t('settings.loading'))
        : unavailable
          ? React.createElement('p', { className: 'dfe-settings-status', role: 'status' }, t('settings.unavailable'))
          : status !== null
            ? React.createElement('p', {
              className: `dfe-settings-status dfe-settings-status--${status.kind}`,
              role: status.kind === 'error' ? 'alert' : 'status',
            }, status.text)
            : !writable
              ? React.createElement('p', { className: 'dfe-settings-status', role: 'status' }, t('settings.readonly'))
              : null)
  }
}

export function FriendlyExpressionIcon({ size = 16, active = false }: {
  size?: number
  active?: boolean
}): React.ReactElement {
  return React.createElement('span', {
    className: 'dfe-settings-icon',
    'data-active': active ? 'true' : 'false',
  }, React.createElement(SpeechIcon, { size }))
}
