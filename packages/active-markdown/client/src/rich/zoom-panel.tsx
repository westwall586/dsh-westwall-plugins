/** The zoom bar and scaled stage an expanded diagram view owns. */
import * as React from 'react'
import { useCallback, useState, type ReactNode } from 'react'
import { ZoomControls } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RichLabels } from './labels.ts'

export interface ZoomPanelProps {
  labels: RichLabels
  children: ReactNode
}

/**
 * Fill the expanded panel with a diagram and its zoom controls.
 * @param props - localized copy and the diagram to scale.
 * @returns the scrolling stage and its bottom bar.
 */
export function ZoomPanel({ labels, children }: ZoomPanelProps): ReactNode {
  const [zoom, setZoom] = useState(1)
  const keepVisible = useCallback(() => {}, [])
  return (
    <div className="am-rich-panel">
      <div className="am-rich-panel-body">
        <div className="am-rich-panel-zoom" style={{ transform: `scale(${zoom})` }}>{children}</div>
      </div>
      <div className="am-rich-panel-foot">
        <ZoomControls
          className="am-rich-panel-controls"
          zoom={zoom}
          labels={labels.zoom}
          visible
          onZoom={setZoom}
          onActiveChange={keepVisible}
        />
      </div>
    </div>
  )
}
