/** Session header badge shown while the configured prompt is non-empty. */
import * as React from 'react'
import { readPromptValue } from './core.ts'
import type { ConfigForm, Translate } from './context.ts'
import { SpeechIcon } from './ui.tsx'

interface BadgeProps {
  t: Translate
}

export function createBadge(form: ConfigForm): React.ComponentType<BadgeProps> {
  return function FriendlyExpressionBadge({ t }: BadgeProps): React.ReactElement | null {
    const subscribe = React.useCallback((listener: () => void) => form.subscribe(listener), [form])
    const readSnapshot = React.useCallback(() => form.getSnapshot(), [form])
    const snapshot = React.useSyncExternalStore(subscribe, readSnapshot, readSnapshot)
    if (snapshot.status !== 'ready') return null
    const prompt = readPromptValue((snapshot.value as { stylePrompt?: unknown } | undefined)?.stylePrompt)
    if (prompt.length === 0) return null
    return React.createElement('span', {
      className: 'dfe-badge',
      tabIndex: 0,
      role: 'img',
      'aria-label': t('badge.tooltip'),
      title: t('badge.tooltip'),
    },
    React.createElement(SpeechIcon, { size: 15 }),
    React.createElement('span', { className: 'dfe-badge-tip', role: 'tooltip' }, t('badge.tooltip')))
  }
}
