/** The document body: read, fallbacks, and the rendered Markdown. */
import * as React from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ContextMenuTarget, DescribeView, HostBridge, Translate, TranslationMeta, WorkspaceFilesRemote } from './context.ts'
import { createImageResolver, type ImageResolver } from './images.ts'
import { classifyLink } from './links.ts'
import { parseDocument } from './markdown/blocks.ts'
import { MarkdownView } from './markdown/render.tsx'
import { LINE_MENU_KIND, registerLineHandler, type LineMenuValue } from './menus.ts'
import { READ_CAP, loadDocument, sessionFileOf } from './source.ts'
import { InstructionAsk } from './translate/ask.tsx'
import { assembleTranslation, normalize, planTranslation } from './translate/plan.ts'
import {
  dismissStale,
  lineAligned,
  markSaved,
  readyState,
  saveable,
  staleNoticeOf,
  translatedText,
  type PromptRun,
  type ReadyTranslation,
  type TranslationState,
} from './translate/state.ts'
import { aligned } from './translate/verify.ts'

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
  /** Opens the shared menu; false when the service is absent, so the native menu stays. */
  openMenu(target: ContextMenuTarget, point: { x: number, y: number }): boolean
}

export interface BodyProps extends BodyInjected {
  resourceAddress: string
  content: BodyContent
  t: Translate
}

type View = 'source' | 'translated'

/** The save action's own lifecycle; a failure shows in the status row, not in the prose. */
type SaveState = { status: 'idle' } | { status: 'busy' } | { status: 'failed', message: string }

/** Where the 重新翻译 popover hangs, in viewport coordinates. */
interface Ask {
  left: number
  top: number
}

type BodyState =
  | { status: 'loading' }
  | { status: 'ready', text: string, absolutePath: string, version: string }
  | { status: 'too-large', limit: number }
  | { status: 'not-text' }
  | { status: 'failed', code: string, message: string }

/** The source line shown beside a clicked translation line. */
interface Peek {
  line: number
  text: string
  left: number
  /** Viewport offset used when the panel sits below the clicked line. */
  top: number
  /** Viewport offset used when the panel flips above the clicked line. */
  bottom: number
  above: boolean
}

const PEEK_GAP = 6
/** Room below the clicked line needed before the panel goes underneath it. */
const PEEK_HEIGHT = 64
const PEEK_WIDTH = 340

/** Nearest ancestor that scrolls the preview, or null when the document scrolls. */
function scrollportOf(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null
  while (node !== null) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node
    node = node.parentElement
  }
  return null
}

/**
 * Only for a failed describe call: the default language code and prompt
 * version keep a run possible, and the next run reads the Host again.
 */
const FALLBACK_DESCRIBE: DescribeView = {
  promptVersion: 'am.translate.v1',
  settings: { lang: 'zh', model: null, translateComments: true },
  languages: [],
}
/** The popover stays narrower than the peek panel so it never fills a narrow pane. */
const ASK_WIDTH = 300

/** Human-readable byte size for the fallback copy. */
function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** The run identity a stored record gives back, with the session's current prompt version as fallback. */
function storedRun(meta: TranslationMeta, promptVersion: string, translateComments: boolean, extraInstruction = ''): PromptRun {
  return {
    promptVersion: meta.promptVersion || promptVersion,
    extraInstruction,
    lang: meta.lang,
    provider: meta.provider,
    model: meta.model,
    translateComments,
  }
}

function alignmentText(ready: ReadyTranslation, t: Translate): string {
  const { alignment } = ready
  if (alignment.sourceLines !== alignment.translatedLines) {
    return t('translate.unaligned', { translated: alignment.translatedLines, source: alignment.sourceLines })
  }
  const broken = alignment.headingBreak
  if (broken === null) return t('translate.aligned', { lines: alignment.translatedLines })
  if (broken.kind === 'missing') return t('translate.heading.missing', { line: broken.source.line })
  if (broken.kind === 'extra') return t('translate.heading.extra', { line: broken.translated.line })
  return t('translate.heading.mismatch', { line: broken.source.line })
}

/**
 * Draw one Markdown preview tab.
 * @param props - owner supplies the address, content protocol state, and locale.
 * @returns the document or its fixed fallback.
 */
