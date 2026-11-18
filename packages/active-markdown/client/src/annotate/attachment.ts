/**
 * The attach transaction for one document's feedback file: prepare the pending
 * snapshot, register a runtime draft, add it to the composer, then record the
 * pending review. The whole transaction holds the draft key's lock so a body
 * edit cannot rewrite the draft between the file hash and the pending save.
 *
 * Nothing here falls back to inserting text: without the draft channel the
 * attach refuses and says so.
 */
import type {
  ConversationPort,
  HostBridge,
  InputActionsView,
  InputPhase,
} from '../context.ts'
import { feedbackFileOf, newRoundId, sha256Bytes, sha256Hex, normalizeSourceText } from './feedback.ts'
import type { Annotation, PendingReview } from './model.ts'
import type { AnnotationStore, DraftKey, PendingRefusal } from './store.ts'

export interface AttachmentDeps {
  store: AnnotationStore
  host(): Promise<HostBridge>
  /** The concrete conversation service for a session; null when unavailable. */
  conversation(sessionId: string): ConversationPort | null
  now?: () => Date
  random?: () => number
  /** Browser `File` factory; tests inject a lightweight stand-in. */
  makeFile?: (name: string, content: string) => File
}

export interface AttachmentRequest {
  key: DraftKey
  /** The composer's session; the address session may differ. */
  composeSessionId: string | undefined
  /** Canonical absolute document path. */
  path: string
  /** Workspace-relative display path used inside the feedback file. */
  displayPath: string
  text: string
  annotations: readonly Annotation[]
  /** Annotation ids that no longer resolve in the current source. */
  unlocatable: ReadonlySet<string>
  editedSinceOpen?: boolean
  input: InputActionsView | undefined
  phase: InputPhase
}

export type AttachmentFailure =
  | 'compose-session'
  | 'empty'
  | 'duplicate'
  | 'composer-busy'
  | 'unavailable'
  | 'draft-failed'
  | 'save-failed'
  | 'no-pending'
  | 'round-mismatch'
  | 'source-changed'

export type AttachResult =
  | { status: 'attached', pending: PendingReview, snapshotSaved: boolean }
  | { status: 'refused', reason: AttachmentFailure }
  | { status: 'failed', reason: AttachmentFailure, message: string }

export type DetachResult =
  | { status: 'detached' }
  | { status: 'refused', reason: AttachmentFailure }
  | { status: 'failed', reason: AttachmentFailure, message: string }

export interface RegenerateRequest extends AttachmentRequest {
  roundId: string
}

export interface DetachRequest {
  key: DraftKey
  roundId: string
  input: InputActionsView | undefined
  phase: InputPhase
}

export interface AttachmentController {
  attach(request: AttachmentRequest): Promise<AttachResult>
  regenerate(request: RegenerateRequest): Promise<AttachResult>
  detach(request: DetachRequest): Promise<DetachResult>
  /** Whether the runtime draft still resolves to exactly this feedback file. */
  verify(pending: PendingReview, sessionId: string): Promise<boolean>
  /** Forget a round's remembered descriptor after commit or detach. */
  forget(roundId: string): void
  /** Release one runtime draft the composer already dropped. */
  release(sessionId: string, id: string): void
}

interface RememberedDraft {
  id: string
  name: string
  bytes: number
  read(): Promise<Uint8Array<ArrayBuffer>>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function defaultMakeFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/markdown' })
}

function draftIdOf(draft: unknown): string | undefined {
  if (draft === null || typeof draft !== 'object') return undefined
  const id = (draft as { id?: unknown }).id
  return typeof id === 'string' && id !== '' ? id : undefined
}

function draftIdsOf(drafts: readonly unknown[]): string[] {
  const ids: string[] = []
  for (const draft of drafts) {
    const id = draftIdOf(draft)
    if (id !== undefined) ids.push(id)
  }
  return ids
}

function readDraft(draft: unknown): RememberedDraft | undefined {
  if (draft === null || typeof draft !== 'object') return undefined
  const value = draft as { kind?: unknown, id?: unknown, file?: unknown }
  if (value.kind !== 'file' || typeof value.id !== 'string') return undefined
  const file = value.file as { name?: unknown, size?: unknown, arrayBuffer?: unknown } | undefined
  if (file === undefined || typeof file.name !== 'string' || typeof file.size !== 'number'
    || typeof file.arrayBuffer !== 'function') return undefined
  return {
    id: value.id,
    name: file.name,
    bytes: file.size,
    read: async () => new Uint8Array(await (file.arrayBuffer as () => Promise<ArrayBuffer>)()),
  }
}

