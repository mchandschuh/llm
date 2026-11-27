import { resolve } from 'node:path';
import { assertRequestShape, parseSchema } from './schema.js';
import { resolveRequiredFile, resolveSource } from './source.js';
import { LlmFailure } from './errors.js';
import { DEFAULT_PROVIDER, defaultModelFor } from './provider-defaults.js';
import type { LlmChatMessage, LlmRequest, NormalizedRequest, NormalizedToolOptions, ReferenceFile, Thinking } from './types.js';

const DEFAULTS = {
  thinking: 'high' as Thinking,
  maxFailedAttempts: 3,
  maxIterations: 3,
};

export const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.' as const;

const TOOL_DEFAULTS = {
  maxRounds: 3,
  maxCalls: 128,
};

function ensureBounds(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new LlmFailure('REQUEST_INVALID', 'request', `${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function schemaPath(source: string): string | undefined {
  return source.startsWith('https://') ? undefined : source;
}

function inlineSchema(value: unknown, name: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LlmFailure('REQUEST_INVALID', 'request', `${name} must be an inline JSON Schema object.`);
  }
  return value as Record<string, unknown>;
}

export async function normalizeRequest(value: unknown, options: { readonly configurationFilePath?: string; readonly configurationRoot?: string; readonly allowFinalSymlinkFiles?: boolean; readonly files?: readonly import('./types.js').ReferenceFile[] } = {}): Promise<NormalizedRequest> {
  assertRequestShape(value);
  const request = value as unknown as LlmRequest;
  validateMessages(request.messages ?? []);
  const root = resolve(options.configurationRoot ?? (options.configurationFilePath ? resolve(options.configurationFilePath, '..') : process.cwd()));
  const task = typeof request.task === 'string' ? (await resolveSource(request.task, root)).value : request.task;
  const systemPrompt = request.systemPrompt === undefined
    ? { value: DEFAULT_SYSTEM_PROMPT }
    : request.systemPrompt === null
      ? { value: null }
      : await resolveSource(request.systemPrompt, root);
  const taskSchema = inlineSchema(request.taskSchema, 'taskSchema');
  const outputSchema = inlineSchema(request.outputSchema, 'outputSchema');
  const files: Array<ReferenceFile & { readonly encoding: 'utf8' | 'base64'; readonly content: string; readonly resolvedPath: string }> = [];
  for (const file of request.files ?? []) {
    const resolved = await resolveRequiredFile(file.path, root, file.type, file.encoding, { allowFinalSymlink: options.allowFinalSymlinkFiles === true });
    files.push({ ...file, encoding: resolved.encoding, content: resolved.value, resolvedPath: resolved.path });
  }
  for (const file of options.files ?? []) {
    const resolved = await resolveRequiredFile(file.path, process.cwd(), file.type, file.encoding, { allowFinalSymlink: true, allowExternal: true });
    files.push({ ...file, encoding: resolved.encoding, content: resolved.value, resolvedPath: resolved.path });
  }
  return {
    schema: request.schema,
    provider: request.provider ?? DEFAULT_PROVIDER,
    model: request.model ?? defaultModelFor(request.provider ?? DEFAULT_PROVIDER),
    thinking: request.thinking ?? DEFAULTS.thinking,
    maxFailedAttempts: request.maxFailedAttempts === undefined ? DEFAULTS.maxFailedAttempts : ensureBounds(request.maxFailedAttempts, 'maxFailedAttempts', 0, 10),
    maxIterations: request.maxIterations === undefined ? DEFAULTS.maxIterations : ensureBounds(request.maxIterations, 'maxIterations', 1, 10),
    credentials: request.credentials,
    task,
    systemPrompt,
    taskSchema,
    files,
    outputSchema,
    messages: request.messages ?? [],
    ...(request.toolOptions ? { toolOptions: await normalizeToolOptions(request.toolOptions) } : {}),
    configurationRoot: root,
  };
}

function validateMessages(messages: readonly LlmChatMessage[]): void {
  if (!Array.isArray(messages)) throw new LlmFailure('REQUEST_INVALID', 'request', 'messages must be an array.');
  for (const message of messages) {
    if (!message || typeof message !== 'object' || !['system', 'user', 'assistant', 'tool'].includes(message.role)) {
      throw new LlmFailure('REQUEST_INVALID', 'request', 'messages contains an invalid chat message.');
    }
    if ((message.role === 'system' || message.role === 'user') && typeof message.content !== 'string') {
      throw new LlmFailure('REQUEST_INVALID', 'request', `${message.role} messages require string content.`);
    }
    if (message.role === 'assistant' && (typeof message.content !== 'string' && message.content !== null || !Array.isArray(message.toolCalls))) {
      throw new LlmFailure('REQUEST_INVALID', 'request', 'assistant messages require content and toolCalls.');
    }
    if (message.role === 'tool' && (typeof message.toolCallId !== 'string' || typeof message.content !== 'string')) {
      throw new LlmFailure('REQUEST_INVALID', 'request', 'tool messages require toolCallId and string content.');
    }
  }
}

async function normalizeToolOptions(value: NonNullable<LlmRequest['toolOptions']>): Promise<NormalizedToolOptions> {
  const maxRounds = value.maxRounds === undefined ? TOOL_DEFAULTS.maxRounds : ensureBounds(value.maxRounds, 'maxRounds', 0, 10);
  const maxCalls = value.maxCalls === undefined ? TOOL_DEFAULTS.maxCalls : ensureBounds(value.maxCalls, 'maxCalls', 0, 128);
  const tools = [...(value.tools ?? [])];
  for (const tool of tools) {
    try {
      const parsed = JSON.parse(tool.inputSchema) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      parseSchema(tool.inputSchema);
    } catch {
      throw new LlmFailure('TOOL_SCHEMA_INVALID', 'request', `Tool '${tool.name}' inputSchema must be valid JSON Schema text.`);
    }
  }
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) throw new LlmFailure('REQUEST_INVALID', 'request', 'Tool names must be unique.');
  return { tools, autoInvoke: value.autoInvoke ?? false, maxRounds, maxCalls };
}

export function sourceMetadata(source: { readonly value: string; readonly path?: string }): { readonly name: string; readonly path?: string } {
  return { name: source.path ?? source.value.slice(0, 120), ...(source.path ? { path: source.path } : {}) };
}

export function schemaSourcePath(source: { readonly path?: string }): string | undefined {
  return schemaPath(source.path ?? '');
}
