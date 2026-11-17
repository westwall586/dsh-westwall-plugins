/** Browser half: locale, the Markdown renderer registration, and its body. */
import CSS from './styles.css'
import { createAnnotationStore } from './annotate/store.ts'
import { Body, type BodyInjected } from './body.tsx'
import type { ClientContext, HostBridge, SidebarRight } from './context.ts'
import { mountHostBridge } from './host.ts'
import { SELECTION_MENU_KIND, selectionActions, type SelectionMenuValue } from './menus.ts'
import { en, zh } from './locales.ts'
import { createSettingsPage } from './settings.tsx'

const NS = 'active-markdown'
const ID = 'active-markdown'
const PACKAGE_ID = '@westwall/dsh-active-markdown'
const STYLE_ATTRIBUTE = 'data-dsh-active-markdown'

export default {
  inject: ['slots', 'locale', 'remote', 'contextMenus'],

  apply(ctx: ClientContext): void {
    ctx.effect(() => ctx.locale.register(NS, {
      zh,
      en,
      'zh-CN': zh,
      'en-US': en,
    }), 'active-markdown locale')

    ctx.effect(() => {
      const style = document.createElement('style')
      style.setAttribute(STYLE_ATTRIBUTE, '')
      style.textContent = CSS
      document.head.append(style)
      return () => style.remove()
    }, 'active-markdown styles')

    const t = ctx.locale.bind(NS)

    // One draft store for the plugin's lifetime; the body and a future session
    // committer share it instead of each opening their own copy.
    let bridge: Promise<HostBridge> | undefined
    const host = (): Promise<HostBridge> => (bridge ??= mountHostBridge(ctx))
    const annotationStore = createAnnotationStore({ host })

    // One contribution for our selection family; the shared menu owns the popup.
    ctx.inject(['contextMenus'], (menus) => {
      menus.effect(() => menus.contextMenus.register({
        id: 'active-markdown.selection',
        target: SELECTION_MENU_KIND,
        order: 20,
        resolve: (target: SelectionMenuValue) => selectionActions(target, {
          annotate: t('annotate.action'),
          copy: t('code.copy'),
          showSource: t('peek.action'),
        }),
      }), 'active-markdown selection menu')
    })

    // The plugin page owns the three settings; the preview only reads them.
    ctx.inject(['configForms'], (scoped) => {
      const forms = scoped.configForms
      if (forms === undefined) return
      const SettingsPage = createSettingsPage({ form: forms.get(ID), host, t })
      const register = (): (() => void) => scoped.slots.inject('plugins.bundle.config', () => scoped.slots.register({
        name: 'plugins.bundle.config',
        key: PACKAGE_ID,
        locale: NS,
      }, SettingsPage))
      const whileServed = forms.whileServed?.bind(forms)
      if (whileServed !== undefined) {
        scoped.effect(() => whileServed([ID], register), 'active-markdown settings')
      } else {
        scoped.effect(register, 'active-markdown settings')
      }
    })

    ctx.inject(['documentPreviews', 'remote.workspaceFiles'], (scoped) => {
      scoped.effect(() => scoped.documentPreviews.register({
        id: ID,
        extensions: ['md', 'markdown'],
        priority: 'extension',
        title: () => t('viewer.label'),
        loading: 'renderer',
        wrap: false,
      }), 'active-markdown renderer')

      scoped.effect(() => scoped.slots.inject('sidebar.right.tab.document', () => scoped.slots.register({
        name: 'sidebar.right.tab.document',
        key: ID,
        locale: NS,
        inject: (): BodyInjected => ({
          readBytes: (sessionId, path, options, signal) => scoped.remote.workspaceFiles.readBytes(sessionId, path, options, signal),
          openResource: (address) => (scoped.get('sidebarRight') as SidebarRight | undefined)?.openResource(address),
          host,
          annotations: annotationStore,
          openMenu: (target, point) => {
            const menus = ctx.get('contextMenus')
            if (menus === undefined || menus === null) return false
            menus.open(target, point)
            return true
          },
        }),
      }, Body)), 'active-markdown body')
    })
  },
}
