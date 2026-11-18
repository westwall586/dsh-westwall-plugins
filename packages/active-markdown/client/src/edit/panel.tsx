import * as React from 'react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { HostBridge } from '../context.ts'
import type { EditCheckResult, WriteIntent, WriteTextResult } from './model.ts'
import type { EditEvent } from './state.ts'

export interface EditCommandDeps {
  host(): Promise<HostBridge>
  onEvent(event: EditEvent): void
  onError(message: string): void
}

export interface EditCommand {
  check(sessionId: string, path: string, bytes: number): Promise<EditCheckResult | undefined>
  save(
    sessionId: string,
    path: string,
    text: string,
    intent: WriteIntent,
  ): Promise<WriteTextResult | undefined>
}

export function useEditCommand(deps: EditCommandDeps): EditCommand {
  const { host, onEvent, onError } = deps
  const check = useCallback(async (sessionId: string, path: string, bytes: number) => {
    try {
      const bridge = await host()
      return await bridge.editCheck({ sessionId, path, bytes })
    } catch {
      return undefined
    }
  }, [host])
  const save = useCallback(async (
    sessionId: string,
    path: string,
    text: string,
    intent: WriteIntent,
  ): Promise<WriteTextResult | undefined> => {
    onEvent({ type: 'save' })
    try {
      const bridge = await host()
      const result = await bridge.writeText({ sessionId, path, text, intent })
      if (result.status === 'saved') {
        onEvent({ type: 'saved' })
      } else if (result.status === 'stale') {
        onEvent({ type: 'stale' })
      }
      return result
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
      return undefined
    }
  }, [host, onEvent, onError])
  return useMemo(() => ({ check, save }), [check, save])
}

export interface EditToolbarLabels {
  save: string
  saving: string
  exit: string
  lines: string
  dirty: string
}

export interface EditToolbarProps {
  dirty: boolean
  saving: boolean
  lineCount: number
  labels: EditToolbarLabels
  onSave(): void
  onExit(): void
}

export function EditToolbar(props: EditToolbarProps): ReactNode {
  const { dirty, saving, lineCount, labels } = props
  return (
    <>
      <span className="am-edit-status">
        {dirty ? <span className="am-edit-dirty">{labels.dirty}</span> : null}
        <span className="am-edit-lines">{labels.lines} {lineCount}</span>
      </span>
      <span className="am-toolbar-spacer" />
      <button
        type="button"
        className="am-primary"
        disabled={saving}
        onClick={props.onSave}
      >
        {saving ? labels.saving : labels.save}
      </button>
      <button
        type="button"
        className="am-toolbar-button am-toolbar-button--quiet"
        disabled={saving}
        onClick={props.onExit}
      >
        {labels.exit}
      </button>
    </>
  )
}

export interface ConflictPanelLabels {
  title: string
  body: string
  reload: string
  overwrite: string
  overwriteWarning: string
  saveAs: string
  close: string
  cancel: string
}

export interface ConflictPanelProps {
  open: boolean
  busy: boolean
  labels: ConflictPanelLabels
  onReload(): void
  onOverwrite(): void
  onSaveAs(): void
  onClose(): void
}

export function ConflictPanel(props: ConflictPanelProps): ReactNode {
  const { open, busy, labels, onClose } = props
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    if (open) setConfirmed(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="am-edit-scrim" onMouseDown={onClose}>
      <div
        className="am-edit-conflict"
        role="dialog"
        aria-modal="true"
        aria-label={labels.title}
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="am-edit-conflict-title">{labels.title}</div>
        <p className="am-edit-conflict-body">{labels.body}</p>
        {confirmed ? <p className="am-edit-conflict-warning">{labels.overwriteWarning}</p> : null}
        <div className="am-edit-conflict-actions">
          <button type="button" className="am-edit-action" disabled={busy} onClick={props.onReload}>
            {labels.reload}
          </button>
          <button type="button" className="am-edit-action" disabled={busy} onClick={props.onSaveAs}>
            {labels.saveAs}
          </button>
          <span className="am-toolbar-spacer" />
          {confirmed ? (
            <>
              <button type="button" className="am-edit-action" disabled={busy} onClick={() => setConfirmed(false)}>
                {labels.cancel}
              </button>
              <button
                type="button"
                className="am-edit-action am-edit-action--danger"
                disabled={busy}
                onClick={props.onOverwrite}
              >
                {labels.overwrite}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="am-edit-action" disabled={busy} onClick={onClose}>
                {labels.close}
              </button>
              <button type="button" className="am-edit-action" disabled={busy} onClick={() => setConfirmed(true)}>
                {labels.overwrite}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export interface BannerAction {
  label: string
  run(): void
  danger?: boolean
}

export interface EditBannerProps {
  text: string
  primary?: BannerAction
  secondary?: BannerAction
}

export function EditBanner({ text, primary, secondary }: EditBannerProps): ReactNode {
  return (
    <div className="am-edit-banner" role="status" aria-live="polite">
      <span className="am-edit-banner-text">{text}</span>
      <span className="am-toolbar-spacer" />
      {secondary === undefined ? null : (
        <button type="button" className="am-edit-action" onClick={secondary.run}>{secondary.label}</button>
      )}
      {primary === undefined ? null : (
        <button
          type="button"
          className={primary.danger === true ? 'am-edit-action am-edit-action--danger' : 'am-edit-action'}
          onClick={primary.run}
        >
          {primary.label}
        </button>
      )}
    </div>
  )
}
