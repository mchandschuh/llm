import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { ConfigError, resolveConfigJson } from 'nodejs-common/dist/src/config/index.js';
import { LlmFailure } from './errors.js';

const REQUEST_DIRECTORY_GUIDANCE = 'Configure ~/.llm/config.json:requestsDirectory to point to the llm repository request directory.';

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

export async function resolveRequestsDirectory(options: RequestsDirectoryResolutionOptions = {}): Promise<string> {
  let configuration: Record<string, unknown>;
  try {
    const result = await resolveConfigJson({
      applicationSourceDirectory: resolve(options.applicationSourceDirectory ?? process.cwd()),
      appSlug: 'llm',
      environmentVariable: 'LLM_CONFIG',
      homeDirectory: options.homeDirectory,
      environment: options.environment,
    });
    configuration = result.value;
  } catch (error) {
    if (error instanceof ConfigError && error.code === 'CONFIGURATION_FILE_NOT_FOUND') throw missingConfiguration();
    throw configurationFailure(error instanceof Error ? error.message : 'The configuration file could not be resolved.');
  }

  const configured = configuration.requestsDirectory;
  if (typeof configured !== 'string' || configured.length === 0) {
    throw configurationFailure('requestsDirectory must be a non-empty absolute directory path.');
  }
  if (!isAbsolute(configured) || configured.split('/').includes('..')) {
    throw configurationFailure('requestsDirectory must be an absolute path without parent traversal.');
  }

  const directory = resolve(configured);
  try {
    if (!(await stat(directory)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw configurationFailure(`requestsDirectory does not exist or is not a directory: ${directory}.`);
  }
  return directory;
}
