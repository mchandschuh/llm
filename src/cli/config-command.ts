import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { complete } from '../complete.js';
import type { LlmRequest } from '../types.js';
import { debugSink, printInputError, printResponse } from './output.js';

export async function runConfigCommand(requestPath: string, debug: boolean): Promise<number> {
  try {
    const configurationFilePath = resolve(process.cwd(), requestPath);
    const request = JSON.parse(await readFile(configurationFilePath, 'utf8')) as LlmRequest;
    const result = await complete(request, { configurationFilePath, debug: debugSink(debug) });
    return printResponse(result);
  } catch {
    return printInputError();
  }
}