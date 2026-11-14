/** One row in the browser tab's actions menu. */
import { createElement } from 'react'
import { useActivePageLoading } from './page-loading.mjs'
import { PagePlusIcon } from './icons.mjs'
import { isDesktopGlobal, tabMenuItemVisible } from './visibility.mjs'

/**
 * @param deps - `{ clip, t }`.
 * @returns the slot component for `sidebar.right.tab.menu.item`.
 */
export function createTabMenuItem({ clip, t, sidebarRight }) {
  return function TabMenuItem(props) {
    const { tab, dismiss, sessionId, inputActions } = props
    const loading = useActivePageLoading()
    if (!tabMenuItemVisible({ desktop: isDesktopGlobal(), tabKind: tab?.kind })) return null
    const tabLoading = loading && sidebarRight?.active?.()?.id === tab?.id
    const label = t('tabMenu.label')
    const run = () => {
      if (tabLoading) return
      dismiss?.()
      void clip({ sessionId, inputActions, tab })
    }
    return createElement('button', {
      type: 'button',
      role: 'menuitem',
      className: 'dwc-menu-item',
      title: tabLoading ? t('tabMenu.loading') : label,
      disabled: tabLoading,
      'aria-disabled': tabLoading ? 'true' : undefined,
      onClick: run,
    },
    createElement(PagePlusIcon, { size: 14 }),
    createElement('span', { className: 'dwc-menu-item-label' }, label))
  }
}