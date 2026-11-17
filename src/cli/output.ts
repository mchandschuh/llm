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
  console.error(JSON.stringify({ status: 'input_invalid', errors: [{ code: 'REQUEST_INVALID', phase: 'request', message: 'The request file could not be read or parsed.' }] }));
  return 1;
}

export function printUsageError(): number {
  console.error(JSON.stringify({ status: 'input_invalid', errors: [{ code: 'REQUEST_INVALID', phase: 'request', message: 'Usage: llm <request.json> | llm -p <prompt> | llm -c <prompt> | llm <prompt>' }] }));
  return 2;
}