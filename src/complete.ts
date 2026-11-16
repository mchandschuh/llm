import { composeCorrectionPrompt, composeRequestPrompt } from './prompt.js';
import { OpenRouterProvider } from './provider.js';
import { assertMatchesSchema, parseSchema, validateResponse } from './schema.js';
import { boundedMessage, errorFromFailure, LlmFailure } from './errors.js';
import { normalizeRequest } from './normalize.js';
import type { CompletionOptions, LlmAssistantMessage, LlmError, LlmOutput, LlmRequest, LlmResponse, LlmProvider, LlmToolMessage, LlmChatMessage, NormalizedRequest, ProviderCompletionResponse, ToolCall, ToolCalls, ToolResult } from './types.js';
import { RESPONSE_SCHEMA } from './types.js';
import { LlmFailure as Failure } from './errors.js';
import { emitDebug } from './debug.js';

function response(status: LlmResponse['status'], output: LlmOutput | null, failedAttempts: number, iterations: number, errors: readonly LlmError[]): LlmResponse {
  const result: LlmResponse = { schema: RESPONSE_SCHEMA, status, output, failedAttempts, iterations, toolRounds: 0, toolCalls: 0, toolResults: [], errors: errors.slice(0, 10) };
  validateResponse(result);
  return result;
}

function outputFromText(text: string, schema: ReturnType<typeof parseSchema> | undefined, source: NormalizedRequest['outputSchema']): LlmOutput {
  if (!schema) return { $type: 'string', schema: null, value: text };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LlmFailure('OUTPUT_JSON_INVALID', 'output-parsing', 'Provider output was not valid JSON.');
  }
  assertMatchesSchema(parsed, schema, 'OUTPUT_SCHEMA_VALIDATION_FAILED', 'output-validation');
  const type = Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed;
  return { $type: type, schema: { name: schema.name, ...(schema.path ? { path: schema.path } : {}) }, value: parsed };
}

function failureStatus(failure: LlmFailure): LlmResponse['status'] {
  if (failure.code === 'REQUEST_INVALID' || failure.code === 'TASK_SCHEMA_VALIDATION_FAILED') return 'input_invalid';
  if (failure.code === 'SOURCE_RESOLUTION_FAILED' || failure.code === 'CONFIGURATION_INVALID') return 'configuration_error';
  if (failure.code === 'OUTPUT_JSON_INVALID' || failure.code === 'OUTPUT_SCHEMA_VALIDATION_FAILED' || failure.code === 'OUTPUT_INVALID') return 'output_invalid';
  return 'provider_error';
}

function validationMessages(failure: LlmFailure): string[] {
  return [boundedMessage(failure.message)];
}

function toolResponse(status: LlmResponse['status'], output: LlmResponse['output'], failedAttempts: number, iterations: number, toolRounds: number, toolCalls: number, toolResults: readonly ToolResult[], errors: readonly LlmError[]): LlmResponse {
  const result: LlmResponse = { schema: RESPONSE_SCHEMA, status, output, failedAttempts, iterations, toolRounds, toolCalls, toolResults: toolResults.slice(0, 128), errors: errors.slice(0, 10) };
  validateResponse(result);
  return result;
}

function toolAwareOutput(value: { readonly output: unknown; readonly tool_calls: ToolCalls }): LlmResponse['output'] {
  return { $type: 'object', schema: { name: 'https://schemas.handschuh.dev/llm/output' }, value };
}

function toolFailure(code: string, message: string, phase: LlmError['phase'] = 'tool-validation'): LlmError {
  return { code: code as LlmError['code'], message: boundedMessage(message), phase };
}

function toolCallCount(calls: ToolCalls): number {
  return calls.reduce((total, batch) => total + batch.length, 0);
}

function initialMessages(request: NormalizedRequest, prompt: string): LlmChatMessage[] {
  return [
    { role: 'system', content: request.systemPrompt.value },
    { role: 'user', content: prompt },
    ...request.messages,
  ];
}

function assistantMessage(providerResult: ProviderCompletionResponse): LlmAssistantMessage {
  return {
    role: 'assistant',
    content: providerResult.content,
    toolCalls: providerResult.toolCalls.flat(),
  };
}

function toolMessage(call: ToolCall, result: ToolResult): LlmToolMessage {
  const content = result.status === 'error'
    ? JSON.stringify({ error: { code: result.error?.code ?? 'TOOL_INVOCATION_FAILED', message: boundedMessage(result.error?.message ?? 'The tool invocation failed.').slice(0, 400) } })
    : JSON.stringify(result.value);
  return {
    role: 'tool',
    toolCallId: call.id,
    content,
  };
}

