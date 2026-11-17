import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { LlmFailure } from './errors.js';
import type { ChatSessionStoreConfig } from './chat-session-store.js';

const DEFAULT_ENVIRONMENT_ROOT = 'LLM_CONFIG';
const CONFIG_FILE = 'config.json';

interface ChatSessionStoreConfigFile {
  readonly chatSessionStore?: {
    readonly type?: unknown;
    readonly rootDirectory?: unknown;
  };
}

export interface ChatSessionStoreConfigResolutionOptions {
  readonly workingDirectory?: string;
  readonly homeDirectory?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

function readConfigLayer(directory: string): ChatSessionStoreConfigFile | undefined {
  const path = join(directory, CONFIG_FILE);
  if (!existsSync(path)) return undefined;
  let value: unknown;
  try {
    if (!statSync(path).isFile()) throw new Error('not a file');
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', `The chat session configuration file could not be read: ${path}.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', `The chat session configuration file must contain an object: ${path}.`);
  }
  return value as ChatSessionStoreConfigFile;
}

function configuredString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value) {
    throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', `${name} must be a non-empty string.`);
  }
  return value;
}

function configurationRoots(workingDirectory: string, homeDirectory: string, environment: Readonly<Record<string, string | undefined>>): string[] {
  const roots = [resolve(workingDirectory, '.config'), resolve(homeDirectory, '.llm')];
  const environmentRoot = environment[DEFAULT_ENVIRONMENT_ROOT];
  if (environmentRoot !== undefined) {
    if (!isAbsolute(environmentRoot)) {
      throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', `${DEFAULT_ENVIRONMENT_ROOT} must be an absolute directory.`);
    }
    const resolvedRoot = resolve(environmentRoot);
    if (!existsSync(resolvedRoot) || !lstatSync(resolvedRoot).isDirectory() || lstatSync(resolvedRoot).isSymbolicLink()) {
      throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', `${DEFAULT_ENVIRONMENT_ROOT} must point to an existing real directory.`);
    }
    roots.push(resolvedRoot);
  }
  return roots;
}

export function resolveChatSessionStoreConfig(options: ChatSessionStoreConfigResolutionOptions = {}): ChatSessionStoreConfig {
  const workingDirectory = resolve(options.workingDirectory ?? process.cwd());
  const homeDirectory = resolve(options.homeDirectory ?? homedir());
  const environment = options.environment ?? process.env;
  const roots = configurationRoots(workingDirectory, homeDirectory, environment);
  let type = 'tempFile';
  let rootDirectory: string | undefined;

  for (const root of roots) {
    const configured = readConfigLayer(root)?.chatSessionStore;
    if (!configured) continue;
    type = configuredString(configured.type, 'chatSessionStore.type') ?? type;
    const configuredRoot = configuredString(configured.rootDirectory, 'chatSessionStore.rootDirectory');
    if (configuredRoot !== undefined) rootDirectory = resolve(workingDirectory, configuredRoot);
  }

  type = configuredString(environment.LLM_CHAT_SESSION_STORE, 'LLM_CHAT_SESSION_STORE') ?? type;
  const environmentRoot = configuredString(environment.LLM_CHAT_SESSION_ROOT, 'LLM_CHAT_SESSION_ROOT');
  if (environmentRoot !== undefined) {
    if (!isAbsolute(environmentRoot)) {
      throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', 'LLM_CHAT_SESSION_ROOT must be an absolute directory.');
    }
    rootDirectory = resolve(environmentRoot);
  }
  return { type, ...(rootDirectory ? { rootDirectory } : {}) };
}