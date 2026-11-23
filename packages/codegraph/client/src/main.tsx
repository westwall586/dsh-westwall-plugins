/**
 * 浏览器半体：工作区「⋯」菜单里的 CodeGraph 入口，以及菜单打开的工作区面板。
 *
 * 两个入口共用一份 Host 远程服务，所以界面上看到的状态就是会话挂载读到的状态。
 * 面板挂在 `shell.overlay` 上而不是插件详情页的 section：详情页的 list 槽位对
 * 崩过的条目永久退休，面板一旦崩过一次就只能刷新页面才能回来。
 */
import * as React from 'react'
import en from '../../locale/en.json'
import zh from '../../locale/zh.json'
import type { CodegraphAdmin, ClientContext } from './context.ts'
import { CodegraphDialog } from './dialog.tsx'
import { WorkspacePanel } from './panel.tsx'
import { en as panelEn, zh as panelZh } from './locales.ts'
import { mountAdmin } from './remote.ts'

const NS = 'codegraph'
const PACKAGE_ID = '@westwall/dsh-codegraph'
const OVERLAY_SLOT = 'shell.overlay'
const DETAIL_SLOT = 'plugins.detail.section'

function dictionary(...sources: Array<Record<string, unknown>>): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value !== 'string' || key === 'meta') continue
      merged[key] = value
    }
  }
  return merged
}

/** 浮层的开关状态；菜单点「打开面板」置位，关闭按钮复位。 */
interface OverlayState {
  open: boolean
}

export default {
  inject: ['slots', 'locale', 'contextMenus'],

  apply(ctx: ClientContext): void {
    ctx.effect(() => ctx.locale.register(NS, {
      zh: dictionary(zh, panelZh),
      en: dictionary(en, panelEn),
      'zh-CN': dictionary(zh, panelZh),
      'en-US': dictionary(en, panelEn),
    }), 'codegraph locale')

    const t = ctx.locale.bind(NS)
    let admin: CodegraphAdmin | undefined
    mountAdmin(ctx).then((bridge) => {
      admin = bridge
      // 先读一次，菜单的同步解析才有缓存可用。
      void bridge.refresh().catch(() => {})
    }, () => { admin = undefined })

    let state: OverlayState = { open: false }
    const listeners = new Set<() => void>()
    const setOpen = (open: boolean): void => {
      if (state.open === open) return
      state = { open }
      for (const listener of listeners) listener()
    }
    const subscribe = (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }

    ctx.effect(() => ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register({
      name: OVERLAY_SLOT,
      id: `${PACKAGE_ID}/workspace-panel`,
      order: 50,
    }, () => React.createElement(WorkspaceOverlay, { subscribe, getOpen: () => state.open, onClose: () => { setOpen(false) }, admin: () => admin, t }))),
    'codegraph workspace panel')

    // 插件详情页的入口按钮。详情页 section 只放一个按钮：面板在浮层里打开，
    // 条目本身足够小，不承担数据读取，坏了也只丢入口不丢功能。
    ctx.effect(() => ctx.slots.inject(DETAIL_SLOT, () => ctx.slots.register({
      name: DETAIL_SLOT,
      id: `${PACKAGE_ID}/workspaces`,
      order: 50,
    }, (props?: { subject?: { pkg?: { name?: string } } }) => {
      if (props?.subject?.pkg?.name !== PACKAGE_ID) return React.createElement(React.Fragment)
      // 面板直接挂在详情页里：这条路径已验证可渲染，浮层只作为同功能的第二个入口。
      // 首帧只放纯展示：数据读取推迟到 effect 里，条目不会因首帧副作用被判失败。
      return React.createElement(DelayedPanel, { admin, t, pluginName: PACKAGE_ID })
    })), 'codegraph detail entry')

    ctx.inject(['contextMenus'], (menuCtx) => ctx.effect(() => menuCtx.contextMenus.register({
      id: 'codegraph.workspace',
      target: 'workspace',
      order: 150,
      resolve: (target: { workspaceId?: string; path?: string }) => {
        // 工作区目标在 Web 侧只带 workspaceId；用会话侧栏的根目录反查路径。
        // resolve 必须同步给出菜单项：菜单的解析期限是 1s，任何 await 都来不及。
        const path = target.path ?? workspacePathOf(ctx, target.workspaceId)
        if (path === undefined) return []
        const open = { id: 'panel', label: t('menu.open'), run: () => { setOpen(true) } }
        const bridge = admin
        if (bridge === undefined) {
          return [open, { id: 'enable', label: t('menu.enable'), run: () => Promise.resolve() }]
        }
        const row = bridge.snapshot()?.workspaces.find(candidate => candidate.path === path)
        if (row === undefined) {
          return [open, { id: 'enable', label: t('menu.enable'), run: () => bridge.setEnabled(path, true).then(() => undefined) }]
        }
        if (row.enabled === false) {
          return [open, { id: 'enable', label: t('menu.enable'), run: () => bridge.setEnabled(path, true).then(() => undefined) }]
        }
        return [
          open,
          ...row.state === 'failed' ? [{ id: 'retry', label: t('menu.retry'), run: () => bridge.retry(path).then(() => undefined) }] : [],
          { id: 'disable', label: t('menu.disable'), run: () => bridge.setEnabled(path, false).then(() => undefined) },
        ]
      },
    }), 'codegraph workspace menu'))
  },
}

