/**
 * The optional one-line instruction a re-translate runs with. It is a popover,
 * not a dialog: the page stays readable and Escape or a click outside closes it.
 */
import * as React from 'react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface InstructionAskProps {
  /** Viewport anchor under the button that opened it. */
  left: number
  top: number
  /** The instruction the last run used, so a second ask reuses it. */
  initial: string
  labels: { label: string, placeholder: string, cancel: string, confirm: string }
  onCancel(): void
  onConfirm(instruction: string): void
}

/**
 * Draw the instruction popover.
 * @param props - anchor, remembered text, copy, and the two outcomes.
 * @returns the popover.
 */
export function InstructionAsk({ left, top, initial, labels, onCancel, onConfirm }: InstructionAskProps): ReactNode {
  const [value, setValue] = useState(initial)
  const panel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target
      if (target instanceof Element && panel.current?.contains(target) === true) return
      onCancel()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onCancel])

  return (
    <div className="am-ask" ref={panel} style={{ left, top }} role="dialog" aria-label={labels.label}>
      <label className="am-ask-label" htmlFor="am-ask-instruction">{labels.label}</label>
      <textarea
        id="am-ask-instruction"
        className="am-ask-input"
        rows={3}
        value={value}
        placeholder={labels.placeholder}
        onChange={(event) => setValue(event.target.value)}
        autoFocus
      />
      <div className="am-ask-actions">
        <button type="button" className="am-ask-button" onClick={onCancel}>{labels.cancel}</button>
        <button type="button" className="am-ask-button" onClick={() => onConfirm(value)}>{labels.confirm}</button>
      </div>
    </div>
  )
}
