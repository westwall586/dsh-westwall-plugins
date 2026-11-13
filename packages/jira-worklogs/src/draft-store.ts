// 草稿上下文缓存（PLAN 草稿上下文单元，D22）：draftId → { date, taskKeys }。
// 进程内 LRU——弹窗重开/重启丢失可接受（重新生成即恢复）；同日再生成替换旧草稿，
// issue key 与校验上下文留在 Host，客户端载荷全程无键（脱敏保守口径）。
// 20261015 Wave：DraftContext 增 outboxDate（暂存回显注册标记，submitFlow 据此
// 区分暂存重提）；新增 createCandidateStore——date → 候选 id 映射（键不出宿主的
// 会话映射，dayDetail 每次调用重建，saveNotes 消费解析 candidateId）。

export interface DraftTaskRef {
  key: string
  name: string
}

export interface DraftContext {
  date: string
  /** id → { key: issue key, name: 任务名 }——提交重组计划文档需要任务名过引擎校验（task_name 不能只显示 key）。 */
  taskKeys: Map<number, DraftTaskRef>
  /** 暂存回显注册时携带（openOutboxFlow）；submitFlow 据此走暂存更新/清除口径。 */
  outboxDate?: string
}

export interface DraftStore {
  put(context: DraftContext): string
  get(draftId: string): DraftContext | undefined
}

export function createDraftStore(capacity = 20): DraftStore {
  const entries = new Map<string, DraftContext>() // Map 迭代序＝插入序；get 重插＝LRU 续期
  let seq = 0
  return {
    put(context) {
      for (const [id, held] of entries) {
        if (held.date === context.date) entries.delete(id)
      }
      seq += 1
      const draftId = `draft-${context.date}-${Date.now().toString(36)}-${seq}`
      entries.set(draftId, context)
      while (entries.size > capacity) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
      return draftId
    },
    get(draftId) {
      const held = entries.get(draftId)
      if (held === undefined) return undefined
      entries.delete(draftId)
      entries.set(draftId, held)
      return held
    },
  }
}

/** 候选映射缓存：date → (id → issue key/任务名)。同日 put 即整替换（dayDetail 重建映射）。 */
export interface CandidateStore {
  put(date: string, map: Map<number, DraftTaskRef>): void
  get(date: string): Map<number, DraftTaskRef> | undefined
}

export function createCandidateStore(capacity = 10): CandidateStore {
  const entries = new Map<string, Map<number, DraftTaskRef>>()
  return {
    put(date, map) {
      entries.delete(date)
      entries.set(date, map)
      while (entries.size > capacity) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    },
    get(date) {
      const held = entries.get(date)
      if (held === undefined) return undefined
      entries.delete(date)
      entries.set(date, held)
      return held
    },
  }
}
