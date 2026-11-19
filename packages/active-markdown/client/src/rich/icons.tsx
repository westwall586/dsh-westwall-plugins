/** Inline SVG icons for the component shell, drawn on the toolbar's 16-unit grid. */
import * as React from 'react'
import type { ReactElement, ReactNode } from 'react'

/** Every icon takes the same measurable edge length. */
export interface IconProps {
  /** Rendered edge length in CSS pixels; the shell draws its buttons at 14. */
  size?: number
}

interface IconShellProps extends IconProps {
  children: ReactNode
}

/** One 1.3-unit stroke drawing that follows the button's text color, matching the top toolbar. */
function IconShell({ size = 14, children }: IconShellProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** Open the expanded panel: four outward corners. */
export function ExpandIcon({ size }: IconProps = {}): ReactElement {
  return <IconShell size={size}><path d="M6 2H2v4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></IconShell>
}

/** Collapse the expanded panel: four inward corners. */
export function CollapseIcon({ size }: IconProps = {}): ReactElement {
  return <IconShell size={size}><path d="M2 6h4V2M14 6h-4V2M14 10h-4v4M2 10h4v4" /></IconShell>
}

/** Close the expanded panel. */
export function CloseIcon({ size }: IconProps = {}): ReactElement {
  return <IconShell size={size}><path d="M4 4l8 8M12 4l-8 8" /></IconShell>
}

/** Copy the component's source text. */
export function CopyIcon({ size }: IconProps = {}): ReactElement {
  return (
    <IconShell size={size}>
      <rect x="6" y="6" width="8" height="8" rx="1.6" />
      <path d="M10 4V3.4A1.4 1.4 0 0 0 8.6 2H3.4A1.4 1.4 0 0 0 2 3.4v5.2A1.4 1.4 0 0 0 3.4 10H4" />
    </IconShell>
  )
}

/** Confirm that a copy just landed. */
export function CheckIcon({ size }: IconProps = {}): ReactElement {
  return <IconShell size={size}><path d="M3 8.6 6.4 12 13 4.6" /></IconShell>
}

/** Annotate the component. */
export function AnnotateIcon({ size }: IconProps = {}): ReactElement {
  return <IconShell size={size}><path d="M2.5 3.5h11v7H8L5 13v-2.5H2.5z" /></IconShell>
}

/** Toggle soft wrapping for a code fence. */
export function WrapIcon({ size }: IconProps = {}): ReactElement {
  return (
    <IconShell size={size}>
      <path d="M2 4h12M2 8h9.5a2.5 2.5 0 1 1 0 5H9M2 12h5" />
      <path d="m7 11-2 2 2 2" />
    </IconShell>
  )
}

/** Fit the whole drawing into the panel. */
export function FitIcon({ size }: IconProps = {}): ReactElement {
  return <IconShell size={size}><path d="M2 6V2h4M14 6V2h-4M14 10v4h-4M2 10v4h4" /></IconShell>
}

/** Show the drawing at its own size. */
export function ActualIcon({ size }: IconProps = {}): ReactElement {
  return (
    <IconShell size={size}>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M6 11V6h2M9 6h1.5a1.5 1.5 0 0 1 0 3H9v2" />
    </IconShell>
  )
}
