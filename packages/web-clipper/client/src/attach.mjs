/**
 * Put one artifact into the current conversation's composer.
 *
 * Primary path: register a runtime draft through the conversation service,
 * then add its ids to the public input actions. The synthetic document drop is
 * only a fallback for a host whose conversation service does not expose
 * `createDrafts`; it never replaces the direct path.
 */

export const RAIL_SELECTOR = '[data-slot="conversation.input.attachments"]'
export const PLACEMENT_TIMEOUT_MS = 2500

const POLL_MS = 150
const failure = (code, detail) => (detail === undefined ? { ok: false, code } : { ok: false, code, detail })

/** Whether the concrete conversation service and public input actions can carry a draft. */
export function hasDirectIntake(conversation, inputActions) {
  return conversation !== null && conversation !== undefined
    && typeof conversation.createDrafts === 'function'
    && typeof conversation.releaseDraftAttachments === 'function'
    && inputActions !== null && inputActions !== undefined
    && typeof inputActions.addAttachments === 'function'
}

function dropIntakeAvailable(DataTransferCtor, DragEventCtor) {
  return typeof DataTransferCtor === 'function'
    && typeof DragEventCtor === 'function'
    && typeof File === 'function'
}

async function confirmPlacement(doc, name, sleep, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const rail = doc.querySelector?.(RAIL_SELECTOR)
    if (rail !== null && rail !== undefined && (rail.textContent ?? '').includes(name)) return true
    if (Date.now() >= deadline) return false
    await sleep(Math.max(0, Math.min(POLL_MS, deadline - Date.now())))
  }
}

function dispatchDrop(doc, artifact, DataTransferCtor, DragEventCtor) {
  const file = new File([artifact.content], artifact.name, { type: artifact.type })
  const transfer = new DataTransferCtor()
  transfer.items.add(file)
  doc.dispatchEvent(new DragEventCtor('drop', {
    bubbles: true,
    cancelable: true,
    dataTransfer: transfer,
  }))
}

/**
 * @param options - `{ artifact, sessionId, inputActions, conversation, doc,
 *   DataTransfer, DragEvent, sleep, timeoutMs }`.
 * @returns `{ ok: true, mode: 'draft' | 'drop' }` or `{ ok: false, code, detail? }`.
 */
export async function attachArtifact(options) {
  const {
    artifact,
    sessionId,
    inputActions,
    conversation,
    doc = globalThis.document,
    DataTransfer: DataTransferCtor = globalThis.DataTransfer,
    DragEvent: DragEventCtor = globalThis.DragEvent,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs = PLACEMENT_TIMEOUT_MS,
  } = options

  if (hasDirectIntake(conversation, inputActions)) {
    let drafts
    try {
      const file = new File([artifact.content], artifact.name, { type: artifact.type })
      drafts = conversation.createDrafts(sessionId, [file], true)
    } catch (error) {
      return failure('attach-failed', error instanceof Error ? error.message : String(error))
    }
    const ids = (drafts ?? []).map((draft) => draft?.id).filter((id) => id !== undefined)
    if (ids.length === 0) {
      try {
        conversation.releaseDraftAttachments(drafts)
      } catch {
        // Nothing to release if the drafts were never registered.
      }
      return failure('attach-failed', 'conversation created no draft')
    }
    let accepted
    try {
      accepted = inputActions.addAttachments(ids)
    } catch (error) {
      try {
        conversation.releaseDraftAttachments(drafts)
      } catch {
        // Keep the original failure.
      }
      return failure('attach-failed', error instanceof Error ? error.message : String(error))
    }
    if (accepted !== true) {
      try {
        conversation.releaseDraftAttachments(drafts)
      } catch {
        // The refusal already tells the caller what happened.
      }
      return failure('composer-busy')
    }
    return { ok: true, mode: 'draft' }
  }

  if (!dropIntakeAvailable(DataTransferCtor, DragEventCtor)) {
    return failure('attach-failed', 'drop intake unavailable')
  }
  try {
    dispatchDrop(doc, artifact, DataTransferCtor, DragEventCtor)
  } catch (error) {
    return failure('attach-failed', error instanceof Error ? error.message : String(error))
  }
  const placed = await confirmPlacement(doc, artifact.name, sleep, timeoutMs)
  if (!placed) return failure('attach-failed', 'attachment did not appear')
  return { ok: true, mode: 'drop' }
}