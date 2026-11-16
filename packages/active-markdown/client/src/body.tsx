/** The document body: read, fallbacks, and the rendered Markdown. */
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Translate, WorkspaceFilesRemote } from './context.ts'
import { createImageResolver, type ImageResolver } from './images.ts'
import { classifyLink } from './links.ts'
import { parseDocument } from './markdown/blocks.ts'
import { MarkdownView } from './markdown/render.tsx'
import { READ_CAP, loadDocument, sessionFileOf } from './source.ts'

/** The renderer branch of the owner's content union. */
export interface RendererContent {
  kind: 'renderer'
  revision: number
  loaded(version: string): void
  failed(): void
  reload(): void
}

/** One of the owner's three content deliveries; only `renderer` reaches this body. */
export type BodyContent =
  | RendererContent
  | { kind: 'text' }
  | { kind: 'bytes' }

/** What the slot hands the body beyond the standard document owner props. */
export interface BodyInjected {
  readBytes: WorkspaceFilesRemote['readBytes']
  openResource(address: string): void
}

export interface BodyProps extends BodyInjected {
  resourceAddress: string
  content: BodyContent
  t: Translate
}

type BodyState =
  | { status: 'loading' }
  | { status: 'ready', text: string, absolutePath: string, version: string }
  | { status: 'too-large', limit: number }
  | { status: 'not-text' }
  | { status: 'failed', code: string, message: string }

/** Human-readable byte size for the fallback copy. */
function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/**
 * Draw one Markdown preview tab.
 * @param props - owner supplies the address, content protocol state, and locale.
 * @returns the document or its fixed fallback.
 */
export function Body({ resourceAddress, content, readBytes, openResource, t }: BodyProps): ReactNode {
  const file = useMemo(() => sessionFileOf(resourceAddress), [resourceAddress])
  const [state, setState] = useState<BodyState>({ status: 'loading' })
  const container = useRef<HTMLDivElement | null>(null)
  const renderer = content.kind === 'renderer' ? content : undefined
  const rendererRef = useRef(renderer)
  rendererRef.current = renderer
  const revision = renderer?.revision ?? 0
  const sessionId = file?.sessionId
  const path = file?.path

  useEffect(() => {
    if (sessionId === undefined || path === undefined) {
      setState({ status: 'failed', code: 'address', message: t('error.address') })
      return
    }
    const controller = new AbortController()
    setState({ status: 'loading' })
    void loadDocument(readBytes, { sessionId, path }, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.status === 'ready') {
        setState({ status: 'ready', text: result.text, absolutePath: result.absolutePath, version: result.version })
        return
      }
      setState(result)
      rendererRef.current?.failed()
    })
    return () => { controller.abort() }
  }, [sessionId, path, revision, readBytes, t])

  // Report the version only once the content is committed: the owner restores
  // the tab's scroll offset as soon as it has a version, and it needs the
  // document to have its full height by then.
  useEffect(() => {
    if (state.status !== 'ready') return
    rendererRef.current?.loaded(state.version)
  }, [state, revision])

  const resolver = useMemo<ImageResolver | undefined>(() => {
    if (state.status !== 'ready' || sessionId === undefined) return undefined
    return createImageResolver(readBytes, sessionId, state.absolutePath)
  }, [state, sessionId, readBytes])
  useEffect(() => () => { resolver?.dispose() }, [resolver])

  const resolveImage = useCallback((src: string): Promise<string | undefined> => resolver?.resolve(src) ?? Promise.resolve(undefined), [resolver])

  const openLink = useCallback((href: string) => {
    if (sessionId === undefined) return
    const documentPath = state.status === 'ready' ? state.absolutePath : (path ?? '')
    const target = classifyLink(href, sessionId, documentPath)
    if (target.kind === 'anchor') {
      const node = Array.from(container.current?.querySelectorAll('[data-anchor]') ?? [])
        .find(element => element.getAttribute('data-anchor') === target.id)
      node?.scrollIntoView({ block: 'start' })
      return
    }
    if (target.kind === 'external') {
      const opened = window.open(target.url, '_blank', 'noopener,noreferrer')
      if (opened !== null) opened.opener = null
      return
    }
    if (target.kind === 'file' || target.kind === 'resource') openResource(target.address)
  }, [sessionId, state, path, openResource])

  const actions = useMemo(() => ({ openLink, resolveImage }), [openLink, resolveImage])
  const labels = useMemo(() => ({ copy: t('code.copy'), copied: t('code.copied'), imageFailed: t('image.failed') }), [t])

  const reload = useCallback(() => { rendererRef.current?.reload() }, [])

  return (
    <div className="am-root" ref={container} data-active-markdown>
      {state.status === 'loading' && <div className="am-status" role="status"><span className="am-spinner" aria-hidden="true" />{t('loading')}</div>}
      {state.status === 'too-large' && (
        <EmptyState
          title={t('error.tooLarge.title')}
          body={t('error.tooLarge.body', { limit: formatBytes(state.limit) })}
          hint={t('hint.switchNative')}
        />
      )}
      {state.status === 'not-text' && <EmptyState title={t('error.notText.title')} body={t('error.notText.body')} hint={t('hint.switchNative')} />}
      {state.status === 'failed' && (
        <EmptyState
          title={t('error.failed.title')}
          body={t('error.failed.body', { message: state.message })}
          hint={t('hint.switchNative')}
          action={{ label: t('retry'), run: reload }}
        />
      )}
      {state.status === 'ready' && (
        <RenderBoundary
          labels={{ title: t('error.render.title'), body: t('error.render.body'), reload: t('reload') }}
          onReload={reload}
        >
          <DocumentView text={state.text} labels={labels} actions={actions} t={t} />
        </RenderBoundary>
      )}
    </div>
  )
}

