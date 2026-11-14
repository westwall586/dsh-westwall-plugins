/** Inline page-plus glyph shared by both entries. */
import { createElement } from 'react'

export function PagePlusIcon({ size = 14 }) {
  return createElement('svg', {
    viewBox: '0 0 16 16',
    width: size,
    height: size,
    fill: 'none',
    'aria-hidden': 'true',
    focusable: 'false',
  },
  createElement('path', {
    d: 'M9 1.5H3.5v13h9V5L9 1.5z',
    stroke: 'currentColor',
    strokeWidth: 1.25,
    strokeLinejoin: 'round',
  }),
  createElement('path', {
    d: 'M8.5 7.75v4.5M6.25 10h4.5',
    stroke: 'currentColor',
    strokeWidth: 1.25,
    strokeLinecap: 'round',
  }))
}