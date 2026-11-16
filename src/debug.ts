import type { AnyLlmRequest, AnyLlmResponse, ProviderCompletionRequest, ProviderCompletionResponse } from './types.js';
import type { LlmFailure } from './errors.js';

export interface DebugEvent {
  readonly event: string;
  readonly timestamp: string;
  readonly data?: unknown;
}

export type DebugSink = (event: DebugEvent) => void;

const SENSITIVE_KEYS = /api.?key|access.?token|authorization|credential|secret|password/i;
const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 40;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') {
    const sanitized = value.replace(/(["'](?:api.?key|access.?token|authorization|credential|secret|password)["']\s*:\s*["'])[^"']*(["'])/gi, '$1[redacted]$2');
    return sanitized.length > MAX_STRING_LENGTH ? `${sanitized.slice(0, MAX_STRING_LENGTH)}…[truncated]` : sanitized;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      result[key] = SENSITIVE_KEYS.test(key) ? '[redacted]' : sanitize(item, depth + 1);
    }
    return result;
  }
  return String(value);
}

export function debugValue(value: unknown): unknown {
  return sanitize(value);
}

export function emitDebug(sink: DebugSink | undefined, event: string, data?: unknown): void {
  if (!sink) return;
  try {
    sink({ event, timestamp: new Date().toISOString(), ...(data === undefined ? {} : { data: debugValue(data) }) });
  } catch {
    // Debug logging must never affect completion behavior.
  }
}

export function debugRequest(request: AnyLlmRequest): unknown {
  return request;
}

export function debugProviderRequest(request: ProviderCompletionRequest): unknown {
  return request;
}

export function debugProviderResponse(response: string | ProviderCompletionResponse): unknown {
  return response;
}

export function debugResponse(response: AnyLlmResponse): unknown {
  return response;
}

export function debugException(error: unknown, depth = 0): unknown {
  const value = error as { readonly name?: unknown; readonly message?: unknown; readonly stack?: unknown; readonly code?: unknown; readonly phase?: unknown };
  const message = typeof value.message === 'string' ? value.message : String(error);
  const stack = typeof value.stack === 'string' ? value.stack.replace(message, message.replace(/(?:api[_-]?key|access[_-]?token|authorization|password|secret)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')) : undefined;
  const cause = (error as { readonly cause?: unknown }).cause;
  return {
    name: typeof value.name === 'string' ? value.name : typeof error,
    message: message.replace(/(?:api[_-]?key|access[_-]?token|authorization|password|secret)\s*[:=]\s*[^\s,;]+/gi, '[redacted]'),
    ...(stack ? { stack } : {}),
    ...(typeof value.code === 'string' ? { code: value.code } : {}),
    ...(typeof value.phase === 'string' ? { phase: value.phase } : {}),
    ...(cause !== undefined && depth < 2 ? { cause: debugException(cause, depth + 1) } : {}),
  };
}

export function stderrDebugSink(write: (line: string) => void = (line) => process.stderr.write(`${line}\n`)): DebugSink {
  return (event) => write(JSON.stringify(event));
}