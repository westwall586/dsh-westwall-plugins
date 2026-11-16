/**
 * The plugin page owns these three fields. It writes the Host Config through
 * the shared config form; the preview carries no settings UI. The language
 * select shows the Host's labels but stores only codes, because codes are what
 * the wire and the saved paths carry.
 */
import * as React from 'react'
import type {
  ConfigFormLike,
  ConfigFormSnapshotLike,
  HostBridge,
  LanguageOption,
  SettingsOp,
  Translate,
} from './context.ts'

interface StoredSettings {
  followDefault: boolean
  provider: string
  model: string
  lang: string
  translateComments: boolean
}

function readStored(value: Record<string, unknown> | undefined): StoredSettings {
  const raw = value?.model
  const pair = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as { provider?: unknown; model?: unknown }
    : null
  const provider = typeof pair?.provider === 'string' ? pair.provider : ''
  const model = typeof pair?.model === 'string' ? pair.model : ''
  const lang = typeof value?.lang === 'string' && value.lang.trim() !== '' ? value.lang.trim() : 'zh'
  return {
    followDefault: provider === '' || model === '',
    provider,
    model,
    lang,
    translateComments: value?.translateComments !== false,
  }
}

function storedKeyOf(value: StoredSettings): string {
  return [value.followDefault, value.provider, value.model, value.lang, value.translateComments].join('\u0000')
}

function hasUserLayer(user: unknown): boolean {
  return typeof user === 'object' && user !== null && !Array.isArray(user) && Object.keys(user).length > 0
}

interface SettingsPageOptions {
  readonly form: ConfigFormLike
  readonly host: () => Promise<HostBridge>
  readonly t: Translate
}

/** The page the Plugins page mounts on this bundle's detail screen. */
export function createSettingsPage(options: SettingsPageOptions): React.ComponentType<{ view?: string }> {
  return function ActiveMarkdownSettings({ view }: { view?: string }): React.ReactNode {
    if (view !== undefined && view !== 'page') return null
    return <SettingsForm {...options} />
  }
}

