import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { LlmFailure } from './errors.js';
import { parseSchema } from './schema.js';
import type { InlineJsonSchema, JsonObject } from './types.js';

export interface RequestAsset<T> {
  readonly path: string;
  readonly value: T;
}

export interface RequestTaskAsset {
  readonly kind: 'prompt' | 'json';
  readonly path: string;
  readonly value: string | JsonObject;
}

export interface RequestDirectoryAssets {
  readonly defaults?: RequestAsset<JsonObject>;
  readonly task: RequestTaskAsset;
  readonly systemPrompt?: RequestAsset<string>;
  readonly taskSchema?: RequestAsset<InlineJsonSchema>;
  readonly parametersSchema?: RequestAsset<InlineJsonSchema>;
  readonly outputSchema?: RequestAsset<InlineJsonSchema>;
}

export interface LoadedRequestDirectory {
  readonly requestName: string;
  readonly requestDirectory: string;
  readonly assets: RequestDirectoryAssets;
  readonly ignoredFiles: readonly string[];
}

const ASSET_KINDS = {
  defaults: 'defaults',
  prompt: 'prompt',
  task: 'task',
  systemPrompt: 'system prompt',
  taskSchema: 'task schema',
  parametersSchema: 'parameters schema',
  outputSchema: 'output schema',
} as const;

type AssetKey = keyof typeof ASSET_KINDS;

function configurationFailure(requestName: string, message: string): LlmFailure {
  return new LlmFailure('CONFIGURATION_INVALID', 'configuration', `Request '${requestName}': ${message}`);
}

function assertRequestName(requestName: string): void {
  if (typeof requestName !== 'string' || requestName.length === 0 || requestName === '.' || requestName === '..') {
    throw configurationFailure(requestName, 'the request name must be a non-empty directory name.');
  }
  if (isAbsolute(requestName) || requestName.includes('/') || requestName.includes('\\') || requestName.includes('\u0000') || /[\u0000-\u001f\u007f]/u.test(requestName)) {
    throw configurationFailure(requestName, 'the request name must be one safe child directory name.');
  }
}

async function inspectRequestDirectory(requestsDirectory: string, requestName: string): Promise<string> {
  if (typeof requestsDirectory !== 'string' || requestsDirectory.length === 0 || !isAbsolute(requestsDirectory)) {
    throw configurationFailure(requestName, 'requestsDirectory must be an absolute directory path.');
  }
  const root = resolve(requestsDirectory);
  let rootInfo;
  try {
    rootInfo = await stat(root);
  } catch {
    throw configurationFailure(requestName, 'requestsDirectory does not exist or cannot be inspected.');
  }
  if (!rootInfo.isDirectory()) throw configurationFailure(requestName, 'requestsDirectory is not a directory.');

  const requestDirectory = resolve(root, requestName);
  let info;
  try {
    info = await lstat(requestDirectory);
  } catch {
    throw configurationFailure(requestName, 'the request directory does not exist.');
  }
  if (info.isSymbolicLink()) throw configurationFailure(requestName, 'symlinked request directories are not permitted.');
  if (!info.isDirectory()) throw configurationFailure(requestName, 'the request target is not a directory.');
  return requestDirectory;
}

/** A request name that exists in more than one configured request directory. */
export class AmbiguousRequestFailure extends LlmFailure {
  readonly directories: readonly string[];

  constructor(requestName: string, directories: readonly string[]) {
    super('CONFIGURATION_INVALID', 'configuration', `Request '${requestName}' is ambiguous: it exists in more than one configured request directory: ${directories.join(', ')}. Rename or remove all but one copy, or remove a directory from ~/.llm/config.json:requestsDirectory or requestDirectories.`);
    this.name = 'AmbiguousRequestFailure';
    this.directories = directories;
  }
}

/**
 * Select the one configured request directory that contains `requestName`.
 *
 * The name is validated before any directory is probed. A child directory or
 * symlink counts as a match even when its bundle is broken, so a broken copy in
 * one directory never lets another directory's copy shadow it; a name in more than one directory throws
 * `AmbiguousRequestFailure` naming every matching directory. With a single
 * configured directory the loader keeps reporting a missing request itself.
 */
export async function locateRequest(requestsDirectories: readonly string[], requestName: string): Promise<string> {
  assertRequestName(requestName);
  if (requestsDirectories.length === 1) return requestsDirectories[0]!;
  const matches: string[] = [];
  for (const directory of requestsDirectories) {
    try {
      const info = await lstat(resolve(directory, requestName));
      // The same candidates the request listing considers: directories and symlinks, loadable or not.
      if (info.isDirectory() || info.isSymbolicLink()) matches.push(directory);
    } catch {
      // Absent from this directory.
    }
  }
  if (matches.length > 1) throw new AmbiguousRequestFailure(requestName, matches);
  if (matches.length === 0) {
    throw configurationFailure(requestName, `the request directory does not exist in any configured request directory: ${requestsDirectories.join(', ')}.`);
  }
  return matches[0]!;
}

function assetName(requestName: string, suffix: string): string {
  return `${requestName}.${suffix}`;
}

