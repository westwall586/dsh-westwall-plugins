/** The expanded diagram stage: pan, zoom, and the footer both diagram kinds share. */
import * as React from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { RichLabels } from './labels.ts'
import { ActualIcon, FitIcon } from './icons.tsx'
import { actualTransform, fitPercent, fitTransform, panBy, zoomAt, type StageView } from './stage-math.ts'

/** One wheel step's scale factor. */
const WHEEL_STEP = 1.12

export interface StageFooterProps {
  /** Current scale as a percentage, where the fitted scale is 100. */
  percent: number
  labels: RichLabels
  onZoom(factor: number): void
  onFit(): void
  onActual(): void
}

/**
 * The bottom bar: step zoom, the current ratio, fit, and actual size.
 * @param props - the ratio where fit is 100%, localized copy, and the three actions.
 * @returns the footer row.
 */
export function StageFooter({ percent, labels, onZoom, onFit, onActual }: StageFooterProps): ReactNode {
  return (
    <div className="am-rich-panel-foot">
      <button type="button" className="am-rich-panel-step" aria-label={labels.zoom.out} title={labels.zoom.out} onClick={() => onZoom(1 / 1.25)}>−</button>
      <span className="am-rich-panel-percent">{labels.zoom.value(Math.round(percent))}</span>
      <button type="button" className="am-rich-panel-step" aria-label={labels.zoom.into} title={labels.zoom.into} onClick={() => onZoom(1.25)}>+</button>
      <span className="am-rich-panel-sep" aria-hidden="true" />
      <button type="button" className="am-component-action" aria-label={labels.zoom.fit} title={labels.zoom.fit} onClick={onFit}>
        <FitIcon />
      </button>
      <button type="button" className="am-component-action" aria-label={labels.zoom.actual} title={labels.zoom.actual} onClick={onActual}>
        <ActualIcon />
      </button>
    </div>
  )
}

export interface MermaidStageProps {
  labels: RichLabels
  children: ReactNode
}

/**
 * Pan and zoom one SVG diagram inside the expanded panel.
 * @param props - localized copy and the diagram.
 * @returns the stage with its footer.
 */
export function MermaidStage({ labels, children }: MermaidStageProps): ReactNode {
  const area = useRef<HTMLDivElement | null>(null)
  const content = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<StageView>({ scale: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ pointerId: number, startX: number, startY: number, view: StageView } | null>(null)

  // The scale the last fit produced; the footer reads the live scale against it.
  const fitScale = useRef(1)
  const fit = useCallback(() => {
    const stage = area.current
    const box = content.current
    if (stage === null || box === null) return
    const next = fitTransform(
      { width: stage.clientWidth, height: stage.clientHeight },
      { width: box.offsetWidth, height: box.offsetHeight },
    )
    fitScale.current = next.scale
    setView(next)
  }, [])

  const actual = useCallback(() => {
    const stage = area.current
    const box = content.current
    if (stage === null || box === null) return
    setView(actualTransform(
      { width: stage.clientWidth, height: stage.clientHeight },
      { width: box.offsetWidth, height: box.offsetHeight },
    ))
  }, [])

  useLayoutEffect(() => {
    const box = content.current
    if (box === null) return
    const observer = new ResizeObserver(() => {
      if (box.offsetWidth === 0 || box.offsetHeight === 0) return
      fit()
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [fit])

  useEffect(() => {
    const stage = area.current
    if (stage === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const box = stage.getBoundingClientRect()
      const point = { x: event.clientX - box.left, y: event.clientY - box.top }
      setView(current => zoomAt(current, current.scale * (event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP), point))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, view }
    setDragging(true)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const active = drag.current
    if (active === null || active.pointerId !== event.pointerId) return
    setView(panBy(active.view, { x: event.clientX - active.startX, y: event.clientY - active.startY }))
  }
  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const active = drag.current
    if (active === null || active.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div className="am-rich-panel">
      <div
        ref={area}
        className="am-rich-panel-body am-rich-scene"
        data-dragging={dragging ? '' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div ref={content} className="am-rich-scene-content" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          {children}
        </div>
      </div>
      <StageFooter
        percent={fitPercent(view.scale, fitScale.current)}
        labels={labels}
        onZoom={(factor) => {
          const point = { x: (area.current?.clientWidth ?? 0) / 2, y: (area.current?.clientHeight ?? 0) / 2 }
          setView(current => zoomAt(current, current.scale * factor, point))
        }}
        onFit={fit}
        onActual={actual}
      />
    </div>
  )
}