function SettingsForm({ form, host, t }: SettingsPageOptions): React.ReactElement {
  const subscribe = React.useCallback((listener: () => void) => form.subscribe(listener), [form])
  const snapshot = React.useSyncExternalStore<ConfigFormSnapshotLike>(
    subscribe,
    () => form.getSnapshot(),
    () => form.getSnapshot(),
  )
  const stored = readStored(snapshot.value)
  const storedKey = storedKeyOf(stored)
  const [draft, setDraft] = React.useState<StoredSettings>(stored)
  const [languages, setLanguages] = React.useState<readonly LanguageOption[]>([])
  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const languageId = React.useId()

  React.useEffect(() => { setDraft(readStored(snapshot.value)) }, [storedKey])
  React.useEffect(() => {
    let live = true
    void host()
      .then(bridge => bridge.describe())
      .then((described) => { if (live) setLanguages(described.languages) })
      .catch(() => { if (live) setLanguages([]) })
    return () => { live = false }
  }, [host])

  const writable = snapshot.status === 'ready' && snapshot.writable
  const invalidModel = !draft.followDefault && (draft.provider.trim() === '' || draft.model.trim() === '')
  const changed = draft.followDefault !== stored.followDefault
    || (!draft.followDefault && (draft.provider.trim() !== stored.provider || draft.model.trim() !== stored.model))
    || draft.lang !== stored.lang
    || draft.translateComments !== stored.translateComments
  const canSave = writable && !saving && changed && !invalidModel
  const hasOverride = hasUserLayer(snapshot.user)

  const run = async (ops: readonly SettingsOp[]): Promise<void> => {
    setSaving(true)
    setStatus(null)
    try {
      const accepted = ops.length === 0 ? true : await form.mutate(ops, snapshot.revision)
      setStatus(accepted
        ? { kind: 'ok', text: t('settings.saved') }
        : { kind: 'error', text: t('settings.saveFailed') })
    } catch (error) {
      setStatus({
        kind: 'error',
        text: t('settings.saveError', { message: error instanceof Error ? error.message : String(error) }),
      })
    } finally {
      setSaving(false)
    }
  }

  const save = (): void => {
    if (!canSave) return
    const ops: SettingsOp[] = []
    if (draft.followDefault) {
      if (!stored.followDefault) ops.push({ op: 'unset', path: ['model'] })
    } else {
      const pair = { provider: draft.provider.trim(), model: draft.model.trim() }
      if (stored.followDefault || stored.provider !== pair.provider || stored.model !== pair.model) {
        ops.push({ op: 'set', path: ['model'], value: pair })
      }
    }
    if (draft.lang !== stored.lang) ops.push({ op: 'set', path: ['lang'], value: draft.lang })
    if (draft.translateComments !== stored.translateComments) {
      ops.push({ op: 'set', path: ['translateComments'], value: draft.translateComments })
    }
    void run(ops)
  }

  const reset = (): void => {
    if (!writable || saving) return
    void run([
      { op: 'unset', path: ['model'] },
      { op: 'unset', path: ['lang'] },
      { op: 'unset', path: ['translateComments'] },
    ])
  }

  const statusClass = status === null ? '' : ` am-settings-status--${status.kind}`

  return (
    <section className="am-settings" data-am-settings>
      <h2 className="am-settings-title">{t('settings.title')}</h2>
      <p className="am-settings-intro">{t('settings.intro')}</p>

      <div className="am-settings-field">
        <span className="am-settings-label">{t('settings.model')}</span>
        <label className="am-settings-check">
          <input
            type="checkbox"
            checked={draft.followDefault}
            disabled={!writable || saving}
            onChange={event => setDraft(current => ({ ...current, followDefault: event.target.checked }))}
          />
          <span>{t('settings.model.follow')}</span>
        </label>
        {draft.followDefault ? null : (
          <div className="am-settings-row">
            <label className="am-settings-subfield">
              <span className="am-settings-sublabel">{t('settings.model.provider')}</span>
              <input
                className="am-settings-input"
                value={draft.provider}
                placeholder="deepseek"
                spellCheck={false}
                disabled={!writable || saving}
                onChange={event => setDraft(current => ({ ...current, provider: event.target.value }))}
              />
            </label>
            <label className="am-settings-subfield">
              <span className="am-settings-sublabel">{t('settings.model.name')}</span>
              <input
                className="am-settings-input"
                value={draft.model}
                placeholder="deepseek-chat"
                spellCheck={false}
                disabled={!writable || saving}
                onChange={event => setDraft(current => ({ ...current, model: event.target.value }))}
              />
            </label>
          </div>
        )}
        <p className="am-settings-hint">{t('settings.model.hint')}</p>
        {invalidModel ? <p className="am-settings-error" role="alert">{t('settings.model.required')}</p> : null}
      </div>

      <div className="am-settings-field">
        <label className="am-settings-label" htmlFor={languageId}>{t('settings.lang')}</label>
        <select
          id={languageId}
          className="am-settings-select"
          value={draft.lang}
          disabled={!writable || saving}
          onChange={event => setDraft(current => ({ ...current, lang: event.target.value }))}
        >
          {languages.length === 0
            ? <option value={draft.lang}>{draft.lang}</option>
            : languages.map(option => (
              <option key={option.code} value={option.code}>{option.label}</option>
            ))}
        </select>
        <p className="am-settings-hint">{t('settings.lang.hint')}</p>
      </div>

      <div className="am-settings-field">
        <label className="am-settings-check">
          <input
            type="checkbox"
            checked={draft.translateComments}
            disabled={!writable || saving}
            onChange={event => setDraft(current => ({ ...current, translateComments: event.target.checked }))}
          />
          <span>{t('settings.comments')}</span>
        </label>
        <p className="am-settings-hint">{t('settings.comments.hint')}</p>
      </div>

      <div className="am-settings-actions">
        <button type="button" className="am-settings-button am-settings-button--primary" disabled={!canSave} onClick={save}>
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
        <button type="button" className="am-settings-button" disabled={!writable || saving || !hasOverride} onClick={reset}>
          {t('settings.reset')}
        </button>
        {status === null ? null : (
          <span className={`am-settings-status${statusClass}`} role={status.kind === 'error' ? 'alert' : 'status'}>
            {status.text}
          </span>
        )}
      </div>

      {snapshot.status === 'loading' ? <p className="am-settings-hint" role="status">{t('settings.loading')}</p> : null}
      {snapshot.status === 'unavailable' ? <p className="am-settings-hint" role="status">{t('settings.unavailable')}</p> : null}
      {snapshot.status === 'ready' && !snapshot.writable
        ? <p className="am-settings-hint" role="status">{t('settings.readonly')}</p>
        : null}
    </section>
  )
}
