/** Copy the Mermaid and mind-map views need from the locale service. */

/** The zoom bar's copy; the fitted scale is the 100% baseline. */
export interface ZoomBarLabels {
  out: string
  into: string
  /** Format one percentage. */
  value: (percent: number) => string
  /** Return to the fitted scale and reset the 100% baseline. */
  fit: string
  /** Show the content at its natural size. */
  actual: string
}

export interface RichLabels {
  /** Shown while a diagram is being built. */
  rendering: string
  copyError: string
  /** Copy feedback shared with the rest of the component frame. */
  copied: string
  /** The expanded panel's zoom bar owns these. */
  zoom: ZoomBarLabels
}
