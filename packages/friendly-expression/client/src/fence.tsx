/** Mermaid fence layer streams the host code block, then swaps in a rendered diagram card. */
import * as React from 'react'
import { detectDiagramType, errorCopyText, errorSummary, titleFromCode } from './core.ts'
import type { Translate } from './context.ts'
import { renderMermaid, useResolvedTheme } from './mermaid-engine.ts'
import { CodeIcon, CopyIcon, ExpandIcon, MermaidIcon, copyText } from './ui.tsx'
import { openViewer } from './viewer.tsx'

export interface MermaidFenceProps {
  code: string
  streaming?: boolean
  children?: React.ReactNode
  meta?: string
  t: Translate
}

type RenderState =
  | { kind: 'loading' }
  | { kind: 'ready'; svg: string }
  | { kind: 'error'; message: string }

export function MermaidFence({ code, streaming, children, meta, t }: MermaidFenceProps): React.ReactElement | null {
  const theme = useResolvedTheme()
  const [sourceView, setSourceView] = React.useState(false)
  const [state, setState] = React.useState<RenderState>({ kind: 'loading' })
  const [feedback, setFeedback] = React.useState<string | null>(null)
  const [visible, setVisible] = React.useState(false)
  const [host, setHost] = React.useState<HTMLElement | null>(null)
  const timer = React.useRef<number | undefined>(undefined)

  const title = React.useMemo(
    () => titleFromCode(code, meta) ?? t(`types.${detectDiagramType(code)}`),
    [code, meta, t],
  )

  React.useEffect(() => {
    if (visible || host === null) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '200px 0px' })
    observer.observe(host)
    return () => observer.disconnect()
  }, [host, visible])

  React.useEffect(() => {
    if (streaming === true || !visible) return
    let cancelled = false
    setState({ kind: 'loading' })
    renderMermaid(code, theme).then(svg => {
      if (!cancelled) setState({ kind: 'ready', svg })
    }).catch((error: unknown) => {
      console.error('[dsh-friendly-expression] Mermaid render failed', error)
      if (!cancelled) setState({ kind: 'error', message: errorSummary(error) })
    })
    return () => { cancelled = true }
  }, [code, streaming, theme, visible])

  React.useEffect(() => () => window.clearTimeout(timer.current), [])

  const showFeedback = (text: string): void => {
    window.clearTimeout(timer.current)
    setFeedback(text)
    timer.current = window.setTimeout(() => setFeedback(null), 2200)
  }

  if (streaming === true) return React.createElement(React.Fragment, null, children)
  if (children === undefined || children === null) return null

  const copySource = async (): Promise<void> => {
    const copied = await copyText(code)
    showFeedback(copied ? t('fence.copied') : t('fence.copyFailed'))
  }

  const copyError = async (message: string): Promise<void> => {
    const copied = await copyText(errorCopyText(t('fence.errorCopyText'), message))
    showFeedback(copied ? t('fence.copyFeedback') : t('fence.copyFailed'))
  }

  const head = React.createElement('header', { className: 'dfe-card-head' },
    React.createElement('span', { className: 'dfe-card-brand' },
      React.createElement(MermaidIcon, { size: 15 }),
      React.createElement('span', null, 'MERMAID')),
    feedback === null ? null : React.createElement('span', { className: 'dfe-card-feedback', role: 'status' }, feedback),
    React.createElement('div', { className: 'dfe-card-tools' },
      React.createElement('button', {
        type: 'button',
        className: 'dfe-icon-btn',
        title: sourceView ? t('fence.diagram') : t('fence.source'),
        'aria-label': sourceView ? t('fence.diagram') : t('fence.source'),
        onClick: () => setSourceView(value => !value),
      }, React.createElement(sourceView ? MermaidIcon : CodeIcon, { size: 15 })),
      React.createElement('button', {
        type: 'button',
        className: 'dfe-icon-btn',
        title: t('fence.copySource'),
        'aria-label': t('fence.copySource'),
        onClick: () => { void copySource() },
      }, React.createElement(CopyIcon)),
      state.kind !== 'ready' ? null : React.createElement('button', {
        type: 'button',
        className: 'dfe-icon-btn',
        title: t('fence.expand'),
        'aria-label': t('fence.expand'),
        onClick: () => openViewer({ title, code, svg: state.svg }),
      }, React.createElement(ExpandIcon))))

  if (!visible) return React.createElement('div', {
    ref: setHost,
    className: 'dfe-fence-placeholder',
    'aria-busy': 'true',
  })

  if (sourceView) {
    return React.createElement('section', { ref: setHost, className: 'dfe-card' }, head,
      React.createElement('div', { className: 'dfe-card-source' }, children))
  }

  if (state.kind === 'error') {
    return React.createElement('section', { ref: setHost, className: 'dfe-card' },
      head,
      React.createElement('div', { className: 'dfe-error', role: 'alert' },
        React.createElement('div', { className: 'dfe-error-title' }, t('fence.errorTitle')),
        React.createElement('div', { className: 'dfe-error-detail' }, state.message),
        React.createElement('div', { className: 'dfe-error-actions' },
          React.createElement('button', {
            type: 'button',
            className: 'dfe-btn dfe-btn--primary',
            onClick: () => { void copyError(state.message) },
          }, t('fence.copyError')),
          React.createElement('button', {
            type: 'button',
            className: 'dfe-btn',
            onClick: () => setSourceView(true),
          }, t('fence.viewSource')))),
      React.createElement('div', { className: 'dfe-card-source' }, children))
  }

  if (state.kind === 'loading') {
    return React.createElement('section', { ref: setHost, className: 'dfe-card' },
      head,
      React.createElement('div', { className: 'dfe-diagram dfe-diagram--loading', 'aria-busy': 'true' },
        React.createElement('span', { className: 'dfe-loading-dot' }),
        React.createElement('span', null, t('fence.rendering'))))
  }

  return React.createElement('section', { ref: setHost, className: 'dfe-card' }, head,
    React.createElement(DiagramBody, { svg: state.svg, title, code, t }))
}

function DiagramBody({ svg, title, code, t }: {
  svg: string
  title: string
  code: string
  t: Translate
}): React.ReactElement {
  const [url, setUrl] = React.useState<string>()
  React.useEffect(() => {
    const next = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [svg])

  const open = (): void => openViewer({ title, code, svg })

  return React.createElement('div', {
    className: 'dfe-diagram',
    role: 'button',
    tabIndex: 0,
    'aria-label': t('fence.openViewer'),
    onClick: open,
    onKeyDown: event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        open()
      }
    },
  },
  url === undefined ? null : React.createElement('img', {
    className: 'dfe-diagram-image', src: url, alt: title, draggable: false,
  }),
  React.createElement('span', { className: 'dfe-diagram-hint' }, t('fence.zoomHint')))
}
