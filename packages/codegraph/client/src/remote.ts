/**
 * 与 Host 远程服务 `codegraphAdmin` 的接线。
 *
 * 走网关的 client-request 信封：endpoint 是 `命名空间/方法`，payload 只含一个
 * `args` 字段（对象）。这是网关校验器实际接受的形状，手写描述符要与之对齐。
 */
import type { ClientContext, CodegraphAdmin, WorkspaceStateView } from './context.ts'

/**
 * 一次 RPC 的结果信封。网关在外面包一层传输结果，Host 方法自己的返回值
 * （`{ ok, value }` 或 `{ ok, error }`）在里面再包一层，所以剥两层。
 */
interface Envelope<T> {
  type: 'server-response'
  rpcId: string
  result: { ok: true; value: Outcome<T> } | { ok: false; error: { code: string; message: string } }
}

/** Host 方法自己的返回形状。 */
interface Outcome<T> {
  ok: boolean
  value?: T
  error?: { code?: string; message?: string }
}

const SERVICE = 'codegraphAdmin'

let rpcSeq = 0

/**
 * 调一次网关端点。任何非 ok 的结果都折成一次可展示的异常。
 * @param ctx - 浏览器半体上下文，用来取 cookie 与基地址。
 * @param method - `codegraphAdmin` 上的方法名。
 * @param args - 位置参数，按 Host 方法签名顺序。
 */
async function call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const endpoint = `${SERVICE}/${method}`
  const body = {
    type: 'client-request' as const,
    rpcId: `codegraph-${++rpcSeq}`,
    endpoint,
    method: endpoint,
    payload: { args },
  }
  const response = await fetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${endpoint} 失败：HTTP ${response.status}`)
  const envelope = await response.json() as Envelope<T>
  if (!envelope.result.ok) throw new Error(envelope.result.error.message)
  const outcome = envelope.result.value
  if (outcome.ok) return outcome.value as T
  throw new Error(outcome.error?.message ?? `${endpoint} 失败`)
}

/** Host 方法的参数名，顺序与签名一致。 */
const ARG_NAMES: Record<keyof WireArgs, string[]> = {
  describe: [],
  setEnabled: ['path', 'enabled'],
  retry: ['path'],
} as const

interface WireArgs {
  describe(): void
  setEnabled(path: string, enabled: boolean): void
  retry(path: string): void
}

/**
 * 把位置参数按 Host 签名折成 args 对象。
 * Host 方法只读位置参数，字段名不影响行为，这里用签名里的形参名保持可读。
 * @param method - 方法名。
 * @param values - 位置参数。
 */
function toArgs(method: keyof WireArgs, values: unknown[]): Record<string, unknown> {
  const names = ARG_NAMES[method]
  const args: Record<string, unknown> = {}
  names.forEach((name, index) => { args[name] = values[index] })
  return args
}

/** 组件与菜单用的门面：每次成功读取都更新缓存，菜单同步读缓存。 */
export function createBridge(): CodegraphAdmin {
  let cached: WorkspaceStateView | undefined
  const listeners = new Set<() => void>()
  const publish = (value: WorkspaceStateView): WorkspaceStateView => {
    cached = value
    for (const listener of listeners) listener()
    return value
  }
  const bridge: CodegraphAdmin = {
    describe: () => call<WorkspaceStateView>('describe').then(publish),
    refresh: () => bridge.describe(),
    snapshot: () => cached,
    setEnabled: (path, enabled) => call<WorkspaceStateView>('setEnabled', toArgs('setEnabled', [path, enabled])).then(publish),
    retry: path => call<WorkspaceStateView>('retry', toArgs('retry', [path])).then(publish),
  }
  Object.defineProperty(bridge, 'subscribe', {
    value: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  })
  return bridge
}

/** 读一次状态；失败时把原因交给调用方展示。 */
export async function describeAll(admin: CodegraphAdmin): Promise<WorkspaceStateView> {
  return admin.describe()
}

/** 占位：保留注入形状，便于后续改用官方 remote 服务时替换。 */
export function mountAdmin(_ctx: ClientContext): Promise<CodegraphAdmin> {
  return Promise.resolve(createBridge())
}
