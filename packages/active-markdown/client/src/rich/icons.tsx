/** Inline SVG icons for the component shell's header buttons and zoom bar. */
import * as React from 'react'
import type { ReactElement, ReactNode } from 'react'

/** Every icon takes the same measurable edge length. */
export interface IconProps {
  /** Rendered edge length in CSS pixels; the shell draws its buttons at 15. */
  size?: number
}

interface IconShellProps extends IconProps {
  children: ReactNode
}

/** One stroked 24-unit drawing that follows the button's text color. */
function IconShell({ size = 15, children }: IconShellProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** Open the expanded panel. */
export function ExpandIcon({ size }: IconProps = {}): ReactElement {
  return <IconShell size={size}><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5" /></IconShell>
}

/** Close the expanded panel. */
export function CloseIcon({ size }: IconProps = {}): ReactElement {
  return <IconShell size={size}><path d="M6 6l12 12M18 6 6 18" /></IconShell>
}

/** Copy the component's source text. */
export function CopyIcon({ size }: IconProps = {}): ReactElement {
  return (
    <IconShell size={size}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1" />
    </IconShell>
  )
}

/** Toggle soft wrapping for a code fence. */
export function WrapIcon({ size }: IconProps = {}): ReactElement {
  return (
    <IconShell size={size}>
      <path d="M3 6h18M3 12h15a3 3 0 1 1 0 6h-4M3 18h7" />
      <path d="m16 16-2 2 2 2" />
    </IconShell>
  )
}

/** Annotate this block, or edit its annotation. */
export function AnnotateIcon({ size }: IconProps = {}): ReactElement {
  return (
    <IconShell size={size}>
      <path d="M4.5 4.5h15a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H11l-4 3v-3H4.5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </IconShell>
  )
}

/** Fit the diagram into the stage; that scale is the footer's 100%. */
export function FitIcon({ size }: IconProps = {}): ReactElement {
  return <IconShell size={size}><path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5" /></IconShell>
}

/** Show the diagram at its natural size. */
export function ActualIcon({ size }: IconProps = {}): ReactElement {
  return (
    <IconShell size={size}>
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </IconShell>
  )
}