function emitMessage(options: CompletionOptions, message: LlmChatMessage): void {
  try {
    options.messageSink?.(message);
  } catch {
    // Session history observers must not change completion behavior.
  }
}

function validateToolCalls(request: NormalizedRequest, calls: ToolCalls, completedRounds: number): void {
  if (!request.toolOptions) throw new Failure('TOOL_CALL_INVALID', 'tool-validation', 'Tool calls require toolOptions.');
  if (completedRounds + calls.length > request.toolOptions.maxRounds) throw new Failure('TOOL_CALL_INVALID', 'tool-validation', 'The tool-round limit would be exceeded; the response is unvalidated and no tool calls may execute.');
  const definitions = new Map(request.toolOptions.tools.map((tool) => [tool.name, tool]));
  const ids = new Set<string>();
  for (const batch of calls) {
    if (batch.length === 0) throw new Failure('TOOL_CALL_INVALID', 'tool-validation', 'A parallel tool call batch must contain at least one call.');
    for (const call of batch) {
      if (ids.has(call.id)) throw new Failure('TOOL_CALL_INVALID', 'tool-validation', 'Tool call identifiers must be unique.');
      ids.add(call.id);
      const definition = definitions.get(call.name);
      if (!definition) throw new Failure('TOOL_CALL_INVALID', 'tool-validation', `The model requested undeclared tool '${call.name}'.`);
      if (!call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) throw new Failure('TOOL_CALL_INVALID', 'tool-validation', `Tool '${call.name}' arguments must be an object.`);
      const schema = parseSchema(definition.inputSchema);
      assertMatchesSchema(call.arguments, schema, 'TOOL_SCHEMA_VALIDATION_FAILED', 'tool-validation');
    }
  }
}

function resultForCall(call: ToolCall, result: unknown): ToolResult {
  return { callId: call.id, name: call.name, status: 'success', value: result };
}

async function invokeParallelToolBatch(request: NormalizedRequest, options: CompletionOptions, batch: readonly ToolCall[], round: number, batchIndex: number): Promise<ToolResult[]> {
  if (!options.toolInvoker) throw new Failure('CONFIGURATION_INVALID', 'configuration', 'autoInvoke requires an injected ToolInvoker.');
  const signal = options.signal ?? new AbortController().signal;
  emitDebug(options.debug, 'llm.tool.batch.start', { round, batchIndex, callIds: batch.map((call) => call.id) });
  const results = await Promise.all(batch.map(async (call) => {
    emitDebug(options.debug, 'llm.tool.call', { round, batchIndex, callId: call.id, toolName: call.name, arguments: call.arguments });
    if (signal.aborted) return undefined;
    try {
      const result = await options.toolInvoker!.invoke(call, { callId: call.id, toolName: call.name, round, batchIndex, signal });
      const toolResult = resultForCall(call, result);
      emitDebug(options.debug, 'llm.tool.result', toolResult);
      return toolResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The tool invocation failed.';
      const toolResult = { callId: call.id, name: call.name, status: 'error' as const, error: { code: 'TOOL_INVOCATION_FAILED', message: boundedMessage(message) } };
      emitDebug(options.debug, 'llm.tool.result', toolResult);
      return toolResult;
    }
  }));
  const settledResults = results.filter((result): result is ToolResult => result !== undefined);
  emitDebug(options.debug, 'llm.tool.batch.end', { round, batchIndex, callIds: settledResults.map((result) => result.callId), resultStatuses: settledResults.map((result) => result.status) });
  return settledResults;
}

function cancelledResponse(completedToolResults: readonly ToolResult[], failedAttempts: number, iterations: number, toolRounds: number, toolCalls: number): LlmResponse {
  return toolResponse('cancelled', null, failedAttempts, iterations, toolRounds, toolCalls, completedToolResults, [toolFailure('CANCELLED', 'The completion was cancelled.', 'cancellation')]);
}

function observeCancellation(options: CompletionOptions, phase: string, iterations: number, toolRounds: number, toolCalls: number): void {
  emitDebug(options.debug, 'llm.cancel.observed', { phase, iterations, toolRounds, toolCalls });
}

function completeCancellation(options: CompletionOptions, phase: string, iterations: number, toolRounds: number, toolCalls: number): void {
  emitDebug(options.debug, 'llm.cancelled', { phase, iterations, toolRounds, toolCalls });
}

