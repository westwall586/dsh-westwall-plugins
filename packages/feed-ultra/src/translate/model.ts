import type { ModelChoice } from '../contract/types.ts';
import type { PromptRequest } from './prompt.ts';

/**
 * The subset of the Host `llm` service this plugin uses, declared structurally:
 * `@deepseek-ai/dsh-llm` is not a package dependency of this plugin.
 */
export interface LlmTextContent {
  type: 'text';
  text: string;
}

export interface LlmMessage {
  role: 'user';
  content: readonly LlmTextContent[];
}

export interface LlmCallOptions {
  provider: string;
  model: string;
  messages: readonly LlmMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  purpose?: string;
  reasoningEffort?: string;
  signal?: AbortSignal;
}

export interface LlmFailure {
  code?: string;
  message?: string;
}

export interface LlmFinishReason {
  kind: string;
  failure?: LlmFailure;
}

export interface LlmStreamChunk {
  type: string;
  text?: string;
  block?: { type: string; text?: string };
  reason?: LlmFinishReason;
}

export interface LlmTranslateService {
  stream(options: LlmCallOptions): AsyncIterable<LlmStreamChunk>;
}

export type ResolvedModelChoice = { choice: ModelChoice } | { error: string };

const NO_DEFAULT_MODEL = '无法读取默认模型';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** An explicit choice is used as-is; the catalog is not a routing whitelist. */
export function resolveModelChoice(
  explicit: ModelChoice | null,
  readDefault: () => ModelChoice | null,
): ResolvedModelChoice {
  if (explicit !== null) return { choice: explicit };
  try {
    const fallback = readDefault();
    return fallback === null ? { error: NO_DEFAULT_MODEL } : { choice: fallback };
  } catch (error) {
    return { error: `${NO_DEFAULT_MODEL}：${errorText(error)}` };
  }
}

function failureText(failure: LlmFailure | undefined): string {
  if (failure?.message !== undefined && failure.message !== '') return failure.message;
  if (failure?.code !== undefined && failure.code !== '') return failure.code;
  return '模型调用失败';
}

/** The only place a translation request reaches a provider. */
export async function callModel(input: {
  llm: LlmTranslateService | null;
  choice: ModelChoice;
  request: PromptRequest;
  signal: AbortSignal;
}): Promise<string> {
  const { llm, choice, request, signal } = input;
  if (llm === null) throw new Error('模型服务不可用');

  const options: LlmCallOptions = {
    provider: choice.provider,
    model: choice.model,
    system: request.system,
    messages: [{ role: 'user', content: [{ type: 'text', text: request.user }] }],
    temperature: 0,
    maxTokens: 2000,
    purpose: 'feedUltra.translate',
    ...(choice.reasoningEffort === undefined ? {} : { reasoningEffort: choice.reasoningEffort }),
    signal,
  };

  let text = '';
  let finish: LlmFinishReason | undefined;

  for await (const chunk of llm.stream(options)) {
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      text += chunk.text;
    } else if (chunk.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') {
      // Delta-only streams are the common case; a block-complete stream still has to be readable.
      if (text === '') text = chunk.block.text;
    } else if (chunk.type === 'finish') {
      finish = chunk.reason;
    }
  }

  if (finish?.kind === 'aborted') throw new Error('翻译已取消');
  if (finish?.kind === 'error') throw new Error(failureText(finish.failure));
  return text;
}
