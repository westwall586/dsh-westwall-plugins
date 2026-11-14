/**
 * @westwall/dsh-web-clipper client entry.
 *
 * Registers the locale and styles, then mounts the two official extension
 * seats through the one shared clip pipeline. Nothing here observes the DOM or
 * injects controls into host chrome.
 */
import en from '../../locale/en.json'
import zh from '../../locale/zh.json'
import { attachArtifact } from './attach.mjs'
import { createClipper, waitForFrames } from './clip.mjs'
import { extractArticle } from './extractor.mjs'
import { createToastHost } from './toast.mjs'
import { createCopyApi } from './remote.mjs'
import { createComposerButton } from './ui/composer-button.mjs'
import { createDetailSection } from './ui/detail.mjs'
import { createSettingsPage } from './ui/settings.mjs'
import { createTabMenuItem } from './ui/tab-menu-item.mjs'
import { isDesktopGlobal } from './ui/visibility.mjs'
import { captureActivePage } from './webview.mjs'
import CSS from './styles.css'

const NAMESPACE = 'webClipper'
const STYLE_ATTRIBUTE = 'data-dsh-web-clipper-style'
const TAB_MENU_SLOT = 'sidebar.right.tab.menu.item'
const COMPOSER_SLOT = 'conversation.input.left'
const ENTRY_ID = 'web-clipper'
const ENTRY_ORDER = 40

export default {
  inject: ['slots', 'locale', 'sidebarRight', 'remote', 'uiWorkspace'],

  apply(ctx) {
    ctx.effect(
      () => ctx.locale.register(NAMESPACE, { zh, en, 'zh-CN': zh, 'en-US': en }),
      'webClipper locale',
    )
    const t = ctx.locale.bind(NAMESPACE)

    ctx.effect(() => {
      const style = document.createElement('style')
      style.setAttribute(STYLE_ATTRIBUTE, '')
      style.textContent = CSS
      document.head.append(style)
      return () => style.remove()
    }, 'webClipper styles')

    const toast = createToastHost(t)
    ctx.effect(() => () => toast.dispose(), 'webClipper toast')

    const sidebarRight = ctx.sidebarRight
    const copy = createCopyApi(ctx)
    // Warm the Remote namespace so the first clip does not wait for its mount.
    void copy.directory().catch(() => {})
    const clipper = createClipper({
      capture: () => captureActivePage(),
      extract: extractArticle,
      attach: attachArtifact,
      copy,
      toast,
      t,
      sidebarRight,
      conversationFor: (sessionId) => {
        const conversation = ctx.get('conversation')
        if (conversation !== undefined && conversation !== null
          && typeof conversation.createDrafts === 'function') {
          return conversation
        }
        return ctx.get('sessions')?.scope?.(sessionId)?.get?.('conversation')
      },
      desktop: isDesktopGlobal,
      now: () => new Date(),
      waitFrames: () => waitForFrames(2),
    })

    ctx.effect(
      () => ctx.slots.inject(TAB_MENU_SLOT, () => ctx.slots.register({
        name: TAB_MENU_SLOT,
        id: ENTRY_ID,
        order: ENTRY_ORDER,
      }, createTabMenuItem({ clip: clipper.clip, t, sidebarRight }))),
      'webClipper tab menu entry',
    )

    ctx.effect(
      () => ctx.slots.inject(COMPOSER_SLOT, () => ctx.slots.register({
        name: COMPOSER_SLOT,
        id: ENTRY_ID,
        order: ENTRY_ORDER,
      }, createComposerButton({ clip: clipper.clip, t, openTabs: sidebarRight.openTabs }))),
      'webClipper composer entry',
    )

    const settingsDeps = { ctx, copy, t, desktop: isDesktopGlobal() }
    const BundleSettingsPage = createSettingsPage(settingsDeps)
    const RowSettingsPage = createSettingsPage(settingsDeps)
    const StandaloneRowSettingsPage = createSettingsPage(settingsDeps)
    ctx.effect(
      () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: '@westwall/dsh-web-clipper',
      }, BundleSettingsPage)),
      'webClipper bundle settings',
    )
    ctx.effect(
      () => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
        name: 'plugins.row.config',
        key: '@westwall/dsh-feed-ultra#dsh-web-clipper',
      }, RowSettingsPage)),
      'webClipper row settings',
    )
    ctx.effect(
      () => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
        name: 'plugins.row.config',
        key: '@westwall/dsh-web-clipper#dsh-web-clipper',
      }, StandaloneRowSettingsPage)),
      'webClipper standalone row settings',
    )
    const DetailSection = createDetailSection({ t })
    ctx.effect(
      () => ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
        name: 'plugins.detail.section',
        id: 'web-clipper-help',
        order: 20,
      }, DetailSection)),
      'webClipper row help',
    )
  },
}
