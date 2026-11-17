/** The document body: read, fallbacks, the rendered Markdown, and annotations. */
import * as React from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnnotationDrawer } from './annotate/drawer.tsx'
import {
  addAnnotation,
  annotateBlock,
  blockAnnotationOf,
  editAnnotation,
  newAnnotationId,
  nextSeq,
  removeAnnotation,
  restoreAnnotation,
  type Annotation,
  type Anchor,
} from './annotate/model.ts'
import { ANNOTATION_POPOVER_WIDTH, AnnotationPopover } from './annotate/popover.tsx'
import {
  atomIndexAt,
  captureAnchor,
  collectComponentRanges,
  collectLineAtoms,
  joinLineAtoms,
  locateAnchor,
  locateBlockAnchor,
  type JoinedLines,
  type TextLineAtom,
} from './annotate/selection.ts'
import type { AnnotationStore, DraftKey } from './annotate/store.ts'
import { useAnnotationSnapshot } from './annotate/use-store.ts'
import type { ContextMenuTarget, DescribeView, HostBridge, Translate, TranslationMeta, WorkspaceFilesRemote } from './context.ts'
import { createImageResolver, type ImageResolver } from './images.ts'
import { classifyLink } from './links.ts'
import { parseDocument, type ParsedDocument } from './markdown/blocks.ts'
import { componentLabel, componentOf, type Block } from './markdown/model.ts'
import { MarkdownView, type ComponentContext } from './markdown/render.tsx'
import {
  registerSelectionHandler,
  SELECTION_MENU_KIND,
  type SelectionAction,
  type SelectionMenuValue,
} from './menus.ts'
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
  /** The plugin-owned draft store; one instance is shared by every body. */
  annotations: AnnotationStore
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

/** The source lines shown beside a translated selection. */
interface Peek {
  lineStart: number
  lineEnd: number
  text: string
  left: number
  /** Viewport offset used when the panel sits below the clicked line. */
  top: number
  /** Viewport offset used when the panel flips above the clicked line. */
  bottom: number
  above: boolean
}

/** The annotation editor's target and its fixed placement. */
type Editor =
  | { mode: 'new-text', anchor: Anchor, left: number, top: number }
  | { mode: 'new-block', block: Block, left: number, top: number }
  | { mode: 'edit', annotation: Annotation, left: number, top: number }

interface UndoState {
  annotation: Annotation
  key: DraftKey
  timer: ReturnType<typeof setTimeout>
}

interface Notice {
  text: string
  undo: boolean
}

const EMPTY_PARSED: ParsedDocument = { blocks: [] }
const ANNOTATION_HIGHLIGHT = 'am-annotation'
const UNDO_WINDOW_MS = 6000
const PIN_STEP = 18

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

/** The rendered line element for a source line, preferring the block that owns it. */
function lineElement(root: HTMLElement | null, line: number, blockId?: string): HTMLElement | null {
  if (root === null) return null
  if (blockId !== undefined) {
    const exact = root.querySelector<HTMLElement>(`[data-line="${line}"][data-block-id="${blockId}"]`)
    if (exact !== null) return exact
  }
  return root.querySelector<HTMLElement>(`[data-line="${line}"]`)
}

/** The text line an event target belongs to; components and gutters return null. */
function closestLineElement(node: Node | null): HTMLElement | null {
  if (node === null) return null
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest<HTMLElement>('[data-line][data-block-id]') ?? null
}

/** The `data-line` of the nearest line container, component line spans included. */
function lineNumberOf(node: Node | null): number | undefined {
  if (node === null) return undefined
  const element = node instanceof Element ? node : node.parentElement
  const value = Number(element?.closest<HTMLElement>('[data-line]')?.dataset.line)
  return Number.isInteger(value) ? value : undefined
}

/** Character offset of a DOM boundary inside one line element. */
function offsetWithin(element: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.setEnd(node, offset)
  return range.toString().length
}

