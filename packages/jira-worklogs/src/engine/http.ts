// 真实 Transport：undici Agent 按客户端关闭证书校验（自签自建），
// 30 秒超时，JSON 编解码，3xx/4xx/5xx 与坏 JSON 归一为 HttpError（确定性失败，
// 不重试），其余失败保持网络错误形态（客户端层据此区分重试）。
import { Agent, request } from 'undici'
import { HttpError, type Transport } from './types.ts'

const REQUEST_TIMEOUT_MS = 30_000

/** 测试可调的网络抖动退避（毫秒，参考 GET_RETRY_DELAY）。 */
export const clientConfig = {
  GET_RETRY_DELAY: 1000,
}

export interface HttpTransportOptions {
  /** 自建自签默认关闭；JIRA/GITLAB_VERIFY_SSL 显式开启时为 true。 */
  verifySsl?: boolean
}

/** 合并请求头：调用方头键先小写归一，再在有 body 时补 content-type。
 * 归一是硬约束——大小写不同的同名头（如 Content-Type 与 content-type）会作为
 * 两个键透传给 undici，写请求直接被拒（"must only have a single value"）；
 * 读请求无 body 恰好只带一个而不触发，故该缺陷只在写路径暴露。 */
export function mergedHeaders(headers: Record<string, string> | undefined, hasBody: boolean): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers ?? {})) normalized[key.toLowerCase()] = value
  return { ...normalized, ...(hasBody ? { 'content-type': 'application/json' } : {}) }
}

/** 构造真实 transport；失败形态约定见模块注释（重试策略在客户端层）。 */
export function makeHttpTransport(options: HttpTransportOptions = {}): Transport {
  const dispatcher = new Agent({
    connect: { rejectUnauthorized: options.verifySsl === true },
    bodyTimeout: REQUEST_TIMEOUT_MS,
    headersTimeout: REQUEST_TIMEOUT_MS,
  })
  return async (method, url, init) => {
    const body = init?.body === undefined ? undefined : JSON.stringify(init.body)
    let response
    try {
      response = await request(url, {
        method,
        body,
        headers: mergedHeaders(init?.headers, body !== undefined),
        dispatcher,
      })
    } catch (error) {
      // undici 抛 TypeError/UND_ERR_* 等——保持网络错误形态，客户端层重试策略据此判定。
      throw error instanceof Error ? error : new Error(String(error))
    }
    // undici request() 不跟随重定向：3xx 在此是确定性失败，不得伪装成空成功。
    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = response.headers.location
      await response.body.dump().catch(() => {})
      throw new HttpError(response.statusCode, `redirect not followed: ${Array.isArray(location) ? location[0] : location ?? ''}`)
    }
    if (response.statusCode >= 400) {
      const text = await response.body.text().catch(() => '')
      throw new HttpError(response.statusCode, text.slice(0, 200) || (response as { statusMessage?: string }).statusMessage || 'request failed')
    }
    if (response.statusCode === 204) {
      await response.body.dump().catch(() => {})
      return {}
    }
    let text: string
    try {
      text = await response.body.text()
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error))
    }
    if (!text) return {}
    try {
      return JSON.parse(text)
    } catch {
      // 坏 JSON 是确定性失败（服务端异常页等），归一为 HttpError 防止被网络重试。
      throw new HttpError(response.statusCode, `invalid JSON response: ${text.slice(0, 80)}`)
    }
  }
}
