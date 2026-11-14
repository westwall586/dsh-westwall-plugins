/** Browser half: locale, Mermaid fence, viewer overlay, header badge, and settings page. */
import * as React from 'react'
import en from '../../locale/en.json'
import zh from '../../locale/zh.json'
import CSS from './styles.css'
import { createBadge } from './badge.tsx'
import type { ClientContext, Translate } from './context.ts'
import { MermaidFence } from './fence.tsx'
import { watchTheme } from './mermaid-engine.ts'
import { FriendlyExpressionIcon, createSettingsSection } from './settings.tsx'
import { saveSvg } from './ui.tsx'
import { ViewerOverlay } from './viewer.tsx'

const NS = 'friendly-expression'
const ENTRY_ID = 'friendly-expression'
const STYLE_ATTRIBUTE = 'data-dsh-friendly-expression'
const FENCE_SLOT = 'conversation.chat.markdown.fence'
const OVERLAY_SLOT = 'shell.overlay'
const UTILITIES_SLOT = 'conversation.session.header.utilities'
const SECTION_SLOT = 'settings.section'
const ICON_SLOT = 'settings.section.icon'

function uiDictionary(source: object): Record<string, string> {
  const dictionary: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') dictionary[key] = value
  }
  return dictionary
}

export default {
  inject: ['slots', 'locale'],

  apply(ctx: ClientContext): void {
    ctx.effect(() => ctx.locale.register(NS, {
      zh: uiDictionary(zh),
      en: uiDictionary(en),
      'zh-CN': uiDictionary(zh),
      'en-US': uiDictionary(en),
    }), 'friendly-expression locale')

    const t = ctx.locale.bind(NS)

    ctx.effect(() => {
      const style = document.createElement('style')
      style.setAttribute(STYLE_ATTRIBUTE, '')
      style.textContent = CSS
      document.head.append(style)
      return () => style.remove()
    }, 'friendly-expression styles')

    watchTheme(ctx)

    ctx.effect(() => ctx.slots.inject(FENCE_SLOT, () => ctx.slots.register({
      name: FENCE_SLOT,
      id: '@westwall/dsh-friendly-expression/fence/mermaid',
      key: 'mermaid',
      locale: NS,
    }, MermaidFence)), 'friendly-expression Mermaid fence')

    const Viewer = (props: { t: Translate }) => React.createElement(ViewerOverlay, {
      ...props,
      saveFile: (svg: string, title: string) => saveSvg(ctx, svg, title),
    })
    ctx.effect(() => ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register({
      name: OVERLAY_SLOT,
      id: 'friendly-expression-viewer',
      order: 20,
      locale: NS,
    }, Viewer)), 'friendly-expression viewer')

    ctx.inject(['configForms'], scoped => {
      const forms = scoped.configForms
      if (forms === undefined) return
      const form = forms.get(ENTRY_ID)
      const Badge = createBadge(form)
      const SettingsSection = createSettingsSection(form)

      scoped.effect(() => scoped.slots.inject(UTILITIES_SLOT, () => scoped.slots.register({
        name: UTILITIES_SLOT,
        id: 'friendly-expression-badge',
        order: 5,
        locale: NS,
      }, Badge)), 'friendly-expression badge')

      const registerSettings = (): (() => void) => {
        const offSection = scoped.slots.inject(SECTION_SLOT, () => scoped.slots.register({
          name: SECTION_SLOT,
          id: ENTRY_ID,
          order: 15.5,
          label: () => t('settings.nav'),
          locale: NS,
        }, SettingsSection))
        const offIcon = scoped.slots.inject(ICON_SLOT, () => scoped.slots.register({
          name: ICON_SLOT,
          id: ENTRY_ID,
          order: 15.5,
          locale: NS,
        }, FriendlyExpressionIcon))
        return () => {
          offSection()
          offIcon()
        }
      }

      const whileServed = forms.whileServed?.bind(forms)
      if (whileServed !== undefined) {
        scoped.effect(() => whileServed([ENTRY_ID], registerSettings), 'friendly-expression settings')
      } else {
        scoped.effect(registerSettings, 'friendly-expression settings')
      }
    })
  },
}
