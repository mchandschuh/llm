import { resolve } from 'node:path';
import { assertRequestShape, parseSchema } from './schema.js';
import { resolveRequiredFile, resolveSource } from './source.js';
import { LlmFailure } from './errors.js';
import type { LlmRequest, NormalizedRequest, NormalizedToolOptions, ReferenceFile, Thinking } from './types.js';

const DEFAULTS = {
  provider: 'openrouter',
  model: 'openai/gpt-5.6-luna',
  thinking: 'high' as Thinking,
  maxFailedAttempts: 3,
  maxIterations: 3,
};

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

export async function normalizeRequest(value: unknown, options: { readonly configurationFilePath?: string; readonly configurationRoot?: string } = {}): Promise<NormalizedRequest> {
  assertRequestShape(value);
  const request = value as unknown as LlmRequest;
  const root = resolve(options.configurationRoot ?? (options.configurationFilePath ? resolve(options.configurationFilePath, '..') : process.cwd()));
  const task = typeof request.task === 'string' ? (await resolveSource(request.task, root)).value : request.task;
  const systemPrompt = await resolveSource(request.systemPrompt, root);
  const taskSchema = inlineSchema(request.taskSchema, 'taskSchema');
  const outputSchema = inlineSchema(request.outputSchema, 'outputSchema');
  const files: Array<ReferenceFile & { readonly encoding: 'utf8' | 'base64'; readonly content: string; readonly resolvedPath: string }> = [];
  for (const file of request.files ?? []) {
    const resolved = await resolveRequiredFile(file.path, root, file.type, file.encoding);
    files.push({ ...file, encoding: resolved.encoding, content: resolved.value, resolvedPath: resolved.path });
  }
  return {
    schema: request.schema,
    provider: request.provider ?? DEFAULTS.provider,
    model: request.model ?? DEFAULTS.model,
    thinking: request.thinking ?? DEFAULTS.thinking,
    maxFailedAttempts: request.maxFailedAttempts === undefined ? DEFAULTS.maxFailedAttempts : ensureBounds(request.maxFailedAttempts, 'maxFailedAttempts', 0, 10),
    maxIterations: request.maxIterations === undefined ? DEFAULTS.maxIterations : ensureBounds(request.maxIterations, 'maxIterations', 1, 10),
    credentials: request.credentials,
    task,
    systemPrompt,
    taskSchema,
    files,
    outputSchema,
    ...(request.toolOptions ? { toolOptions: await normalizeToolOptions(request.toolOptions) } : {}),
    configurationRoot: root,
  };
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