async function completeToolInternalImpl(request: LlmRequest | unknown, options: CompletionOptions = {}): Promise<LlmResponse> {
  let normalized: NormalizedRequest;
  try {
    normalized = await normalizeRequest(request, options);
    if (normalized.taskSchema) {
      const schema = parseSchema(normalized.taskSchema);
      assertMatchesSchema(normalized.task, schema, 'TASK_SCHEMA_VALIDATION_FAILED', 'request');
    }
    if (normalized.outputSchema) parseSchema(normalized.outputSchema);
  } catch (error) {
    const failure = error instanceof Failure ? error : new Failure('REQUEST_INVALID', 'request', 'Request preparation failed.');
    return toolResponse(failureStatus(failure), null, 0, 0, 0, 0, [], [errorFromFailure(failure)]);
  }
  const provider = options.provider ?? new OpenRouterProvider();
  if (!normalized.toolOptions) return response('configuration_error', null, 0, 0, [toolFailure('CONFIGURATION_INVALID', 'toolOptions is required for tool completion.', 'configuration')]);
  if (normalized.toolOptions.autoInvoke && !options.toolInvoker) return toolResponse('configuration_error', null, 0, 0, 0, 0, [], [toolFailure('CONFIGURATION_INVALID', 'autoInvoke requires an injected ToolInvoker.', 'configuration')]);
  let failedAttempts = 0;
  let iterations = 0;
  let toolRounds = 0;
  let totalToolCalls = 0;
  let prompt = composeRequestPrompt(normalized as unknown as NormalizedRequest);
  const messages = initialMessages(normalized, prompt);
  let toolResults: ToolResult[] = [];
  const completedToolResults: ToolResult[] = [];
  const outputSchema = normalized.outputSchema ? parseSchema(normalized.outputSchema) : undefined;
  while (iterations < normalized.maxIterations) {
    if (options.signal?.aborted) {
      observeCancellation(options, 'before-provider-request', iterations, toolRounds, totalToolCalls);
      const result = cancelledResponse(completedToolResults, failedAttempts, iterations, toolRounds, totalToolCalls);
      completeCancellation(options, 'before-provider-request', iterations, toolRounds, totalToolCalls);
      return result;
    }
    let providerResult: ProviderCompletionResponse;
    try {
      const providerRequest = { provider: normalized.provider, model: normalized.model, thinking: normalized.thinking, systemPrompt: normalized.systemPrompt.value, llmPrompt: prompt, task: normalized.task, taskSchema: normalized.taskSchema, messages: messages.slice(), files: normalized.files, credentials: normalized.credentials, signal: options.signal, toolOptions: normalized.toolOptions, toolResults };
      emitDebug(options.debug, 'llm.request', request);
      emitDebug(options.debug, 'llm.provider.request', providerRequest);
      providerResult = await provider.complete(providerRequest);
      emitDebug(options.debug, 'llm.provider.response', providerResult);
      iterations += 1;
      if (options.signal?.aborted) {
        observeCancellation(options, 'after-provider-response', iterations, toolRounds, totalToolCalls);
        const result = cancelledResponse(completedToolResults, failedAttempts, iterations, toolRounds, totalToolCalls);
        completeCancellation(options, 'after-provider-response', iterations, toolRounds, totalToolCalls);
        return result;
      }
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        observeCancellation(options, 'provider-abort', iterations, toolRounds, totalToolCalls);
        const result = cancelledResponse(completedToolResults, failedAttempts, iterations, toolRounds, totalToolCalls);
        completeCancellation(options, 'provider-abort', iterations, toolRounds, totalToolCalls);
        return result;
      }
      const failure = error instanceof Failure ? error : new Failure('PROVIDER_REQUEST_FAILED', 'provider', 'The provider request failed before a usable response was returned.');
      failedAttempts += 1;
      if (failedAttempts >= normalized.maxFailedAttempts) return toolResponse('attempts_exhausted', null, failedAttempts, iterations, toolRounds, totalToolCalls, completedToolResults, [errorFromFailure(new Failure('ATTEMPTS_EXHAUSTED', 'retry', 'The provider failure-attempt limit was exhausted.'))]);
      continue;
    }
    const calls: ToolCalls = providerResult.toolCalls;
    if (providerResult.decision !== 'continue' && providerResult.decision !== 'stop') {
      const failure = new Failure('PROVIDER_REQUEST_FAILED', 'provider', 'The provider returned a missing or unsupported completion decision.');
      return toolResponse('provider_error', null, failedAttempts, iterations, toolRounds, totalToolCalls, completedToolResults, [errorFromFailure(failure)]);
    }
    if (providerResult.decision === 'continue') {
      if (calls.length === 0) {
        const failure = new Failure('PROVIDER_REQUEST_FAILED', 'provider', 'The provider selected continuation without returning tool calls.');
        return toolResponse('provider_error', null, failedAttempts, iterations, toolRounds, totalToolCalls, completedToolResults, [errorFromFailure(failure)]);
      }
      try { validateToolCalls(normalized, calls, toolRounds); } catch (error) {
        const failure = error instanceof Failure ? error : new Failure('TOOL_CALL_INVALID', 'tool-validation', 'The provider tool-call response was not validated.');
        return toolResponse(failure.message.includes('round limit') ? 'unvalidated' : 'output_invalid', null, failedAttempts, iterations, toolRounds, totalToolCalls, completedToolResults, [errorFromFailure(failure)]);
      }
      const count = toolCallCount(calls);
      if (totalToolCalls + count > normalized.toolOptions.maxCalls) return toolResponse('unvalidated', null, failedAttempts, iterations, toolRounds, totalToolCalls, completedToolResults, [toolFailure('TOOL_CALL_INVALID', 'The tool-call count would exceed the configured limit.')]);
      totalToolCalls += count;
      const assistant = assistantMessage(providerResult);
      messages.push(assistant);
      emitMessage(options, assistant);
      if (!normalized.toolOptions.autoInvoke) return toolResponse('tool_calls_pending', toolAwareOutput({ output: null, tool_calls: calls }), failedAttempts, iterations, toolRounds, totalToolCalls, completedToolResults, []);
      toolResults = [];
      for (let batchIndex = 0; batchIndex < calls.length; batchIndex += 1) {
        if (options.signal?.aborted) {
          observeCancellation(options, 'before-tool-batch', iterations, toolRounds, totalToolCalls);
          const result = cancelledResponse(completedToolResults, failedAttempts, iterations, toolRounds, totalToolCalls);
          completeCancellation(options, 'before-tool-batch', iterations, toolRounds, totalToolCalls);
          return result;
        }
        const batchResults = await invokeParallelToolBatch(normalized, options, calls[batchIndex]!, toolRounds, batchIndex);
        toolResults.push(...batchResults);
        for (const [index, result] of batchResults.entries()) {
          const call = calls[batchIndex]![index];
          if (call) {
            const message = toolMessage(call, result);
            messages.push(message);
            emitMessage(options, message);
          }
        }
      }
      completedToolResults.push(...toolResults);
      if (options.signal?.aborted) {
        observeCancellation(options, 'after-tool-batch', iterations, toolRounds, totalToolCalls);
        const result = cancelledResponse(completedToolResults, failedAttempts, iterations, toolRounds, totalToolCalls);
        completeCancellation(options, 'after-tool-batch', iterations, toolRounds, totalToolCalls);
        return result;
      }
      toolRounds += calls.length;
      prompt = composeRequestPrompt(normalized as unknown as NormalizedRequest);
      continue;
    }
    if (calls.length > 0) {
      const failure = new Failure('PROVIDER_REQUEST_FAILED', 'provider', 'The provider selected final completion while returning tool calls.');
      return toolResponse('provider_error', null, failedAttempts, iterations, toolRounds, totalToolCalls, completedToolResults, [errorFromFailure(failure)]);
    }
    try {
      const text = providerResult.content ?? '';
      if (!outputSchema) {
        emitMessage(options, { role: 'assistant', content: text, toolCalls: [] });
        return toolResponse('success', { $type: 'string', schema: null, value: text }, failedAttempts, iterations, toolRounds, totalToolCalls, completedToolResults, []);
      }
      const parsed = JSON.parse(text) as unknown;
      assertMatchesSchema(parsed, outputSchema, 'OUTPUT_SCHEMA_VALIDATION_FAILED', 'output-validation');
      emitMessage(options, { role: 'assistant', content: text, toolCalls: [] });
      return toolResponse('success', toolAwareOutput({ output: parsed, tool_calls: [] }), failedAttempts, iterations, toolRounds, totalToolCalls, completedToolResults, []);
    } catch (error) {
      const failure = error instanceof Failure ? error : new Failure('OUTPUT_INVALID', 'output-validation', 'Provider output did not satisfy the configured output schema.');
      if (iterations >= normalized.maxIterations) return toolResponse('output_invalid', null, failedAttempts, iterations, toolRounds, totalToolCalls, completedToolResults, [errorFromFailure(failure)]);
      prompt = composeCorrectionPrompt(normalized as unknown as NormalizedRequest, providerResult.content ?? '', validationMessages(failure));
    }
  }
  return toolResponse('output_invalid', null, failedAttempts, iterations, toolRounds, totalToolCalls, completedToolResults, [toolFailure('OUTPUT_INVALID', 'Provider output did not satisfy the configured output schema.', 'output-validation')]);
}

