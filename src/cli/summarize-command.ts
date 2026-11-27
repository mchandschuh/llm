import { resolveRequestDirectories, type RequestsDirectoryResolutionOptions } from '../requests-config.js';
import { locateRequest } from '../request-directory.js';
import { boundedMessage } from '../errors.js';
import type { LlmProvider, RequestSettingsOverrides, Thinking } from '../types.js';
import { runRequestCommand } from './request-command.js';
import type { ResponseFormat } from './arguments.js';
import type { OutputWriter } from './output.js';

export interface SummarizeCommandOptions extends RequestsDirectoryResolutionOptions {
  readonly path?: string;
  readonly content?: string;
  readonly debug: boolean;
  readonly format?: ResponseFormat;
  /** Direct request-directory injection is used by provider-free callers and tests. */
  readonly requestDirectory?: string;
  readonly provider?: LlmProvider;
  readonly providerName?: string;
  readonly model?: string;
  readonly thinking?: Thinking;
  readonly write?: OutputWriter;
  readonly writeError?: OutputWriter;
}

function compatibilitySettings(options: SummarizeCommandOptions): RequestSettingsOverrides {
  return {
    ...(options.providerName === undefined ? {} : { provider: options.providerName }),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.thinking === undefined ? {} : { thinking: options.thinking }),
  };
}

function parameters(options: SummarizeCommandOptions): string {
  return JSON.stringify({
    ...(options.path === undefined ? {} : { path: options.path }),
    ...(options.content === undefined ? {} : { content: options.content }),
  });
}

/**
 * Compatibility adapter for the retired top-level command.
 *
 * All request loading, parameter validation, source handling, prompt composition,
 * completion delegation, and response formatting belong to `llm req`. This
 * adapter only translates the legacy command spelling into generic parameters.
 */
export async function runSummarizeCommand(options: SummarizeCommandOptions): Promise<number> {
  const writeError = options.writeError ?? ((text: string) => process.stderr.write(`${text}\n`));
  try {
    const requestsDirectory = options.requestDirectory ?? await locateRequest(await resolveRequestDirectories(options), 'summarize');
    return await runRequestCommand({
      requestName: 'summarize',
      requestsDirectory,
      parameters: parameters(options),
      debug: options.debug,
      format: options.format,
      provider: options.provider,
      settings: compatibilitySettings(options),
      write: options.write,
      writeError,
    });
  } catch (error) {
    const message = boundedMessage(error instanceof Error ? error.message : 'The llm summarize command could not be completed.');
    writeError(`${JSON.stringify({ status: 'configuration_error', errors: [{ code: 'CONFIGURATION_INVALID', phase: 'configuration', message }] })}\n`);
    return 1;
  }
}