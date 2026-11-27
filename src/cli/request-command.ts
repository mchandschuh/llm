import { completeRequest } from '../request.js';
import type { RequestParameterAssignment } from '../request-parameters.js';
import { boundedMessage } from '../errors.js';
import { ParameterValidationFailure, parameterIssueMessage } from '../request-parameter-validation.js';
import { RESPONSE_SCHEMA, type LlmResponse, type LlmProvider } from '../types.js';
import type { RequestSettingsOverrides } from '../types.js';
import { debugSink, printResponse, type OutputWriter } from './output.js';
import type { ResponseFormat } from './arguments.js';

export interface RequestCommandOptions {
  readonly requestName: string;
  readonly requestsDirectory?: string;
  readonly parameters?: string;
  readonly assignments?: readonly RequestParameterAssignment[];
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

export async function runRequestCommand(options: RequestCommandOptions): Promise<number> {
  const writeError = options.writeError ?? ((text: string) => process.stderr.write(`${text}\n`));
  try {
    const result = await completeRequest({
      requestName: options.requestName,
      requestsDirectory: options.requestsDirectory,
      parameters: options.parameters,
      assignments: options.assignments,
      settings: options.settings,
      debug: debugSink(options.debug),
      provider: options.provider,
    });
    return printResponse(responseFromProvider(result.content), options.format ?? 'raw', result.content ?? '', options.write, writeError);
  } catch (error) {
    writeError(`${JSON.stringify({ status: 'configuration_error', errors: errorEntries(error) })}\n`);
    return 1;
  }
}

/** One error entry per parameter-validation issue, so users and agents see every fix; otherwise one entry. */
function errorEntries(error: unknown): readonly Record<string, string>[] {
  if (error instanceof ParameterValidationFailure) {
    return error.issues.map((issue) => ({
      code: error.code,
      phase: error.phase,
      message: parameterIssueMessage(issue),
      parameterPath: issue.path,
      ...(issue.remediation === undefined ? {} : { remediation: issue.remediation }),
    }));
  }
  const message = boundedMessage(error instanceof Error ? error.message : 'The llm req command could not be completed.');
  return [{ code: 'CONFIGURATION_INVALID', phase: 'configuration', message }];
}