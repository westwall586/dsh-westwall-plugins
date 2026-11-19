/** Browser half: locale, the Markdown renderer registration, and its body. */
import CSS from './styles.css'
import { createAttachmentController } from './annotate/attachment.ts'
import { AnnotationCommitter, type CommitterInjected } from './annotate/committer.tsx'
import { createPendingHub } from './annotate/committer.ts'
import { createAnnotationStore } from './annotate/store.ts'
import { Body, type BodyInjected } from './body.tsx'
import type { ClientContext, ConversationPort, HostBridge, SidebarRight } from './context.ts'
import { openExternal } from './external.ts'
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

    // One draft store for the plugin's lifetime; the body and the session
    // committer share it instead of each opening their own copy.
    let bridge: Promise<HostBridge> | undefined
    const host = (): Promise<HostBridge> => (bridge ??= mountHostBridge(ctx))
    const annotationStore = createAnnotationStore({ host })
    const pendingHub = createPendingHub()
    const conversationFor = (sessionId: string): ConversationPort | null => {
      const root = ctx.get('conversation') as ConversationPort | null | undefined
      if (root !== null && root !== undefined && typeof root.createDrafts === 'function') return root
      const scoped = (ctx.get('sessions') as { scope?: (id: string) => { get?: (name: string) => unknown } } | null | undefined)
        ?.scope?.(sessionId)?.get?.('conversation') as ConversationPort | null | undefined
      if (scoped !== null && scoped !== undefined && typeof scoped.createDrafts === 'function') return scoped
      return null
    }
    const attachment = createAttachmentController({ store: annotationStore, host, conversation: conversationFor })

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
          // The browser page type is desktop-only and registers independently of
          // this preview, so the lookup happens per click, not at mount.
          openExternal: (url) => {
            openExternal(
              url,
              scoped.get('sidebarRight') as SidebarRight | undefined,
              (href) => { window.open(href, '_blank', 'noopener,noreferrer') },
            )
          },
          host,
          annotations: annotationStore,
          attachment,
          hub: pendingHub,
          openMenu: (target, point) => {
            const menus = ctx.get('contextMenus')
            if (menus === undefined || menus === null) return false
            menus.open(target, point)
            return true
          },
        }),
      }, Body)), 'active-markdown body')
    })

    // Session scope, not a document tab: a send clears every document whose
    // attachment entered the message, even when its tab is closed.
    ctx.inject(['slots'], (scoped) => {
      scoped.effect(() => scoped.slots.inject('conversation.input.left', () => scoped.slots.register({
        name: 'conversation.input.left',
        id: 'active-markdown-annotation-committer',
        order: 40,
        locale: NS,
        inject: (): CommitterInjected => ({
          annotations: annotationStore,
          hub: pendingHub,
          attachments: attachment,
          host,
        }),
      }, AnnotationCommitter)), 'active-markdown annotation committer')
    })
  },
}
