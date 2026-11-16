import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { boundedMessage, LlmFailure } from './errors.js';
import type { LlmChatMessage, LlmRequest } from './types.js';

export const CHAT_SESSION_SCHEMA = 'https://schemas.handschuh.dev/llm/chat-session/v1' as const;
export const DEFAULT_CHAT_SESSION_ROOT = '/tmp/.llm/chat';
const CHAT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const MAX_SESSION_BYTES = 2 * 1024 * 1024;

export interface PersistedChatSession {
  readonly schema: typeof CHAT_SESSION_SCHEMA;
  readonly chatId: string;
  readonly request: LlmRequest;
  readonly history: readonly LlmChatMessage[];
  readonly updatedAt: string;
}

export interface ChatSessionStoreOptions {
  readonly rootDirectory?: string;
}

export function chatSessionRoot(options: ChatSessionStoreOptions = {}): string {
  return resolve(options.rootDirectory ?? DEFAULT_CHAT_SESSION_ROOT);
}

export function validateChatId(chatId: string): string {
  if (!CHAT_ID_PATTERN.test(chatId)) {
    throw new LlmFailure('REQUEST_INVALID', 'request', 'The chat identifier must be 1-64 characters using letters, numbers, dot, underscore, or hyphen.');
  }
  return chatId;
}

export function chatSessionPath(chatId: string, options: ChatSessionStoreOptions = {}): string {
  const safeId = validateChatId(chatId);
  const root = chatSessionRoot(options);
  const path = resolve(root, `${safeId}.json`);
  if (path !== join(root, `${safeId}.json`) || !path.startsWith(`${root}${sep}`)) {
    throw new LlmFailure('REQUEST_INVALID', 'request', 'The chat session path is outside the approved session directory.');
  }
  return path;
}

function requestWithoutSecrets(request: LlmRequest): LlmRequest {
  const { credentials: _credentials, messages: _messages, ...safeRequest } = request;
  return safeRequest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateToolCalls(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((call) => isRecord(call) && typeof call.id === 'string' && typeof call.name === 'string' && isRecord(call.arguments));
}

function validateMessage(value: unknown): value is LlmChatMessage {
  if (!isRecord(value) || typeof value.role !== 'string') return false;
  if ((value.role === 'system' || value.role === 'user') && typeof value.content === 'string') return true;
  if (value.role === 'assistant') {
    return (typeof value.content === 'string' || value.content === null)
      && Array.isArray(value.toolCalls)
      && value.toolCalls.every(validateToolCalls);
  }
  return value.role === 'tool' && typeof value.toolCallId === 'string' && typeof value.content === 'string';
}

function validatePersistedRequest(value: Record<string, unknown>): boolean {
  return value.schema === 'https://schemas.handschuh.dev/llm/request/v1'
    && (typeof value.task === 'string' || isRecord(value.task))
    && typeof value.systemPrompt === 'string'
    && !('messages' in value)
    && !('credentials' in value)
    && !('providerCredentials' in value);
}

function parsePersistedSession(value: unknown, expectedChatId: string): PersistedChatSession {
  if (
    !isRecord(value)
    || value.schema !== CHAT_SESSION_SCHEMA
    || value.chatId !== expectedChatId
    || !isRecord(value.request)
    || !validatePersistedRequest(value.request)
    || !Array.isArray(value.history)
    || !value.history.every(validateMessage)
    || typeof value.updatedAt !== 'string'
  ) {
    throw new LlmFailure('REQUEST_INVALID', 'request', 'The persisted chat session is invalid or incompatible.');
  }
  return value as unknown as PersistedChatSession;
}

export async function loadChatSession(chatId: string, options: ChatSessionStoreOptions = {}): Promise<PersistedChatSession | undefined> {
  const path = chatSessionPath(chatId, options);
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
    throw new LlmFailure('SOURCE_RESOLUTION_FAILED', 'source-resolution', 'The persisted chat session could not be read.');
  }
  if (Buffer.byteLength(source, 'utf8') > MAX_SESSION_BYTES) {
    throw new LlmFailure('REQUEST_INVALID', 'request', 'The persisted chat session exceeds the allowed size.');
  }
  try {
    return parsePersistedSession(JSON.parse(source), validateChatId(chatId));
  } catch (error) {
    if (error instanceof LlmFailure) throw error;
    throw new LlmFailure('REQUEST_INVALID', 'request', boundedMessage('The persisted chat session is not valid JSON.'));
  }
}

export async function saveChatSession(
  session: Omit<PersistedChatSession, 'schema' | 'updatedAt'>,
  options: ChatSessionStoreOptions = {},
): Promise<string> {
  const chatId = validateChatId(session.chatId);
  const path = chatSessionPath(chatId, options);
  const root = dirname(path);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const persisted: PersistedChatSession = {
    schema: CHAT_SESSION_SCHEMA,
    chatId,
    request: requestWithoutSecrets(session.request),
    history: session.history,
    updatedAt: new Date().toISOString(),
  };
  const content = `${JSON.stringify(persisted, null, 2)}\n`;
  if (Buffer.byteLength(content, 'utf8') > MAX_SESSION_BYTES) {
    throw new LlmFailure('REQUEST_INVALID', 'request', 'The chat session is too large to persist.');
  }
  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
    return path;
  } catch {
    await unlink(temporaryPath).catch(() => undefined);
    throw new LlmFailure('SOURCE_RESOLUTION_FAILED', 'source-resolution', 'The persisted chat session could not be written.');
  }
}