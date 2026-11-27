import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { ConfigError, resolveConfigJson } from 'nodejs-common/dist/src/config/index.js';
import { LlmFailure } from './errors.js';

/** Guidance appended to every request-directory configuration failure; it names both keys. */
export const REQUEST_DIRECTORY_GUIDANCE = 'Configure ~/.llm/config.json:requestsDirectory (one absolute directory path) or ~/.llm/config.json:requestDirectories (an array of absolute directory paths) to point to llm request directories.';

export interface RequestsDirectoryResolutionOptions {
  readonly applicationSourceDirectory?: string;
  readonly homeDirectory?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

function missingConfiguration(): LlmFailure {
  return new LlmFailure('CONFIGURATION_INVALID', 'configuration', `No llm request configuration was found. ${REQUEST_DIRECTORY_GUIDANCE}`);
}

function configurationFailure(message: string): LlmFailure {
  return new LlmFailure('CONFIGURATION_INVALID', 'configuration', `The llm request configuration is invalid. ${message} ${REQUEST_DIRECTORY_GUIDANCE}`);
}

async function loadConfiguration(options: RequestsDirectoryResolutionOptions): Promise<Record<string, unknown>> {
  try {
    const result = await resolveConfigJson({
      applicationSourceDirectory: resolve(options.applicationSourceDirectory ?? process.cwd()),
      appSlug: 'llm',
      environmentVariable: 'LLM_CONFIG',
      homeDirectory: options.homeDirectory,
      environment: options.environment,
    });
    return result.value;
  } catch (error) {
    if (error instanceof ConfigError && error.code === 'CONFIGURATION_FILE_NOT_FOUND') throw missingConfiguration();
    throw configurationFailure(error instanceof Error ? error.message : 'The configuration file could not be resolved.');
  }
}

/** Validate one configured directory; `label` is `requestsDirectory` or `requestDirectories[<index>]`. */
async function configuredDirectory(label: string, configured: unknown): Promise<string> {
  if (typeof configured !== 'string' || configured.length === 0) {
    throw configurationFailure(`${label} must be a non-empty absolute directory path.`);
  }
  if (!isAbsolute(configured) || configured.split('/').includes('..')) {
    throw configurationFailure(`${label} must be an absolute path without parent traversal.`);
  }
  const directory = resolve(configured);
  try {
    if (!(await stat(directory)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw configurationFailure(`${label} does not exist or is not a directory: ${directory}.`);
  }
  return directory;
}

/**
 * Resolve the configured request directories from the layered `config.json`.
 *
 * `requestsDirectory` (one path) comes first, then each `requestDirectories`
 * entry in array order. Entries that resolve to the same real directory are kept
 * once, at their first position, so listing a directory twice is never
 * ambiguous. At least one directory must be configured.
 */
export async function resolveRequestDirectories(options: RequestsDirectoryResolutionOptions = {}): Promise<readonly string[]> {
  const configuration = await loadConfiguration(options);
  const single = configuration.requestsDirectory;
  const multiple = configuration.requestDirectories;
  if (single === undefined && multiple === undefined) {
    throw configurationFailure('requestsDirectory or requestDirectories must be configured.');
  }
  const candidates: { readonly label: string; readonly value: unknown }[] = [];
  if (single !== undefined) candidates.push({ label: 'requestsDirectory', value: single });
  if (multiple !== undefined) {
    if (!Array.isArray(multiple) || multiple.length === 0) {
      throw configurationFailure('requestDirectories must be a non-empty array of absolute directory paths.');
    }
    multiple.forEach((value: unknown, index) => candidates.push({ label: `requestDirectories[${index}]`, value }));
  }

  const directories: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const directory = await configuredDirectory(candidate.label, candidate.value);
    let identity = directory;
    try {
      identity = await realpath(directory);
    } catch {
      // stat succeeded above; fall back to the resolved path if realpath races.
    }
    if (seen.has(identity)) continue;
    seen.add(identity);
    directories.push(directory);
  }
  return directories;
}
