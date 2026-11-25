/** Browser half: locale, the Markdown renderer registration, and its body. */
import CSS from './styles.css'
import { createAttachmentController, type AttachmentController } from './annotate/attachment.ts'
import { AnnotationCommitter, type CommitterInjected } from './annotate/committer.tsx'
import { createPendingHub } from './annotate/committer.ts'
import { Body, type BodyInjected } from './body.tsx'
import type { ClientContext, ConversationPort, HostBridge, SidebarRight } from './context.ts'
import { openExternal } from './external.ts'
import { mountHostBridge } from './host.ts'
import { SELECTION_MENU_KIND, selectionActions, type SelectionMenuValue } from './menus.ts'
import { en, zh } from './locales.ts'
import { createSettingsPage } from './settings.tsx'
import { createDocumentStore } from './store/index.ts'
import { createCloseObserver, type Registration } from './store/observer.ts'

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

    // One document store for the plugin's lifetime; each document's state lives
    // in its own crate, and the body and the session committer reach the same one.
    let bridge: Promise<HostBridge> | undefined
    const host = (): Promise<HostBridge> => (bridge ??= mountHostBridge(ctx))
    const documents = createDocumentStore({ host })
    const pendingHub = createPendingHub()

    // The body unmounts whenever the tab is hidden, so a close that happens
    // then has no listener in the body; the host aborts `tab.signal` for both a
    // vanished record and this plugin unloading, so the observer discovers a
    // close from `openTabs` alone and turns `unload` into memory-only disposal.
    const sidebar = ctx.get('sidebarRight') as SidebarRight | null | undefined
    const openTabs = sidebar?.openTabs
    const observer = createCloseObserver({
      documents,
      openAddresses: () => new Set((openTabs?.getSnapshot() ?? []).map(tab => tab.contentId)),
      dispose: (session, path) => {
        // Closing has already happened from the reader's point of view; the disk
        // cleanup only needs a log if it fails.
        void Promise.resolve(documents.dispose(session, path, 'close')).catch((error: unknown) => {
          console.error('[active-markdown] close cleanup failed', error)
        })
      },
    })
    // The flag and the teardown live in one effect: its cleanup runs before the
    // host aborts every tab signal, which is what separates unload from close.
    ctx.effect(() => {
      if (openTabs === undefined) return
      const unsubscribe = openTabs.subscribe(() => observer.check())
      return () => {
        observer.dispose()
        unsubscribe()
      }
    }, 'active-markdown close observer')
    const conversationFor = (sessionId: string): ConversationPort | null => {
      const root = ctx.get('conversation') as ConversationPort | null | undefined
      if (root !== null && root !== undefined && typeof root.createDrafts === 'function') return root
      const scoped = (ctx.get('sessions') as { scope?: (id: string) => { get?: (name: string) => unknown } } | null | undefined)
        ?.scope?.(sessionId)?.get?.('conversation') as ConversationPort | null | undefined
      if (scoped !== null && scoped !== undefined && typeof scoped.createDrafts === 'function') return scoped
      return null
    }
    // 一份文档的批注事务绑它的 crate：锁、快照与写入必须是同一个 composer 维度。
    const attachmentFor = (sessionId: string, path: string): AttachmentController => {
      const { notes, withLock } = documents.notesFor(sessionId, path, sessionId)
      return createAttachmentController({
        store: notes,
        withLock,
        composeSession: () => sessionId,
        host,
        conversation: conversationFor,
      })
    }

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
          documents,
          register: (mount): Registration => {
            // 挂载这一刻先对一次表：页签在 body 挂上来之前就关掉了。
            const registration = observer.register(mount)
            observer.check()
            return registration
          },
          attachmentFor,
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
          documents,
          hub: pendingHub,
          // The committer's scope is one session, and that session is the
          // composer that attaches the feedback files it watches.
          attachments: sessionId => attachmentFor(sessionId, sessionId),
          host,
        }),
      }, AnnotationCommitter)), 'active-markdown annotation committer')
    })
  },
}
