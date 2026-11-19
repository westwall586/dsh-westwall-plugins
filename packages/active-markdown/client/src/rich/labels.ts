/** Copy the Mermaid and mind-map views need from the locale service. */
import type { DocumentZoomLabels } from '@deepseek-ai/dsh-client-ui-primitives'

export interface RichLabels {
  /** Shown while a diagram is being built. */
  rendering: string
  copyError: string
  /** Copy feedback shared with the rest of the component frame. */
  copied: string
  /** The expanded panel's zoom bar owns these. */
  zoom: DocumentZoomLabels
}
