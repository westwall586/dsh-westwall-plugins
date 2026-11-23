/**
 * 插件详情页里的工作区面板：一张表加每行的开关。
 *
 * 状态来自 Host 的同一份存储域，按钮调同一个远程服务，所以界面上看到的就是
 * 会话挂载读到的。
 */
import * as React from 'react'
import type { CodegraphAdmin, Translate, WorkspaceStateView } from './context.ts'
import { describeAll } from './remote.ts'

const STATE_LABEL: Record<string, string> = {
  disabled: 'panel.state.disabled',
  indexing: 'panel.state.indexing',
  verifying: 'panel.state.verifying',
  ready: 'panel.state.ready',
  degraded: 'panel.state.degraded',
  failed: 'panel.state.failed',
}

interface PanelProps {
  readonly admin: CodegraphAdmin | undefined
  readonly t: Translate
  readonly pluginName: string
}

export function WorkspacePanel({ admin, t, pluginName }: PanelProps): React.ReactElement {
  const [view, setView] = React.useState<WorkspaceStateView | undefined>(undefined)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [busy, setBusy] = React.useState<string | undefined>(undefined)

  const refresh = React.useCallback(() => {
    if (admin === undefined) return
    describeAll(admin).then(setView, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [admin])

  React.useEffect(refresh, [refresh])

  const act = (path: string, action: () => Promise<unknown>): void => {
    setBusy(path)
    setError(undefined)
    action().then(() => { setBusy(undefined); refresh() }, (reason: unknown) => {
      setBusy(undefined)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  if (admin === undefined) {
    return (
      <section data-codegraph-panel={pluginName}>
        <h3>{t('panel.title')}</h3>
        <p>{t('panel.unavailable')}</p>
      </section>
    )
  }

  return (
    <section data-codegraph-panel={pluginName}>
      <h3>{t('panel.title')}</h3>
      <p>{t('panel.intro')}</p>
      {view?.cliMissing === true && <p role="status">{t('panel.cli.missing')}</p>}
      {view?.durable === false && <p role="status">{t('panel.durable.off')}</p>}
      {view?.globalInstall !== undefined && <p role="status">{t('panel.global')}</p>}
      {error !== undefined && <p role="alert">{error}</p>}
      {view === undefined || view.workspaces.length === 0
        ? <p>{t('panel.empty')}</p>
        : (
          <ul>
            {view.workspaces.map(row => (
              <li key={row.path} data-codegraph-workspace={row.path}>
                <code>{row.path}</code>
                {' — '}
                {t(STATE_LABEL[row.state] ?? 'panel.state.failed')}
                {row.reason === undefined ? null : <span> ({row.reason})</span>}
                {' '}
                {busy === row.path
                  ? <span>{t('panel.busy')}</span>
                  : row.enabled
                    ? (
                      <span>
                        <button type="button" onClick={() => { if (admin) act(row.path, () => admin.setEnabled(row.path, false)) }}>{t('panel.switchOff')}</button>
                        {row.state === 'failed' ? <button type="button" onClick={() => { if (admin) act(row.path, () => admin.retry(row.path)) }}>{t('panel.retry')}</button> : null}
                      </span>
                    )
                    : <button type="button" onClick={() => { if (admin) act(row.path, () => admin.setEnabled(row.path, true)) }}>{t('panel.switchOn')}</button>}
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
