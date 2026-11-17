import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { complete } from '../complete.js';
import type { LlmChatMessage, LlmProvider, LlmRequest } from '../types.js';
import { debugSink, printInputError, printResponse, type OutputWriter } from './output.js';
import type { ResponseFormat } from './arguments.js';

export async function runConfigCommand(requestPath: string, debug: boolean, format: ResponseFormat = 'full', provider?: LlmProvider, write?: OutputWriter, writeError?: OutputWriter): Promise<number> {
  try {
    const configurationFilePath = resolve(process.cwd(), requestPath);
    const request = JSON.parse(await readFile(configurationFilePath, 'utf8')) as LlmRequest;
    let rawOutput: string | undefined;
    const messageSink = (message: LlmChatMessage): void => {
      if (message.role === 'assistant' && message.content !== null) rawOutput = message.content;
    };
    const result = await complete(request, { configurationFilePath, debug: debugSink(debug), provider, messageSink });
    return printResponse(result, format, rawOutput, write, writeError);
  } catch {
    return printInputError(writeError);
  }
}