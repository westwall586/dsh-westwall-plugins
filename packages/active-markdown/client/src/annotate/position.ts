export type Rect = { top: number; left: number; width: number; height: number }
export type Size = { width: number; height: number }
export type Viewport = { width: number; height: number }
export type Placement = { left: number; top: number; above: boolean }

const DEFAULT_GAP = 6
const DEFAULT_MARGIN = 8

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
