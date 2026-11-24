import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import type { Thinking } from '../types.js';

export type ResponseFormat = 'full' | 'raw';

export interface ParsedCliArguments {
  readonly debug: boolean;
  readonly format: ResponseFormat;
  readonly printChatId: boolean;
  readonly command: 'help' | 'version' | 'config' | 'prompt' | 'chat' | 'continue' | 'summarize';
  readonly prompt?: string;
  readonly chatId?: string;
  readonly requestPath?: string;
  readonly summarizePath?: string;
  readonly summarizeContent?: string;
  readonly summarizeProvider?: string;
  readonly summarizeModel?: string;
  readonly summarizeThinking?: Thinking;
  readonly exitCode?: number;
}

function parseFlags(args: readonly string[]): { readonly debug: boolean; readonly format: ResponseFormat; readonly printChatId: boolean; readonly invalid: boolean; readonly args: string[] } {
  const cleanArgs: string[] = [];
  let format: ResponseFormat = 'raw';
  let formatSpecified = false;
  let invalid = false;
  let debug = false;
  let printChatId = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--debug') {
      debug = true;
      continue;
    }
    if (arg === '--print-chat-id') {
      printChatId = true;
      continue;
    }
    if (arg === '--json') {
      invalid = true;
      continue;
    }
    if (arg === '--format' || arg.startsWith('--format=')) {
      const value = arg === '--format' ? args[++index] : arg.slice('--format='.length);
      if (formatSpecified || (value !== 'full' && value !== 'raw')) {
        invalid = true;
      } else {
        format = value;
        formatSpecified = true;
      }
      continue;
    }
    cleanArgs.push(arg);
  }

  return {
    debug,
    format,
    printChatId,
    invalid,
    args: cleanArgs,
  };
}

function summarizeOptionValue(value: string): { readonly name: 'path' | 'content' | 'provider' | 'model' | 'thinking'; readonly value: string } | undefined {
  for (const name of ['path', 'content', 'provider', 'model', 'thinking'] as const) {
    const prefix = `--${name}=`;
    if (value.startsWith(prefix)) return { name, value: value.slice(prefix.length) };
  }
  return undefined;
}

const THINKING_VALUES = new Set<Thinking>(['minimal', 'low', 'medium', 'high', 'xhigh']);
const PROVIDER_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/u;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;

function parseSummarizeArguments(args: readonly string[], common: { readonly debug: boolean; readonly format: ResponseFormat; readonly printChatId: boolean }): ParsedCliArguments {
  if (common.printChatId) return { ...common, command: 'summarize', exitCode: 2 };
  let path: string | undefined;
  let content: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;
  let thinking: Thinking | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]!;
    const inline = summarizeOptionValue(argument);
    const option = inline ? inline.name : ['path', 'content', 'provider', 'model', 'thinking'].includes(argument.slice(2)) ? argument.slice(2) as 'path' | 'content' | 'provider' | 'model' | 'thinking' : undefined;
    if (!option) return { ...common, command: 'summarize', exitCode: 2 };
    const value = inline ? inline.value : args[++index];
    if (!value) return { ...common, command: 'summarize', exitCode: 2 };
    if (option === 'path') {
      if (path !== undefined || !value) return { ...common, command: 'summarize', exitCode: 2 };
      path = value;
    } else if (option === 'content') {
      if (content !== undefined || !value) return { ...common, command: 'summarize', exitCode: 2 };
      content = value;
    } else if (option === 'provider') {
      if (provider !== undefined || !PROVIDER_PATTERN.test(value)) return { ...common, command: 'summarize', exitCode: 2 };
      provider = value;
    } else if (option === 'model') {
      if (model !== undefined || !MODEL_PATTERN.test(value)) return { ...common, command: 'summarize', exitCode: 2 };
      model = value;
    } else {
      if (thinking !== undefined || !THINKING_VALUES.has(value as Thinking)) return { ...common, command: 'summarize', exitCode: 2 };
      thinking = value as Thinking;
    }
  }
  if ((path === undefined) === (content === undefined)) return { ...common, command: 'summarize', exitCode: 2 };
  return {
    ...common,
    command: 'summarize',
    ...(path !== undefined ? { summarizePath: path } : { summarizeContent: content }),
    ...(provider !== undefined ? { summarizeProvider: provider } : {}),
    ...(model !== undefined ? { summarizeModel: model } : {}),
    ...(thinking !== undefined ? { summarizeThinking: thinking } : {}),
  };
}

export function parseCliArguments(args: readonly string[]): ParsedCliArguments {
  const parsed = parseFlags(args);
  const cleanArgs = parsed.args;
  const common = { debug: parsed.debug, format: parsed.format, printChatId: parsed.printChatId };
  if (parsed.invalid) return { ...common, command: 'config', exitCode: 2 };
  if (cleanArgs.length === 0 || cleanArgs[0] === '--help' || cleanArgs[0] === '-h') return { ...common, command: 'help', exitCode: 0 };
  if (cleanArgs[0] === '--version' || cleanArgs[0] === '-v') return { ...common, command: 'version', exitCode: 0 };

  if (cleanArgs[0] === '-p' || cleanArgs[0] === '--prompt') {
    if (cleanArgs.length !== 2 || !cleanArgs[1]) return { ...common, command: 'prompt', exitCode: 2 };
    return { ...common, command: 'prompt', prompt: cleanArgs[1] };
  }

  if (cleanArgs[0] === '-c' || cleanArgs[0] === '--chat') {
    const chatIdIndex = cleanArgs.indexOf('--chat-id');
    const chatId = chatIdIndex >= 0 ? cleanArgs[chatIdIndex + 1] : undefined;
    const promptArgs = cleanArgs
      .filter((_arg, index) => chatIdIndex < 0 || (index !== chatIdIndex && index !== chatIdIndex + 1))
      .slice(1);
    if (chatIdIndex >= 0 && (!chatId || promptArgs.length !== 1)) return { ...common, command: 'chat', exitCode: 2 };
    if (promptArgs.length !== 1) return { ...common, command: 'chat', exitCode: 2 };
    return { ...common, command: 'chat', prompt: promptArgs[0], ...(chatId ? { chatId } : {}) };
  }

  if (cleanArgs[0] === 'summarize') return parseSummarizeArguments(cleanArgs, common);

  const configMode = cleanArgs[0] === '--config';
  const requestPath = configMode ? cleanArgs[1] : cleanArgs[0];
  const valid = Boolean(requestPath) && (configMode ? cleanArgs.length === 2 : cleanArgs.length === 1);
  if (!valid) return { ...common, command: 'config', exitCode: 2 };
  if (configMode || existsSync(requestPath!) || extname(requestPath!) === '.json') return { ...common, command: 'config', requestPath };
  return { ...common, command: 'continue', prompt: requestPath };
}