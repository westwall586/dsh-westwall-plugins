/** Browser half: locale, the Markdown renderer registration, and its body. */
import CSS from './styles.css'
import { Body, type BodyInjected } from './body.tsx'
import type { ClientContext, HostBridge, SidebarRight } from './context.ts'
import { mountHostBridge } from './host.ts'
import { LINE_MENU_KIND, lookUpSource, type LineMenuValue } from './menus.ts'
import { en, zh } from './locales.ts'

const NS = 'active-markdown'
const ID = 'active-markdown'
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

    // One contribution for our line family; the shared menu owns the popup.
    ctx.inject(['contextMenus'], (menus) => {
      menus.effect(() => menus.contextMenus.register({
        id: 'active-markdown.look-source',
        target: LINE_MENU_KIND,
        order: 20,
        resolve: (target: LineMenuValue) => [{
          id: 'look-source',
          label: t('peek.action'),
          run: () => lookUpSource(target),
        }],
      }), 'active-markdown line menu')
    })
    let bridge: Promise<HostBridge> | undefined
    const host = (): Promise<HostBridge> => (bridge ??= mountHostBridge(ctx))
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
