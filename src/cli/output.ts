import { stderrDebugSink } from '../debug.js';
import type { LlmResponse } from '../types.js';

export function debugSink(enabled: boolean) {
  return enabled ? stderrDebugSink() : undefined;
}

export function printResponse(response: LlmResponse): number {
  console.log(JSON.stringify(response, null, 2));
  return response.status === 'success' ? 0 : 1;
}

export function printInputError(): number {
  console.error(JSON.stringify({ status: 'input_invalid', message: 'The request file could not be read or parsed.' }));
  return 1;
}

export function printUsageError(): number {
  console.error('Usage: llm <request.json>');
  return 2;
}