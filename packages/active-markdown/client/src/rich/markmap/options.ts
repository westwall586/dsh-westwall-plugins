/** How a mind map should take pointer input, per where it is mounted. */
export type MarkmapInteraction = 'inline' | 'panel'

/** The markmap-view flags that decide what the wheel and the pointer do. */
export interface MarkmapInteractionOptions {
  /**
   * Markmap turns wheel into panning by default on macOS; both mounts want the
   * wheel to mean "scroll the page" (in place) or "zoom" (panel), so it is off.
   */
  scrollForPan: boolean
  /** The wheel zooms about the pointer. */
  zoom: boolean
  /** Markmap's own wheel pan, the one that would swallow the page scroll. */
  pan: boolean
}

/**
 * Pick the pointer flags for one mount.
 * @param mode - the fence in place, or the copy inside the expanded panel.
 * @returns flags that keep the map inert in place and zoomable in the panel.
 */
export function interactionOptions(mode: MarkmapInteraction): MarkmapInteractionOptions {
  // Panning stays available in the panel through d3's drag, which does not need
  // markmap's wheel pan; in place the frame owns the click, so the map is inert.
  return { scrollForPan: false, zoom: mode === 'panel', pan: false }
}
