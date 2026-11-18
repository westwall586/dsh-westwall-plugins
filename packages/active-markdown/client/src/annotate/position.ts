export type Rect = { top: number; left: number; width: number; height: number }
export type Size = { width: number; height: number }
export type Viewport = { width: number; height: number }
export type Placement = { left: number; top: number; above: boolean }

export interface PanelPlacement {
  left: number
  top: number
  width: number
  maxHeight: number
}

const DEFAULT_GAP = 6
const DEFAULT_MARGIN = 8
const DEFAULT_PANEL_WIDTH = 320
const DEFAULT_PANEL_MAX_HEIGHT = 420

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max < min) {
    // Non-finite or inverted bounds leave no valid position; the margin is the only finite, stable spot.
    return min
  }
  return Math.min(Math.max(value, min), max)
}

export function placePopover(
  anchor: Rect,
  size: Size,
  viewport: Viewport,
  options?: { gap?: number; margin?: number },
): Placement {
  const gap = options?.gap ?? DEFAULT_GAP
  const margin = options?.margin ?? DEFAULT_MARGIN
  const spaceBelow = viewport.height - (anchor.top + anchor.height)
  const spaceAbove = anchor.top
  const above = spaceBelow < size.height + gap && spaceAbove > spaceBelow

  return {
    left: clamp(anchor.left, margin, viewport.width - size.width - margin),
    top: clamp(
      above ? anchor.top - size.height - gap : anchor.top + anchor.height + gap,
      margin,
      viewport.height - size.height - margin,
    ),
    above,
  }
}

export function placePanelBelow(
  anchor: Rect,
  bounds: Rect,
  options?: { maxWidth?: number; maxHeight?: number; gap?: number; margin?: number },
): PanelPlacement {
  const maxWidth = options?.maxWidth ?? DEFAULT_PANEL_WIDTH
  const maxHeight = options?.maxHeight ?? DEFAULT_PANEL_MAX_HEIGHT
  const gap = options?.gap ?? DEFAULT_GAP
  const margin = options?.margin ?? DEFAULT_MARGIN
  const boundsLeft = Number.isFinite(bounds.left) ? bounds.left : 0
  const boundsTop = Number.isFinite(bounds.top) ? bounds.top : 0
  const boundsWidth = Number.isFinite(bounds.width) ? Math.max(0, bounds.width) : 0
  const boundsHeight = Number.isFinite(bounds.height) ? Math.max(0, bounds.height) : 0

  const width = Math.max(0, Math.min(maxWidth, boundsWidth - margin * 2))
  const bottom = boundsTop + boundsHeight
  const top = clamp(anchor.top + anchor.height + gap, boundsTop + margin, bottom - margin)
  return {
    left: clamp(anchor.left, boundsLeft + margin, boundsLeft + boundsWidth - margin - width),
    top,
    width,
    maxHeight: Math.max(0, Math.min(maxHeight, bottom - margin - top)),
  }
}

export function revealDelta(panel: Rect, row: Rect): number {
  const panelBottom = panel.top + panel.height
  const rowBottom = row.top + row.height
  if (row.top >= panel.top && rowBottom <= panelBottom) return 0
  return row.top < panel.top ? row.top - panel.top : rowBottom - panelBottom
}

export function centerDelta(panel: Rect, row: Rect): number {
  return row.top + row.height / 2 - (panel.top + panel.height / 2)
}