interface DocumentViewProps {
  text: string
  labels: { copy: string, copied: string, imageFailed: string }
  actions: { openLink(href: string): void, resolveImage(src: string): Promise<string | undefined> }
  t: Translate
}

/** Parse inside the boundary so a parser failure stays recoverable. */
function DocumentView({ text, labels, actions, t }: DocumentViewProps): ReactNode {
  const parsed = useMemo(() => parseDocument(text), [text])
  return (
    <>
      {parsed.frontmatter === undefined ? null : (
        <section className="am-frontmatter" data-active-markdown-frontmatter>
          <div className="am-frontmatter-label">{t('frontmatter')}</div>
          <pre className="am-frontmatter-source">{parsed.frontmatter.source}</pre>
        </section>
      )}
      <MarkdownView blocks={parsed.blocks} labels={labels} actions={actions} />
    </>
  )
}

interface EmptyStateProps {
  title: string
  body: string
  hint?: string
  action?: { label: string, run: () => void }
}

function EmptyState({ title, body, hint, action }: EmptyStateProps): ReactNode {
  return (
    <div className="am-empty" role="note">
      <div className="am-empty-title">{title}</div>
      <p className="am-empty-body">{body}</p>
      {hint === undefined ? null : <p className="am-empty-hint">{hint}</p>}
      {action === undefined ? null : <button type="button" className="am-empty-action" onClick={action.run}>{action.label}</button>}
    </div>
  )
}

interface RenderBoundaryProps {
  children: ReactNode
  labels: { title: string, body: string, reload: string }
  onReload: () => void
}

interface RenderBoundaryState {
  failed: boolean
}

/** Keep a rendering crash inside the body instead of blanking the tab. */
class RenderBoundary extends React.Component<RenderBoundaryProps, RenderBoundaryState> {
  state: RenderBoundaryState = { failed: false }

  static getDerivedStateFromError(): RenderBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('[active-markdown] render failed', error)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <EmptyState
        title={this.props.labels.title}
        body={this.props.labels.body}
        action={{
          label: this.props.labels.reload,
          run: () => {
            this.setState({ failed: false })
            this.props.onReload()
          },
        }}
      />
    )
  }
}
