/** One row in the browser tab's actions menu. */
import { createElement } from 'react'
import { PagePlusIcon } from './icons.mjs'
import { isDesktopGlobal, tabMenuItemVisible } from './visibility.mjs'

/**
 * @param deps - `{ clip, t }`.
 * @returns the slot component for `sidebar.right.tab.menu.item`.
 */
export function createTabMenuItem({ clip, t }) {
  return function TabMenuItem(props) {
    const { tab, dismiss, sessionId, inputActions } = props
    if (!tabMenuItemVisible({ desktop: isDesktopGlobal(), tabKind: tab?.kind })) return null
    const label = t('tabMenu.label')
    const run = () => {
      dismiss?.()
      void clip({ sessionId, inputActions, tab })
    }
    return createElement('button', {
      type: 'button',
      role: 'menuitem',
      className: 'dwc-menu-item',
      title: label,
      onClick: run,
    },
    createElement(PagePlusIcon, { size: 14 }),
    createElement('span', { className: 'dwc-menu-item-label' }, label))
  }
}