/** Small browser utilities and icons shared by the client surfaces. */
import * as React from 'react'
import type { ClientContext, FileActions } from './context.ts'

/** Copy through the async clipboard first, then the legacy selection command. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // The WebView can deny the async clipboard, so the selection fallback still runs.
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  area.style.opacity = '0'
  document.body.append(area)
  area.focus()
  area.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  area.remove()
  return copied
}

function svgFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\n\r]+/g, '-').trim()
  return `${base.length > 0 ? base : 'mermaid'}.svg`
}

/** Save through the host file service when present, otherwise use an anchor download. */
export async function saveSvg(ctx: ClientContext, svg: string, title: string): Promise<void> {
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  try {
    const actions = ctx.get('fileActions') as FileActions | undefined
    if (actions !== undefined && typeof actions.save === 'function') {
      try {
        await actions.save({
          url,
          name: svgFileName(title),
          mediaType: 'image/svg+xml',
          read: async () => blob,
        }, 'download')
        return
      } catch {
        // Service present but refused, so fall through to the browser download.
      }
    }
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = svgFileName(title)
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export function MermaidIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return React.createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': 'true',
    focusable: 'false',
  },
  React.createElement('rect', { x: 3, y: 3, width: 7, height: 5, rx: 1.4, stroke: 'currentColor', strokeWidth: 1.6 }),
  React.createElement('rect', { x: 14, y: 16, width: 7, height: 5, rx: 1.4, stroke: 'currentColor', strokeWidth: 1.6 }),
  React.createElement('rect', { x: 14, y: 3, width: 7, height: 5, rx: 1.4, stroke: 'currentColor', strokeWidth: 1.6 }),
  React.createElement('path', { d: 'M10 5.5h4M17.5 8v8M17.5 16h-3.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }))
}

export function SpeechIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return React.createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': 'true',
    focusable: 'false',
  },
  React.createElement('path', {
    d: 'M4.5 5.5h15a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H11l-4 3v-3H4.5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinejoin: 'round',
  }),
  React.createElement('circle', { cx: 8, cy: 10.5, r: 1.1, fill: 'currentColor' }),
  React.createElement('circle', { cx: 12, cy: 10.5, r: 1.1, fill: 'currentColor' }),
  React.createElement('circle', { cx: 16, cy: 10.5, r: 1.1, fill: 'currentColor' }))
}

export function CopyIcon({ size = 15 }: { size?: number }): React.ReactElement {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true', focusable: 'false',
  },
  React.createElement('rect', { x: 9, y: 9, width: 11, height: 11, rx: 2, stroke: 'currentColor', strokeWidth: 1.7 }),
  React.createElement('path', { d: 'M15 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }))
}

export function ExpandIcon({ size = 15 }: { size?: number }): React.ReactElement {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true', focusable: 'false',
  },
  React.createElement('path', {
    d: 'M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5',
    stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
  }))
}

export function CodeIcon({ size = 15 }: { size?: number }): React.ReactElement {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true', focusable: 'false',
  },
  React.createElement('path', {
    d: 'm8.5 8-4 4 4 4M15.5 8l4 4-4 4',
    stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
  }))
}

export function DownloadIcon({ size = 15 }: { size?: number }): React.ReactElement {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true', focusable: 'false',
  },
  React.createElement('path', {
    d: 'M12 4v11m0 0 4-4m-4 4-4-4M4 19h16',
    stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
  }))
}

export function CloseIcon({ size = 15 }: { size?: number }): React.ReactElement {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true', focusable: 'false',
  },
  React.createElement('path', {
    d: 'M6 6l12 12M18 6 6 18',
    stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round',
  }))
}