async function completeToolInternal(request: LlmRequest | unknown, options: CompletionOptions = {}): Promise<LlmResponse> {
  const result = await completeToolInternalImpl(request, options);
  emitDebug(options.debug, 'llm.response', result);
  return result;
}

async function completeV1Internal(request: LlmRequest | unknown, options: CompletionOptions = {}): Promise<LlmResponse> {
  let normalized: NormalizedRequest;
  try {
    normalized = await normalizeRequest(request, options);
    if (normalized.taskSchema) {
      const schema = parseSchema(normalized.taskSchema);
      assertMatchesSchema(normalized.task, schema, 'TASK_SCHEMA_VALIDATION_FAILED', 'request');
    }
    if (normalized.outputSchema) parseSchema(normalized.outputSchema);
  } catch (error) {
    const failure = error instanceof LlmFailure ? error : new LlmFailure('REQUEST_INVALID', 'request', 'Request preparation failed.');
    const result = response(failureStatus(failure), null, 0, 0, [errorFromFailure(failure)]);
    emitDebug(options.debug, 'llm.response', result);
    return result;
  }

  const provider: LlmProvider = options.provider ?? new OpenRouterProvider();
  if (!options.provider && normalized.provider !== 'openrouter') {
    const result = response('configuration_error', null, 0, 0, [errorFromFailure(new LlmFailure('CONFIGURATION_INVALID', 'configuration', `No provider adapter is registered for ${normalized.provider}.`))]);
    emitDebug(options.debug, 'llm.response', result);
    return result;
  }
  const outputSchema = normalized.outputSchema ? parseSchema(normalized.outputSchema) : undefined;
  let failedAttempts = 0;
  let iterations = 0;
  let prompt = composeRequestPrompt(normalized);
  let lastOutputFailure: LlmFailure | undefined;

  while (iterations < normalized.maxIterations) {
    let raw: string;
    try {
      const providerRequest = { provider: normalized.provider, model: normalized.model, thinking: normalized.thinking, systemPrompt: normalized.systemPrompt.value, llmPrompt: prompt, task: normalized.task, taskSchema: normalized.taskSchema, messages: initialMessages(normalized, prompt), files: normalized.files, credentials: normalized.credentials, signal: options.signal };
      emitDebug(options.debug, 'llm.request', request);
      emitDebug(options.debug, 'llm.provider.request', providerRequest);
      raw = (await provider.complete(providerRequest)).content ?? '';
      emitDebug(options.debug, 'llm.provider.response', raw);
      iterations += 1;
    } catch (error) {
      const failure = error instanceof LlmFailure ? error : new LlmFailure('PROVIDER_REQUEST_FAILED', 'provider', 'The provider request failed before a usable response was returned.');
      failedAttempts += 1;
      if (failedAttempts >= normalized.maxFailedAttempts) {
        const result = response('attempts_exhausted', null, failedAttempts, iterations, [errorFromFailure(new LlmFailure('ATTEMPTS_EXHAUSTED', 'retry', 'The provider failure-attempt limit was exhausted.'))]);
        emitDebug(options.debug, 'llm.response', result);
        return result;
      }
      continue;
    }
    try {
  const result = response('success', outputFromText(raw, outputSchema, normalized.outputSchema), failedAttempts, iterations, []);
      emitDebug(options.debug, 'llm.response', result);
      return result;
    } catch (error) {
      const failure = error instanceof LlmFailure ? error : new LlmFailure('OUTPUT_INVALID', 'output-validation', 'Provider output did not satisfy the configured output schema.');
      lastOutputFailure = failure;
      if (!outputSchema || iterations >= normalized.maxIterations) break;
      prompt = composeCorrectionPrompt(normalized, raw, validationMessages(failure));
    }
  }

  const failure = lastOutputFailure ?? new LlmFailure('OUTPUT_INVALID', 'output-validation', 'Provider output did not satisfy the configured output schema.');
  const result = response('output_invalid', null, failedAttempts, iterations, [errorFromFailure(failure)]);
  emitDebug(options.debug, 'llm.response', result);
  return result;
}

export async function complete(request: LlmRequest | unknown, options: CompletionOptions = {}): Promise<LlmResponse> {
  if (request && typeof request === 'object' && 'toolOptions' in request && (request as { toolOptions?: unknown }).toolOptions !== undefined) {
    return completeToolInternal(request, options);
  }
  return completeV1Internal(request, options);
}