async function readAsset(requestName: string, path: string, kind: string, required: boolean): Promise<string | undefined> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT' && !required) return undefined;
    if (code === 'ENOENT') throw configurationFailure(requestName, `the required ${kind} asset is missing.`);
    throw configurationFailure(requestName, `the ${kind} asset could not be inspected.`);
  }
  if (info.isSymbolicLink()) throw configurationFailure(requestName, `the ${kind} asset must not be a symbolic link.`);
  if (!info.isFile()) throw configurationFailure(requestName, `the ${kind} asset must be a regular file.`);
  try {
    return await readFile(path, 'utf8');
  } catch {
    throw configurationFailure(requestName, `the ${kind} asset is not readable UTF-8 text.`);
  }
}

function parseObject(requestName: string, kind: string, source: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw configurationFailure(requestName, `the ${kind} asset must contain valid JSON.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configurationFailure(requestName, `the ${kind} asset must contain a JSON object.`);
  }
  return value as JsonObject;
}

function parseSchemaObject(requestName: string, kind: string, path: string, source: string): InlineJsonSchema {
  const value = parseObject(requestName, kind, source);
  try {
    return parseSchema(value, path).schema as InlineJsonSchema;
  } catch {
    throw configurationFailure(requestName, `the ${kind} asset must contain a valid JSON Schema object.`);
  }
}

function pathsFor(requestName: string, requestDirectory: string): Readonly<Record<AssetKey, string>> {
  return {
    defaults: resolve(requestDirectory, assetName(requestName, 'defaults.json')),
    prompt: resolve(requestDirectory, assetName(requestName, 'prompt.md')),
    task: resolve(requestDirectory, assetName(requestName, 'task.json')),
    systemPrompt: resolve(requestDirectory, assetName(requestName, 'prompt.system.md')),
    taskSchema: resolve(requestDirectory, assetName(requestName, 'taskSchema.json')),
    parametersSchema: resolve(requestDirectory, assetName(requestName, 'parameters.schema.json')),
    outputSchema: resolve(requestDirectory, assetName(requestName, 'outputSchema.json')),
  };
}

export async function loadRequestDirectory(requestsDirectory: string, requestName: string): Promise<LoadedRequestDirectory> {
  assertRequestName(requestName);
  const requestDirectory = await inspectRequestDirectory(requestsDirectory, requestName);
  const paths = pathsFor(requestName, requestDirectory);
  const entries = await readdir(requestDirectory, { withFileTypes: true });
  const recognizedNames = new Set(Object.values(paths));
  const ignoredFiles = entries
    .map((entry) => entry.name)
    .filter((name) => !recognizedNames.has(resolve(requestDirectory, name)))
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);

  const defaultsSource = await readAsset(requestName, paths.defaults, ASSET_KINDS.defaults, false);
  const promptSource = await readAsset(requestName, paths.prompt, ASSET_KINDS.prompt, false);
  const taskSource = await readAsset(requestName, paths.task, ASSET_KINDS.task, false);
  if (promptSource !== undefined && taskSource !== undefined) {
    throw configurationFailure(requestName, 'prompt and task assets are mutually exclusive.');
  }
  if (promptSource === undefined && taskSource === undefined) {
    throw configurationFailure(requestName, 'exactly one prompt or task asset is required.');
  }

  const systemPromptSource = await readAsset(requestName, paths.systemPrompt, ASSET_KINDS.systemPrompt, false);
  const taskSchemaSource = await readAsset(requestName, paths.taskSchema, ASSET_KINDS.taskSchema, false);
  if (taskSource !== undefined && taskSchemaSource === undefined) {
    throw configurationFailure(requestName, 'the task schema asset is required when task.json is present.');
  }
  const parametersSchemaSource = await readAsset(requestName, paths.parametersSchema, ASSET_KINDS.parametersSchema, false);
  const outputSchemaSource = await readAsset(requestName, paths.outputSchema, ASSET_KINDS.outputSchema, false);

  const assets: RequestDirectoryAssets = {
    ...(defaultsSource === undefined ? {} : { defaults: { path: paths.defaults, value: parseObject(requestName, ASSET_KINDS.defaults, defaultsSource) } }),
    task: promptSource === undefined
      ? { kind: 'json', path: paths.task, value: parseObject(requestName, ASSET_KINDS.task, taskSource!) }
      : { kind: 'prompt', path: paths.prompt, value: promptSource },
    ...(systemPromptSource === undefined ? {} : { systemPrompt: { path: paths.systemPrompt, value: systemPromptSource } }),
    ...(taskSchemaSource === undefined ? {} : { taskSchema: { path: paths.taskSchema, value: parseSchemaObject(requestName, ASSET_KINDS.taskSchema, paths.taskSchema, taskSchemaSource) } }),
    ...(parametersSchemaSource === undefined ? {} : { parametersSchema: { path: paths.parametersSchema, value: parseSchemaObject(requestName, ASSET_KINDS.parametersSchema, paths.parametersSchema, parametersSchemaSource) } }),
    ...(outputSchemaSource === undefined ? {} : { outputSchema: { path: paths.outputSchema, value: parseSchemaObject(requestName, ASSET_KINDS.outputSchema, paths.outputSchema, outputSchemaSource) } }),
  };

  return { requestName, requestDirectory, assets, ignoredFiles };
}