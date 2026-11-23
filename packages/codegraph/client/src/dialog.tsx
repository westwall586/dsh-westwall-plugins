/**
 * 工作区面板的浮层形态。
 *
 * 不用插件详情页的 section：那个槽位对 list 条目有一条硬规则，条目一旦崩过一次就
 * 永久退休且没有清除路径，用户升级插件之后要刷新页面才能再看到面板。浮层挂在
 * `shell.overlay` 上，每次打开都是新的一棵树，没有这个残留状态。
 */
import * as React from 'react'
import type { CodegraphAdmin, Translate } from './context.ts'
import { WorkspacePanel } from './panel.tsx'

export interface CodegraphDialogProps {
  readonly admin: CodegraphAdmin | undefined
  readonly t: Translate
  readonly pluginName: string
  readonly onClose: () => void
}

/** 面板 + 关闭按钮；Esc 与点背景都能关。 */
export function CodegraphDialog({ admin, t, pluginName, onClose }: CodegraphDialogProps): React.ReactElement {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div role="presentation" onClick={onClose} style={BACKDROP}>
      <div role="dialog" aria-modal="true" aria-label={t('panel.title')} onClick={event => event.stopPropagation()} style={CARD}>
        <WorkspacePanel admin={admin} t={t} pluginName={pluginName} />
        <button type="button" onClick={onClose}>{t('panel.close')}</button>
      </div>
    </div>
  )
}

const BACKDROP: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 60, display: 'flex',
  alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.45)',
}

const CARD: React.CSSProperties = {
  minWidth: '32rem', maxWidth: '52rem', maxHeight: '70vh', overflow: 'auto',
  padding: '1.25rem', borderRadius: '0.75rem',
  background: 'var(--dsw-surface, #fff)', color: 'var(--dsw-text, #111)',
  boxShadow: '0 24px 64px rgba(0,0,0,.35)',
}
