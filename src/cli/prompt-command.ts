import { complete } from '../complete.js';
import type { LlmProvider, LlmRequest } from '../types.js';
import { debugSink, printInputError } from './output.js';

export interface PromptCommandOptions {
  readonly prompt: string;
  readonly debug: boolean;
  readonly json: boolean;
  readonly provider?: LlmProvider;
}

export async function runPromptCommand(options: PromptCommandOptions): Promise<number> {
  const request: LlmRequest = {
    schema: 'https://schemas.handschuh.dev/llm/request/v1',
    task: options.prompt,
    systemPrompt: 'Respond helpfully and concisely.',
  };
  try {
    const result = await complete(request, { debug: debugSink(options.debug), provider: options.provider });
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'success' ? 0 : 1;
  } catch {
    return printInputError();
  }
}