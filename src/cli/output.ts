import { stderrDebugSink } from '../debug.js';
import type { LlmResponse } from '../types.js';
import type { ResponseFormat } from './arguments.js';

export type OutputWriter = (text: string) => void;

const stdoutWriter: OutputWriter = (text) => process.stdout.write(text);
const stderrWriter: OutputWriter = (text) => process.stderr.write(text);

export function debugSink(enabled: boolean) {
  return enabled ? stderrDebugSink() : undefined;
}

export function responseText(response: LlmResponse, format: ResponseFormat, rawOutput?: string): string {
  if (format === 'raw' && response.status === 'success') return rawOutput ?? (response.output?.value as string | undefined) ?? '';
  return JSON.stringify(response, null, 2);
}

export function printResponse(
  response: LlmResponse,
  format: ResponseFormat = 'raw',
  rawOutput?: string,
  write: OutputWriter = stdoutWriter,
  writeError: OutputWriter = stderrWriter,
): number {
  const text = responseText(response, format, rawOutput);
  (response.status === 'success' ? write : writeError)(response.status === 'success' && format === 'raw' ? text : `${text}\n`);
  return response.status === 'success' ? 0 : 1;
}

export function printInputError(writeError: OutputWriter = stderrWriter): number {
  writeError(`${JSON.stringify({ status: 'input_invalid', errors: [{ code: 'REQUEST_INVALID', phase: 'request', message: 'The request file could not be read or parsed.' }] })}\n`);
  return 1;
}

export function printUsageError(message = 'Usage: llm <request.json> | llm -p <prompt> | llm -c <prompt> | llm summarize --path <path> [--provider <provider>] [--model <model>] [--thinking <thinking>] | llm summarize --content <text> [--provider <provider>] [--model <model>] [--thinking <thinking>] | llm <prompt>', writeError: OutputWriter = stderrWriter): number {
  writeError(`${JSON.stringify({ status: 'input_invalid', errors: [{ code: 'REQUEST_INVALID', phase: 'request', message }] })}\n`);
  return 2;
}