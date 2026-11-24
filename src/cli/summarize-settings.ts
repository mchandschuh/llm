import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LlmFailure } from '../errors.js';
import type { Thinking } from '../types.js';

export const SUMMARIZE_DEFAULTS_FILE = 'summarize.defaults.json';

const PROVIDER_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/u;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const THINKING_VALUES = new Set<Thinking>(['minimal', 'low', 'medium', 'high', 'xhigh']);

export interface SummarizeSettings {
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: Thinking;
}

export interface ResolvedSummarizeSettings {
  readonly provider: string;
  readonly model: string;
  readonly thinking: Thinking;
}

const RUNTIME_DEFAULTS: ResolvedSummarizeSettings = {
  provider: 'openrouter',
  model: 'openai/gpt-5.6-luna',
  thinking: 'high',
};

function settingsFailure(message: string): LlmFailure {
  return new LlmFailure('CONFIGURATION_INVALID', 'configuration', `The llm summarize settings are invalid. ${message}`);
}

function parseSettings(value: unknown): SummarizeSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw settingsFailure('The settings file must contain a JSON object.');
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !['provider', 'model', 'thinking'].includes(key));
  if (unknown.length > 0) throw settingsFailure(`Unsupported settings: ${unknown.join(', ')}.`);
  if (record.provider !== undefined && (typeof record.provider !== 'string' || !PROVIDER_PATTERN.test(record.provider))) {
    throw settingsFailure('provider must match the provider identifier format.');
  }
  if (record.model !== undefined && (typeof record.model !== 'string' || !MODEL_PATTERN.test(record.model))) {
    throw settingsFailure('model must match the model identifier format.');
  }
  if (record.thinking !== undefined && (typeof record.thinking !== 'string' || !THINKING_VALUES.has(record.thinking as Thinking))) {
    throw settingsFailure('thinking must be one of minimal, low, medium, high, or xhigh.');
  }
  return {
    ...(record.provider !== undefined ? { provider: record.provider as string } : {}),
    ...(record.model !== undefined ? { model: record.model as string } : {}),
    ...(record.thinking !== undefined ? { thinking: record.thinking as Thinking } : {}),
  };
}

export async function readSummarizeSettings(requestDirectory: string): Promise<SummarizeSettings> {
  const path = resolve(requestDirectory, 'summarize', SUMMARIZE_DEFAULTS_FILE);
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch {
    throw settingsFailure(`The ${SUMMARIZE_DEFAULTS_FILE} file could not be read at the configured requests directory.`);
  }
  try {
    return parseSettings(JSON.parse(source) as unknown);
  } catch (error) {
    if (error instanceof LlmFailure) throw error;
    throw settingsFailure(`The ${SUMMARIZE_DEFAULTS_FILE} file must contain valid JSON.`);
  }
}

export function resolveSummarizeSettings(defaults: SummarizeSettings, overrides: SummarizeSettings = {}): ResolvedSummarizeSettings {
  return {
    provider: overrides.provider ?? defaults.provider ?? RUNTIME_DEFAULTS.provider,
    model: overrides.model ?? defaults.model ?? RUNTIME_DEFAULTS.model,
    thinking: overrides.thinking ?? defaults.thinking ?? RUNTIME_DEFAULTS.thinking,
  };
}