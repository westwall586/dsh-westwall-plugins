/** Fullscreen shell shared by the Mermaid and mind-map views. */
import * as React from 'react'
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ZoomControls } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RichLabels } from './labels.ts'

export interface RichFullscreenProps {
  labels: RichLabels
  /** The graph's expand button; focus returns here after every close. */
  returnFocus: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
}

/** Above the host's overlays, below nothing the document can stack over a portal. */
const Z_INDEX = 1000

/**
 * Show one diagram over a themed scrim with zoom controls.
 * Esc, the close button, and a click on the scrim all close it.
 * @param props - localized copy, the focus target, the close handler, and the diagram.
 * @returns the portal, or null before the document body exists.
 */
export function RichFullscreen({ labels, returnFocus, onClose, children }: RichFullscreenProps): ReactNode {
  const [zoom, setZoom] = useState(1)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close.current()
    }
    document.addEventListener('keydown', onKeyDown, true)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previous
      returnFocus.current?.focus()
    }
  }, [returnFocus])

  const stop = useCallback((event: React.MouseEvent): void => { event.stopPropagation() }, [])
  const keepVisible = useCallback(() => {}, [])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="am-rich-overlay"
      style={{ zIndex: Z_INDEX }}
      role="dialog"
      aria-modal="true"
      aria-label={labels.expand}
      onClick={() => close.current()}
    >
      <div className="am-rich-overlay-frame" onClick={stop}>
        <button ref={closeRef} type="button" className="am-rich-overlay-close" onClick={() => close.current()}>
          {labels.close}
        </button>
        <div className="am-rich-overlay-body" style={{ transform: `scale(${zoom})` }}>
          {children}
        </div>
        <ZoomControls
          className="am-rich-overlay-zoom"
          zoom={zoom}
          labels={labels.zoom}
          visible
          onZoom={setZoom}
          onActiveChange={keepVisible}
        />
      </div>
    </div>,
    document.body,
  )
}
