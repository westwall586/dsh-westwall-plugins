/** The document body: read, fallbacks, the rendered Markdown, and annotations. */
import * as React from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AttachmentController, AttachmentFailure } from './annotate/attachment.ts'
import type { PendingHub } from './annotate/committer.ts'
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
import { centerDelta, placePanelBelow, placePopover, revealDelta, type PanelPlacement } from './annotate/position.ts'
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
import type {
  ContextMenuTarget,
  DescribeView,
  HostBridge,
  InputActionsView,
  ReviewLatestView,
  Translate,
  TranslationMeta,
  UseInput,
  WorkspaceFilesRemote,
} from './context.ts'
import { SourceEditor } from './edit/editor.tsx'
import {
  canEnterEdit,
  conflictFileName,
  lineTarget,
  MAX_EDIT_BYTES,
  sameText,
  saveOutcomeOf,
  type EditCheckResult,
  type WriteIntent,
  type WriteTextResult,
} from './edit/model.ts'
import { ConflictPanel, EditBanner, EditToolbar, useEditCommand } from './edit/panel.tsx'
import { dirty as draftDirty, editReduce, sessionOf, type EditEvent, type EditState } from './edit/state.ts'
import { createImageResolver, type ImageResolver } from './images.ts'
import { classifyLink } from './links.ts'
import { parseDocument, type ParsedDocument } from './markdown/blocks.ts'
import { diffBlocks, tocEntries, updatedSections, type DocumentDiff } from './markdown/diff.ts'
import { componentLabel, componentOf, type Block } from './markdown/model.ts'
import { MarkdownView, type ComponentContext } from './markdown/render.tsx'
import { MarkdownToc } from './markdown/toc.tsx'
import { activeAnchorOf, tocRows } from './markdown/toc-model.ts'
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
  /** The feedback-attachment transaction, shared by every body. */
  attachment: AttachmentController
  /** Session-level pending records the committer watches. */
  hub: PendingHub
  /** Opens the shared menu; false when the service is absent, so the native menu stays. */
  openMenu(target: ContextMenuTarget, point: { x: number, y: number }): boolean
}

export interface BodyProps extends BodyInjected {
  resourceAddress: string
  content: BodyContent
  t: Translate
  /** The composer's session; the addressed file may belong to another session. */
  sessionId: string
  inputActions: InputActionsView | undefined
  useInput: UseInput
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
  | { status: 'ready', text: string, absolutePath: string, version: string, bytes: number }
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

/** Where the anchored panel sat when it opened, and the scroll baseline it follows. */
interface EditorOrigin {
  left: number
  top: number
  height: number
  scrollTop: number
  scrollport: HTMLElement | null
}

interface EditorPlacement {
  left: number
  top: number
  above: boolean
}

/** The data half of the editor, before its anchor is measured. */
type EditorTarget =
  | { mode: 'new-text', anchor: Anchor }
  | { mode: 'new-block', block: Block }
  | { mode: 'edit', annotation: Annotation }

/** The annotation editor's target, its anchor, and its measured placement. */
type Editor =
  | ({ mode: 'new-text', anchor: Anchor, origin: EditorOrigin } & EditorPlacement)
  | ({ mode: 'new-block', block: Block, origin: EditorOrigin } & EditorPlacement)
  | ({ mode: 'edit', annotation: Annotation, origin: EditorOrigin } & EditorPlacement)

/** The one error the toolbar shows as a chip; the full text lives in its popover. */
type ToolbarError =
  | { kind: 'save', message: string }
  | { kind: 'translate', message: string }
  | { kind: 'too-large', message: string }

interface UndoState {
  annotation: Annotation
  key: DraftKey
  timer: ReturnType<typeof setTimeout>
}

interface Notice {
  text: string
  undo: boolean
  /** An absolute path the toast can copy, shown with its own action. */
  copyPath?: string
}

const EMPTY_PARSED: ParsedDocument = { blocks: [] }
const EMPTY_DIFF: DocumentDiff = { statuses: [], counts: { updated: 0 } }
const EMPTY_ANCHORS: ReadonlySet<string> = new Set()
const ANNOTATION_HIGHLIGHT = 'am-annotation'
const UNDO_WINDOW_MS = 6000
const PIN_STEP = 18

const PEEK_GAP = 6
/** Room below the clicked line needed before the panel goes underneath it. */
const PEEK_HEIGHT = 64
const PEEK_WIDTH = 340
/** The editor's measured height is not known before it renders; this keeps it on screen. */
const ANNOTATION_ESTIMATE_HEIGHT = 240

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

/** The text line an event target belongs to; components return null. */
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

function refusalText(reason: AttachmentFailure, t: Translate): string {
  switch (reason) {
    case 'compose-session': return t('annotate.composeSession')
    case 'empty': return t('annotate.attachEmpty')
    case 'duplicate': return t('annotate.attached')
    case 'composer-busy': return t('annotate.composerBusy')
    case 'unavailable': return t('annotate.attachUnavailable')
    case 'no-pending': return t('annotate.noPending')
    case 'round-mismatch': return t('annotate.roundMismatch')
    case 'source-changed': return t('annotate.sourceChanged')
    default: return t('annotate.attachFailed', { message: reason })
  }
}

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

/** Place a fixed editor from its anchor, flipping above when the space below is short. */
function placeEditor(left: number, top: number, height: number, popoverHeight = ANNOTATION_ESTIMATE_HEIGHT): EditorPlacement {
  return placePopover(
    { left, top, width: 0, height },
    { width: ANNOTATION_POPOVER_WIDTH, height: popoverHeight },
    { width: window.innerWidth, height: window.innerHeight },
  )
}

function TocIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M3 4h10M5 8h8M7 12h6" />
    </svg>
  )
}

function GlobeIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.8 8h10.4M8 2.5c1.6 1.6 2.4 3.4 2.4 5.5S9.6 12.4 8 13.5C6.4 12.4 5.6 10.6 5.6 8S6.4 4.1 8 2.5Z" />
    </svg>
  )
}

function CommentIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M3 3.5h10v7H8.2L5.5 13v-2.5H3z" />
    </svg>
  )
}

function EditIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="m3 13 1-3.2 7.1-7.1 2.2 2.2L6.2 12 3 13Z" />
      <path d="m9.8 3.2 2.2 2.2" />
    </svg>
  )
}

function BackIcon(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M9.5 3.5 5 8l4.5 4.5" />
    </svg>
  )
}

function AlertIcon(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.5M8 11v.5" />
    </svg>
  )
}

/**
 * Draw one Markdown preview tab.
 * @param props - owner supplies the address, content protocol state, and locale.
 * @returns the document or its fixed fallback.
 */
