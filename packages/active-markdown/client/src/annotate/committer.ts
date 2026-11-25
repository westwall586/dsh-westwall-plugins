/**
 * The session-level send detector. It is a pure reducer over composer
 * observations plus a tiny pending hub, so the four-way identity and every
 * send outcome are testable without React.
 *
 * A round is only considered when its pending record exists, its draft id is
 * the one in the composer and that id resolved to the exact feedback file, and
 * the sent message carries a matching FileBlock (or the id disappeared after a
 * `sending` latch, which is the input facade's own acceptance signal).
 */
import type { ChatMessageView, FileBlockView, InputPhase } from '../context.ts'
import type { PendingReview } from './model.ts'

/** A document the committer watches: the file's session plus its canonical path. */
export interface PendingEntry {
  key: { session: string, path: string }
  pending: PendingReview
}

export interface TranscriptFile {
  name: string
  attachmentId: string
}

export interface CommitterObservation {
  phase: InputPhase
  attachmentIds: readonly string[]
  /** Round ids whose runtime descriptor matched the pending file byte for byte. */
  verifiedRoundIds: readonly string[]
  /** Draft text captured while the round was latched. */
  draftText: string
  transcript: readonly TranscriptFile[]
}

export interface CommitterState {
  candidates: readonly PendingEntry[]
  /** Rounds whose draft id was actually seen in the composer. */
  attached: ReadonlySet<string>
  /** Round id to the draft text that was in flight. */
  latched: ReadonlyMap<string, string>
  /** Rounds an effect is already handling. */
  inFlight: ReadonlySet<string>
}

export type CommitterEffect =
  | { kind: 'commit', entry: PendingEntry, sentText: string }
  | { kind: 'detach', entry: PendingEntry }

export interface CommitterOutcome {
  state: CommitterState
  effects: readonly CommitterEffect[]
}

export type CommitterResult = 'committed' | 'detached' | 'failed' | 'refused'

export interface CommitterEffectPorts {
  commit(entry: PendingEntry, sentText: string): Promise<CommitterResult>
  detach(entry: PendingEntry): Promise<CommitterResult>
}

export interface CommitterSettlement {
  roundId: string
  effect: 'commit' | 'detach'
  result: CommitterResult
}

export function initialCommitterState(candidates: readonly PendingEntry[] = []): CommitterState {
  return { candidates: [...candidates], attached: new Set(), latched: new Map(), inFlight: new Set() }
}

export function transcriptFilesOfNodes(nodes: readonly ChatMessageView[]): TranscriptFile[] {
  const files: TranscriptFile[] = []
  let messages = 0
  for (let index = nodes.length - 1; index >= 0 && messages < 8; index -= 1) {
    const node = nodes[index]!
    if (node.kind !== 'user' && node.kind !== 'steering') continue
    messages += 1
    for (const block of node.data?.content ?? node.content ?? []) {
      if (!isFileBlock(block)) continue
      files.push({ name: block.attachment.name, attachmentId: block.attachment.attachmentId })
    }
  }
  return files
}

function isFileBlock(block: { readonly type: string }): block is FileBlockView {
  return block.type === 'file'
    && typeof (block as FileBlockView).attachment?.name === 'string'
    && typeof (block as FileBlockView).attachment?.attachmentId === 'string'
}

/** The sent-file half of the identity: name carries the round id, or the id is the file digest. */
export function fileMatchesPending(file: TranscriptFile, pending: PendingReview): boolean {
  return file.name.includes(pending.roundId) || file.attachmentId === `sha256:${pending.fileHash}`
}

function matchesTranscript(entry: PendingEntry, transcript: readonly TranscriptFile[]): boolean {
  return transcript.some(file => fileMatchesPending(file, entry.pending))
}

/**
 * Decide what one observation means. `submitting` is a slash command and is
 * ignored entirely: this version never treats a command send as annotation
 * delivery.
 */
