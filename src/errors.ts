import type { ErrorCode, ErrorPhase, LlmError } from './types.js';

export class LlmFailure extends Error {
  readonly code: ErrorCode;
  readonly phase: ErrorPhase;

  constructor(code: ErrorCode, phase: ErrorPhase, message: string) {
    super(message);
    this.name = 'LlmFailure';
    this.code = code;
    this.phase = phase;
  }
}

export function boundedMessage(message: string): string {
  const sanitized = message
    .replace(/(?:api[_-]?key|access[_-]?token|authorization|password|secret)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
  return (sanitized || 'The operation failed.').slice(0, 500);
}

export function errorFromFailure(failure: LlmFailure): LlmError {
  return { code: failure.code, phase: failure.phase, message: boundedMessage(failure.message) };
}

export function genericFailure(code: ErrorCode, phase: ErrorPhase, message: string): LlmFailure {
  return new LlmFailure(code, phase, message);
}
