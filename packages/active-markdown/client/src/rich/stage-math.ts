/** Pan and zoom arithmetic shared by the diagram stages. */

/** Lowest scale a stage will show. */
export const MIN_SCALE = 0.1

/** Highest scale a stage will show. */
export const MAX_SCALE = 8

/** Share of the stage a fitted content leaves empty, on each axis. */
export const FIT_RATIO = 0.92

/** One stage placement: content scaled about its own top-left corner, then moved. */
export interface StageView {
  scale: number
  x: number
  y: number
}

/**
 * Keep a requested scale inside the stage range.
 * @param scale - raw scale.
 * @returns the clamped scale.
 */
export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/**
 * Center content in the stage at the largest scale that still fits.
 * @param stage - stage width and height in CSS pixels.
 * @param content - content width and height in CSS pixels, before scaling.
 * @returns the fitted placement; scale stays 1 for an empty content box.
 */
export function fitTransform(
  stage: { width: number, height: number },
  content: { width: number, height: number },
): StageView {
  if (content.width <= 0 || content.height <= 0) return { scale: 1, x: 0, y: 0 }
  const scale = clampScale(Math.min(stage.width / content.width, stage.height / content.height) * FIT_RATIO)
  return {
    scale,
    x: (stage.width - content.width * scale) / 2,
    y: (stage.height - content.height * scale) / 2,
  }
}

/**
 * Apply a zoom step that keeps the content under one stage point in place.
 * @param view - current placement.
 * @param next - requested scale, clamped here.
 * @param point - the stage point that must stay over the same content, in stage pixels.
 * @returns the placement after the zoom step.
 */
export function zoomAt(view: StageView, next: number, point: { x: number, y: number }): StageView {
  const scale = clampScale(next)
  const ratio = scale / view.scale
  return {
    scale,
    x: point.x - ratio * (point.x - view.x),
    y: point.y - ratio * (point.y - view.y),
  }
}

/**
 * Move content by a drag delta.
 * @param view - placement when the drag started.
 * @param delta - pointer movement in CSS pixels.
 * @returns the moved placement.
 */
export function panBy(view: StageView, delta: { x: number, y: number }): StageView {
  return { scale: view.scale, x: view.x + delta.x, y: view.y + delta.y }
}
