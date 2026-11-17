import { complete } from '../complete.js';
import type { LlmChatMessage, LlmProvider, LlmRequest } from '../types.js';
import { debugSink, printInputError, printResponse, type OutputWriter } from './output.js';
import type { ResponseFormat } from './arguments.js';

export interface PromptCommandOptions {
  readonly prompt: string;
  readonly debug: boolean;
  readonly format?: ResponseFormat;
  readonly provider?: LlmProvider;
  readonly write?: OutputWriter;
  readonly writeError?: OutputWriter;
}

export async function runPromptCommand(options: PromptCommandOptions): Promise<number> {
  const request: LlmRequest = {
    schema: 'https://schemas.handschuh.dev/llm/request/v1',
    task: options.prompt,
    systemPrompt: 'Respond helpfully and concisely.',
  };
  try {
    let rawOutput: string | undefined;
    const messageSink = (message: LlmChatMessage): void => {
      if (message.role === 'assistant' && message.content !== null) rawOutput = message.content;
    };
    const result = await complete(request, { debug: debugSink(options.debug), provider: options.provider, messageSink });
    return printResponse(result, options.format ?? 'full', rawOutput, options.write, options.writeError);
  } catch {
    return printInputError(options.writeError);
  }
}