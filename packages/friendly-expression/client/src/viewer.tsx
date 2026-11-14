/** Frame overlay viewer with fit, zoom, pan, copy, download, and focus handling. */
import * as React from 'react'
import { clampZoom, fitScale } from './core.ts'
import type { Translate } from './context.ts'
import { CloseIcon, CopyIcon, DownloadIcon, copyText } from './ui.tsx'

export interface ViewerPayload {
  title: string
  code: string
  svg: string
}

interface ViewerState extends ViewerPayload {
  token: number
  opener: HTMLElement | null
}

let current: ViewerState | null = null
let token = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function openViewer(payload: ViewerPayload): void {
  token += 1
  current = {
    ...payload,
    token,
    opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
  }
  emit()
}

export function closeViewer(): void {
  if (current === null) return
  current = null
  emit()
}

function subscribeViewer(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getViewerSnapshot(): ViewerState | null {
  return current
}

interface ViewerOverlayProps {
  t: Translate
  saveFile: (svg: string, title: string) => Promise<void>
}

interface ViewTransform {
  scale: number
  x: number
  y: number
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function ViewerOverlay({ t, saveFile }: ViewerOverlayProps): React.ReactElement | null {
  const state = React.useSyncExternalStore(subscribeViewer, getViewerSnapshot, getViewerSnapshot)
  if (state === null) return null
  return React.createElement(ViewerDialog, { key: state.token, state, t, saveFile })
}

function ViewerDialog({ state, t, saveFile }: {
  state: ViewerState
  t: Translate
  saveFile: (svg: string, title: string) => Promise<void>
}): React.ReactElement {
  const dialog = React.useRef<HTMLDivElement>(null)
  const canvas = React.useRef<HTMLDivElement>(null)
  const image = React.useRef<HTMLImageElement>(null)
  const closeButton = React.useRef<HTMLButtonElement>(null)
  const drag = React.useRef<{ pointerId: number; startX: number; startY: number; x: number; y: number } | null>(null)
  const feedbackTimer = React.useRef<number | undefined>(undefined)
  const [view, setView] = React.useState<ViewTransform>({ scale: 1, x: 0, y: 0 })
  const [dragging, setDragging] = React.useState(false)
  const [feedback, setFeedback] = React.useState<string | null>(null)

  const [url, setUrl] = React.useState<string>()
  React.useEffect(() => {
    const next = URL.createObjectURL(new Blob([state.svg], { type: 'image/svg+xml' }))
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [state.svg])

  const fitToWindow = React.useCallback(() => {
    const area = canvas.current
    const img = image.current
    if (area === null || img === null) return
    const box = area.getBoundingClientRect()
    const width = img.naturalWidth || box.width
    const height = img.naturalHeight || box.height
    const scale = fitScale(box.width, box.height, width, height)
    setView({
      scale,
      x: (box.width - width * scale) / 2,
      y: (box.height - height * scale) / 2,
    })
  }, [])

  const centerAt = React.useCallback((scale: number) => {
    const area = canvas.current
    const img = image.current
    if (area === null || img === null) return
    const box = area.getBoundingClientRect()
    const width = img.naturalWidth || box.width
    const height = img.naturalHeight || box.height
    setView({
      scale,
      x: (box.width - width * scale) / 2,
      y: (box.height - height * scale) / 2,
    })
  }, [])

  const showFeedback = React.useCallback((text: string) => {
    window.clearTimeout(feedbackTimer.current)
    setFeedback(text)
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), 2200)
  }, [])

  React.useEffect(() => () => window.clearTimeout(feedbackTimer.current), [])

  React.useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButton.current?.focus()
    return () => {
      const target = state.opener ?? previous
      if (target !== null && typeof target.focus === 'function') target.focus()
    }
  }, [state])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeViewer()
        return
      }
      if (event.key !== 'Tab') return
      const root = dialog.current
      if (root === null) return
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(item => item.offsetParent !== null)
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  React.useEffect(() => {
    const area = canvas.current
    if (area === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const box = area.getBoundingClientRect()
      const px = event.clientX - box.left
      const py = event.clientY - box.top
      setView(previous => {
        const next = clampZoom(previous.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12))
        const ratio = next / previous.scale
        return { scale: next, x: px - ratio * (px - previous.x), y: py - ratio * (py - previous.y) }
      })
    }
    area.addEventListener('wheel', onWheel, { passive: false })
    return () => area.removeEventListener('wheel', onWheel)
  }, [])

  React.useEffect(() => {
    const area = canvas.current
    if (area === null) return
    const observer = new ResizeObserver(() => fitToWindow())
    observer.observe(area)
    return () => observer.disconnect()
  }, [fitToWindow])

  const zoomBy = (factor: number): void => {
    const area = canvas.current
    if (area === null) return
    const box = area.getBoundingClientRect()
    const px = box.width / 2
    const py = box.height / 2
    setView(previous => {
      const next = clampZoom(previous.scale * factor)
      const ratio = next / previous.scale
      return { scale: next, x: px - ratio * (px - previous.x), y: py - ratio * (py - previous.y) }
    })
  }

  const copySource = async (): Promise<void> => {
    const copied = await copyText(state.code)
    showFeedback(copied ? t('viewer.copied') : t('viewer.copyFailed'))
  }

  const download = async (): Promise<void> => {
    try {
      await saveFile(state.svg, state.title)
    } catch {
      showFeedback(t('viewer.saveFailed'))
    }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: view.x,
      y: view.y,
    }
    setDragging(true)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const active = drag.current
    if (active === null || active.pointerId !== event.pointerId) return
    setView(previous => ({
      ...previous,
      x: active.x + event.clientX - active.startX,
      y: active.y + event.clientY - active.startY,
    }))
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const active = drag.current
    if (active === null || active.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return React.createElement('div', {
    className: 'dfe-viewer',
    onWheel: event => { event.preventDefault() },
    onPointerDown: event => {
      if (event.target === event.currentTarget) closeViewer()
    },
  },
  React.createElement('div', {
    ref: dialog,
    className: 'dfe-viewer-panel',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'dfe-viewer-title',
  },
  React.createElement('header', { className: 'dfe-viewer-head' },
    React.createElement('h2', { className: 'dfe-viewer-title', id: 'dfe-viewer-title' }, state.title),
    React.createElement('div', { className: 'dfe-viewer-actions' },
      React.createElement('button', {
        type: 'button',
        className: 'dfe-icon-btn',
        title: t('viewer.copySource'),
        'aria-label': t('viewer.copySource'),
        onClick: () => { void copySource() },
      }, React.createElement(CopyIcon)),
      React.createElement('button', {
        type: 'button',
        className: 'dfe-icon-btn',
        title: t('viewer.download'),
        'aria-label': t('viewer.download'),
        onClick: () => { void download() },
      }, React.createElement(DownloadIcon)),
      React.createElement('button', {
        ref: closeButton,
        type: 'button',
        className: 'dfe-icon-btn',
        title: t('viewer.close'),
        'aria-label': t('viewer.close'),
        onClick: closeViewer,
      }, React.createElement(CloseIcon)))),
  feedback === null ? null : React.createElement('div', { className: 'dfe-viewer-feedback', role: 'status' }, feedback),
  React.createElement('div', {
    ref: canvas,
    className: `dfe-viewer-canvas${dragging ? ' dfe-viewer-canvas--dragging' : ''}`,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  },
  url === undefined ? null : React.createElement('img', {
    ref: image,
    className: 'dfe-viewer-image',
    src: url,
    alt: state.title,
    draggable: false,
    onLoad: fitToWindow,
    style: {
      transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    },
  })),
  React.createElement('footer', { className: 'dfe-viewer-foot' },
    React.createElement('button', {
      type: 'button', className: 'dfe-text-btn', 'aria-label': t('viewer.zoomOut'), onClick: () => zoomBy(1 / 1.25),
    }, '−'),
    React.createElement('span', { className: 'dfe-viewer-percent' }, `${Math.round(view.scale * 100)}%`),
    React.createElement('button', {
      type: 'button', className: 'dfe-text-btn', 'aria-label': t('viewer.zoomIn'), onClick: () => zoomBy(1.25),
    }, '+'),
    React.createElement('span', { className: 'dfe-viewer-sep' }),
    React.createElement('button', {
      type: 'button', className: 'dfe-text-btn', onClick: fitToWindow,
    }, t('viewer.fit')),
    React.createElement('button', {
      type: 'button', className: 'dfe-text-btn', onClick: () => centerAt(1),
    }, t('viewer.actual')))))
}