/** Whether a right-click landed inside the selected text, not merely elsewhere on the page. */
function pointInRange(range: Range, x: number, y: number): boolean {
  for (const rect of range.getClientRects()) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true
  }
  return false
}

function textPoint(root: HTMLElement, offset: number): { node: Node, offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node = walker.nextNode()
  while (node !== null) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) return { node, offset: remaining }
    remaining -= length
    node = walker.nextNode()
  }
  return null
}

function atomAtOffset(
  atoms: readonly TextLineAtom[],
  starts: readonly number[],
  offset: number,
): { index: number, offset: number } | undefined {
  for (const [index, atom] of atoms.entries()) {
    const start = starts[index]!
    const end = start + atom.text.length
    if (offset <= end) return { index, offset: Math.max(0, offset - start) }
  }
  return undefined
}

/** Where a text annotation starts in the current revision, after any relocation. */
function currentTextStart(
  annotation: Annotation,
  atoms: readonly TextLineAtom[],
  joined: JoinedLines,
): { line: number, blockId: string } | undefined {
  const location = locateAnchor(annotation, joined)
  if (location.status !== 'located') return undefined
  const point = atomAtOffset(atoms, joined.starts, location.startOffset)
  if (point === undefined) return undefined
  const atom = atoms[point.index]
  return atom === undefined ? undefined : { line: atom.line, blockId: atom.blockId }
}