export function Body({
  resourceAddress,
  content,
  readBytes,
  openResource,
  host,
  annotations,
  attachment,
  hub,
  openMenu,
  t,
  sessionId: composeSessionId,
  inputActions,
  useInput,
}: BodyProps): ReactNode {
  const file = useMemo(() => sessionFileOf(resourceAddress), [resourceAddress])
  const [state, setState] = useState<BodyState>({ status: 'loading' })
  const container = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<View>('source')
  const [translation, setTranslation] = useState<TranslationState>({ status: 'idle' })
  const [peek, setPeek] = useState<Peek | null>(null)
  /** The instruction the last re-translate ran with; the popover reopens with it. */
  const [instruction, setInstruction] = useState('')
  const [ask, setAsk] = useState<Ask | null>(null)
  const [save, setSave] = useState<SaveState>({ status: 'idle' })
  const [notice, setNotice] = useState<Notice | null>(null)
  const [latest, setLatest] = useState<ReviewLatestView | null>(null)
  const [updateCursor, setUpdateCursor] = useState(0)
  const [tocOpen, setTocOpen] = useState(false)
  const [tocPlacement, setTocPlacement] = useState<PanelPlacement | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(EMPTY_ANCHORS)
  const [activeToc, setActiveToc] = useState<string | undefined>(undefined)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [undo, setUndo] = useState<UndoState | null>(null)
  const [pinTops, setPinTops] = useState<Readonly<Record<string, number>>>({})
  const [instanceId] = useState(() => newAnnotationId())
  const [attachBusy, setAttachBusy] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [errorOpen, setErrorOpen] = useState(false)
  const [errorPlacement, setErrorPlacement] = useState<{ left: number, top: number } | null>(null)
  const [described, setDescribed] = useState<DescribeView | null>(null)
  const [edit, setEdit] = useState<EditState>({ status: 'reading' })
  const [editability, setEditability] = useState<EditCheckResult | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [editErrorSaveAs, setEditErrorSaveAs] = useState(true)
  const [editSeq, setEditSeq] = useState(0)
  const [adopt, setAdopt] = useState<{ text: string, token: number }>({ text: '', token: 0 })
  const [exitConfirm, setExitConfirm] = useState(false)
  const [editedSinceOpen, setEditedSinceOpen] = useState(false)
  const tocButton = useRef<HTMLButtonElement | null>(null)
  const tocPanel = useRef<HTMLDivElement | null>(null)
  const toolbar = useRef<HTMLDivElement | null>(null)
  const pointerOver = useRef(false)
  const revealCenter = useRef(false)
  const errorChip = useRef<HTMLButtonElement | null>(null)
  const editorPanel = useRef<HTMLDivElement | null>(null)
  const editorHeight = useRef(ANNOTATION_ESTIMATE_HEIGHT)
  const peekPanel = useRef<HTMLDivElement | null>(null)
  const requestToken = useRef(0)
  const reviewToken = useRef(0)
  const runController = useRef<AbortController | null>(null)
  const editCheckToken = useRef(0)
  const adoptToken = useRef(0)
  const savedEcho = useRef<string | null>(null)
  const restoreLine = useRef<number | undefined>(undefined)
  const docKeyRef = useRef<string | null>(null)
  const editHost = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const editRef = useRef(edit)
  editRef.current = edit
  const translationRef = useRef(translation)
  translationRef.current = translation

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
  // The tab keeps its identity across a revision reload; the edit phase does not.
  const documentKey = useMemo(
    () => (!composeSessionId || path === undefined ? null : `${composeSessionId}\u0000${path}`),
    [composeSessionId, path],
  )
  const phase = useInput(state => state.phase)
  const inputAttachmentIds = useInput(state => state.attachmentIds)
  const composerBusy = phase === 'sending' || phase === 'submitting'

  /** Reduce and keep the ref in step, so a save can read the draft it just changed. */
  const applyEdit = useCallback((event: EditEvent): EditState => {
    const next = editReduce(editRef.current, event)
    editRef.current = next
    setEdit(next)
    return next
  }, [])

  const handleEditError = useCallback((message: string): void => {
    setEditErrorSaveAs(true)
    setEditError(t('edit.saveFailed', { message }))
  }, [t])

  const editCommand = useEditCommand({ host, onEvent: applyEdit, onError: handleEditError })

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
    const documentChanged = docKeyRef.current !== documentKey
    if (documentChanged) {
      docKeyRef.current = documentKey
      savedEcho.current = null
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
      setAttachBusy(false)
      setAttachError(null)
      setState({ status: 'loading' })
      setEdit({ status: 'reading' })
      editRef.current = { status: 'reading' }
      setEditability(null)
      setEditError(null)
      setExitConfirm(false)
      setEditedSinceOpen(false)
    } else if (stateRef.current.status !== 'ready') {
      setState({ status: 'loading' })
    }
    void loadDocument(readBytes, { sessionId, path }, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.status !== 'ready') {
        // An external reload that fails while editing must not unmount the draft.
        if (documentChanged || editRef.current.status === 'reading') {
          setState(result)
          rendererRef.current?.failed()
        }
        return
      }
      const ready: BodyState = {
        status: 'ready',
        text: result.text,
        absolutePath: result.absolutePath,
        version: result.version,
        bytes: result.bytes,
      }
      const current = stateRef.current
      // Our own save lands here once the owner bumps the revision: the version
      // matches the token we just wrote, so adopt it without touching the view.
      if (savedEcho.current !== null && savedEcho.current === result.version) {
        savedEcho.current = null
        setState(ready)
        return
      }
      if (!documentChanged && current.status === 'ready' && current.version === result.version && sameText(current.text, result.text)) {
        setState(ready)
        return
      }
      const phase = editRef.current
      if (phase.status !== 'reading') {
        setState(ready)
        setTranslation({ status: 'idle' })
        setInstruction('')
        if (phase.status === 'editing') {
          if (!draftDirty(phase.session)) {
            adoptToken.current += 1
            setAdopt({ text: result.text, token: adoptToken.current })
          }
          applyEdit({ type: 'external', text: result.text, version: result.version })
        }
        setEditability({ status: 'ok', absolutePath: result.absolutePath, version: result.version })
        return
      }
      // A revision that arrived while reading is an ordinary external update.
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
      setAttachBusy(false)
      setAttachError(null)
      setState(ready)
      restoreTranslation(result.text, requestToken.current)
    })
    return () => {
      controller.abort()
      // A new revision or an unmount also ends any chunk loop still in flight.
      stopRun()
    }
  }, [sessionId, path, revision, readBytes, t, restoreTranslation, stopRun, documentKey, applyEdit])

  // Report the version only once the content is committed: the owner restores
  // the tab's scroll offset as soon as it has a version, and it needs the
  // document to have its full height by then.
  useEffect(() => {
    if (state.status !== 'ready') return
    rendererRef.current?.loaded(state.version)
  }, [state, revision])

  const readyVersion = state.status === 'ready' ? state.version : undefined
  const readyBytes = state.status === 'ready' ? state.bytes : 0

  // Every new version answers the entry question again: a policy switch or an
  // external resize decides whether the 编辑 button exists at all.
  useEffect(() => {
    if (sessionId === undefined || path === undefined || readyVersion === undefined) {
      setEditability(null)
      return
    }
    const token = (editCheckToken.current += 1)
    void editCommand.check(sessionId, path, readyBytes).then((result) => {
      if (token !== editCheckToken.current) return
      setEditability(result ?? { status: 'unsupported', reason: 'fs' })
    })
  }, [sessionId, path, readyVersion, readyBytes, editCommand.check])

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
  // The annotation draft belongs to the composer's session, never the
  // addressed document's session: the attachment is created in the composer.
  const draftKey = useMemo<DraftKey | null>(
    () => (!composeSessionId || absolutePath === '' ? null : { sessionId: composeSessionId, path: absolutePath }),
    [composeSessionId, absolutePath],
  )
  const snapshot = useAnnotationSnapshot(annotations, draftKey)
  const annotationList = snapshot.annotations
  const pendingReview = snapshot.pending
  const attached = pendingReview !== null && inputAttachmentIds.includes(pendingReview.draftAttachmentId)

  // A tab keeps its diff state across a reload; another document starts clean.
  useEffect(() => {
    setLatest(null)
    setTocOpen(false)
  }, [documentKey])

  const pendingRoundId = pendingReview?.roundId ?? null
  useEffect(() => {
    const token = (reviewToken.current += 1)
    if (state.status !== 'ready' || draftKey === null || pendingRoundId !== null) {
      setLatest(null)
      return
    }
    const request = { sessionId: draftKey.sessionId, path: draftKey.path }
    void (async () => {
      const bridge = await host().catch(() => undefined)
      if (bridge === undefined) return
      const base = await bridge.reviewLatest(request).catch(() => null)
      if (token !== reviewToken.current) return
      setLatest(base)
    })()
  }, [state.status, revision, draftKey, pendingRoundId, host])

  const currentText = state.status === 'ready' ? state.text : ''
  const baselineText = latest?.text ?? null
  const sameAsBaseline = baselineText !== null
    && state.status === 'ready'
    && normalize(baselineText) === normalize(currentText)
  const baselineParsed = useMemo<ParsedDocument>(
    () => (baselineText === null || sameAsBaseline ? EMPTY_PARSED : parseDocument(baselineText)),
    [baselineText, sameAsBaseline],
  )
  const diffActive = state.status === 'ready' && baselineText !== null && !sameAsBaseline
  const diff = useMemo<DocumentDiff>(
    () => (diffActive ? diffBlocks(baselineParsed.blocks, parsed.blocks) : EMPTY_DIFF),
    [diffActive, baselineParsed, parsed],
  )
  const updatedAnchors = useMemo(
    () => new Set(updatedSections(parsed.blocks, diff.statuses)),
    [parsed, diff],
  )
  // The contents follow whatever Markdown is on screen: translation gets its own entries.
  const toc = useMemo(() => tocEntries(displayed.blocks), [displayed])

  const toggleFold = useCallback((anchor: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(anchor)) next.add(anchor)
      return next
    })
  }, [])
  const rows = useMemo(() => tocRows(toc, collapsed, activeToc), [toc, collapsed, activeToc])

  const jumpToSection = useCallback((anchor: string): void => {
    const node = Array.from(container.current?.querySelectorAll<HTMLElement>('[data-anchor]') ?? [])
      .find(element => element.getAttribute('data-anchor') === anchor)
    node?.scrollIntoView({ block: 'start' })
    setTocOpen(false)
  }, [])

  // A cross-session attachment belongs to the composer, so an absolute path is
  // the only display path that stays true in that workspace.
  const displayPath = composeSessionId === sessionId ? (path ?? '') : ''
  const peekable = view === 'translated' && lineAligned(translation)

  const staleTranslation = staleNoticeOf(translation)
  const toolbarError: ToolbarError | null = save.status === 'failed'
    ? { kind: 'save', message: save.message }
    : translation.status === 'failed'
      ? { kind: 'translate', message: translation.message }
      : translation.status === 'too-large'
        ? { kind: 'too-large', message: t('translate.tooLarge', { lines: translation.lineCount }) }
        : null
  const langCode = translation.status === 'ready' ? translation.run.lang : described?.settings.lang
  const langLabel = described?.languages.find(option => option.code === langCode)?.label ?? t('view.translated')

  useEffect(() => {
    setUpdateCursor(0)
  }, [diff, view])

  useEffect(() => {
    let live = true
    void host().then(bridge => bridge.describe()).then((value) => {
      if (live) setDescribed(value)
    }).catch(() => {})
    return () => { live = false }
  }, [host])

  useEffect(() => {
    if (attachError === null || drawerOpen) return
    setNotice({ text: attachError, undo: false })
  }, [attachError, drawerOpen])

  useEffect(() => {
    if (toolbarError === null) setErrorOpen(false)
  }, [toolbarError])

  const stepUpdate = useCallback((): void => {
    const targets = container.current?.querySelectorAll<HTMLElement>('[data-diff="updated"]')
    if (targets === undefined || targets.length === 0) return
    const next = updateCursor >= targets.length ? 1 : updateCursor + 1
    const target = targets[next - 1]
    target.scrollIntoView({ block: 'center' })
    target.classList.remove('am-diff-flash')
    void target.offsetWidth
    target.classList.add('am-diff-flash')
    window.setTimeout(() => target.classList.remove('am-diff-flash'), 1200)
    setUpdateCursor(next)
  }, [updateCursor])

  useEffect(() => {
    setCollapsed(EMPTY_ANCHORS)
    setActiveToc(undefined)
  }, [path, view])

  useLayoutEffect(() => {
    if (!tocOpen) {
      setTocPlacement(null)
      return
    }
    const button = tocButton.current
    const pane = container.current
    if (button === null || pane === null) return
    revealCenter.current = true
    const place = (): void => {
      const buttonRect = button.getBoundingClientRect()
      const paneRect = pane.getBoundingClientRect()
      const left = Math.min(Math.max(0, paneRect.left), window.innerWidth)
      const top = Math.min(Math.max(0, paneRect.top), window.innerHeight)
      const right = Math.min(Math.max(0, paneRect.right), window.innerWidth)
      const bottom = Math.min(Math.max(0, paneRect.bottom), window.innerHeight)
      setTocPlacement(placePanelBelow(buttonRect, { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }))
    }
    place()
    window.addEventListener('resize', place)
    const observer = new ResizeObserver(place)
    observer.observe(pane)
    return () => {
      window.removeEventListener('resize', place)
      observer.disconnect()
    }
  }, [tocOpen, toc, view])

  useLayoutEffect(() => {
    if (!tocOpen) return
    const pane = container.current
    if (pane === null) return
    let frame = 0
    const measure = (): void => {
      const tops = new Map<string, number>()
      for (const element of pane.querySelectorAll<HTMLElement>('[data-anchor]')) {
        const anchor = element.getAttribute('data-anchor')
        if (anchor !== null) tops.set(anchor, element.getBoundingClientRect().top)
      }
      // A jump parks the heading 12px below the sticky bar (scroll-margin 56 vs 44),
      // so the threshold needs that gap plus a little slack to claim it current.
      const bar = toolbar.current
      const threshold = (bar === null ? 0 : bar.getBoundingClientRect().bottom) + 16
      setActiveToc(activeAnchorOf(toc, tops, threshold))
    }
    const paint = (): void => {
      frame = 0
      measure()
    }
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(paint)
    }
    measure()
    const scrollport = scrollportOf(pane)
    scrollport?.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    const observer = new ResizeObserver(schedule)
    observer.observe(pane)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      scrollport?.removeEventListener('scroll', schedule)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer.disconnect()
    }
  }, [tocOpen, toc])

  useLayoutEffect(() => {
    if (!tocOpen || tocPlacement === null) return
    const current = rows.find(row => row.isCurrent)
    const panel = tocPanel.current
    if (panel === null) return
    if (current === undefined || pointerOver.current) {
      revealCenter.current = false
      return
    }
    const rowElement = Array.from(panel.querySelectorAll<HTMLElement>('[data-toc-anchor]'))
      .find(element => element.getAttribute('data-toc-anchor') === current.anchor)
    if (rowElement === undefined) return
    const panelRect = panel.getBoundingClientRect()
    const rowRect = rowElement.getBoundingClientRect()
    const panelGeometry = { left: panelRect.left, top: panelRect.top, width: panelRect.width, height: panelRect.height }
    const rowGeometry = { left: rowRect.left, top: rowRect.top, width: rowRect.width, height: rowRect.height }
    panel.scrollTop += revealCenter.current ? centerDelta(panelGeometry, rowGeometry) : revealDelta(panelGeometry, rowGeometry)
    revealCenter.current = false
  }, [tocOpen, tocPlacement, activeToc, rows])

  useEffect(() => {
    if (!tocOpen) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (tocPanel.current?.contains(target) === true || tocButton.current?.contains(target) === true) return
      setTocOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const focused = document.activeElement
      if (focused instanceof Node && tocPanel.current?.contains(focused) === true) tocButton.current?.focus()
      setTocOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [tocOpen])

  useLayoutEffect(() => {
    if (!errorOpen) {
      setErrorPlacement(null)
      return
    }
    const chip = errorChip.current
    if (chip === null) return
    const place = (): void => {
      const rect = chip.getBoundingClientRect()
      const placement = placePopover(rect, { width: 320, height: 160 }, { width: window.innerWidth, height: window.innerHeight })
      setErrorPlacement({ left: placement.left, top: placement.top })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [errorOpen])

  useEffect(() => {
    if (!errorOpen) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (errorChip.current?.contains(target) === true) return
      if (target instanceof Element && target.closest('.am-error-popover') !== null) return
      setErrorOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setErrorOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [errorOpen])

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

  const openEditorAt = useCallback((target: EditorTarget, anchor: { top: number, left: number, height: number }, left: number): void => {
    const scrollport = scrollportOf(container.current)
    const scrollTop = scrollport?.scrollTop ?? window.scrollY
    const origin: EditorOrigin = { left, top: anchor.top, height: anchor.height, scrollTop, scrollport }
    setEditor({ ...target, origin, ...placeEditor(left, anchor.top, anchor.height) })
  }, [])

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
    if (composerBusy) {
      setNotice({ text: t('annotate.composerBusy'), undo: false })
      return
    }
    if (value.anchor === undefined) return
    openEditorAt(
      { mode: 'new-text', anchor: value.anchor },
      { top: value.rect.top, left: value.rect.left, height: Math.max(0, value.rect.bottom - value.rect.top) },
      value.rect.left,
    )
  }, [showSourceRange, t, composerBusy, openEditorAt])

  // The menu action runs against the body instance that opened it, not the last one mounted.
  useEffect(() => registerSelectionHandler(instanceId, onSelectionAction), [onSelectionAction])

  useEffect(() => {
    const root = container.current
    if (root === null || state.status !== 'ready' || edit.status !== 'reading') return
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
  }, [state.status, edit.status, view, sourceAtoms, translatedAtoms, componentRanges, peekable, openMenu, t])

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
    const left = rect?.left ?? window.innerWidth - ANNOTATION_POPOVER_WIDTH - 24
    openEditorAt(
      { mode: 'edit', annotation },
      rect === undefined
        ? { top: 72, left, height: 0 }
        : { top: rect.top, left: rect.left, height: rect.height },
      left,
    )
  }, [openEditorAt])

  const openBlockEditor = useCallback((block: Block): void => {
    if (composerBusy) {
      setNotice({ text: t('annotate.composerBusy'), undo: false })
      return
    }
    const element = container.current?.querySelector<HTMLElement>(`[data-component][data-block-id="${block.id}"]`)
    const rect = element?.getBoundingClientRect()
    const latest = draftKey === null ? annotationList : annotations.getSnapshot(draftKey).annotations
    const existing = blockAnnotationOf(latest, block.id)
    const left = rect === undefined ? window.innerWidth - ANNOTATION_POPOVER_WIDTH - 24 : rect.right - ANNOTATION_POPOVER_WIDTH
    const top = rect === undefined ? 72 : rect.top + 32
    openEditorAt(
      existing !== undefined
        ? { mode: 'edit', annotation: existing }
        : { mode: 'new-block', block },
      { top, left, height: 0 },
      left,
    )
  }, [annotationList, annotations, draftKey, composerBusy, t, openEditorAt])

  useLayoutEffect(() => {
    if (editor === null) return
    const panel = editorPanel.current
    if (panel === null) return
    const place = (): void => {
      const height = panel.getBoundingClientRect().height
      if (height > 0) editorHeight.current = height
      const origin = editor.origin
      const current = origin.scrollport?.scrollTop ?? window.scrollY
      const anchorTop = origin.top - (current - origin.scrollTop)
      const placement = placeEditor(origin.left, anchorTop, origin.height, editorHeight.current)
      setEditor(currentEditor => currentEditor === null ? null : { ...currentEditor, ...placement })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [editor?.origin])

  useEffect(() => {
    if (editor === null) return
    const origin = editor.origin
    const onScroll = (): void => {
      const current = origin.scrollport?.scrollTop ?? window.scrollY
      const top = origin.top - (current - origin.scrollTop)
      if (top < -origin.height - 32 || top > window.innerHeight + 32) {
        setEditor(null)
        return
      }
      const placement = placeEditor(origin.left, top, origin.height, editorHeight.current)
      setEditor(currentEditor => currentEditor === null ? null : { ...currentEditor, ...placement })
    }
    origin.scrollport?.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    const close = (): void => setEditor(null)
    window.addEventListener('resize', close)
    return () => {
      origin.scrollport?.removeEventListener('scroll', onScroll)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', close)
    }
  }, [editor?.origin])

  const componentContext = useMemo<ComponentContext>(() => ({
    labelOf: (block) => {
      const component = componentOf(block)
      return component === null ? '' : componentLabel(component, t)
    },
    annotationOf: block => (view === 'source' ? blockAnnotationOf(annotationList, block.id) : undefined),
    ...(view === 'source' ? { annotate: openBlockEditor } : {}),
  }), [view, annotationList, t, openBlockEditor])

  const unlocatableNow = useCallback((): ReadonlySet<string> => {
    const ids = new Set<string>()
    for (const [id, ok] of located) if (!ok) ids.add(id)
    return ids
  }, [located])

  const syncAttachment = useCallback(async (annotationsToSend: readonly Annotation[]): Promise<void> => {
    const target = draftKey
    if (target === null || state.status !== 'ready' || phase !== 'plain') return
    const pending = annotations.getSnapshot(target).pending
    if (pending === null) return
    // A manually removed attachment is not rebuilt behind the user's back.
    if (!inputAttachmentIds.includes(pending.draftAttachmentId)) return
    if (annotationsToSend.length === 0) {
      const detached = await attachment.detach({ key: target, roundId: pending.roundId, input: inputActions, phase })
      if (detached.status === 'detached') hub.remove(target, pending.roundId)
      else if (detached.status === 'failed') setAttachError(t('annotate.attachFailed', { message: detached.message }))
      return
    }
    const result = await attachment.regenerate({
      key: target,
      composeSessionId,
      path: state.absolutePath,
      displayPath: displayPath || state.absolutePath,
      text: state.text,
      annotations: annotationsToSend,
      unlocatable: unlocatableNow(),
      edited: editedSinceOpen,
      input: inputActions,
      phase,
      roundId: pending.roundId,
    })
    if (result.status === 'attached') hub.set({ key: target, pending: result.pending })
    else if (result.status === 'failed') setAttachError(t('annotate.attachFailed', { message: result.message }))
    else if (result.reason === 'source-changed') setAttachError(refusalText(result.reason, t))
  }, [
    draftKey, state, phase, annotations, inputAttachmentIds, attachment, inputActions, hub,
    composeSessionId, path, displayPath, unlocatableNow, editedSinceOpen, t,
  ])

  const attachFeedback = useCallback(async (): Promise<void> => {
    const target = draftKey
    if (target === null || state.status !== 'ready') return
    if (composerBusy) {
      setAttachError(t('annotate.composerBusy'))
      return
    }
    const latest = annotations.getSnapshot(target)
    if (latest.status !== 'ready') {
      setAttachError(t('annotate.loading'))
      return
    }
    const current = latest.pending
    if (current !== null && !inputAttachmentIds.includes(current.draftAttachmentId)) {
      const cleared = await attachment.detach({ key: target, roundId: current.roundId, input: inputActions, phase })
      if (cleared.status === 'failed') {
        setAttachError(t('annotate.attachFailed', { message: cleared.message }))
        return
      }
      hub.remove(target, current.roundId)
      attachment.forget(current.roundId)
    }
    setAttachBusy(true)
    setAttachError(null)
    const result = await attachment.attach({
      key: target,
      composeSessionId,
      path: state.absolutePath,
      displayPath: displayPath || state.absolutePath,
      text: state.text,
      annotations: latest.annotations,
      unlocatable: unlocatableNow(),
      edited: editedSinceOpen,
      input: inputActions,
      phase,
    })
    setAttachBusy(false)
    if (result.status === 'attached') {
      hub.set({ key: target, pending: result.pending })
      setNotice({ text: result.snapshotSaved ? t('annotate.attachHint') : t('annotate.snapshotMissing'), undo: false })
      return
    }
    setAttachError(result.status === 'failed'
      ? t('annotate.attachFailed', { message: result.message })
      : refusalText(result.reason, t))
  }, [
    draftKey, state, composerBusy, annotations, inputAttachmentIds, attachment, inputActions, phase,
    hub, composeSessionId, path, displayPath, unlocatableNow, editedSinceOpen, t,
  ])

  const removeAttachment = useCallback(async (): Promise<void> => {
    const target = draftKey
    if (target === null) return
    if (composerBusy) {
      setAttachError(t('annotate.composerBusy'))
      return
    }
    const current = annotations.getSnapshot(target).pending
    if (current === null) return
    setAttachBusy(true)
    setAttachError(null)
    const result = await attachment.detach({ key: target, roundId: current.roundId, input: inputActions, phase })
    setAttachBusy(false)
    if (result.status === 'detached') {
      hub.remove(target, current.roundId)
      attachment.forget(current.roundId)
      setNotice({ text: t('annotate.detached'), undo: false })
      return
    }
    if (result.status === 'failed') setAttachError(t('annotate.attachFailed', { message: result.message }))
  }, [draftKey, composerBusy, annotations, attachment, inputActions, phase, hub, t])

  const saveEditor = useCallback((body: string): void => {
    const target = draftKey
    const current = editor
    const text = body.trim()
    if (target === null || current === null || text === '') return
    if (composerBusy) {
      setEditor(null)
      setNotice({ text: t('annotate.composerBusy'), undo: false })
      return
    }
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
      else void syncAttachment(annotations.getSnapshot(target).annotations)
    })
  }, [draftKey, editor, annotations, componentContext, t, composerBusy, syncAttachment])

  const deleteAnnotation = useCallback((annotation: Annotation): void => {
    const target = draftKey
    if (target === null) return
    if (composerBusy) {
      setNotice({ text: t('annotate.composerBusy'), undo: false })
      return
    }
    if (undo !== null) clearTimeout(undo.timer)
    const latest = annotations.getSnapshot(target).annotations
    if (!latest.some(entry => entry.id === annotation.id)) return
    void annotations.write(target, removeAnnotation(latest, annotation.id)).then((result) => {
      if (result.status === 'too-large') setNotice({ text: t('annotate.tooLarge'), undo: true })
      else if (result.status === 'failed') setNotice({ text: result.message, undo: true })
      else void syncAttachment(annotations.getSnapshot(target).annotations)
    })
    const timer = setTimeout(() => setUndo(current => (current?.annotation.id === annotation.id ? null : current)), UNDO_WINDOW_MS)
    setUndo({ annotation, key: target, timer })
    setNotice({ text: t('annotate.deleted'), undo: true })
  }, [draftKey, annotations, undo, t, composerBusy, syncAttachment])

  const undoDelete = useCallback((): void => {
    if (undo === null) return
    if (composerBusy) {
      setNotice({ text: t('annotate.composerBusy'), undo: false })
      return
    }
    clearTimeout(undo.timer)
    const current = annotations.getSnapshot(undo.key).annotations
    void annotations.write(undo.key, restoreAnnotation(current, undo.annotation)).then((result) => {
      if (result.status === 'too-large') setNotice({ text: t('annotate.tooLarge'), undo: false })
      else if (result.status === 'failed') setNotice({ text: result.message, undo: false })
      else void syncAttachment(annotations.getSnapshot(undo.key).annotations)
    })
    setUndo(null)
    setNotice(null)
  }, [undo, annotations, t, composerBusy, syncAttachment])

  const clearAnnotations = useCallback(async (): Promise<void> => {
    if (draftKey === null) return
    if (composerBusy) {
      setNotice({ text: t('annotate.composerBusy'), undo: false })
      return
    }
    if (undo !== null) clearTimeout(undo.timer)
    setUndo(null)
    setNotice(null)
    const pending = annotations.getSnapshot(draftKey).pending
    if (pending !== null) {
      const detached = await attachment.detach({ key: draftKey, roundId: pending.roundId, input: inputActions, phase })
      if (detached.status === 'failed') {
        setNotice({ text: t('annotate.attachFailed', { message: detached.message }), undo: false })
        return
      }
      hub.remove(draftKey, pending.roundId)
      attachment.forget(pending.roundId)
    }
    void annotations.clear(draftKey).then((result) => {
      if (result.status === 'failed') setNotice({ text: result.message, undo: false })
    })
  }, [draftKey, annotations, undo, composerBusy, attachment, inputActions, phase, hub, t])

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

  // Pins sit beside the prose at the start line's measured top, independent of
  // the view mode.
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
    if (next === 'translated') {
      setDrawerOpen(false)
      setEditor(null)
      setPeek(null)
      setTocOpen(false)
      setErrorOpen(false)
    }
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

  /** Leaving translation keeps a finished result in memory, but a run in flight is cancelled. */
  const exitTranslation = useCallback(() => {
    if (translation.status === 'running') {
      stopRun()
      setTranslation({ status: 'idle' })
    }
    setView('source')
    setTocOpen(false)
    setErrorOpen(false)
    setPeek(null)
    setSave({ status: 'idle' })
  }, [translation.status, stopRun])

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

  const retryToolbarError = useCallback((): void => {
    setErrorOpen(false)
    if (toolbarError?.kind === 'save') saveTranslation()
    else if (toolbarError?.kind === 'translate') chooseView('translated')
  }, [toolbarError, saveTranslation, chooseView])

  /** The source line the reading view is showing at its top edge. */
  const visibleSourceLine = useCallback((): number => {
    const blocks = parsed.blocks
    if (blocks.length === 0) return 1
    const root = container.current
    if (root === null) return blocks[0]!.sourceStartLine
    const reference = (toolbar.current?.getBoundingClientRect().bottom ?? 0) + 8
    for (const block of blocks) {
      const element = lineElement(root, block.sourceStartLine, block.id)
      if (element !== null && element.getBoundingClientRect().bottom > reference) return block.sourceStartLine
    }
    return blocks[blocks.length - 1]!.sourceStartLine
  }, [parsed])

  const editMessageOf = useCallback((result: WriteTextResult): string => {
    const outcome = saveOutcomeOf(result)
    switch (outcome.kind) {
      case 'denied':
        return outcome.mode === 'read-only' ? t('edit.readOnly') : t('edit.denied', { mode: outcome.mode })
      case 'too-large': return t('edit.tooLarge')
      case 'exists': return t('edit.exists')
      case 'unsupported': return t('edit.unsupported')
      case 'saved':
      case 'stale': return ''
    }
  }, [t])

  /** A successful write of the original file becomes the new reading state. */
  const rememberSavedOriginal = useCallback((
    text: string,
    result: Extract<WriteTextResult, { status: 'saved' }>,
  ): void => {
    // A restore already in flight belongs to the old source text.
    stopRun()
    savedEcho.current = result.version
    setState({ status: 'ready', text, absolutePath: result.absolutePath, version: result.version, bytes: result.bytes })
    setEditability({ status: 'ok', absolutePath: result.absolutePath, version: result.version })
    setEditedSinceOpen(true)
    setExitConfirm(false)
    setEditError(null)
    if (translationRef.current.status !== 'idle') {
      setTranslation({ status: 'idle' })
      setNotice({ text: t('edit.translationStale'), undo: false })
    }
  }, [t, stopRun])

  const enterEdit = useCallback(async (): Promise<void> => {
    const ready = stateRef.current
    if (ready.status !== 'ready' || sessionId === undefined || path === undefined) return
    if (view === 'translated') {
      setView('source')
      return
    }
    const pendingCount = pendingReview?.annotations.length ?? 0
    const result = await editCommand.check(sessionId, path, ready.bytes)
    const check: EditCheckResult = result ?? { status: 'unsupported', reason: 'fs' }
    setEditability(check)
    const entry = canEnterEdit({ view, pending: pendingCount, gate: { check, bytes: ready.bytes } })
    if (!entry.ok) {
      switch (entry.reason) {
        case 'pending':
          setNotice({ text: t('edit.pending', { count: pendingCount }), undo: false })
          return
        case 'translated':
          setView('source')
          return
        case 'too-large':
          setNotice({ text: t('edit.tooLarge'), undo: false })
          return
        case 'read-only':
          setNotice({ text: t('edit.readOnly'), undo: false })
          return
        case 'unchecked':
        case 'unsupported':
          setNotice({ text: t('edit.unsupported'), undo: false })
          return
        case 'outside':
          return
      }
    }
    savedEcho.current = null
    setTocOpen(false)
    setPeek(null)
    setEditor(null)
    setDrawerOpen(false)
    setAsk(null)
    setErrorOpen(false)
    setNotice(null)
    setEditError(null)
    setExitConfirm(false)
    setAdopt({ text: ready.text, token: 0 })
    applyEdit({ type: 'enter', text: ready.text, version: ready.version, line: visibleSourceLine() })
    setEditSeq(sequence => sequence + 1)
  }, [sessionId, path, view, pendingReview, editCommand, t, visibleSourceLine, applyEdit])

  const requestSave = useCallback((): void => {
    const current = editRef.current
    const ready = stateRef.current
    if (current.status === 'reading' || current.status === 'saving') return
    if (ready.status !== 'ready' || sessionId === undefined || path === undefined) return
    const fromConflict = current.status === 'conflict'
    const text = current.session.draft
    restoreLine.current = current.session.cursorLine
    setEditError(null)
    setExitConfirm(false)
    const intent: WriteIntent = { kind: 'replace', version: current.session.version }
    void (async () => {
      const result = await editCommand.save(sessionId, path, text, intent)
      if (result === undefined) {
        applyEdit({ type: fromConflict ? 'conflict-back' : 'write-failed' })
        return
      }
      if (result.status === 'saved') {
        rememberSavedOriginal(text, result)
        return
      }
      if (result.status === 'stale') return
      applyEdit({ type: fromConflict ? 'conflict-back' : 'write-failed' })
      setEditErrorSaveAs(result.status !== 'denied')
      setEditError(editMessageOf(result))
    })()
  }, [sessionId, path, editCommand, applyEdit, rememberSavedOriginal, editMessageOf])

  const leaveEdit = useCallback((): void => {
    const current = editRef.current
    if (current.status === 'reading') return
    restoreLine.current = current.session.cursorLine
    setExitConfirm(false)
    setEditError(null)
    applyEdit({ type: 'exit' })
  }, [applyEdit])

  const requestExit = useCallback((): void => {
    const current = editRef.current
    if (current.status === 'reading' || current.status === 'saving') return
    // Esc over the conflict panel only closes it; the draft must survive.
    if (current.status === 'conflict') {
      setExitConfirm(false)
      applyEdit({ type: 'conflict-close' })
      return
    }
    if (draftDirty(current.session)) {
      setExitConfirm(true)
      return
    }
    leaveEdit()
  }, [applyEdit, leaveEdit])

  const reloadFromConflict = useCallback((): void => {
    restoreLine.current = undefined
    setExitConfirm(false)
    setEditError(null)
    applyEdit({ type: 'exit' })
    rendererRef.current?.reload()
  }, [applyEdit])

  const overwriteConflict = useCallback((): void => {
    const current = editRef.current
    if (current.status !== 'conflict' || sessionId === undefined || path === undefined) return
    const text = current.session.draft
    restoreLine.current = current.session.cursorLine
    setEditError(null)
    void (async () => {
      const result = await editCommand.save(sessionId, path, text, { kind: 'overwrite' })
      if (result === undefined) {
        applyEdit({ type: 'conflict-back' })
        return
      }
      if (result.status === 'saved') {
        rememberSavedOriginal(text, result)
        return
      }
      applyEdit({ type: 'conflict-back' })
      setEditErrorSaveAs(result.status !== 'denied')
      setEditError(editMessageOf(result))
    })()
  }, [sessionId, path, editCommand, applyEdit, rememberSavedOriginal, editMessageOf])

  const saveAsCopy = useCallback((): void => {
    const current = editRef.current
    const ready = stateRef.current
    if (current.status === 'reading' || current.status === 'saving') return
    if (ready.status !== 'ready' || sessionId === undefined) return
    const fromConflict = current.status === 'conflict'
    const text = current.session.draft
    restoreLine.current = current.session.cursorLine
    setEditError(null)
    void (async () => {
      const stamp = new Date()
      const taken = new Set<string>()
      const back = (): void => {
        applyEdit({ type: fromConflict ? 'conflict-back' : 'write-failed' })
      }
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const target = conflictFileName(ready.absolutePath, stamp, taken)
        const result = await editCommand.save(sessionId, target, text, { kind: 'create' })
        if (result === undefined) {
          back()
          return
        }
        if (result.status === 'saved') {
          setNotice({
            text: t('edit.savedAs', { path: result.absolutePath }),
            undo: false,
            copyPath: result.absolutePath,
          })
          setExitConfirm(false)
          setEditError(null)
          rendererRef.current?.reload()
          return
        }
        if (result.status === 'exists') {
          taken.add(target)
          taken.add(result.absolutePath)
          continue
        }
        back()
        setEditErrorSaveAs(result.status !== 'denied')
        setEditError(editMessageOf(result))
        return
      }
      back()
      setEditErrorSaveAs(true)
      setEditError(t('edit.saveFailed', { message: t('edit.exists') }))
    })()
  }, [sessionId, editCommand, applyEdit, editMessageOf, t])

  const onEditorUpdate = useCallback((text: string, cursorLine: number): void => {
    const current = editRef.current
    if (current.status !== 'editing') return
    if (current.session.draft === text && current.session.cursorLine === cursorLine) return
    applyEdit({ type: 'change', text, cursorLine })
  }, [applyEdit])

  const onEditorSave = useCallback((text: string, cursorLine: number): void => {
    const current = editRef.current
    if (current.status !== 'editing' && current.status !== 'conflict') return
    if (current.session.draft !== text || current.session.cursorLine !== cursorLine) {
      applyEdit({ type: 'change', text, cursorLine })
    }
    requestSave()
  }, [applyEdit, requestSave])

  // The editor fills the pane between the toolbar and the bottom edge; the
  // reading position comes back from the line the cursor was last on.
  useLayoutEffect(() => {
    if (edit.status !== 'reading') return
    const line = restoreLine.current
    if (line === undefined) return
    restoreLine.current = undefined
    const target = lineTarget(parsed.blocks, line)
    if (target === undefined) return
    const root = container.current
    const element = lineElement(root, target.sourceStartLine, target.id)
    if (element === null) return
    const port = scrollportOf(root)
    if (port === null) {
      element.scrollIntoView({ block: 'start' })
      return
    }
    port.scrollTop += element.getBoundingClientRect().top - port.getBoundingClientRect().top - 52
  }, [edit.status, parsed])

  useLayoutEffect(() => {
    if (editSeq === 0) return
    const host = editHost.current
    const root = container.current
    if (host === null || root === null) return
    const port = scrollportOf(root)
    if (port === null) return
    port.scrollTop += host.getBoundingClientRect().top - port.getBoundingClientRect().top - 44
  }, [editSeq])

  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(
      () => setNotice(null),
      notice.copyPath === undefined ? (notice.undo ? UNDO_WINDOW_MS : 4000) : 8000,
    )
    return () => clearTimeout(timer)
  }, [notice])

  const editPhase = edit.status !== 'reading'
  const editSessionValue = sessionOf(edit)
  const editDirty = editSessionValue !== undefined && draftDirty(editSessionValue)
  const editBusy = edit.status === 'saving'
  const editLineCount = editSessionValue === undefined ? 0 : editSessionValue.draft.split('\n').length
  const editBytes = state.status === 'ready' ? state.bytes : 0
  const showEditAction = state.status === 'ready'
    && view === 'source'
    && editability?.status === 'ok'
    && editBytes <= MAX_EDIT_BYTES
  const editFileName = state.status === 'ready'
    ? (state.absolutePath.replace(/\\/g, '/').split('/').pop() ?? '')
    : (path ?? '')
  const editExternal = editSessionValue?.external === true

  return (
    <div className="am-root" ref={container} data-active-markdown data-editing={editPhase ? 'true' : undefined}>
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
          <div className="am-toolbar" ref={toolbar}>
            {editPhase ? (
              <EditToolbar
                dirty={editDirty}
                saving={editBusy}
                lineCount={editLineCount}
                labels={{
                  save: t('edit.save'),
                  saving: t('edit.saving'),
                  exit: t('edit.exit'),
                  lines: t('edit.lines'),
                  dirty: t('edit.dirty'),
                }}
                onSave={requestSave}
                onExit={requestExit}
              />
            ) : view === 'source' ? (
              <>
                <button
                  ref={tocButton}
                  type="button"
                  className="am-toolbar-button"
                  aria-label={t('toc.label')}
                  aria-expanded={tocOpen}
                  title={t('toc.label')}
                  disabled={toc.length === 0}
                  onClick={() => setTocOpen(value => !value)}
                >
                  <TocIcon />
                  <span className="am-toolbar-label">{t('toc.label')}</span>
                  {updatedAnchors.size === 0 ? null : <span className="am-toolbar-dot" aria-hidden="true" />}
                </button>
                <span className="am-toolbar-spacer" />
                {showEditAction ? (
                  <button
                    type="button"
                    className="am-toolbar-button"
                    aria-label={t('edit.action')}
                    title={t('edit.action')}
                    onClick={() => { void enterEdit() }}
                  >
                    <EditIcon />
                    <span className="am-toolbar-label">{t('edit.action')}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="am-toolbar-button am-toolbar-button--quiet"
                  aria-label={t('translate.entry')}
                  title={t('translate.entry')}
                  onClick={() => chooseView('translated')}
                >
                  <GlobeIcon />
                  <span className="am-toolbar-label">{t('translate.entry')}</span>
                </button>
                {diff.counts.updated > 0 ? (
                  <>
                    <span className="am-toolbar-rule" />
                    <button type="button" className="am-update-chip" title={t('diff.next')} onClick={stepUpdate}>
                      <span className="am-update-dot" aria-hidden="true" />
                      {updateCursor === 0 || diff.counts.updated === 1
                        ? <>{t('diff.chipCount', { count: diff.counts.updated })}<span className="am-update-unit">{t('diff.unit')}</span></>
                        : t('diff.index', { current: updateCursor, total: diff.counts.updated })}
                    </button>
                  </>
                ) : null}
                <span className="am-toolbar-rule" />
                <button
                  type="button"
                  className="am-toolbar-button"
                  aria-label={`${t('annotate.drawer.title')} ${annotationList.length}`}
                  title={t('annotate.drawer.title')}
                  aria-expanded={drawerOpen}
                  onClick={() => setDrawerOpen(value => !value)}
                >
                  <CommentIcon />
                  <span className="am-annotate-label">{t('annotate.drawer.title')}</span>
                  <span className="am-count">{annotationList.length}</span>
                </button>
                <button
                  type="button"
                  className={attached ? 'am-primary am-primary--muted' : 'am-primary'}
                  disabled={annotationList.length === 0 || composerBusy || attachBusy || attached}
                  title={attached ? t('annotate.attached') : t('annotate.attach')}
                  onClick={() => { void attachFeedback() }}
                >
                  {attached ? t('annotate.attached') : t('annotate.attach')}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="am-toolbar-button am-toolbar-button--quiet" onClick={exitTranslation}>
                  <BackIcon />
                  {t('view.source')}
                </button>
                <button
                  ref={tocButton}
                  type="button"
                  className="am-toolbar-button"
                  aria-label={t('toc.label')}
                  aria-expanded={tocOpen}
                  title={t('toc.label')}
                  disabled={toc.length === 0}
                  onClick={() => setTocOpen(value => !value)}
                >
                  <TocIcon />
                  <span className="am-toolbar-label">{t('toc.label')}</span>
                </button>
                <span className="am-toolbar-spacer" />
                <span className="am-lang"><GlobeIcon />{langLabel}</span>
                {translation.status === 'running' ? (
                  <>
                    <span className="am-spinner" aria-hidden="true" />
                    <span className="am-progress">
                      {translation.chunks > 1
                        ? t('translate.progress', { current: translation.chunk, total: translation.chunks })
                        : t('translate.running')}
                    </span>
                    <button type="button" className="am-toolbar-button am-toolbar-button--quiet" onClick={cancelTranslation}>
                      {t('translate.cancel')}
                    </button>
                  </>
                ) : toolbarError !== null ? (
                  <button
                    ref={errorChip}
                    type="button"
                    className="am-error-chip"
                    aria-expanded={errorOpen}
                    aria-haspopup="dialog"
                    onClick={() => setErrorOpen(value => !value)}
                  >
                    <AlertIcon />
                    {toolbarError.kind === 'save'
                      ? t('translate.saveFailedShort')
                      : toolbarError.kind === 'translate' ? t('translate.failedShort') : t('translate.tooLargeShort')}
                  </button>
                ) : staleTranslation ? (
                  <span className="am-stale" title={t('translate.stale')}>{t('translate.staleShort')}</span>
                ) : null}
                {translation.status === 'running' ? null : (
                  <button type="button" className="am-toolbar-button am-toolbar-button--quiet" onClick={(event) => openAsk(event.currentTarget)}>
                    {t('translate.retranslate')}
                  </button>
                )}
                {translation.status === 'running'
                  ? <button type="button" className="am-primary" disabled>{t('translate.save')}</button>
                  : toolbarError?.kind === 'save' || toolbarError?.kind === 'translate'
                    ? <button type="button" className="am-primary" onClick={retryToolbarError}>{t('translate.retry')}</button>
                    : translation.status === 'ready'
                      ? saveable(translation) !== undefined
                        ? <button type="button" className="am-primary" disabled={save.status === 'busy'} onClick={saveTranslation}>{save.status === 'busy' ? t('translate.saving') : t('translate.save')}</button>
                        : <button type="button" className="am-primary am-primary--muted" disabled>{t('translate.savedShort')}</button>
                      : <button type="button" className="am-primary" disabled>{t('translate.save')}</button>}
              </>
            )}
          </div>
          {!editPhase && tocOpen && tocPlacement !== null && toc.length > 0 ? (
            <div
              ref={tocPanel}
              className="am-toc-popover"
              style={{ left: tocPlacement.left, top: tocPlacement.top, width: tocPlacement.width, maxHeight: tocPlacement.maxHeight }}
              onPointerEnter={() => { pointerOver.current = true }}
              onPointerLeave={() => { pointerOver.current = false }}
            >
              <MarkdownToc
                rows={rows}
                collapsed={collapsed}
                updated={view === 'source' ? updatedAnchors : EMPTY_ANCHORS}
                label={t('toc.label')}
                updatedLabel={t('toc.updated')}
                expandLabel={t('toc.expand')}
                collapseLabel={t('toc.collapse')}
                onJump={jumpToSection}
                onToggle={toggleFold}
              />
            </div>
          ) : null}
          {!editPhase && errorOpen && toolbarError !== null && errorPlacement !== null ? (
            <div
              className="am-error-popover"
              style={{ left: errorPlacement.left, top: errorPlacement.top }}
              role="dialog"
              aria-label={toolbarError.kind === 'save'
                ? t('translate.saveFailedShort')
                : toolbarError.kind === 'translate' ? t('translate.failedShort') : t('translate.tooLargeShort')}
            >
              <div className="am-error-title">
                {toolbarError.kind === 'save'
                  ? t('translate.saveFailedShort')
                  : toolbarError.kind === 'translate' ? t('translate.failedShort') : t('translate.tooLargeShort')}
              </div>
              <div className="am-error-message">{toolbarError.message}</div>
              <div className="am-error-actions">
                <button
                  type="button"
                  className="am-toolbar-button am-toolbar-button--quiet"
                  onClick={() => {
                    const clipboard = navigator.clipboard
                    if (clipboard === undefined) return
                    void clipboard.writeText(toolbarError.message)
                      .then(() => setNotice({ text: t('code.copied'), undo: false }))
                      .catch(() => {})
                  }}
                >
                  {t('code.copy')}
                </button>
                {toolbarError.kind === 'too-large' ? null : (
                  <button type="button" className="am-toolbar-button" onClick={retryToolbarError}>{t('translate.retry')}</button>
                )}
                <button type="button" className="am-toolbar-button am-toolbar-button--quiet" onClick={() => setErrorOpen(false)}>
                  {t('diff.dismiss')}
                </button>
              </div>
            </div>
          ) : null}
          {editPhase ? (
            <>
              {exitConfirm ? (
                <EditBanner
                  text={t('edit.exitConfirm')}
                  primary={{ label: t('edit.discard'), run: leaveEdit, danger: true }}
                  secondary={{ label: t('edit.conflict.close'), run: () => setExitConfirm(false) }}
                />
              ) : null}
              {editError === null ? null : (
                <EditBanner
                  text={editError}
                  primary={editErrorSaveAs ? { label: t('edit.conflict.saveAs'), run: saveAsCopy } : undefined}
                  secondary={{ label: t('diff.dismiss'), run: () => setEditError(null) }}
                />
              )}
              {editExternal && !exitConfirm ? (
                <EditBanner
                  text={t('edit.external')}
                  secondary={{
                    label: t('edit.conflict.close'),
                    run: () => applyEdit({ type: 'external-dismiss' }),
                  }}
                />
              ) : null}
              <div className="am-edit-shell" ref={editHost}>
                <SourceEditor
                  key={editSeq}
                  initialText={editSessionValue?.draft ?? ''}
                  entryLine={editSessionValue?.entryLine ?? 1}
                  adopt={adopt}
                  readOnly={editBusy || edit.status === 'conflict'}
                  label={`${t('edit.action')} ${editFileName}`}
                  onUpdate={onEditorUpdate}
                  onSave={onEditorSave}
                  onExit={requestExit}
                />
              </div>
              <ConflictPanel
                open={edit.status === 'conflict'}
                busy={editBusy}
                labels={{
                  title: t('edit.conflict.title'),
                  body: t('edit.conflict.body'),
                  reload: t('edit.conflict.reload'),
                  overwrite: t('edit.conflict.overwrite'),
                  overwriteWarning: t('edit.conflict.overwriteConfirm'),
                  saveAs: t('edit.conflict.saveAs'),
                  close: t('edit.conflict.close'),
                  cancel: t('annotate.cancel'),
                }}
                onReload={reloadFromConflict}
                onOverwrite={overwriteConflict}
                onSaveAs={saveAsCopy}
                onClose={() => applyEdit({ type: 'conflict-close' })}
              />
            </>
          ) : (
            <RenderBoundary
              labels={{ title: t('error.render.title'), body: t('error.render.body'), reload: t('reload') }}
              onReload={reload}
            >
              <DocumentView
                parsed={displayed}
                labels={labels}
                actions={actions}
                components={componentContext}
                t={t}
                diff={view === 'source' && diffActive ? diff : undefined}
              />
            </RenderBoundary>
          )}
        </>
      )}
      {view === 'source' && !editPhase ? (
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
        open={drawerOpen && !editPhase}
        annotations={annotationList}
        readOnly={view === 'translated'}
        located={located}
        persistence={snapshot.persistence}
        attached={attached}
        busy={composerBusy || attachBusy}
        attachError={attachError}
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
          attach: t('annotate.attach'),
          attached: t('annotate.attached'),
          removeAttachment: t('annotate.removeAttachment'),
          line: line => t('annotate.line', { line }),
          range: (start, end) => t('annotate.range', { start, end }),
        }}
        onClose={() => setDrawerOpen(false)}
        onLocate={locateAnnotation}
        onEdit={openEditor}
        onDelete={deleteAnnotation}
        onClear={() => { void clearAnnotations() }}
        onAttach={() => { void attachFeedback() }}
        onRemoveAttachment={() => { void removeAttachment() }}
      />
      {editor === null || editPhase ? null : (
        <AnnotationPopover
          left={editor.left}
          top={editor.top}
          above={editor.above}
          panelRef={editorPanel}
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
            {notice.copyPath === undefined
              ? null
              : (
                <button
                  type="button"
                  className="am-toast-action"
                  onClick={() => {
                    const copy = notice.copyPath
                    const clipboard = navigator.clipboard
                    if (copy === undefined || clipboard === undefined) return
                    void clipboard.writeText(copy)
                      .then(() => setNotice({ text: t('code.copied'), undo: false }))
                      .catch(() => {})
                  }}
                >
                  {t('edit.copyPath')}
                </button>
              )}
            {notice.undo && undo !== null && !editPhase
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
  t: Translate
  diff?: DocumentDiff
}

/** Parse once in the body so annotations and the rendered tree share one block model. */
function DocumentView({ parsed, labels, actions, components, t, diff }: DocumentViewProps): ReactNode {
  return (
    <>
      {parsed.frontmatter === undefined ? null : (
        <section className="am-frontmatter" data-active-markdown-frontmatter>
          <div className="am-frontmatter-label">{t('frontmatter')}</div>
          <pre className="am-frontmatter-source">{parsed.frontmatter.source}</pre>
        </section>
      )}
      <MarkdownView blocks={parsed.blocks} labels={labels} actions={actions} components={components} diff={diff} />
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