/** 工作区 id → 目录。列表在会话侧栏的 store 里；拿不到就当未知，不给菜单项。 */
function workspacePathOf(ctx: ClientContext, workspaceId: string | undefined): string | undefined {
  if (workspaceId === undefined) return undefined
  const listed = ctx.get('workspaces')?.list?.getSnapshot?.()
  const found = listed?.items?.find?.((item: { workspaceId?: string }) => item.workspaceId === workspaceId)
  return typeof found?.path === 'string' ? found.path : undefined
}

/**
 * 包一层错误边界：面板自身的异常在这里被接住并显示成一行文字。
 *
 * 详情页的 list 型 slot 对条目有一条硬规则：崩过一次就永久退休，页面上再也
 * 回不来。所以内部组件必须自己承担失败，不能让它冒到 slot 的边界上。
 */
class PanelBoundary extends React.Component<{ children?: React.ReactNode; fallback: string }, { error: string | undefined }> {
  override state: { error: string | undefined } = { error: undefined }

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  override render(): React.ReactElement {
    if (this.state.error !== undefined) {
      return React.createElement('p', { role: 'alert', 'data-codegraph-error': '' }, `${this.props.fallback}: ${this.state.error}`)
    }
    return React.createElement(React.Fragment, null, this.props.children ?? null)
  }
}

/**
 * 首帧渲染一个不含副作用的骨架，挂载后再换成真面板。
 *
 * 详情页的 list 型 slot 有一个硬约束：条目首帧抛错就永久退休。骨架不读数据、
 * 不订阅、不发请求，先把条目稳定下来，再让真面板自己承担它的失败。
 */
function DelayedPanel(props: { admin: CodegraphAdmin | undefined; t: (key: string, params?: Record<string, unknown>) => string; pluginName: string }): React.ReactElement {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    const timer = setTimeout(() => { setReady(true) }, 0)
    return () => { clearTimeout(timer) }
  }, [])
  if (!ready) return React.createElement('p', { 'data-codegraph-pending': '' }, props.t('panel.busy'))
  return React.createElement(PanelBoundary, { fallback: props.t('panel.title') }, React.createElement(WorkspacePanel, props))
}

interface OverlayProps {
  readonly subscribe: (listener: () => void) => () => void
  readonly getOpen: () => boolean
  readonly onClose: () => void
  readonly admin: () => CodegraphAdmin | undefined
  readonly t: (key: string, params?: Record<string, unknown>) => string
}

/** 订阅浮层状态的最小包装；关闭时不渲染任何东西。 */
function WorkspaceOverlay({ subscribe, getOpen, onClose, admin, t }: OverlayProps): React.ReactElement | null {
  const open = React.useSyncExternalStore(subscribe, getOpen)
  if (!open) return null
  return <CodegraphDialog admin={admin()} t={t} pluginName={PACKAGE_ID} onClose={onClose} />
}
