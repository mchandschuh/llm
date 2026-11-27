import { rm } from 'node:fs/promises';
import { resolveRequestsDirectory } from './requests-config.js';
import { loadRequestDirectory, type RequestDirectoryAssets } from './request-directory.js';
import { constructRequestParameters } from './request-parameters.js';
import { materializeParameterFiles } from './request-parameter-files.js';
import { runParameterValidators } from './request-parameter-validation.js';
import { substituteRequestVariables } from './request-variables.js';
import { complete } from './complete.js';
import { normalizeRequest } from './normalize.js';
import { composeRequestPrompt } from './prompt.js';
import { OpenRouterProvider } from './provider.js';
import { parseSchema, assertMatchesSchema } from './schema.js';
import { boundedMessage, LlmFailure } from './errors.js';
import type {
  CompleteRequestOptions,
  JsonObject,
  LlmRequest,
  LlmProvider,
  ProviderCompletionRequest,
  ProviderCompletionResponse,
} from './types.js';

function requestFailure(message: string): LlmFailure {
  return new LlmFailure('CONFIGURATION_INVALID', 'configuration', boundedMessage(`The dynamic request could not be completed. ${message}`));
}

function replaceValue(value: unknown, parameters: JsonObject): unknown {
  if (typeof value === 'string') return substituteRequestVariables(value, parameters);
  if (Array.isArray(value)) return value.map((item) => replaceValue(item, parameters));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceValue(child, parameters)]));
  }
  return value;
}

function replaceAsset<T>(asset: { readonly path: string; readonly value: T } | undefined, parameters: JsonObject): T | undefined {
  return asset === undefined ? undefined : replaceValue(asset.value, parameters) as T;
}

function requestSettings(defaults: JsonObject | undefined, overrides: CompleteRequestOptions['settings'] = {}): Pick<LlmRequest, 'provider' | 'model' | 'thinking' | 'maxFailedAttempts' | 'maxIterations'> {
  const value = { ...(defaults ?? {}), ...overrides };
  const provider = value.provider;
  const model = value.model;
  const thinking = value.thinking;
  const maxFailedAttempts = value.maxFailedAttempts;
  const maxIterations = value.maxIterations;
  if (provider !== undefined && typeof provider !== 'string') throw requestFailure('defaults.provider must be a string.');
  if (model !== undefined && typeof model !== 'string') throw requestFailure('defaults.model must be a string.');
  if (thinking !== undefined && !['minimal', 'low', 'medium', 'high', 'xhigh'].includes(String(thinking))) throw requestFailure('defaults.thinking is invalid.');
  if (maxFailedAttempts !== undefined && (typeof maxFailedAttempts !== 'number' || !Number.isInteger(maxFailedAttempts) || maxFailedAttempts < 0 || maxFailedAttempts > 10)) throw requestFailure('defaults.maxFailedAttempts is invalid.');
  if (maxIterations !== undefined && (typeof maxIterations !== 'number' || !Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10)) throw requestFailure('defaults.maxIterations is invalid.');
  return {
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(thinking === undefined ? {} : { thinking: thinking as LlmRequest['thinking'] }),
    ...(typeof maxFailedAttempts !== 'number' ? {} : { maxFailedAttempts }),
    ...(typeof maxIterations !== 'number' ? {} : { maxIterations }),
  };
}

