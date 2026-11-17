import { chmod, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { boundedMessage, LlmFailure } from './errors.js';
import type { LlmChatMessage, LlmRequest } from './types.js';

export const CHAT_SESSION_SCHEMA = 'https://schemas.handschuh.dev/llm/chat-session/v1' as const;
export const DEFAULT_CHAT_SESSION_STORE_TYPE = 'tempFile' as const;
export const DEFAULT_CHAT_SESSION_ROOT = '/tmp/.llm/chat';
const DEFAULT_PERSISTENT_CHAT_SESSION_ROOT = '.llm/chat';
const CHAT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const CHAT_SESSION_FILE_PATTERN = /^([A-Za-z0-9][A-Za-z0-9._-]{0,63})\.json$/u;
const MAX_SESSION_BYTES = 2 * 1024 * 1024;

export interface PersistedChatSession {
  readonly schema: typeof CHAT_SESSION_SCHEMA;
  readonly chatId: string;
  readonly request: LlmRequest;
  readonly history: readonly LlmChatMessage[];
  readonly updatedAt: string;
}

export type ChatSessionToPersist = Omit<PersistedChatSession, 'schema' | 'updatedAt'>;

export interface ChatSessionTimeRange {
  /** Inclusive lower bound for the persisted session's updatedAt value. */
  readonly from?: Date;
  /** Inclusive upper bound for the persisted session's updatedAt value. */
  readonly to?: Date;
}

export interface ChatSessionStore {
  load(chatId: string): Promise<PersistedChatSession | undefined>;
  save(session: ChatSessionToPersist): Promise<string>;
  query(timeRange?: ChatSessionTimeRange): Promise<readonly string[]>;
}

export interface ChatSessionStoreConfig {
  readonly type: string;
  readonly rootDirectory?: string;
}

export type ChatSessionStoreFactoryFunction = (config: ChatSessionStoreConfig) => ChatSessionStore;

function validateChatId(chatId: string): string {
  if (!CHAT_ID_PATTERN.test(chatId)) {
    throw new LlmFailure('REQUEST_INVALID', 'request', 'The chat identifier must be 1-64 characters using letters, numbers, dot, underscore, or hyphen.');
  }
  return chatId;
}

function sessionPath(chatId: string, rootDirectory: string): string {
  const safeId = validateChatId(chatId);
  const root = resolve(rootDirectory);
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
    || Number.isNaN(Date.parse(value.updatedAt))
  ) {
    throw new LlmFailure('REQUEST_INVALID', 'request', 'The persisted chat session is invalid or incompatible.');
  }
  return value as unknown as PersistedChatSession;
}

function validateTimeRange(timeRange: ChatSessionTimeRange | undefined): { readonly from?: number; readonly to?: number } {
  const from = timeRange?.from?.getTime();
  const to = timeRange?.to?.getTime();
  if (from !== undefined && Number.isNaN(from)) {
    throw new LlmFailure('REQUEST_INVALID', 'request', 'The chat session query start time must be a valid date.');
  }
  if (to !== undefined && Number.isNaN(to)) {
    throw new LlmFailure('REQUEST_INVALID', 'request', 'The chat session query end time must be a valid date.');
  }
  if (from !== undefined && to !== undefined && from > to) {
    throw new LlmFailure('REQUEST_INVALID', 'request', 'The chat session query start time must not be after its end time.');
  }
  return { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
}

class FileBackedChatSessionStore implements ChatSessionStore {
  constructor(private readonly rootDirectory: string) {}

  async load(chatId: string): Promise<PersistedChatSession | undefined> {
    const path = sessionPath(chatId, this.rootDirectory);
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

  async save(session: ChatSessionToPersist): Promise<string> {
    const path = sessionPath(session.chatId, this.rootDirectory);
    const root = dirname(path);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);
    const persisted: PersistedChatSession = {
      schema: CHAT_SESSION_SCHEMA,
      chatId: validateChatId(session.chatId),
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

  async query(timeRange?: ChatSessionTimeRange): Promise<readonly string[]> {
    const bounds = validateTimeRange(timeRange);
    let entries;
    try {
      entries = await readdir(this.rootDirectory, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
      throw new LlmFailure('SOURCE_RESOLUTION_FAILED', 'source-resolution', 'The chat session directory could not be read.');
    }
    const chatIds: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = CHAT_SESSION_FILE_PATTERN.exec(entry.name);
      if (!match) continue;
      const session = await this.load(match[1]!);
      if (!session) continue;
      const updatedAt = Date.parse(session.updatedAt);
      if (bounds.from !== undefined && updatedAt < bounds.from) continue;
      if (bounds.to !== undefined && updatedAt > bounds.to) continue;
      chatIds.push(session.chatId);
    }
    return chatIds.sort((left, right) => left.localeCompare(right));
  }
}

function rootFromConfig(config: ChatSessionStoreConfig, defaultRoot: string): string {
  const root = config.rootDirectory ?? defaultRoot;
  if (!root) throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', 'The chat session store root directory is invalid.');
  return resolve(root);
}

function createTempFileStore(config: ChatSessionStoreConfig): ChatSessionStore {
  return new FileBackedChatSessionStore(rootFromConfig(config, DEFAULT_CHAT_SESSION_ROOT));
}

function createPersistentFileStore(config: ChatSessionStoreConfig): ChatSessionStore {
  return new FileBackedChatSessionStore(rootFromConfig(config, join(homedir(), DEFAULT_PERSISTENT_CHAT_SESSION_ROOT)));
}

export class ChatSessionStoreFactory {
  private static readonly factories = new Map<string, ChatSessionStoreFactoryFunction>([
    ['tempFile', createTempFileStore],
    ['file', createPersistentFileStore],
  ]);

  static register(type: string, factory: ChatSessionStoreFactoryFunction): void {
    if (!type) throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', 'A chat session store type is required.');
    ChatSessionStoreFactory.factories.set(type, factory);
  }

  static validateChatId(chatId: string): string {
    return validateChatId(chatId);
  }

  static createChatSessionStore(config: ChatSessionStoreConfig): ChatSessionStore {
    if (!config || typeof config.type !== 'string' || !config.type) {
      throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', 'A chat session store type is required.');
    }
    const factory = ChatSessionStoreFactory.factories.get(config.type);
    if (!factory) {
      throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', `Unknown chat session store implementation: ${config.type}.`);
    }
    return factory(config);
  }
}