export function observeCommitter(state: CommitterState, observation: CommitterObservation): CommitterOutcome {
  if (observation.phase === 'submitting') return { state, effects: [] }

  const effects: CommitterEffect[] = []
  const attached = new Set(state.attached)
  const latched = new Map(state.latched)
  const inFlight = new Set(state.inFlight)
  const gone = new Set<string>()

  for (const entry of state.candidates) {
    const roundId = entry.pending.roundId
    if (inFlight.has(roundId) || gone.has(roundId)) continue
    const present = observation.attachmentIds.includes(entry.pending.draftAttachmentId)
    const verified = observation.verifiedRoundIds.includes(roundId)

    if (observation.phase === 'sending') {
      if (present && verified) {
        attached.add(roundId)
        latched.set(roundId, observation.draftText)
      }
      continue
    }

    if (observation.phase !== 'plain') continue

    if (latched.has(roundId)) {
      if (!present) {
        effects.push({ kind: 'commit', entry, sentText: latched.get(roundId) ?? '' })
        attached.delete(roundId)
        latched.delete(roundId)
        inFlight.add(roundId)
        gone.add(roundId)
      } else {
        // Back to plain with the id still there: the send failed. Keep both,
        // and drop the latch so a later manual removal is not read as a send.
        latched.delete(roundId)
      }
      continue
    }

    if (matchesTranscript(entry, observation.transcript)) {
      effects.push({ kind: 'commit', entry, sentText: '' })
      attached.delete(roundId)
      inFlight.add(roundId)
      gone.add(roundId)
      continue
    }

    if (attached.has(roundId)) {
      if (!present) {
        effects.push({ kind: 'detach', entry })
        attached.delete(roundId)
        inFlight.add(roundId)
        gone.add(roundId)
      }
      continue
    }

    if (present && verified) attached.add(roundId)
  }

  return { state: { candidates: state.candidates, attached, latched, inFlight }, effects }
}

export async function runCommitterEffects(
  effects: readonly CommitterEffect[],
  ports: CommitterEffectPorts,
): Promise<CommitterSettlement[]> {
  const settlements: CommitterSettlement[] = []
  for (const effect of effects) {
    const result = effect.kind === 'commit'
      ? await ports.commit(effect.entry, effect.sentText)
      : await ports.detach(effect.entry)
    settlements.push({ roundId: effect.entry.pending.roundId, effect: effect.kind, result })
  }
  return settlements
}

/** Remove what succeeded; a failure clears the in-flight mark so the next observation retries. */
export function settleCommitterState(state: CommitterState, settlements: readonly CommitterSettlement[]): CommitterState {
  const resolved = new Set<string>()
  for (const settlement of settlements) {
    if (settlement.result === 'committed' || settlement.result === 'detached' || settlement.result === 'refused') {
      resolved.add(settlement.roundId)
    }
  }
  const attached = new Set(state.attached)
  const latched = new Map(state.latched)
  const inFlight = new Set(state.inFlight)
  for (const settlement of settlements) {
    if (resolved.has(settlement.roundId)) {
      attached.delete(settlement.roundId)
      latched.delete(settlement.roundId)
    }
    inFlight.delete(settlement.roundId)
  }
  return {
    candidates: state.candidates.filter(entry => !resolved.has(entry.pending.roundId)),
    attached,
    latched,
    inFlight,
  }
}

export interface PendingHub {
  subscribe(sessionId: string, listener: () => void): () => void
  list(sessionId: string): readonly PendingEntry[]
  set(entry: PendingEntry): void
  remove(key: { session: string, path: string }, roundId: string): void
  /** Drop every entry for a round id, whatever key it sits under. */
  clear(roundId: string): void
}

export function createPendingHub(): PendingHub {
  const entries = new Map<string, PendingEntry[]>()
  const listeners = new Map<string, Set<() => void>>()

  const publish = (sessionId: string): void => {
    for (const listener of [...listeners.get(sessionId) ?? []]) listener()
  }

  const sessionOfGroups = (): string[] => [...entries.keys()]

  return {
    subscribe(sessionId, listener) {
      let group = listeners.get(sessionId)
      if (group === undefined) {
        group = new Set()
        listeners.set(sessionId, group)
      }
      group.add(listener)
      return () => {
        group.delete(listener)
      }
    },

    list(sessionId) {
      return entries.get(sessionId) ?? []
    },

    set(entry) {
      const sessionId = entry.key.session
      const group = entries.get(sessionId) ?? []
      const next = group.filter(existing => !(existing.key.session === entry.key.session && existing.key.path === entry.key.path))
      next.push(entry)
      entries.set(sessionId, next)
      publish(sessionId)
    },

    remove(key, roundId) {
      const sessionId = key.session
      const group = entries.get(sessionId)
      if (group === undefined) return
      const next = group.filter(entry => !(entry.key.path === key.path && entry.pending.roundId === roundId))
      if (next.length === group.length) return
      if (next.length === 0) entries.delete(sessionId)
      else entries.set(sessionId, next)
      publish(sessionId)
    },

    clear(roundId) {
      for (const sessionId of sessionOfGroups()) {
        const group = entries.get(sessionId) ?? []
        const next = group.filter(entry => entry.pending.roundId !== roundId)
        if (next.length === group.length) continue
        if (next.length === 0) entries.delete(sessionId)
        else entries.set(sessionId, next)
        publish(sessionId)
      }
    },
  }
}
