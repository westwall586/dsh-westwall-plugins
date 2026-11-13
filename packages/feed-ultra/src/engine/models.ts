import type { ModelChoice } from '../contract/types.ts';
import type { ModelEffortsView, ModelEntryView, ModelsView, ModelProviderView } from '../contract/views.ts';

/**
 * The subset of the Host `llm` service this plugin uses. Declared structurally on purpose:
 * `@deepseek-ai/dsh-llm` is not a package dependency of this plugin, and the shapes below
 * mirror the Host Service contract (`listProviders` / `listModels` / `resolveModelInfo`).
 */
export interface LlmProviderInfo {
  id: string;
  name: string;
}

export interface LlmModelInfo {
  provider: string;
  id: string;
  name: string;
}

export interface LlmReasoningEffortInfo {
  id: string;
  name: string;
  description?: string;
}

export interface LlmResolvedModelInfo {
  provider: string;
  id: string;
  name: string;
  reasoning?: {
    efforts: readonly LlmReasoningEffortInfo[];
    defaultEffort?: string;
  };
}

export interface LlmLike {
  listProviders(): readonly LlmProviderInfo[] | Promise<readonly LlmProviderInfo[]>;
  listModels(provider: string): Promise<readonly LlmModelInfo[]>;
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
}

export interface DefaultModelLike {
  currentSelection(): ModelChoice;
}

export interface ModelInputs {
  llm: LlmLike | null;
  /** True when the config has no explicit model and follows the DSH default. */
  following: boolean;
  /** Reads the current DSH default selection; may throw when the service is absent or unreadable. */
  readDefault(): ModelChoice | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const LLM_UNAVAILABLE = 'llm service is unavailable';

/**
 * One call for the whole picker. The client cannot reach `agentDefaultModel` remotely,
 * so the host resolves the effective selection here instead of leaking two namespaces.
 */
export async function collectModels(input: ModelInputs): Promise<ModelsView> {
  const { llm, following } = input;

  let selected: ModelChoice | null = null;
  let error = '';
  try {
    selected = input.readDefault();
  } catch (failure) {
    error = errorText(failure);
  }

  if (llm === null) {
    return { providers: [], models: {}, selected, following, error: error || LLM_UNAVAILABLE };
  }

  try {
    const providers: ModelProviderView[] = (await llm.listProviders()).map((provider) => ({
      id: provider.id,
      name: provider.name || provider.id,
    }));

    const models: Record<string, ModelEntryView[]> = {};
    for (const provider of providers) {
      try {
        models[provider.id] = (await llm.listModels(provider.id)).map((model) => ({
          id: model.id,
          name: model.name || model.id,
        }));
      } catch (failure) {
        // One provider's catalog failing must not blank the whole picker.
        models[provider.id] = [];
        if (error === '') error = errorText(failure);
      }
    }

    return { providers, models, selected, following, error };
  } catch (failure) {
    return { providers: [], models: {}, selected, following, error: error || errorText(failure) };
  }
}

/** Reasoning efforts are resolved lazily, only for the model the user is about to pick. */
export async function collectModelEfforts(
  llm: LlmLike | null,
  provider: string,
  model: string,
): Promise<ModelEffortsView> {
  if (llm === null) return { efforts: [], error: LLM_UNAVAILABLE };

  try {
    const resolved = await llm.resolveModelInfo(provider, model);
    const reasoning = resolved.reasoning;
    if (!reasoning) return { efforts: [], error: '' };

    const efforts = reasoning.efforts.map((effort) => ({
      id: effort.id,
      name: effort.name,
      ...(effort.description === undefined ? {} : { description: effort.description }),
    }));

    return reasoning.defaultEffort === undefined
      ? { efforts, error: '' }
      : { efforts, default: reasoning.defaultEffort, error: '' };
  } catch (failure) {
    return { efforts: [], error: errorText(failure) };
  }
}