function usable(conversation: ConversationPort | null, input: InputActionsView | undefined): conversation is ConversationPort {
  return conversation !== null
    && typeof conversation.createDrafts === 'function'
    && typeof conversation.releaseDraftAttachments === 'function'
    && input !== undefined
    && typeof input.addAttachments === 'function'
}

function mayRemove(input: InputActionsView | undefined): input is InputActionsView & { removeAttachment(id: string): unknown } {
  return input !== undefined && typeof input.removeAttachment === 'function'
}

function isPlain(phase: InputPhase): boolean {
  return phase === 'plain'
}

function attachmentFailureOf(refusal: PendingRefusal): AttachmentFailure {
  if (refusal === 'already-pending') return 'duplicate'
  if (refusal === 'not-ready') return 'unavailable'
  return refusal
}

export function createAttachmentController(deps: AttachmentDeps): AttachmentController {
  const now = deps.now ?? (() => new Date())
  const random = deps.random ?? Math.random
  const makeFile = deps.makeFile ?? defaultMakeFile
  const remembered = new Map<string, RememberedDraft>()

  const remember = (roundId: string, drafts: readonly unknown[]): void => {
    for (const draft of drafts) {
      const entry = readDraft(draft)
      if (entry !== undefined) remembered.set(roundId, entry)
    }
  }

  const releaseOne = (conversation: ConversationPort, id: string): void => {
    if (typeof conversation.releaseDraftAttachment === 'function') {
      conversation.releaseDraftAttachment(id)
      return
    }
    if (typeof conversation.resolveDraftAttachments !== 'function') return
    const drafts = conversation.resolveDraftAttachments([id])
    if (drafts.length > 0) conversation.releaseDraftAttachments(drafts)
  }

  const removeFromComposer = (input: InputActionsView | undefined, id: string): void => {
    if (!mayRemove(input)) return
    try {
      input.removeAttachment(id)
    } catch {
      // The attachment may already be gone; the pending record is the truth.
    }
  }

  const prepare = async (
    key: DraftKey,
    path: string,
    roundId: string,
    text: string,
  ): Promise<{ sourceHash: string, snapshotSaved: boolean }> => {
    try {
      const host = await deps.host()
      const view = await host.reviewPrepare({ sessionId: key.sessionId, path, roundId, text })
      return { sourceHash: view.sourceHash, snapshotSaved: view.snapshotWritten }
    } catch {
      return { sourceHash: await sha256Hex(normalizeSourceText(text)), snapshotSaved: false }
    }
  }

  const discardPrepared = async (key: DraftKey, path: string, roundId: string): Promise<void> => {
    try {
      const host = await deps.host()
      await host.reviewDetach({ sessionId: key.sessionId, path, roundId })
    } catch {
      // The pending snapshot ages out; annotations were never touched.
    }
  }

  const attach = (request: AttachmentRequest): Promise<AttachResult> => deps.store.withLock(request.key, async () => {
    const { key, composeSessionId, input, phase } = request
    if (composeSessionId === undefined || composeSessionId !== key.sessionId) {
      return { status: 'refused', reason: 'compose-session' }
    }
    if (request.annotations.length === 0) return { status: 'refused', reason: 'empty' }
    if (!isPlain(phase)) return { status: 'refused', reason: 'composer-busy' }
    const snapshot = deps.store.getSnapshot(key)
    if (snapshot.status !== 'ready') return { status: 'refused', reason: 'unavailable' }
    if (snapshot.pending !== null) return { status: 'refused', reason: 'duplicate' }
    const conversation = deps.conversation(composeSessionId)
    if (input === undefined || !usable(conversation, input)) return { status: 'refused', reason: 'unavailable' }

    const roundId = newRoundId(random)
    const file = feedbackFileOf({
      roundId,
      sourcePath: request.displayPath,
      annotations: request.annotations,
      unlocatable: request.unlocatable,
      ...(request.editedSinceOpen === true ? { editedSinceOpen: true } : {}),
    })
    const fileHash = await sha256Hex(file.content)
    const prepared = await prepare(key, request.path, roundId, request.text)

    let drafts: readonly unknown[] = []
    try {
      drafts = conversation.createDrafts(composeSessionId, [makeFile(file.fileName, file.content)], true)
    } catch (error) {
      if (prepared.snapshotSaved) await discardPrepared(key, request.path, roundId)
      return { status: 'failed', reason: 'draft-failed', message: messageOf(error) }
    }
    const ids = draftIdsOf(drafts)
    if (ids.length === 0) {
      try {
        conversation.releaseDraftAttachments(drafts)
      } catch {
        // Nothing registered to release.
      }
      if (prepared.snapshotSaved) await discardPrepared(key, request.path, roundId)
      return { status: 'failed', reason: 'draft-failed', message: 'conversation created no draft' }
    }
    let accepted: boolean
    try {
      accepted = input.addAttachments(ids) === true
    } catch (error) {
      try {
        conversation.releaseDraftAttachments(drafts)
      } catch {
        // Keep the original failure.
      }
      if (prepared.snapshotSaved) await discardPrepared(key, request.path, roundId)
      return { status: 'failed', reason: 'draft-failed', message: messageOf(error) }
    }
    if (!accepted) {
      try {
        conversation.releaseDraftAttachments(drafts)
      } catch {
        // The refusal already says what happened.
      }
      if (prepared.snapshotSaved) await discardPrepared(key, request.path, roundId)
      return { status: 'refused', reason: 'composer-busy' }
    }

    const pending: PendingReview = {
      roundId,
      draftAttachmentId: ids[0]!,
      fileName: file.fileName,
      fileBytes: file.bytes,
      fileHash,
      sourceHash: prepared.sourceHash,
      annotations: [...request.annotations],
      feedback: file.content,
      createdAt: now().toISOString(),
    }
    const written = await deps.store.attach(key, pending)
    if (written.status !== 'saved') {
      removeFromComposer(input, ids[0]!)
      try {
        conversation.releaseDraftAttachments(drafts)
      } catch {
        // The pending save failure is the one to report.
      }
      try {
        const host = await deps.host()
        await host.reviewDetach({ sessionId: key.sessionId, path: request.path, roundId })
      } catch {
        // The pending snapshot will age out; annotations were never touched.
      }
      if (written.status === 'failed') return { status: 'failed', reason: 'save-failed', message: written.message }
      if (written.status === 'too-large') {
        return { status: 'failed', reason: 'save-failed', message: `draft exceeds ${written.limit} bytes` }
      }
      return { status: 'refused', reason: attachmentFailureOf(written.reason) }
    }
    remember(roundId, drafts)
    return { status: 'attached', pending, snapshotSaved: prepared.snapshotSaved }
  })

  const regenerate = (request: RegenerateRequest): Promise<AttachResult> => deps.store.withLock(request.key, async () => {
    const { key, composeSessionId, input, phase, roundId } = request
    if (composeSessionId === undefined || composeSessionId !== key.sessionId) {
      return { status: 'refused', reason: 'compose-session' }
    }
    if (!isPlain(phase)) return { status: 'refused', reason: 'composer-busy' }
    const snapshot = deps.store.getSnapshot(key)
    const current = snapshot.pending
    if (current === null) return { status: 'refused', reason: 'no-pending' }
    if (current.roundId !== roundId) return { status: 'refused', reason: 'round-mismatch' }
    if (request.annotations.length === 0) return { status: 'refused', reason: 'empty' }
    const conversation = deps.conversation(composeSessionId)
    if (input === undefined || !usable(conversation, input) || !mayRemove(input)) {
      return { status: 'refused', reason: 'unavailable' }
    }
    const sourceHash = await sha256Hex(normalizeSourceText(request.text))
    if (sourceHash !== current.sourceHash) return { status: 'refused', reason: 'source-changed' }

    const file = feedbackFileOf({
      roundId,
      sourcePath: request.displayPath,
      annotations: request.annotations,
      unlocatable: request.unlocatable,
      ...(request.editedSinceOpen === true ? { editedSinceOpen: true } : {}),
    })
    const fileHash = await sha256Hex(file.content)
    const prepared = await prepare(key, request.path, roundId, request.text)

    let drafts: readonly unknown[] = []
    try {
      drafts = conversation.createDrafts(composeSessionId, [makeFile(file.fileName, file.content)], true)
    } catch (error) {
      return { status: 'failed', reason: 'draft-failed', message: messageOf(error) }
    }
    const ids = draftIdsOf(drafts)
    if (ids.length === 0) {
      try {
        conversation.releaseDraftAttachments(drafts)
      } catch {
        // Nothing registered to release.
      }
      return { status: 'failed', reason: 'draft-failed', message: 'conversation created no draft' }
    }
    let accepted: boolean
    try {
      accepted = input.addAttachments(ids) === true
    } catch (error) {
      try {
        conversation.releaseDraftAttachments(drafts)
      } catch {
        // Keep the original failure.
      }
      return { status: 'failed', reason: 'draft-failed', message: messageOf(error) }
    }
    if (!accepted) {
      try {
        conversation.releaseDraftAttachments(drafts)
      } catch {
        // The old attachment is still the one in the composer.
      }
      return { status: 'refused', reason: 'composer-busy' }
    }

    // Add the replacement before removing the old id, so a failing save leaves
    // the previous attachment valid instead of an empty draft.
    const pending: PendingReview = {
      roundId,
      draftAttachmentId: ids[0]!,
      fileName: file.fileName,
      fileBytes: file.bytes,
      fileHash,
      sourceHash: prepared.sourceHash,
      annotations: [...request.annotations],
      feedback: file.content,
      createdAt: now().toISOString(),
    }
    const written = await deps.store.regenerate(key, roundId, pending)
    if (written.status !== 'saved') {
      removeFromComposer(input, ids[0]!)
      try {
        conversation.releaseDraftAttachments(drafts)
      } catch {
        // The old attachment and pending record are untouched.
      }
      if (written.status === 'failed') return { status: 'failed', reason: 'save-failed', message: written.message }
      if (written.status === 'too-large') {
        return { status: 'failed', reason: 'save-failed', message: `draft exceeds ${written.limit} bytes` }
      }
      return { status: 'refused', reason: attachmentFailureOf(written.reason) }
    }
    removeFromComposer(input, current.draftAttachmentId)
    releaseOne(conversation, current.draftAttachmentId)
    remembered.delete(roundId)
    remember(roundId, drafts)
    return { status: 'attached', pending, snapshotSaved: prepared.snapshotSaved }
  })

  const detach = (request: DetachRequest): Promise<DetachResult> => deps.store.withLock(request.key, async () => {
    if (!isPlain(request.phase)) return { status: 'refused', reason: 'composer-busy' }
    if (!mayRemove(request.input)) return { status: 'refused', reason: 'unavailable' }
    const current = deps.store.getSnapshot(request.key).pending
    if (current === null) return { status: 'refused', reason: 'no-pending' }
    if (current.roundId !== request.roundId) return { status: 'refused', reason: 'round-mismatch' }
    removeFromComposer(request.input, current.draftAttachmentId)
    const conversation = deps.conversation(request.key.sessionId)
    if (conversation !== null) releaseOne(conversation, current.draftAttachmentId)
    const written = await deps.store.detach(request.key, request.roundId)
    if (written.status === 'failed') return { status: 'failed', reason: 'save-failed', message: written.message }
    if (written.status === 'refused') return { status: 'refused', reason: written.reason as AttachmentFailure }
    remembered.delete(request.roundId)
    return { status: 'detached' }
  })

  const verify = async (pending: PendingReview, sessionId: string): Promise<boolean> => {
    const known = remembered.get(pending.roundId)
    if (known !== undefined && known.id === pending.draftAttachmentId) return hashMatches(known, pending)
    const conversation = deps.conversation(sessionId)
    if (conversation === null || typeof conversation.resolveDraftAttachments !== 'function') return false
    let drafts: readonly unknown[]
    try {
      drafts = conversation.resolveDraftAttachments([pending.draftAttachmentId])
    } catch {
      return false
    }
    const entry = readDraft(drafts[0])
    if (entry === undefined) return false
    return hashMatches(entry, pending)
  }

  return {
    attach,
    regenerate,
    detach,
    verify,
    forget(roundId) {
      remembered.delete(roundId)
    },
    release(sessionId, id) {
      const conversation = deps.conversation(sessionId)
      if (conversation !== null) releaseOne(conversation, id)
    },
  }
}

async function hashMatches(entry: RememberedDraft, pending: PendingReview): Promise<boolean> {
  if (entry.name !== pending.fileName || entry.bytes !== pending.fileBytes) return false
  try {
    return await sha256Bytes(await entry.read()) === pending.fileHash
  } catch {
    return false
  }
}
