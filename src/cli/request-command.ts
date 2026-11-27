import { rm } from 'node:fs/promises';
import { completeRequest } from '../request.js';
import { prepareAdditionalFiles } from '../request-parameter-files.js';
import type { RequestParameterAssignment } from '../request-parameters.js';
import { boundedMessage } from '../errors.js';
import { RESPONSE_SCHEMA, type LlmResponse, type LlmProvider } from '../types.js';
import type { RequestSettingsOverrides } from '../types.js';
import { debugSink, printResponse, type OutputWriter } from './output.js';
import type { ResponseFormat } from './arguments.js';

export interface RequestCommandOptions {
  readonly requestName: string;
  readonly requestsDirectory?: string;
  readonly parameters?: string;
  readonly assignments?: readonly RequestParameterAssignment[];
  readonly sourcePath?: string;
  readonly sourceContent?: string;
  readonly debug: boolean;
  readonly format?: ResponseFormat;
  readonly provider?: LlmProvider;
  readonly settings?: RequestSettingsOverrides;
  readonly write?: OutputWriter;
  readonly writeError?: OutputWriter;
}

function responseFromProvider(content: string | null): LlmResponse {
  return {
    schema: RESPONSE_SCHEMA,
    status: 'success',
    output: { $type: 'string', schema: null, value: content ?? '' },
    failedAttempts: 0,
    iterations: 1,
    toolRounds: 0,
    toolCalls: 0,
    toolResults: [],
    errors: [],
  };
}

function actionableErrorMessage(options: RequestCommandOptions, error: unknown): string {
  const message = boundedMessage(error instanceof Error ? error.message : 'The llm req command could not be completed.');
  if (
    options.sourceContent !== undefined
    && message.includes('resolved parameters do not satisfy the parameter schema')
    && message.includes("required property 'content'")
  ) {
    return `${message} The --content option supplies an additional input file; it does not set the request's content parameter. Use --p-content <value> (for example, llm req ${options.requestName} --p-content 'some-content').`;
  }
  return message;
}

export async function runRequestCommand(options: RequestCommandOptions): Promise<number> {
  const writeError = options.writeError ?? ((text: string) => process.stderr.write(`${text}\n`));
  let temporaryRoot: string | undefined;
  try {
    const preparedFiles = await prepareAdditionalFiles({ sourcePath: options.sourcePath, sourceContent: options.sourceContent });
    temporaryRoot = preparedFiles.temporaryRoot;
    const result = await completeRequest({
      requestName: options.requestName,
      requestsDirectory: options.requestsDirectory,
      parameters: options.parameters,
      assignments: options.assignments,
      files: preparedFiles.files,
      settings: options.settings,
      debug: debugSink(options.debug),
      provider: options.provider,
    });
    return printResponse(responseFromProvider(result.content), options.format ?? 'raw', result.content ?? '', options.write, writeError);
  } catch (error) {
    const message = actionableErrorMessage(options, error);
    writeError(`${JSON.stringify({ status: 'configuration_error', errors: [{ code: 'CONFIGURATION_INVALID', phase: 'configuration', message }] })}\n`);
    return 1;
  } finally {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  }
}