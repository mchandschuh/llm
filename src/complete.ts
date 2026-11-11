import { composeCorrectionPrompt, composeRequestPrompt } from './prompt.js';
import { OpenRouterProvider } from './provider.js';
import { assertMatchesSchema, parseSchema, parseTaskJson, validateResponse, validateResponseV2 } from './schema.js';
import { boundedMessage, errorFromFailure, LlmFailure } from './errors.js';
import { normalizeRequest } from './normalize.js';
import type { CompletionOptions, CompletionOptionsV2, LlmError, LlmOutput, LlmRequest, LlmRequestV2, LlmResponse, LlmResponseV2, LlmProvider, LlmProviderV2, NormalizedRequest, NormalizedRequestV2, ProviderCompletionResponse, ToolCall, ToolCalls, ToolResult } from './types.js';
import { RESPONSE_SCHEMA, RESPONSE_SCHEMA_V2 } from './types.js';
import { normalizeRequestV2 } from './normalize.js';
import { LlmFailure as Failure } from './errors.js';

function response(status: LlmResponse['status'], output: LlmOutput | null, failedAttempts: number, iterations: number, errors: readonly LlmError[]): LlmResponse {
  const result: LlmResponse = { schema: RESPONSE_SCHEMA, status, output, failedAttempts, iterations, errors: errors.slice(0, 10) };
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

function v2Response(status: LlmResponseV2['status'], output: LlmResponseV2['output'], failedAttempts: number, iterations: number, toolRounds: number, toolCalls: number, errors: readonly LlmError[]): LlmResponseV2 {
  const result: LlmResponseV2 = { schema: RESPONSE_SCHEMA_V2, status, output, failedAttempts, iterations, toolRounds, toolCalls, errors: errors.slice(0, 10) };
  validateResponseV2(result);
  return result;
}

function toolAwareOutput(value: { readonly output: unknown; readonly tool_calls: ToolCalls }): LlmResponseV2['output'] {
  return { $type: 'object', schema: { name: 'https://schemas.handschuh.dev/llm/output/v2' }, value };
}

function toolFailure(code: string, message: string, phase: LlmError['phase'] = 'tool-validation'): LlmError {
  return { code: code as LlmError['code'], message: boundedMessage(message), phase };
}

function toolCallCount(calls: ToolCalls): number {
  return calls.reduce((total, batch) => total + batch.length, 0);
}

function validateToolCalls(request: NormalizedRequestV2, calls: ToolCalls, completedRounds: number): void {
  if (completedRounds + calls.length > request.maxToolRounds) throw new Failure('TOOL_CALL_INVALID', 'tool-validation', 'The tool-round limit would be exceeded; the response is unvalidated and no tool calls may execute.');
  const definitions = new Map(request.tools.map((tool) => [tool.name, tool]));
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

async function invokeParallelToolBatch(request: NormalizedRequestV2, options: CompletionOptionsV2, batch: readonly ToolCall[], round: number, batchIndex: number): Promise<ToolResult[]> {
  if (!options.toolInvoker) throw new Failure('CONFIGURATION_INVALID', 'configuration', 'autoInvokeTools requires an injected ToolInvoker.');
  const signal = options.signal ?? new AbortController().signal;
  return Promise.all(batch.map(async (call) => {
    try {
      const result = await options.toolInvoker!.invoke(call, { callId: call.id, toolName: call.name, round, batchIndex, signal });
      return resultForCall(call, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The tool invocation failed.';
      return { callId: call.id, name: call.name, status: 'error', error: { code: 'TOOL_INVOCATION_FAILED', message: boundedMessage(message) } };
    }
  }));
}

async function completeV2Internal(request: LlmRequestV2 | unknown, options: CompletionOptionsV2 = {}): Promise<LlmResponseV2> {
  let normalized: NormalizedRequestV2;
  try {
    normalized = await normalizeRequestV2(request, options);
    if (normalized.taskSchema) {
      const schema = parseSchema(normalized.taskSchema.value, normalized.taskSchema.path);
      assertMatchesSchema(parseTaskJson(normalized.task.value), schema, 'TASK_SCHEMA_VALIDATION_FAILED', 'request');
    }
    if (normalized.outputSchema) parseSchema(normalized.outputSchema.value, normalized.outputSchema.path);
  } catch (error) {
    const failure = error instanceof Failure ? error : new Failure('REQUEST_INVALID', 'request', 'Request preparation failed.');
    return v2Response(failureStatus(failure) as LlmResponseV2['status'], null, 0, 0, 0, 0, [errorFromFailure(failure)]);
  }
  const provider = options.provider as LlmProviderV2 | undefined ?? new OpenRouterProvider();
  if (typeof provider.completeV2 !== 'function') return v2Response('configuration_error', null, 0, 0, 0, 0, [toolFailure('CONFIGURATION_INVALID', 'The configured provider does not support v2 tool transport.', 'configuration')]);
  if (normalized.autoInvokeTools && !options.toolInvoker) return v2Response('configuration_error', null, 0, 0, 0, 0, [toolFailure('CONFIGURATION_INVALID', 'autoInvokeTools requires an injected ToolInvoker.', 'configuration')]);
  let failedAttempts = 0;
  let iterations = 0;
  let toolRounds = 0;
  let totalToolCalls = 0;
  let prompt = composeRequestPrompt(normalized as unknown as NormalizedRequest);
  let toolResults: ToolResult[] = [];
  const outputSchema = normalized.outputSchema ? parseSchema(normalized.outputSchema.value, normalized.outputSchema.path) : undefined;
  while (iterations < normalized.maxIterations) {
    let providerResult: ProviderCompletionResponse;
    try {
      providerResult = await provider.completeV2({ provider: normalized.provider, model: normalized.model, thinking: normalized.thinking, systemPrompt: normalized.systemPrompt.value, llmPrompt: prompt, files: normalized.files, credentials: normalized.credentials, tools: normalized.tools, toolResults });
      iterations += 1;
    } catch (error) {
      const failure = error instanceof Failure ? error : new Failure('PROVIDER_REQUEST_FAILED', 'provider', 'The provider request failed before a usable response was returned.');
      failedAttempts += 1;
      if (failedAttempts >= normalized.maxFailedAttempts) return v2Response('attempts_exhausted', null, failedAttempts, iterations, toolRounds, totalToolCalls, [errorFromFailure(new Failure('ATTEMPTS_EXHAUSTED', 'retry', 'The provider failure-attempt limit was exhausted.'))]);
      continue;
    }
    const calls: ToolCalls = providerResult.toolCalls;
    if (calls.length > 0) {
      try { validateToolCalls(normalized, calls, toolRounds); } catch (error) {
        const failure = error instanceof Failure ? error : new Failure('TOOL_CALL_INVALID', 'tool-validation', 'The provider tool-call response was not validated.');
        return v2Response(failure.message.includes('round limit') ? 'unvalidated' : 'output_invalid', null, failedAttempts, iterations, toolRounds, totalToolCalls, [errorFromFailure(failure)]);
      }
      const count = toolCallCount(calls);
      if (totalToolCalls + count > normalized.maxToolCalls) return v2Response('unvalidated', null, failedAttempts, iterations, toolRounds, totalToolCalls, [toolFailure('TOOL_CALL_INVALID', 'The tool-call count would exceed the configured limit.')]);
      totalToolCalls += count;
      if (!normalized.autoInvokeTools) return v2Response('tool_calls_pending', toolAwareOutput({ output: null, tool_calls: calls }), failedAttempts, iterations, toolRounds, totalToolCalls, []);
      toolResults = [];
      for (let batchIndex = 0; batchIndex < calls.length; batchIndex += 1) toolResults.push(...await invokeParallelToolBatch(normalized, options, calls[batchIndex]!, toolRounds, batchIndex));
      toolRounds += calls.length;
      prompt = composeRequestPrompt(normalized as unknown as NormalizedRequest);
      continue;
    }
    try {
      const text = providerResult.content ?? '';
      if (!outputSchema) return v2Response('success', { $type: 'string', schema: null, value: text }, failedAttempts, iterations, toolRounds, totalToolCalls, []);
      const parsed = JSON.parse(text) as unknown;
      assertMatchesSchema(parsed, outputSchema, 'OUTPUT_SCHEMA_VALIDATION_FAILED', 'output-validation');
      return v2Response('success', toolAwareOutput({ output: parsed, tool_calls: [] }), failedAttempts, iterations, toolRounds, totalToolCalls, []);
    } catch (error) {
      const failure = error instanceof Failure ? error : new Failure('OUTPUT_INVALID', 'output-validation', 'Provider output did not satisfy the configured output schema.');
      if (iterations >= normalized.maxIterations) return v2Response('output_invalid', null, failedAttempts, iterations, toolRounds, totalToolCalls, [errorFromFailure(failure)]);
    }
  }
  return v2Response('output_invalid', null, failedAttempts, iterations, toolRounds, totalToolCalls, [toolFailure('OUTPUT_INVALID', 'Provider output did not satisfy the configured output schema.', 'output-validation')]);
}

async function completeV1Internal(request: LlmRequest | unknown, options: CompletionOptions = {}): Promise<LlmResponse> {
  let normalized: NormalizedRequest;
  try {
    normalized = await normalizeRequest(request, options);
    if (normalized.taskSchema) {
      const schema = parseSchema(normalized.taskSchema.value, normalized.taskSchema.path);
      assertMatchesSchema(parseTaskJson(normalized.task.value), schema, 'TASK_SCHEMA_VALIDATION_FAILED', 'request');
    }
    if (normalized.outputSchema) parseSchema(normalized.outputSchema.value, normalized.outputSchema.path);
  } catch (error) {
    const failure = error instanceof LlmFailure ? error : new LlmFailure('REQUEST_INVALID', 'request', 'Request preparation failed.');
    return response(failureStatus(failure), null, 0, 0, [errorFromFailure(failure)]);
  }

  const provider: LlmProvider = options.provider ?? new OpenRouterProvider();
  if (!options.provider && normalized.provider !== 'openrouter') {
    return response('configuration_error', null, 0, 0, [errorFromFailure(new LlmFailure('CONFIGURATION_INVALID', 'configuration', `No provider adapter is registered for ${normalized.provider}.`))]);
  }
  const outputSchema = normalized.outputSchema ? parseSchema(normalized.outputSchema.value, normalized.outputSchema.path) : undefined;
  let failedAttempts = 0;
  let iterations = 0;
  let prompt = composeRequestPrompt(normalized);
  let lastOutputFailure: LlmFailure | undefined;

  while (iterations < normalized.maxIterations) {
    let raw: string;
    try {
      raw = await provider.complete({ provider: normalized.provider, model: normalized.model, thinking: normalized.thinking, systemPrompt: normalized.systemPrompt.value, llmPrompt: prompt, files: normalized.files, credentials: normalized.credentials });
      iterations += 1;
    } catch (error) {
      const failure = error instanceof LlmFailure ? error : new LlmFailure('PROVIDER_REQUEST_FAILED', 'provider', 'The provider request failed before a usable response was returned.');
      if (failure.code === 'CONFIGURATION_INVALID') return response('configuration_error', null, failedAttempts, iterations, [errorFromFailure(failure)]);
      failedAttempts += 1;
      if (failedAttempts >= normalized.maxFailedAttempts) {
        return response('attempts_exhausted', null, failedAttempts, iterations, [errorFromFailure(new LlmFailure('ATTEMPTS_EXHAUSTED', 'retry', 'The provider failure-attempt limit was exhausted.'))]);
      }
      continue;
    }
    try {
      return response('success', outputFromText(raw, outputSchema, normalized.outputSchema), failedAttempts, iterations, []);
    } catch (error) {
      const failure = error instanceof LlmFailure ? error : new LlmFailure('OUTPUT_INVALID', 'output-validation', 'Provider output did not satisfy the configured output schema.');
      lastOutputFailure = failure;
      if (!outputSchema || iterations >= normalized.maxIterations) break;
      prompt = composeCorrectionPrompt(normalized, raw, validationMessages(failure));
    }
  }

  const failure = lastOutputFailure ?? new LlmFailure('OUTPUT_INVALID', 'output-validation', 'Provider output did not satisfy the configured output schema.');
  return response('output_invalid', null, failedAttempts, iterations, [errorFromFailure(failure)]);
}

export async function complete(request: LlmRequest | LlmRequestV2 | unknown, options: CompletionOptions | CompletionOptionsV2 = {}): Promise<LlmResponse | LlmResponseV2> {
  if (request && typeof request === 'object' && (request as { schema?: unknown }).schema === 'https://schemas.handschuh.dev/llm/request/v2') {
    return completeV2Internal(request, options as CompletionOptionsV2);
  }
  return completeV1Internal(request, options as CompletionOptions);
}

export async function completeV2(request: LlmRequestV2 | unknown, options: CompletionOptionsV2 = {}): Promise<LlmResponseV2> {
  return completeV2Internal(request, options);
}
