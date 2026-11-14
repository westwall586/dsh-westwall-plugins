/** Host half freezes one expression prompt per new Web session and injects it scoped to that agent. */
import type { Context } from '@deepseek-ai/cordis'
// Type-only import. It loads the agent/* event vocabulary into this Context.
import type {} from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_STYLE_PROMPT, MAX_PROMPT_CHARS, SECTION_NAME, SECTION_ORDER } from './prompt.ts'
import { openSnapshotStore, shouldCapture } from './snapshot.ts'

export const name = 'friendly-expression'

export const inject = ['systemPrompt']

export const Config = z.object({
  stylePrompt: z.string().max(MAX_PROMPT_CHARS).default(DEFAULT_STYLE_PROMPT).volatile(),
})

interface FriendlyExpressionConfig {
  stylePrompt: string | { get(): string } | undefined
}

interface PromptService {
  section(section: { name: string; order: number; text: string }): () => void
}

type PromptContext = Context & { systemPrompt: PromptService }

interface AgentLike {
  session: {
    id: string
    header: { origin?: 'subagent'; isSeeded: boolean }
    surface: { nodes: readonly unknown[] }
  }
  ctx: Context
}

interface AgentRegistryLike {
  list(): Iterable<AgentLike>
}

/** Read a volatile config field whether the Host handed back a raw string or a reference. */
export function readStylePrompt(value: FriendlyExpressionConfig['stylePrompt']): string {
  if (typeof value === 'string') return value
  return value?.get() ?? ''
}

function hasWebSurface(ctx: Context): boolean {
  return ctx.get('webApp') !== undefined || ctx.get('webServer') !== undefined
}

function warn(message: string, error: unknown): void {
  console.warn(`[dsh-friendly-expression] ${message}`, error)
}

export async function apply(ctx: Context, config: FriendlyExpressionConfig): Promise<void> {
  const store = await openSnapshotStore(ctx)
  const sections = new Map<string, () => void>()

  const registerSection = (agent: AgentLike, prompt: string): void => {
    const sessionId = agent.session.id
    if (prompt.length === 0 || sections.has(sessionId)) return
    const promptCtx = agent.ctx as PromptContext
    const dispose = agent.ctx.effect(() => promptCtx.systemPrompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      text: prompt,
    }), 'friendly-expression prompt section')
    sections.set(sessionId, dispose)
  }

  ctx.effect(() => () => store.close(), 'friendly-expression snapshot store')
  ctx.effect(() => () => {
    for (const dispose of sections.values()) dispose()
    sections.clear()
  }, 'friendly-expression prompt sections')

  ctx.on('agent/created', ({ agent, source }) => {
    if (!hasWebSurface(ctx)) return undefined
    if (agent.session.header.origin === 'subagent') return undefined
    if (sections.has(agent.session.id)) return undefined

    let prompt = store.get(agent.session.id)
    if (prompt === undefined) {
      if (source !== 'startup') return undefined
      const fresh = shouldCapture({
        isSubagent: false,
        isSeeded: agent.session.header.isSeeded,
        hasMessages: agent.session.surface.nodes.length > 0,
      })
      if (!fresh) return undefined
      prompt = readStylePrompt(config.stylePrompt)
      void store.capture(agent.session.id, prompt).catch((error: unknown) => {
        warn(`failed to capture the prompt snapshot for session ${agent.session.id}`, error)
      })
    }

    registerSection(agent, prompt)
    return undefined
  })

  ctx.on('agent/disposed', ({ agent }) => {
    sections.delete(agent.session.id)
  })

  const registry = ctx.get('agents') as AgentRegistryLike | undefined
  if (registry !== undefined && hasWebSurface(ctx)) {
    for (const agent of registry.list()) {
      if (agent.session.header.origin === 'subagent') continue
      const prompt = store.get(agent.session.id)
      if (prompt !== undefined) registerSection(agent, prompt)
    }
  }
}
