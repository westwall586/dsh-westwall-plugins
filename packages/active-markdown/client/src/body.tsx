/** The document body: read, fallbacks, and the rendered Markdown. */
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { HostBridge, Translate, WorkspaceFilesRemote } from './context.ts'
import { createImageResolver, type ImageResolver } from './images.ts'
import { classifyLink } from './links.ts'
import { parseDocument } from './markdown/blocks.ts'
import { MarkdownView } from './markdown/render.tsx'
import { READ_CAP, loadDocument, sessionFileOf } from './source.ts'
import { assembleTranslation, countLines, normalize, planTranslation } from './translate/plan.ts'

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
  host(): Promise<HostBridge>
}

export interface BodyProps extends BodyInjected {
  resourceAddress: string
  content: BodyContent
  t: Translate
}

type View = 'source' | 'translated'

/** One translation request's lifecycle; the view never recomputes it. */
type Translation =
  | { status: 'idle' }
  | { status: 'running', chunk: number, chunks: number, partial?: string }
  | { status: 'ready', text: string, sourceLines: number, translatedLines: number }
  | { status: 'too-large', lineCount: number }
  | { status: 'failed', message: string }

type BodyState =
  | { status: 'loading' }
  | { status: 'ready', text: string, absolutePath: string, version: string }
  | { status: 'too-large', limit: number }
  | { status: 'not-text' }
  | { status: 'failed', code: string, message: string }

/** While chunks land, the body already shows the translated prefix at full line count. */
function translatedText(translation: Translation): string | undefined {
  if (translation.status === 'ready') return translation.text
  if (translation.status === 'running') return translation.partial
  return undefined
}

/** Hard-coded until the settings slice lands; the plugin page will own both. */
const TARGET_LANGUAGE = '简体中文'
const FALLBACK_PROMPT_VERSION = 'am.translate.v1'

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
export function Body({ resourceAddress, content, readBytes, openResource, host, t }: BodyProps): ReactNode {
  const file = useMemo(() => sessionFileOf(resourceAddress), [resourceAddress])
  const [state, setState] = useState<BodyState>({ status: 'loading' })
  const container = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<View>('source')
  const [translation, setTranslation] = useState<Translation>({ status: 'idle' })
  const requestToken = useRef(0)
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
    requestToken.current += 1
    setView('source')
    setTranslation({ status: 'idle' })
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
    return () => {
      controller.abort()
      // A new revision or an unmount also ends any chunk loop still in flight.
      requestToken.current += 1
    }
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

  const translateDocument = useCallback((document: { text: string, absolutePath: string }): void => {
    const token = ++requestToken.current
    const sourceLines = normalize(document.text).split('\n')
    const plan = planTranslation(document.text, parseDocument(document.text).blocks)
    if (plan.kind === 'too-large') {
      setTranslation({ status: 'too-large', lineCount: plan.lineCount })
      return
    }
    const chunks = plan.ranges.length
    setTranslation({ status: 'running', chunk: 1, chunks })
    void (async () => {
      try {
        const bridge = await host()
        const promptVersion = await bridge.describePrompt().catch(() => FALLBACK_PROMPT_VERSION)
        const replies: string[] = []
        for (const [index, range] of plan.ranges.entries()) {
          if (token !== requestToken.current) return
          setTranslation({ status: 'running', chunk: index + 1, chunks })
          replies.push(await bridge.translate({
            sessionId: sessionId ?? '',
            path: path ?? '',
            text: sourceLines.slice(range.start, range.end).join('\n'),
            lang: TARGET_LANGUAGE,
            promptVersion,
          }))
          if (token !== requestToken.current) return
          // Land every finished chunk at once: the unfinished ones keep their source lines,
          // so the page shows a growing Chinese document at constant line count.
          const pending = plan.ranges.slice(index + 1).map(next => sourceLines.slice(next.start, next.end).join('\n'))
          setTranslation({
            status: 'running',
            chunk: index + 2 > chunks ? chunks : index + 2,
            chunks,
            partial: assembleTranslation(plan.ranges, sourceLines, [...replies, ...pending]),
          })
        }
        const text = assembleTranslation(plan.ranges, sourceLines, replies)
        setTranslation({
          status: 'ready',
          text,
          sourceLines: countLines(document.text),
          translatedLines: countLines(text),
        })
      } catch (error) {
        if (token !== requestToken.current) return
        setTranslation({ status: 'failed', message: error instanceof Error ? error.message : String(error) })
      }
    })()
  }, [host, sessionId, path])

  const chooseView = useCallback((next: View) => {
    setView(next)
    if (next !== 'translated' || state.status !== 'ready') return
    if (translation.status === 'ready' || translation.status === 'running' || translation.status === 'too-large') return
    translateDocument({ text: state.text, absolutePath: state.absolutePath })
  }, [state, translation, translateDocument])

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
        <>
          <div className="am-toolbar">
            <div className="am-seg" role="group" aria-label={t('view.label')}>
              <button type="button" className="am-seg-button" aria-pressed={view === 'source'} onClick={() => chooseView('source')}>
                {t('view.source')}
              </button>
              <button type="button" className="am-seg-button" aria-pressed={view === 'translated'} onClick={() => chooseView('translated')}>
                {t('view.translated')}
              </button>
            </div>
            <div className="am-toolbar-status" role="status">
              {translation.status === 'running' && (
                <>
                  <span className="am-spinner" aria-hidden="true" />
                  {translation.chunks > 1
                    ? t('translate.progress', { current: translation.chunk, total: translation.chunks })
                    : t('translate.running')}
                </>
              )}
              {translation.status === 'too-large' && (
                <span className="am-toolbar-error">{t('translate.tooLarge', { lines: translation.lineCount })}</span>
              )}
              {translation.status === 'ready' && (translation.sourceLines === translation.translatedLines
                ? t('translate.aligned', { lines: translation.translatedLines })
                : t('translate.unaligned', { translated: translation.translatedLines, source: translation.sourceLines }))}
              {translation.status === 'failed' && (
                <>
                  <span className="am-toolbar-error">{t('translate.failed', { message: translation.message })}</span>
                  <button type="button" className="am-toolbar-action" onClick={() => chooseView('translated')}>
                    {t('translate.retry')}
                  </button>
                </>
              )}
            </div>
          </div>
          <RenderBoundary
            labels={{ title: t('error.render.title'), body: t('error.render.body'), reload: t('reload') }}
            onReload={reload}
          >
            <DocumentView
              text={view === 'translated' ? translatedText(translation) ?? state.text : state.text}
              labels={labels}
              actions={actions}
              t={t}
            />
          </RenderBoundary>
        </>
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
