// Host（Node）service 插件入口：jiraWorklogs 远程服务（TypertRemoteService）。
// 本文件只被 dsh 运行时加载（平台包经 peerDependencies 解析到宿主副本），
// 不进 node --test——可测流程编排全部在 src/flows.ts（依赖注入），本层只做
// ctx 接线、描述符与提交互斥。方法面：overview / dayDetail / generate / submit
// ＋ 20261015 Wave 三新方法 openOutbox / dismissOutbox / saveNotes。
// 方法暴露采用手写 remote-methods 原型描述符（Node 24 strip-only 不支持
// 装饰器语法；描述符为纯数据，与 @Remote() 装饰器写入的线格式一致）。
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { JiraClient } from './engine/jira.ts'
import { engineConfigFrom, pluginConfigSnapshot, settingsSchema, bindPluginConfig } from './settings.ts'
import { acquireAll, DayMutex } from './gates.ts'
import { createCandidateStore, createDraftStore } from './draft-store.ts'
import { openWorklogsStore, type WorklogsStore } from './store/domain.ts'
import {
  dayDetailFlow, dismissOutboxFlow, generateFlow, openOutboxFlow, overviewFlow, queryFlow, saveNotesFlow, submitFlow,
  todayKeyEast8, type HostFlowsDeps, type NotesSaveRequest,
} from './flows.ts'
import type { DayDetail, DraftDocument, MonthOverview, QueryView, SubmitReport, SubmitRequest } from './service.ts'

type Mirror = Record<string, unknown>

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 生成调用通道与默认模型路由（base profile 恒在位，F3/F4；注入声明之内访问保留属性追踪）。 */
type LlmStream = (options: GenerateOptions) => AsyncIterable<StreamChunk>
type CurrentSelection = () => { provider: string; model: string; reasoningEffort?: string }

export default class JiraWorklogsService extends TypertRemoteService {
  /** rc.1 设置集成：schema 即插件 Config，三个顶层子树 volatile 在线编辑。 */
  static Config = settingsSchema

  private readonly store = createDraftStore()
  private readonly candidateStore = createCandidateStore()
  private readonly submitMutex = new DayMutex()
  private worklogs: WorklogsStore | undefined
  private llmStream: LlmStream | undefined
  private currentSelection: CurrentSelection | undefined

  constructor(ctx: Context, config: unknown) {
    super(ctx, 'jiraWorklogs')
    bindPluginConfig(config)
    ctx.inject(['llm'], llmCtx => {
      this.llmStream = (options: unknown) => llmCtx.llm.stream(options as never)
      return () => { this.llmStream = undefined }
    })
    ctx.inject(['agentDefaultModel'], modelCtx => {
      // Context 接口增强声明在平台包内；以结构 cast 消费，避免额外 peer 引用
      const service = (modelCtx as unknown as { agentDefaultModel: { currentSelection: () => { provider: string; model: string; reasoningEffort?: string } } }).agentDefaultModel
      this.currentSelection = () => service.currentSelection()
      return () => { this.currentSelection = undefined }
    })
    // 存储域（20261015 Wave）：开域失败＝存储缺席降级（warn 不阻断启动——四既有方法
    // 与素材/暂存面各自降级，SPEC R8；JWL_DEBUG_STORE_FAIL=open 注入形态同此）。
    ctx.inject(['storageDomain'], sctx => {
      const pending = openWorklogsStore(sctx as never)
      pending.then(store => { this.worklogs = store }).catch(error => {
        console.warn('[dsh-jira-worklogs] storage domain unavailable:', (error as Error).message)
      })
      return () => {
        this.worklogs = undefined
        void pending.then(store => store.close()).catch(() => {})
      }
    })
  }

  /** 流程依赖装配：配置每调用快照（热生效，F17）；平台服务缺席时按路由不可用口径拒绝。 */
  private deps(): HostFlowsDeps {
    const routeUnavailable = (): never => {
      throw new Error('默认模型路由不可用：llm 或默认模型服务未就绪（请到平台设置检查默认模型后再来重试）')
    }
    const engineConfig = () => engineConfigFrom(pluginConfigSnapshot() as never)
    return {
      engineConfig,
      jiraConfigured: () => {
        const jira = engineConfig().jira
        return Boolean(jira.server && jira.username && jira.password)
      },
      makeClient: jira => new JiraClient(jira.server, jira.username, jira.password, undefined, jira.verifySsl),
      currentSelection: this.currentSelection ?? routeUnavailable,
      stream: this.llmStream ?? routeUnavailable,
      store: this.store,
      worklogs: this.worklogs,
      candidates: this.candidateStore,
    }
  }

  /** 月视图：凭据纯配置预检 → 当月工作日状态（PLAN Host 服务单元）。 */
  async overview(): Promise<MonthOverview> {
    return overviewFlow(this.deps(), todayKeyEast8())
  }

  /** 日详情：全量登记 + 名称解析 + 单日 Git。 */
  async dayDetail(date?: unknown): Promise<DayDetail> {
    const day = String(((date ?? {}) as Mirror).date ?? date ?? '')
    if (!DATE_RE.test(day)) throw new Error('date 必须是 YYYY-MM-DD')
    return dayDetailFlow(this.deps(), day)
  }

