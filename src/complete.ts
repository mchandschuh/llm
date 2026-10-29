import { composeCorrectionPrompt, composeRequestPrompt } from './prompt.js';
import { OpenRouterProvider } from './provider.js';
import { assertMatchesSchema, parseSchema, parseTaskJson, validateResponse } from './schema.js';
import { boundedMessage, errorFromFailure, LlmFailure } from './errors.js';
import { normalizeRequest } from './normalize.js';
import type { CompletionOptions, LlmError, LlmOutput, LlmRequest, LlmResponse, LlmProvider, NormalizedRequest } from './types.js';
import { RESPONSE_SCHEMA } from './types.js';

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

export async function complete(request: LlmRequest | unknown, options: CompletionOptions = {}): Promise<LlmResponse> {
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
      raw = await provider.complete({ provider: normalized.provider, model: normalized.model, thinking: normalized.thinking, systemPrompt: normalized.systemPrompt.value, llmPrompt: prompt, credentials: normalized.credentials });
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