/** Rebuild a DOM range from the joined line offsets an anchor stores. */
function rangeForOffsets(
  root: HTMLElement,
  atoms: readonly TextLineAtom[],
  starts: readonly number[],
  startOffset: number,
  endOffset: number,
): Range | null {
  const start = atomAtOffset(atoms, starts, startOffset)
  const end = atomAtOffset(atoms, starts, endOffset)
  if (start === undefined || end === undefined) return null
  const startAtom = atoms[start.index]!
  const endAtom = atoms[end.index]!
  const startElement = lineElement(root, startAtom.line, startAtom.blockId)
  const endElement = lineElement(root, endAtom.line, endAtom.blockId)
  if (startElement === null || endElement === null) return null
  const startPoint = textPoint(startElement, start.offset)
  const endPoint = textPoint(endElement, end.offset)
  if (startPoint === null || endPoint === null) return null
  const range = document.createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  return range
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
export function Body({ resourceAddress, content, readBytes, openResource, host, annotations, openMenu, t }: BodyProps): ReactNode {
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
  const [notice, setNotice] = useState<Notice | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [undo, setUndo] = useState<UndoState | null>(null)
  const [pinTops, setPinTops] = useState<Readonly<Record<string, number>>>({})
  const [instanceId] = useState(() => newAnnotationId())
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
    setEditor(null)
    setDrawerOpen(false)
    setUndo(null)
    setNotice(null)
    setPinTops({})
    setPeek(null)
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
  const labels = useMemo(() => ({
    copy: t('code.copy'),
    copied: t('code.copied'),
    imageFailed: t('image.failed'),
    annotate: t('component.annotate'),
    edit: t('component.edit'),
  }), [t])

  const reload = useCallback(() => { rendererRef.current?.reload() }, [])

  const sourceLines = useMemo(() => state.status === 'ready' ? normalize(state.text).split('\n') : [], [state])
  const parsed = useMemo<ParsedDocument>(() => (state.status === 'ready' ? parseDocument(state.text) : EMPTY_PARSED), [state])
  const translatedSource = view === 'translated' ? translatedText(translation) ?? (state.status === 'ready' ? state.text : '') : ''
  const translatedParsed = useMemo<ParsedDocument>(
    () => (view === 'translated' ? parseDocument(translatedSource) : EMPTY_PARSED),
    [view, translatedSource],
  )
  const displayed = view === 'translated' ? translatedParsed : parsed
  const sourceAtoms = useMemo(() => collectLineAtoms(parsed.blocks), [parsed])
  const sourceJoined = useMemo(() => joinLineAtoms(sourceAtoms), [sourceAtoms])
  const componentRanges = useMemo(() => collectComponentRanges(parsed.blocks), [parsed])
  const translatedAtoms = useMemo(
    () => (view === 'translated' ? collectLineAtoms(translatedParsed.blocks) : []),
    [view, translatedParsed],
  )
  const absolutePath = state.status === 'ready' ? state.absolutePath : ''
  const draftKey = useMemo<DraftKey | null>(
    () => (sessionId === undefined || absolutePath === '' ? null : { sessionId, path: absolutePath }),
    [sessionId, absolutePath],
  )
  const snapshot = useAnnotationSnapshot(annotations, draftKey)
  const annotationList = snapshot.annotations
  const peekable = view === 'translated' && lineAligned(translation)
  const showGutter = lineNumbers && (view === 'source' || peekable)

  useEffect(() => {
    if (draftKey !== null) annotations.load(draftKey)
  }, [annotations, draftKey])

  const showSourceRange = useCallback((lineStart: number, lineEnd: number): void => {
    const root = container.current
    if (root === null || lineEnd < lineStart) return
    const text = sourceLines.slice(lineStart - 1, lineEnd).join('\n')
    const element = lineElement(root, lineStart)
    if (element === null) return
    const rect = element.getBoundingClientRect()
    setPeek({
      lineStart,
      lineEnd,
      text,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - PEEK_WIDTH - 8)),
      top: rect.bottom + PEEK_GAP,
      bottom: window.innerHeight - rect.top + PEEK_GAP,
      above: rect.bottom + PEEK_GAP + PEEK_HEIGHT > window.innerHeight,
    })
  }, [sourceLines])

  const onSelectionAction = useCallback((value: SelectionMenuValue, action: SelectionAction): void => {
    if (action === 'copy') {
      const clipboard = navigator.clipboard
      if (clipboard === undefined) return
      void clipboard.writeText(value.text)
        .then(() => setNotice({ text: t('code.copied'), undo: false }))
        .catch(() => {})
      return
    }
    if (action === 'show-source') {
      showSourceRange(value.lineStart, value.lineEnd)
      return
    }
    if (value.anchor === undefined) return
    setEditor({
      mode: 'new-text',
      anchor: value.anchor,
      left: Math.max(8, Math.min(value.rect.left, window.innerWidth - ANNOTATION_POPOVER_WIDTH - 8)),
      top: value.rect.bottom + PEEK_GAP,
    })
  }, [showSourceRange, t])

  // The menu action runs against the body instance that opened it, not the last one mounted.
  useEffect(() => registerSelectionHandler(instanceId, onSelectionAction), [onSelectionAction])

  useEffect(() => {
    const root = container.current
    if (root === null || state.status !== 'ready') return
    const openSelectionMenu = (event: MouseEvent, value: SelectionMenuValue): void => {
      if (!openMenu({ kind: SELECTION_MENU_KIND, value }, { x: event.clientX, y: event.clientY })) return
      event.preventDefault()
    }
    const componentSelected = (range: Range): boolean => {
      const from = lineNumberOf(range.startContainer)
      const to = lineNumberOf(range.endContainer)
      if (from === undefined || to === undefined) return false
      const start = Math.min(from, to)
      const end = Math.max(from, to)
      return componentRanges.some(component => component.lineStart <= end && start <= component.lineEnd)
    }
    const onContextMenu = (event: MouseEvent): void => {
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      if (range.collapsed) return
      const doc = root.querySelector<HTMLElement>('.am-doc')
      if (doc === null || !doc.contains(range.commonAncestorContainer)) return
      if (!pointInRange(range, event.clientX, event.clientY)) return
      const rect = range.getBoundingClientRect()
      const area = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      }

      if (view === 'source') {
        const startElement = closestLineElement(range.startContainer)
        const endElement = closestLineElement(range.endContainer)
        if (startElement === null || endElement === null) {
          if (componentSelected(range)) setNotice({ text: t('annotate.componentOnly'), undo: false })
          return
        }
        const start = atomIndexAt(sourceAtoms, Number(startElement.dataset.line), startElement.dataset.blockId ?? '')
        const end = atomIndexAt(sourceAtoms, Number(endElement.dataset.line), endElement.dataset.blockId ?? '')
        if (start === undefined || end === undefined) {
          if (componentSelected(range)) setNotice({ text: t('annotate.componentOnly'), undo: false })
          return
        }
        const anchor = captureAnchor(
          sourceAtoms,
          { atom: start, offset: offsetWithin(startElement, range.startContainer, range.startOffset) },
          { atom: end, offset: offsetWithin(endElement, range.endContainer, range.endOffset) },
          componentRanges,
        )
        if (anchor === null) {
          if (componentSelected(range)) setNotice({ text: t('annotate.componentOnly'), undo: false })
          return
        }
        openSelectionMenu(event, {
          instanceId: instanceId,
          view: 'source',
          text: selection.toString(),
          lineStart: anchor.lineStart,
          lineEnd: anchor.lineEnd,
          rect: area,
          canShowSource: true,
          anchor,
        })
        return
      }

      const startLine = closestLineElement(range.startContainer)
      const endLine = closestLineElement(range.endContainer)
      const startAtom = startLine === null
        ? undefined
        : atomIndexAt(translatedAtoms, Number(startLine.dataset.line), startLine.dataset.blockId ?? '')
      const endAtom = endLine === null
        ? undefined
        : atomIndexAt(translatedAtoms, Number(endLine.dataset.line), endLine.dataset.blockId ?? '')
      const lineStart = startAtom === undefined ? lineNumberOf(range.startContainer) : translatedAtoms[startAtom]?.line
      const lineEnd = endAtom === undefined ? lineNumberOf(range.endContainer) : translatedAtoms[endAtom]?.line
      if (lineStart === undefined || lineEnd === undefined) return
      openSelectionMenu(event, {
        instanceId: instanceId,
        view: 'translated',
        text: selection.toString(),
        lineStart,
        lineEnd,
        rect: area,
        canShowSource: peekable,
      })
    }
    root.addEventListener('contextmenu', onContextMenu)
    return () => root.removeEventListener('contextmenu', onContextMenu)
  }, [state.status, view, sourceAtoms, translatedAtoms, componentRanges, peekable, openMenu, t])

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

  const located = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const annotation of annotationList) {
      map.set(annotation.id, annotation.kind === 'text'
        ? locateAnchor(annotation, sourceJoined).status === 'located'
        : locateBlockAnchor(annotation, parsed.blocks).status === 'located')
    }
    return map
  }, [annotationList, sourceJoined, parsed])

  const openEditor = useCallback((annotation: Annotation, anchor?: HTMLElement): void => {
    const rect = anchor?.getBoundingClientRect()
    setEditor({
      mode: 'edit',
      annotation,
      left: rect === undefined ? Math.max(8, window.innerWidth - ANNOTATION_POPOVER_WIDTH - 24) : Math.max(8, Math.min(rect.left, window.innerWidth - ANNOTATION_POPOVER_WIDTH - 8)),
      top: rect === undefined ? 72 : rect.bottom + PEEK_GAP,
    })
  }, [])

  const openBlockEditor = useCallback((block: Block): void => {
    const element = container.current?.querySelector<HTMLElement>(`[data-component][data-block-id="${block.id}"]`)
    const rect = element?.getBoundingClientRect()
    const latest = draftKey === null ? annotationList : annotations.getSnapshot(draftKey).annotations
    const existing = blockAnnotationOf(latest, block.id)
    const left = rect === undefined
      ? Math.max(8, window.innerWidth - ANNOTATION_POPOVER_WIDTH - 24)
      : Math.max(8, Math.min(rect.right - ANNOTATION_POPOVER_WIDTH, window.innerWidth - ANNOTATION_POPOVER_WIDTH - 8))
    const top = rect === undefined ? 72 : rect.top + 36
    if (existing !== undefined) setEditor({ mode: 'edit', annotation: existing, left, top })
    else setEditor({ mode: 'new-block', block, left, top })
  }, [annotationList, annotations, draftKey])

  const componentContext = useMemo<ComponentContext>(() => ({
    labelOf: (block) => {
      const component = componentOf(block)
      return component === null ? '' : componentLabel(component, t)
    },
    annotationOf: block => (view === 'source' ? blockAnnotationOf(annotationList, block.id) : undefined),
    ...(view === 'source' ? { annotate: openBlockEditor } : {}),
  }), [view, annotationList, t, openBlockEditor])

  const saveEditor = useCallback((body: string): void => {
    const target = draftKey
    const current = editor
    const text = body.trim()
    if (target === null || current === null || text === '') return
    const latest = annotations.getSnapshot(target)
    if (latest.status !== 'ready') {
      setEditor(null)
      setNotice({ text: t('annotate.loading'), undo: false })
      return
    }
    const base = latest.annotations
    const options = {
      id: newAnnotationId(),
      seq: nextSeq(base, latest.nextSeq),
      createdAt: new Date().toISOString(),
    }
    const next = current.mode === 'edit'
      ? editAnnotation(base, current.annotation.id, text)
      : current.mode === 'new-block'
        ? annotateBlock(base, current.block, text, options, componentContext.labelOf(current.block))
        : addAnnotation(base, { ...current.anchor, kind: 'text', body: text }, options)
    setEditor(null)
    void annotations.write(target, next).then((result) => {
      if (result.status === 'too-large') setNotice({ text: t('annotate.tooLarge'), undo: false })
      else if (result.status === 'failed') setNotice({ text: result.message, undo: false })
    })
  }, [draftKey, editor, annotations, componentContext, t])

  const deleteAnnotation = useCallback((annotation: Annotation): void => {
    const target = draftKey
    if (target === null) return
    if (undo !== null) clearTimeout(undo.timer)
    const latest = annotations.getSnapshot(target).annotations
    if (!latest.some(entry => entry.id === annotation.id)) return
    void annotations.write(target, removeAnnotation(latest, annotation.id)).then((result) => {
      if (result.status === 'too-large') setNotice({ text: t('annotate.tooLarge'), undo: true })
      else if (result.status === 'failed') setNotice({ text: result.message, undo: true })
    })
    const timer = setTimeout(() => setUndo(current => (current?.annotation.id === annotation.id ? null : current)), UNDO_WINDOW_MS)
    setUndo({ annotation, key: target, timer })
    setNotice({ text: t('annotate.deleted'), undo: true })
  }, [draftKey, annotations, undo, t])

  const undoDelete = useCallback((): void => {
    if (undo === null) return
    clearTimeout(undo.timer)
    const current = annotations.getSnapshot(undo.key).annotations
    void annotations.write(undo.key, restoreAnnotation(current, undo.annotation)).then((result) => {
      if (result.status === 'too-large') setNotice({ text: t('annotate.tooLarge'), undo: false })
      else if (result.status === 'failed') setNotice({ text: result.message, undo: false })
    })
    setUndo(null)
    setNotice(null)
  }, [undo, annotations, t])

  const clearAnnotations = useCallback((): void => {
    if (draftKey === null) return
    if (undo !== null) clearTimeout(undo.timer)
    setUndo(null)
    setNotice(null)
    void annotations.clear(draftKey).then((result) => {
      if (result.status === 'failed') setNotice({ text: result.message, undo: false })
    })
  }, [draftKey, annotations, undo])

  const locateAnnotation = useCallback((annotation: Annotation): void => {
    const textStart = annotation.kind === 'text'
      ? currentTextStart(annotation, sourceAtoms, sourceJoined)
      : undefined
    if (annotation.kind === 'text' && textStart === undefined) {
      setNotice({ text: t('annotate.missing'), undo: false })
      return
    }
    if (annotation.kind === 'block' && locateBlockAnchor(annotation, parsed.blocks).status !== 'located') {
      setNotice({ text: t('annotate.blockMissing'), undo: false })
      return
    }
    setView('source')
    setPeek(null)
    setDrawerOpen(false)
    requestAnimationFrame(() => {
      const element = annotation.kind === 'block'
        ? container.current?.querySelector<HTMLElement>(`[data-component][data-block-id="${annotation.blockStartId}"]`)
        : textStart === undefined ? null : lineElement(container.current, textStart.line, textStart.blockId)
      element?.scrollIntoView({ block: 'center' })
    })
  }, [parsed, sourceAtoms, sourceJoined, t])

  useEffect(() => {
    if (undo === null) return
    return () => clearTimeout(undo.timer)
  }, [undo])

  // Pins sit beside the prose at the start line's measured top; they never depend
  // on the gutter toggle, so annotations stay visible with line numbers off.
  useLayoutEffect(() => {
    const root = container.current
    if (root === null || view !== 'source' || state.status !== 'ready' || annotationList.length === 0) {
      setPinTops({})
      return
    }
    const doc = root.querySelector<HTMLElement>('.am-doc')
    if (doc === null) return
    const place = (): void => {
      const rootTop = root.getBoundingClientRect().top
      const tops: Record<string, number> = {}
      const counts = new Map<number, number>()
      for (const annotation of annotationList) {
        if (annotation.kind !== 'text') continue
        const start = currentTextStart(annotation, sourceAtoms, sourceJoined)
        if (start === undefined) continue
        const element = lineElement(root, start.line, start.blockId)
        if (element === null) continue
        const stacked = counts.get(start.line) ?? 0
        counts.set(start.line, stacked + 1)
        tops[annotation.id] = element.getBoundingClientRect().top - rootTop + stacked * PIN_STEP
      }
      setPinTops(tops)
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(doc)
    return () => observer.disconnect()
  }, [annotationList, sourceAtoms, sourceJoined, view, state.status])

  useEffect(() => {
    if (typeof CSS === 'undefined' || CSS.highlights === undefined || typeof Highlight === 'undefined') return
    const registry = CSS.highlights
    if (view !== 'source' || state.status !== 'ready') {
      registry.delete(ANNOTATION_HIGHLIGHT)
      return
    }
    const root = container.current
    if (root === null) return
    const highlight = new Highlight()
    for (const annotation of annotationList) {
      if (annotation.kind !== 'text') continue
      const location = locateAnchor(annotation, sourceJoined)
      if (location.status !== 'located') continue
      const range = rangeForOffsets(root, sourceAtoms, sourceJoined.starts, location.startOffset, location.endOffset)
      if (range !== null) highlight.add(range)
    }
    registry.set(ANNOTATION_HIGHLIGHT, highlight)
    return () => {
      registry.delete(ANNOTATION_HIGHLIGHT)
    }
  }, [annotationList, sourceAtoms, sourceJoined, view, state.status])

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
        setNotice({ text: t('translate.saved', { file: saved.file }), undo: false })
      } catch (error) {
        setSave({ status: 'failed', message: error instanceof Error ? error.message : String(error) })
      }
    })()
  }, [translation, state, sessionId, path, host, t])

  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), notice.undo ? UNDO_WINDOW_MS : 4000)
    return () => clearTimeout(timer)
  }, [notice])

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
            <button type="button" className="am-toolbar-toggle" aria-pressed={drawerOpen} onClick={() => setDrawerOpen(value => !value)}>
              {t('annotate.count', { count: annotationList.length })}
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
              parsed={displayed}
              labels={labels}
              actions={actions}
              components={componentContext}
              lineNumbers={showGutter}
              t={t}
            />
          </RenderBoundary>
        </>
      )}
      {view === 'source' ? (
        <div className="am-pins">
          {annotationList.map(annotation => (
            annotation.kind !== 'text' || pinTops[annotation.id] === undefined
              ? null
              : (
                <button
                  key={annotation.id}
                  type="button"
                  className="am-pin"
                  style={{ top: pinTops[annotation.id] }}
                  title={annotation.quote}
                  onClick={(event) => openEditor(annotation, event.currentTarget)}
                >
                  {annotation.seq}
                </button>
              )
          ))}
        </div>
      ) : null}
      {peek === null ? null : (
        <div
          ref={peekPanel}
          className="am-peek"
          style={peek.above ? { left: peek.left, bottom: peek.bottom } : { left: peek.left, top: peek.top }}
        >
          <div className="am-peek-head">
            {peek.lineStart === peek.lineEnd
              ? t('peek.line', { line: peek.lineStart })
              : t('peek.range', { start: peek.lineStart, end: peek.lineEnd })}
          </div>
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
      <AnnotationDrawer
        open={drawerOpen}
        annotations={annotationList}
        readOnly={view === 'translated'}
        located={located}
        persistence={snapshot.persistence}
        labels={{
          title: t('annotate.drawer.title'),
          empty: t('annotate.drawer.empty'),
          clear: t('annotate.drawer.clear'),
          locate: t('annotate.drawer.locate'),
          edit: t('annotate.drawer.edit'),
          delete: t('annotate.drawer.delete'),
          missing: t('annotate.missing'),
          memory: t('annotate.memory'),
          tooLarge: t('annotate.tooLarge'),
          readOnly: t('annotate.readOnly'),
          top: t('annotate.drawer.top'),
          line: line => t('annotate.line', { line }),
          range: (start, end) => t('annotate.range', { start, end }),
        }}
        onClose={() => setDrawerOpen(false)}
        onLocate={locateAnnotation}
        onEdit={openEditor}
        onDelete={deleteAnnotation}
        onClear={clearAnnotations}
      />
      {editor === null ? null : (
        <AnnotationPopover
          left={editor.left}
          top={editor.top}
          quote={editor.mode === 'edit' ? editor.annotation.quote : editor.mode === 'new-block' ? componentContext.labelOf(editor.block) : editor.anchor.quote}
          initial={editor.mode === 'edit' ? editor.annotation.body : ''}
          labels={{
            title: t('annotate.drawer.title'),
            quote: t('annotate.quote'),
            placeholder: t('annotate.placeholder'),
            save: t('annotate.save'),
            cancel: t('annotate.cancel'),
          }}
          onSave={saveEditor}
          onCancel={() => setEditor(null)}
        />
      )}
      {notice === null
        ? null
        : (
          <div className="am-toast" role="status">
            <span>{notice.text}</span>
            {notice.undo && undo !== null
              ? <button type="button" className="am-toast-action" onClick={undoDelete}>{t('annotate.undo')}</button>
              : null}
          </div>
        )}
    </div>
  )
}

interface DocumentViewProps {
  parsed: ParsedDocument
  labels: { copy: string, copied: string, imageFailed: string, annotate: string, edit: string }
  actions: { openLink(href: string): void, resolveImage(src: string): Promise<string | undefined> }
  components: ComponentContext
  lineNumbers: boolean
  t: Translate
}

/** Parse once in the body so annotations and the rendered tree share one block model. */
function DocumentView({ parsed, labels, actions, components, lineNumbers, t }: DocumentViewProps): ReactNode {
  return (
    <>
      {parsed.frontmatter === undefined ? null : (
        <section className="am-frontmatter" data-active-markdown-frontmatter>
          <div className="am-frontmatter-label">{t('frontmatter')}</div>
          <pre className="am-frontmatter-source">{parsed.frontmatter.source}</pre>
        </section>
      )}
      <MarkdownView blocks={parsed.blocks} labels={labels} actions={actions} components={components} lineNumbers={lineNumbers} />
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