  /** 就地生成：全量素材 → 一次性模型调用 → fail-closed 解析 → 草稿入缓存。
   * 取消：描述符声明 cancellation（signal 为保留末位参数）——客户端关窗/断连的
   * 调用取消直达 stream（F16；终审 F2 接线完成）。 */
  async generate(date?: unknown, signal?: AbortSignal): Promise<DraftDocument> {
    const day = String(((date ?? {}) as Mirror).date ?? date ?? '')
    if (!DATE_RE.test(day)) throw new Error('date 必须是 YYYY-MM-DD')
    return generateFlow(this.deps(), day, signal)
  }

  /** 直接提交：同日互斥 → 现查重组 → 引擎写入（confirm 恒 true＝UI 提交动作的显式确认，D6）。 */
  async submit(request?: unknown): Promise<SubmitReport> {
    const record = (request ?? {}) as Mirror
    const req: SubmitRequest = {
      draftId: String(record.draftId ?? ''),
      entries: Array.isArray(record.entries) ? record.entries as SubmitRequest['entries'] : [],
    }
    if (!req.draftId) throw new Error('draftId 不能为空')
    const context = this.store.get(req.draftId)
    if (!context) throw new Error('草稿已过期，请重新生成后再提交')
    const release = acquireAll(this.submitMutex, [context.date])
    try {
      return await submitFlow(this.deps(), req)
    } finally {
      release()
    }
  }

  /** 暂存回显（20261015 Wave）：读暂存 → 注册草稿缓存（outboxDate）→ 回显文档。 */
  async openOutbox(date?: unknown): Promise<DraftDocument> {
    const day = String(((date ?? {}) as Mirror).date ?? date ?? '')
    if (!DATE_RE.test(day)) throw new Error('date 必须是 YYYY-MM-DD')
    return openOutboxFlow(this.deps(), day)
  }

  /** 放弃暂存：删除该日暂存记录（不写任何 Jira 内容）。与提交共享同日互斥——
   * 消除「提交记账读旧记录与放弃删除」的写竞态（T05 review f2）。 */
  async dismissOutbox(date?: unknown): Promise<void> {
    const day = String(((date ?? {}) as Mirror).date ?? date ?? '')
    if (!DATE_RE.test(day)) throw new Error('date 必须是 YYYY-MM-DD')
    const release = acquireAll(this.submitMutex, [day])
    try {
      return await dismissOutboxFlow(this.deps(), day)
    } finally {
      release()
    }
  }

  /** 素材保存：整日条目集落库（自动保存动线，防抖在客户端）。 */
  async saveNotes(request?: unknown): Promise<{ items: { id: string; taskName: string; text: string }[] }> {
    const record = (request ?? {}) as Mirror
    const req: NotesSaveRequest = {
      date: String(record.date ?? ''),
      items: Array.isArray(record.items) ? record.items as NotesSaveRequest['items'] : [],
    }
    if (!DATE_RE.test(req.date)) throw new Error('date 必须是 YYYY-MM-DD')
    return saveNotesFlow(this.deps(), req)
  }

  /** 查同事日志（20261023 Wave）：只读查询——中文名或登录 ID＋可选日期范围（from/to
   * 各自缺省＝该侧不限；右界卡今天在引擎层）。参数校验在此层（错误指出问题字段）。 */
  async query(request?: unknown): Promise<QueryView> {
    const record = (request ?? {}) as Mirror
    const name = String(record.name ?? '').trim()
    if (!name) throw new Error('name 不能为空')
    const from = record.from === undefined || record.from === '' ? undefined : String(record.from)
    const to = record.to === undefined || record.to === '' ? undefined : String(record.to)
    if (from !== undefined && !DATE_RE.test(from)) throw new Error('from 必须是 YYYY-MM-DD')
    if (to !== undefined && !DATE_RE.test(to)) throw new Error('to 必须是 YYYY-MM-DD')
    if (from !== undefined && to !== undefined && from > to) throw new Error('开始日期（from）晚于结束日期（to），请修正日期范围')
    return queryFlow(this.deps(), { name, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) })
  }
}

// @Remote() 等价的手写方法描述符（direct 调用；方法签名须为普通标识符参数）。
// generate 的取消接线：gateway 从方法签名参数名（generate(date, signal) 的保留末位
// signal）推导 cancellation——描述符上的 cancellation 字段是自文档（平台对 marker
// 上的声明不消费，终审复审 N1）；改签名参数名会静默断链，勿重命名。
interface RemoteMethodDescriptorV1 {
  version: 1
  methods: { method: string; invocation: { kind: 'direct' }; cancellation?: { parameter: 'signal' } }[]
}
const descriptor: RemoteMethodDescriptorV1 = {
  version: 1,
  methods: [
    { method: 'overview', invocation: { kind: 'direct' } },
    { method: 'dayDetail', invocation: { kind: 'direct' } },
    { method: 'generate', invocation: { kind: 'direct' }, cancellation: { parameter: 'signal' } },
    { method: 'submit', invocation: { kind: 'direct' } },
    { method: 'openOutbox', invocation: { kind: 'direct' } },
    { method: 'dismissOutbox', invocation: { kind: 'direct' } },
    { method: 'saveNotes', invocation: { kind: 'direct' } },
    { method: 'query', invocation: { kind: 'direct' } },
  ],
}
Object.defineProperty(JiraWorklogsService.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods', {
  configurable: true,
  value: Object.freeze(structuredClone(descriptor)),
})