function taskAndSchemas(assets: RequestDirectoryAssets, parameters: JsonObject): Pick<LlmRequest, 'task' | 'systemPrompt' | 'taskSchema' | 'outputSchema'> {
  const task = replaceValue(assets.task.value, parameters);
  const systemPrompt = assets.systemPrompt === undefined ? null : substituteRequestVariables(assets.systemPrompt.value, parameters);
  const taskSchema = replaceAsset(assets.taskSchema, parameters);
  const outputSchema = replaceAsset(assets.outputSchema, parameters);
  if (!task || (typeof task !== 'string' && (typeof task !== 'object' || Array.isArray(task)))) throw requestFailure('The substituted task is invalid.');
  if (taskSchema !== undefined) {
    try {
      const loaded = parseSchema(taskSchema, assets.taskSchema?.path);
      assertMatchesSchema(task, loaded, 'TASK_SCHEMA_VALIDATION_FAILED', 'request');
    } catch (error) {
      if (error instanceof LlmFailure) throw error;
      throw requestFailure('The substituted task does not satisfy taskSchema.');
    }
  }
  if (outputSchema !== undefined) parseSchema(outputSchema, assets.outputSchema?.path);
  return {
    task: task as LlmRequest['task'],
    systemPrompt,
    ...(taskSchema === undefined ? {} : { taskSchema }),
    ...(outputSchema === undefined ? {} : { outputSchema }),
  };
}

async function providerFor(options: CompleteRequestOptions): Promise<LlmProvider> {
  return options.provider ?? new OpenRouterProvider();
}

/**
 * Resolve one request bundle and make exactly one raw provider delegation.
 * Runtime retries, output correction, and terminal response envelopes remain
 * owned by `complete`; this boundary returns the provider-neutral raw result.
 */
export async function completeRequest(options: CompleteRequestOptions): Promise<ProviderCompletionResponse> {
  const requestsDirectory = options.requestsDirectory ?? await resolveRequestsDirectory({ applicationSourceDirectory: options.configurationRoot });
  const loaded = await loadRequestDirectory(requestsDirectory, options.requestName);
  const defaults = replaceAsset(loaded.assets.defaults, {}) as JsonObject | undefined;
  const parameters = constructRequestParameters({
    schema: loaded.assets.parametersSchema?.value,
    schemaPath: loaded.assets.parametersSchema?.path,
    defaults: defaults?.parameters && typeof defaults.parameters === 'object' && !Array.isArray(defaults.parameters) ? defaults.parameters as JsonObject : undefined,
    parameters: options.parameters,
    assignments: options.assignments,
    schemaRoots: [requestsDirectory],
  });
  await runParameterValidators(loaded.assets.parametersSchema?.value, parameters, {
    name: options.requestName,
    directory: loaded.requestDirectory,
  });
  const declaredFiles = await materializeParameterFiles(loaded.assets.parametersSchema?.value, parameters);
  try {
    const request: LlmRequest = {
      schema: 'https://schemas.handschuh.dev/llm/request/v1',
      ...requestSettings(defaults, options.settings),
      ...taskAndSchemas(loaded.assets, parameters),
    };
    const normalized = await normalizeRequest(request, {
      configurationRoot: loaded.requestDirectory,
      files: [...declaredFiles.files, ...(options.files ?? [])],
    });
    const provider = await providerFor(options);
    if (provider.validate) {
      const validation = await provider.validate({ provider: normalized.provider, credentials: normalized.credentials });
      if (!validation.success) throw requestFailure(validation.errors[0]?.message ?? 'Provider configuration validation failed.');
    }
    const providerRequest: ProviderCompletionRequest = {
      provider: normalized.provider,
      model: normalized.model,
      thinking: normalized.thinking,
      ...(normalized.systemPrompt.value === null ? {} : { systemPrompt: normalized.systemPrompt.value }),
      llmPrompt: composeRequestPrompt(normalized),
      task: normalized.task,
      ...(normalized.taskSchema === undefined ? {} : { taskSchema: normalized.taskSchema }),
      ...(normalized.outputSchema === undefined ? {} : { outputSchema: normalized.outputSchema }),
      messages: normalized.messages,
      files: normalized.files,
      ...(normalized.credentials === undefined ? {} : { credentials: normalized.credentials }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
    return await provider.complete(providerRequest);
  } finally {
    if (declaredFiles.temporaryRoot !== undefined) {
      await rm(declaredFiles.temporaryRoot, { recursive: true, force: true });
    }
  }
}