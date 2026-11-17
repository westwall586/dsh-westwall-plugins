/**
 * The session-scoped committer that owns "sent, so clear". It renders nothing
 * and sits in `conversation.input.left`, so it exists wherever a composer
 * exists and outlives every document tab.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ConversationPort, HostBridge, UseChat, UseInput } from '../context.ts'
import type { AttachmentController } from './attachment.ts'
import {
  initialCommitterState,
  observeCommitter,
  runCommitterEffects,
  settleCommitterState,
  transcriptFilesOf,
  type CommitterState,
  type PendingEntry,
  type PendingHub,
  type TranscriptFile,
} from './committer.ts'
import type { AnnotationStore } from './store.ts'

const RETRY_MS = 2000

export interface CommitterInjected {
  annotations: AnnotationStore
  hub: PendingHub
  attachments: AttachmentController
  conversation(sessionId: string): ConversationPort | null
  host(): Promise<HostBridge>
}

export interface CommitterProps extends CommitterInjected {
  sessionId: string
  useInput: UseInput
  /** Absent only when the Chat package is not assembled; the fallback then never matches. */
  useChat?: UseChat
  inputActions: unknown
}

export function AnnotationCommitter({
  sessionId,
  useInput,
  useChat,
  annotations,
  hub,
  attachments,
  host,
}: CommitterProps): ReactNode {
  const phase = useInput(state => state.phase)
  const attachmentIds = useInput(state => state.attachmentIds)
  const draftText = useInput(state => state.draft)
  const transcript = useTranscript(useChat)
  const entries = usePendingEntries(hub, sessionId)
  const verified = useVerified(entries, attachmentIds, attachments, sessionId)
  const state = useRef<CommitterState>(initialCommitterState())
  const mounted = useRef(true)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Seed from the Host so a page reload still commits a file already sent.
  useEffect(() => {
    let live = true
    void host().then(async (bridge) => {
      const drafts = await bridge.annotationPending(sessionId)
      if (!live) return
      for (const draft of drafts) {
        const pending = draft.pending
        if (pending === undefined || pending.annotations.length === 0) continue
        hub.set({ key: { sessionId, path: draft.path }, pending })
      }
    }).catch(() => {})
    return () => { live = false }
  }, [host, hub, sessionId])

  useEffect(() => {
    if (phase === 'submitting') return
    const base: CommitterState = { ...state.current, candidates: entries }
    const outcome = observeCommitter(base, {
      phase,
      attachmentIds,
      verifiedRoundIds: verified,
      draftText,
      transcript,
    })
    state.current = outcome.state
    if (outcome.effects.length === 0) return
    void runCommitterEffects(outcome.effects, {
      async commit(entry, sentText) {
        const key = entry.key
        const result = await annotations.withLock(key, () => annotations.commit(key, entry.pending.roundId, sentText))
        if (result.status === 'committed') {
          hub.remove(key, entry.pending.roundId)
          attachments.forget(entry.pending.roundId)
          return 'committed'
        }
        return result.status === 'refused' ? 'refused' : 'failed'
      },
      async detach(entry) {
        const key = entry.key
        const result = await annotations.withLock(key, () => annotations.detach(key, entry.pending.roundId))
        if (result.status === 'saved') {
          attachments.release(key.sessionId, entry.pending.draftAttachmentId)
          hub.remove(key, entry.pending.roundId)
          attachments.forget(entry.pending.roundId)
          return 'detached'
        }
        return result.status === 'refused' ? 'refused' : 'failed'
      },
    }).then((settlements) => {
      state.current = settleCommitterState(state.current, settlements)
      if (!mounted.current) return
      if (settlements.some(settlement => settlement.result === 'failed')) {
        setTimeout(() => { if (mounted.current) setRetry(value => value + 1) }, RETRY_MS)
      }
    })
  }, [phase, attachmentIds, draftText, transcript, entries, verified, annotations, hub, attachments, retry])

  return null
}

function useTranscript(useChat: UseChat | undefined): readonly TranscriptFile[] {
  const chat = useChat === undefined ? undefined : useChat(state => state)
  return useMemo(() => (chat === undefined ? [] : transcriptFilesOf(chat)), [chat])
}

function usePendingEntries(hub: PendingHub, sessionId: string): readonly PendingEntry[] {
  const [entries, setEntries] = useState<readonly PendingEntry[]>(() => hub.list(sessionId))
  useEffect(() => {
    setEntries(hub.list(sessionId))
    return hub.subscribe(sessionId, () => setEntries(hub.list(sessionId)))
  }, [hub, sessionId])
  return entries
}

function useVerified(
  entries: readonly PendingEntry[],
  attachmentIds: readonly string[],
  attachments: AttachmentController,
  sessionId: string,
): readonly string[] {
  const [verified, setVerified] = useState<readonly string[]>([])
  const running = useRef(new Set<string>())

  useEffect(() => {
    for (const entry of entries) {
      const roundId = entry.pending.roundId
      if (running.current.has(roundId) || verified.includes(roundId)) continue
      if (!attachmentIds.includes(entry.pending.draftAttachmentId)) continue
      running.current.add(roundId)
      void attachments.verify(entry.pending, sessionId).then((ok) => {
        running.current.delete(roundId)
        if (!ok) return
        setVerified(current => (current.includes(roundId) ? current : [...current, roundId]))
      }).catch(() => {
        running.current.delete(roundId)
      })
    }
  }, [entries, attachmentIds, verified, attachments, sessionId])

  useEffect(() => {
    setVerified(current => {
      const live = current.filter(roundId => entries.some(entry => entry.pending.roundId === roundId))
      return live.length === current.length ? current : live
    })
  }, [entries])

  return verified
}
