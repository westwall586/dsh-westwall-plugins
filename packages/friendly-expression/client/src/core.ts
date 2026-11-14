/** Pure helpers shared by the fence, the viewer, and their tests. No React or DOM access. */

/** Mirrors the Host schema cap. The settings counter uses UTF-16 length. */
export const MAX_PROMPT_CHARS = 800

export type DiagramType =
  | 'flowchart'
  | 'sequence'
  | 'state'
  | 'er'
  | 'class'
  | 'gantt'
  | 'pie'
  | 'mindmap'
  | 'timeline'
  | 'journey'
  | 'gitGraph'
  | 'quadrant'
  | 'other'

export interface ThemeFingerprint {
  scheme: string
  variables: Record<string, string>
}

function stripFrontmatter(code: string): string {
  const lines = code.replace(/\r\n?/g, '\n').split('\n')
  if (lines[0]?.trim() !== '---') return code
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end === -1) return code
  return lines.slice(end + 1).join('\n')
}

/** Read the diagram kind from the first meaningful declaration line. */
export function detectDiagramType(code: string): DiagramType {
  for (const line of stripFrontmatter(code).split('\n')) {
    const text = line.trim()
    if (text.length === 0 || text.startsWith('%%')) continue
    const lower = text.toLowerCase()
    if (lower.startsWith('flowchart') || lower.startsWith('graph')) return 'flowchart'
    if (lower.startsWith('sequencediagram')) return 'sequence'
    if (lower.startsWith('statediagram')) return 'state'
    if (lower.startsWith('erdiagram')) return 'er'
    if (lower.startsWith('classdiagram')) return 'class'
    if (lower.startsWith('gantt')) return 'gantt'
    if (lower.startsWith('pie')) return 'pie'
    if (lower.startsWith('mindmap')) return 'mindmap'
    if (lower.startsWith('timeline')) return 'timeline'
    if (lower.startsWith('journey')) return 'journey'
    if (lower.startsWith('gitgraph')) return 'gitGraph'
    if (lower.startsWith('quadrantchart')) return 'quadrant'
    return 'other'
  }
  return 'other'
}

/** Fence meta wins over a frontmatter title. Node labels are never consulted. */
export function titleFromCode(code: string, meta?: string | null): string | undefined {
  const fromMeta = meta?.trim()
  if (fromMeta !== undefined && fromMeta.length > 0) return fromMeta
  const normalized = code.replace(/\r\n?/g, '\n')
  if (!normalized.startsWith('---\n')) return undefined
  const end = normalized.indexOf('\n---', 4)
  if (end === -1) return undefined
  for (const line of normalized.slice(4, end).split('\n')) {
    const match = /^\s*title\s*:\s*(.*)$/i.exec(line)
    if (match === null) continue
    const title = match[1].trim().replace(/^(['"])(.*)\1$/, '$2').trim()
    if (title.length > 0) return title
  }
  return undefined
}

/** Fill the localized error-copy template without ever including diagram source. */
export function errorCopyText(template: string, message: string): string {
  return template.replace('{message}', message)
}

/** Keep zoom inside the viewer range. */
export function clampZoom(scale: number, min = 0.2, max = 8): number {
  if (!Number.isFinite(scale)) return min
  return Math.min(max, Math.max(min, scale))
}

/** Scale that fits the SVG inside the canvas with a small gutter. */
export function fitScale(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
  padding = 48,
): number {
  if (containerWidth <= 0 || containerHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) return 1
  const width = Math.max(1, containerWidth - padding)
  const height = Math.max(1, containerHeight - padding)
  return clampZoom(Math.min(width / imageWidth, height / imageHeight))
}

/** Cache identity for one code block under one resolved palette. */
export function cacheKey(code: string, theme: ThemeFingerprint): string {
  const palette = Object.keys(theme.variables)
    .sort()
    .map(name => `${name}=${theme.variables[name]}`)
    .join(';')
  return `${theme.scheme}\n${palette}\n${code}`
}

/** Accept a plain resolved value or a volatile reference from a settings snapshot. */
export function readPromptValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return ''
  const getter = (value as { get?: unknown }).get
  if (typeof getter !== 'function') return ''
  try {
    const resolved: unknown = getter.call(value)
    return typeof resolved === 'string' ? resolved : ''
  } catch {
    return ''
  }
}

/** One-line error summary for the card. Full detail stays in the console. */
export function errorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').trim().slice(0, 300)
}