export function Body({ resourceAddress, content, readBytes, openResource, host, openMenu, t }: BodyProps): ReactNode {
  const file = useMemo(() => sessionFileOf(resourceAddress), [resourceAddress])
  const [state, setState] = useState<BodyState>({ status: 'loading' })
  const container = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<View>('source')
  const [translation, setTranslation] = useState<TranslationState>({ status: 'idle' })
  const [lineNumbers, setLineNumbers] = useState(false)
  const [peek, setPeek] = useState<Peek | null>(null)
  /** The instruction the last re-translate ran with; the popover reopens with it. */
  const [instruction, setInstruction] = useState('')
  const [ask, setAsk] = useState<Ask | null>(null)
  const [save, setSave] = useState<SaveState>({ status: 'idle' })
  const [toast, setToast] = useState<string | null>(null)
  const peekPanel = useRef<HTMLDivElement | null>(null)
  const requestToken = useRef(0)
  const runController = useRef<AbortController | null>(null)

  const stopRun = useCallback((): void => {
    runController.current?.abort()
    runController.current = null
    requestToken.current += 1
  }, [])
  const renderer = content.kind === 'renderer' ? content : undefined
  const rendererRef = useRef(renderer)
  rendererRef.current = renderer
  const revision = renderer?.revision ?? 0
  const sessionId = file?.sessionId
  const path = file?.path

  /**
   * The stored translation a reopened document can show without a model call.
   * A saved file wins over the automatic cache, and the token drops the answer
   * once any other run has taken over the document.
   */
  const restoreTranslation = useCallback((sourceText: string, token: number): void => {
    if (sessionId === undefined || path === undefined) return
    void (async () => {
      const bridge = await host().catch(() => undefined)
      if (bridge === undefined) return
      const described = await bridge.describe().catch(() => FALLBACK_DESCRIBE)
      const settings = described.settings
      const saved = await bridge.load({ sessionId, path, lang: settings.lang }).catch(() => null)
      let restored: ReadyTranslation | undefined
      if (saved !== null) {
        restored = readyState({
          text: saved.text,
          sourceText,
          persistence: { kind: 'saved', stale: saved.stale, dismissed: false },
          run: storedRun(saved.meta, described.promptVersion, settings.translateComments),
        })
      } else {
        const cached = await bridge.cacheGet({
          text: sourceText,
          lang: settings.lang,
          ...(settings.model === null ? {} : settings.model),
          promptVersion: described.promptVersion,
          translateComments: settings.translateComments,
        }).catch(() => null)
        if (cached !== null) {
          restored = readyState({
            text: cached.text,
            sourceText,
            persistence: { kind: 'unsaved' },
            run: storedRun(cached.meta, described.promptVersion, settings.translateComments),
          })
        }
      }
      if (restored === undefined || token !== requestToken.current) return
      setTranslation(current => (current.status === 'idle' ? restored : current))
    })()
  }, [host, sessionId, path])

  useEffect(() => {
    if (sessionId === undefined || path === undefined) {
      setState({ status: 'failed', code: 'address', message: t('error.address') })
      return
    }
    const controller = new AbortController()
    requestToken.current += 1
    setView('source')
    setTranslation({ status: 'idle' })
    setInstruction('')
    setAsk(null)
    setSave({ status: 'idle' })
    setState({ status: 'loading' })
    void loadDocument(readBytes, { sessionId, path }, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.status === 'ready') {
        setState({ status: 'ready', text: result.text, absolutePath: result.absolutePath, version: result.version })
        restoreTranslation(result.text, requestToken.current)
        return
      }
      setState(result)
      rendererRef.current?.failed()
    })
    return () => {
      controller.abort()
      // A new revision or an unmount also ends any chunk loop still in flight.
      stopRun()
    }
  }, [sessionId, path, revision, readBytes, t, restoreTranslation, stopRun])

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

  const sourceLines = useMemo(() => state.status === 'ready' ? normalize(state.text).split('\n') : [], [state])
  const peekable = view === 'translated' && lineAligned(translation)
  const showGutter = lineNumbers && (view === 'source' || peekable)

  const showLine = useCallback((line: number): void => {
    const root = container.current
    if (root === null) return
    const element = root.querySelector(`[data-line="${line}"]`)
    if (element === null) return
    const text = normalize(state.status === 'ready' ? state.text : '').split('\n')[line - 1]
    if (text === undefined) return
    const rect = element.getBoundingClientRect()
    setPeek({
      line,
      text,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - PEEK_WIDTH - 8)),
      top: rect.bottom + PEEK_GAP,
      bottom: window.innerHeight - rect.top + PEEK_GAP,
      above: rect.bottom + PEEK_GAP + PEEK_HEIGHT > window.innerHeight,
    })
  }, [state])

  const docId = `${sessionId ?? ''}:${path ?? ''}`

  // The menu action runs against the body that owns the document, not the one that is mounted last.
  useEffect(() => registerLineHandler(docId, showLine), [docId, showLine])

  useEffect(() => {
    const root = container.current
    if (root === null || !peekable) return
    const onContextMenu = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const element = target.closest('[data-line]')
      if (element === null || !root.contains(element)) return
      const line = Number(element.getAttribute('data-line'))
      if (!Number.isInteger(line)) return
      const value: LineMenuValue = { docId, line }
      if (!openMenu({ kind: LINE_MENU_KIND, value }, { x: event.clientX, y: event.clientY })) return
      event.preventDefault()
    }
    root.addEventListener('contextmenu', onContextMenu)
    return () => root.removeEventListener('contextmenu', onContextMenu)
  }, [peekable, docId, openMenu])

  // A long source line can make the panel taller than the estimate; flip it once
  // the measured height says it would leave the viewport.
  useLayoutEffect(() => {
    if (peek === null || peek.above) return
    const panel = peekPanel.current
    if (panel === null) return
    const rect = panel.getBoundingClientRect()
    if (rect.bottom <= window.innerHeight - 8) return
    if (peek.top - PEEK_GAP - rect.height < 8) return
    setPeek({ ...peek, above: true })
  }, [peek])

  useEffect(() => {
    if (!peekable) setPeek(null)
  }, [peekable])

  useEffect(() => {
    if (peek === null) return
    const root = container.current
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) {
        setPeek(null)
        return
      }
      if (target.closest('.am-peek') !== null) return
      const line = target.closest('[data-line]')
      if (line !== null && root !== null && root.contains(line)) return
      setPeek(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPeek(null)
    }
    const onScroll = (): void => { setPeek(null) }
    const scrollport = scrollportOf(root)
    scrollport?.addEventListener('scroll', onScroll)
    if (scrollport === null) window.addEventListener('scroll', onScroll)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
      scrollport?.removeEventListener('scroll', onScroll)
      if (scrollport === null) window.removeEventListener('scroll', onScroll)
    }
  }, [peek])

  const translateDocument = useCallback((
    document: { text: string, absolutePath: string },
    extraInstruction: string,
    reuseStored: boolean,
  ): void => {
    stopRun()
    setPeek(null)
    setSave({ status: 'idle' })
    const sourceLines = normalize(document.text).split('\n')
    const plan = planTranslation(document.text, parseDocument(document.text).blocks)
    if (plan.kind === 'too-large') {
      setTranslation({ status: 'too-large', lineCount: plan.lineCount })
      return
    }
    const token = ++requestToken.current
    const controller = new AbortController()
    runController.current = controller
    const chunks = plan.ranges.length
    setTranslation({ status: 'running', chunk: 1, chunks })
    void (async () => {
      try {
        const bridge = await host()
        const described = await bridge.describe().catch(() => FALLBACK_DESCRIBE)
        const settings = described.settings
        const run: PromptRun = {
          promptVersion: described.promptVersion,
          extraInstruction,
          lang: settings.lang,
          ...(settings.model === null ? {} : settings.model),
          translateComments: settings.translateComments,
        }
        // The reader asked for a translation that may already exist, so a stored
        // result answers with no model call. An explicit re-translate must produce
        // a new one, so it never takes this branch.
        if (reuseStored) {
          const cached = await bridge.cacheGet({
            text: document.text,
            lang: settings.lang,
            ...(settings.model === null ? {} : settings.model),
            promptVersion: described.promptVersion,
            translateComments: settings.translateComments,
            extraInstruction,
          }).catch(() => null)
          if (token !== requestToken.current) return
          if (cached !== null) {
            setTranslation(readyState({
              text: cached.text,
              sourceText: document.text,
              persistence: { kind: 'unsaved' },
              run: storedRun(cached.meta, described.promptVersion, settings.translateComments, extraInstruction),
            }))
            return
          }
        }
        const replies: string[] = []
        let partial: string | undefined
        for (const [index, range] of plan.ranges.entries()) {
          if (token !== requestToken.current) return
          // Keep the chunks that already landed visible while this one runs.
          setTranslation({ status: 'running', chunk: index + 1, chunks, ...(partial === undefined ? {} : { partial }) })
          replies.push(await bridge.translate({
            sessionId: sessionId ?? '',
            path: path ?? '',
            text: sourceLines.slice(range.start, range.end).join('\n'),
            lang: settings.lang,
            ...(settings.model === null ? {} : settings.model),
            promptVersion: described.promptVersion,
            extraInstruction,
            translateComments: settings.translateComments,
          }, controller.signal))
          if (token !== requestToken.current) return
          // Land every finished chunk at once: the unfinished ones keep their source lines,
          // so the page shows a growing Chinese document at constant line count.
          const pending = plan.ranges.slice(index + 1).map(next => sourceLines.slice(next.start, next.end).join('\n'))
          partial = assembleTranslation(plan.ranges, sourceLines, [...replies, ...pending])
          setTranslation({ status: 'running', chunk: index + 2 > chunks ? chunks : index + 2, chunks, partial })
        }
        const text = assembleTranslation(plan.ranges, sourceLines, replies)
        const ready = readyState({ text, sourceText: document.text, persistence: { kind: 'unsaved' }, run })
        setTranslation(ready)
        // Fire and forget: a lost cache write costs one re-translation later, and
        // must never change what the reader is looking at.
        void bridge.cachePut({
          text: document.text,
          translated: text,
          lang: run.lang,
          ...(run.provider === undefined ? {} : { provider: run.provider }),
          ...(run.model === undefined ? {} : { model: run.model }),
          promptVersion: run.promptVersion,
          translateComments: run.translateComments,
          extraInstruction: run.extraInstruction,
          aligned: aligned(ready.alignment),
          sourceLines: ready.alignment.sourceLines,
          translatedLines: ready.alignment.translatedLines,
        }).catch((error: unknown) => console.warn('[active-markdown] cache write failed', error))
      } catch (error) {
        if (token !== requestToken.current) return
        setTranslation({ status: 'failed', message: error instanceof Error ? error.message : String(error) })
      } finally {
        if (runController.current === controller) runController.current = null
      }
    })()
  }, [host, sessionId, path, stopRun])

  const chooseView = useCallback((next: View) => {
    setView(next)
    if (next !== 'translated' || state.status !== 'ready') return
    if (translation.status === 'ready' || translation.status === 'running' || translation.status === 'too-large') return
    translateDocument({ text: state.text, absolutePath: state.absolutePath }, instruction, true)
  }, [state, translation, translateDocument, instruction])

  /** Hang the instruction popover under whichever button opened it. */
  const openAsk = useCallback((anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect()
    setAsk({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - ASK_WIDTH - 8)),
      top: rect.bottom + PEEK_GAP,
    })
  }, [])

  const retranslate = useCallback((nextInstruction: string) => {
    if (state.status !== 'ready') return
    setAsk(null)
    setInstruction(nextInstruction)
    setView('translated')
    translateDocument({ text: state.text, absolutePath: state.absolutePath }, nextInstruction, false)
  }, [state, translateDocument])

  const cancelTranslation = useCallback(() => {
    stopRun()
    setTranslation({ status: 'idle' })
    setView('source')
    setPeek(null)
    setSave({ status: 'idle' })
  }, [stopRun])

  const saveTranslation = useCallback(() => {
    const ready = saveable(translation)
    if (ready === undefined || state.status !== 'ready' || sessionId === undefined || path === undefined) return
    setSave({ status: 'busy' })
    void (async () => {
      try {
        const bridge = await host()
        const saved = await bridge.save({
          sessionId,
          path,
          text: state.text,
          translated: ready.text,
          lang: ready.run.lang,
          ...(ready.run.provider === undefined ? {} : { provider: ready.run.provider }),
          ...(ready.run.model === undefined ? {} : { model: ready.run.model }),
          promptVersion: ready.run.promptVersion,
          extraInstruction: ready.run.extraInstruction,
          aligned: aligned(ready.alignment),
        })
        setTranslation(current => (current.status === 'ready' && current.text === ready.text ? markSaved(current) : current))
        setSave({ status: 'idle' })
        setToast(t('translate.saved', { file: saved.file }))
      } catch (error) {
        setSave({ status: 'failed', message: error instanceof Error ? error.message : String(error) })
      }
    })()
  }, [translation, state, sessionId, path, host, t])

  useEffect(() => {
    if (toast === null) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  return (
    <div className={showGutter ? 'am-root am-linenos' : 'am-root'} ref={container} data-active-markdown>
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
            <button type="button" className="am-toolbar-toggle" aria-pressed={lineNumbers} onClick={() => setLineNumbers(value => !value)}>
              {t('lineNumbers')}
            </button>
            {saveable(translation) === undefined ? null : (
              <button type="button" className="am-toolbar-toggle" disabled={save.status === 'busy'} onClick={saveTranslation}>
                {t('translate.save')}
              </button>
            )}
            {translation.status === 'ready' ? (
              <button type="button" className="am-toolbar-toggle" onClick={(event) => openAsk(event.currentTarget)}>
                {t('translate.retranslate')}
              </button>
            ) : null}
            {translation.status === 'running' ? (
              <button type="button" className="am-toolbar-toggle" onClick={cancelTranslation}>
                {t('translate.cancel')}
              </button>
            ) : null}
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
              {translation.status === 'ready' && !staleNoticeOf(translation) && alignmentText(translation, t)}
              {translation.status === 'failed' && (
                <>
                  <span className="am-toolbar-error">{t('translate.failed', { message: translation.message })}</span>
                  <button type="button" className="am-toolbar-action" onClick={() => chooseView('translated')}>
                    {t('translate.retry')}
                  </button>
                </>
              )}
              {save.status === 'failed' && (
                <span className="am-toolbar-error">{t('translate.saveFailed', { message: save.message })}</span>
              )}
            </div>
          </div>
          {staleNoticeOf(translation) && view === 'translated' && (
            <div className="am-notice" role="note">
              <span className="am-notice-text">{t('translate.stale')}</span>
              <button type="button" className="am-toolbar-action" onClick={(event) => openAsk(event.currentTarget)}>
                {t('translate.retranslate')}
              </button>
              <button type="button" className="am-toolbar-action" onClick={() => setTranslation(current => dismissStale(current))}>
                {t('translate.stale.dismiss')}
              </button>
            </div>
          )}
          <RenderBoundary
            labels={{ title: t('error.render.title'), body: t('error.render.body'), reload: t('reload') }}
            onReload={reload}
          >
            <DocumentView
              text={view === 'translated' ? translatedText(translation) ?? state.text : state.text}
              labels={labels}
              actions={actions}
              lineNumbers={showGutter}
              t={t}
            />
          </RenderBoundary>
        </>
      )}
      {peek === null ? null : (
        <div
          ref={peekPanel}
          className="am-peek"
          style={peek.above ? { left: peek.left, bottom: peek.bottom } : { left: peek.left, top: peek.top }}
        >
          <div className="am-peek-head">{t('peek.line', { line: peek.line })}</div>
          <div className="am-peek-text">{peek.text}</div>
        </div>
      )}
      {ask === null ? null : (
        <InstructionAsk
          left={ask.left}
          top={ask.top}
          initial={instruction}
          labels={{
            label: t('translate.ask.label'),
            placeholder: t('translate.ask.placeholder'),
            cancel: t('translate.ask.cancel'),
            confirm: t('translate.retranslate'),
          }}
          onCancel={() => setAsk(null)}
          onConfirm={value => retranslate(value)}
        />
      )}
      {toast === null ? null : <div className="am-toast" role="status">{toast}</div>}
    </div>
  )
}

interface DocumentViewProps {
  text: string
  labels: { copy: string, copied: string, imageFailed: string }
  actions: { openLink(href: string): void, resolveImage(src: string): Promise<string | undefined> }
  lineNumbers: boolean
  t: Translate
}

/** Parse inside the boundary so a parser failure stays recoverable. */
function DocumentView({ text, labels, actions, lineNumbers, t }: DocumentViewProps): ReactNode {
  const parsed = useMemo(() => parseDocument(text), [text])
  return (
    <>
      {parsed.frontmatter === undefined ? null : (
        <section className="am-frontmatter" data-active-markdown-frontmatter>
          <div className="am-frontmatter-label">{t('frontmatter')}</div>
          <pre className="am-frontmatter-source">{parsed.frontmatter.source}</pre>
        </section>
      )}
      <MarkdownView blocks={parsed.blocks} labels={labels} actions={actions} lineNumbers={lineNumbers} />
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
