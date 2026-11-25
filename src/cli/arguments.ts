import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import type { Thinking } from '../types.js';
import { resolveRequestsDirectory } from '../requests-config.js';
import { loadRequestDirectory } from '../request-directory.js';
import type { RequestParameterAssignment } from '../request-parameters.js';

export type ResponseFormat = 'full' | 'raw';

export interface ParsedCliArguments {
  readonly debug: boolean;
  readonly format: ResponseFormat;
  readonly printChatId: boolean;
  readonly command: 'help' | 'version' | 'config' | 'prompt' | 'chat' | 'continue' | 'summarize' | 'req';
  readonly prompt?: string;
  readonly chatId?: string;
  readonly requestPath?: string;
  readonly summarizePath?: string;
  readonly summarizeContent?: string;
  readonly summarizeProvider?: string;
  readonly summarizeModel?: string;
  readonly summarizeThinking?: Thinking;
  readonly requestName?: string;
  readonly requestParameters?: string;
  readonly requestAssignments?: readonly RequestParameterAssignment[];
  readonly requestSourcePath?: string;
  readonly requestSourceContent?: string;
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

function parameterRoots(schema: Record<string, unknown> | undefined): readonly string[] {
  if (!schema || !schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) return [];
  return Object.keys(schema.properties as Record<string, unknown>);
}

function assignmentToken(value: string, roots: readonly string[]): boolean {
  if (!value.startsWith('--') || value === '--parameters') return false;
  const path = value.slice(2).split('=', 1)[0];
  return roots.some((root) => path === root || path.startsWith(`${root}.`) || path.startsWith(`${root}[`));
}

async function parseRequestArguments(args: readonly string[], common: { readonly debug: boolean; readonly format: ResponseFormat; readonly printChatId: boolean }): Promise<ParsedCliArguments> {
  if (common.printChatId || args.length < 2) return { ...common, command: 'req', exitCode: 2 };
  const requestName = args[1]!;
  let requestsDirectory: string;
  let loaded;
  try {
    requestsDirectory = await resolveRequestsDirectory();
    loaded = await loadRequestDirectory(requestsDirectory, requestName);
  } catch {
    return { ...common, command: 'req', exitCode: 2 };
  }
  const roots = parameterRoots(loaded.assets.parametersSchema?.value);
  let parameters: string | undefined;
  const assignments: RequestParameterAssignment[] = [];
  let sourcePath: string | undefined;
  let sourceContent: string | undefined;
  for (let index = 2; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === '--path' || token.startsWith('--path=')) {
      if (sourcePath !== undefined || sourceContent !== undefined) return { ...common, command: 'req', exitCode: 2 };
      sourcePath = token === '--path' ? args[++index] : token.slice('--path='.length);
      if (!sourcePath) return { ...common, command: 'req', exitCode: 2 };
      continue;
    }
    if (token === '--content' || token.startsWith('--content=')) {
      if (sourcePath !== undefined || sourceContent !== undefined) return { ...common, command: 'req', exitCode: 2 };
      sourceContent = token === '--content' ? args[++index] : token.slice('--content='.length);
      if (!sourceContent) return { ...common, command: 'req', exitCode: 2 };
      continue;
    }
    if (token === '--parameters' || token.startsWith('--parameters=')) {
      if (parameters !== undefined) return { ...common, command: 'req', exitCode: 2 };
      parameters = token === '--parameters' ? args[++index] : token.slice('--parameters='.length);
      if (!parameters) return { ...common, command: 'req', exitCode: 2 };
      continue;
    }
    if (!assignmentToken(token, roots)) return { ...common, command: 'req', exitCode: 2 };
    const separator = token.indexOf('=');
    const pathToken = token.slice(2, separator === -1 ? undefined : separator);
    const value = separator === -1 ? args[++index] : token.slice(separator + 1);
    if (!value) return { ...common, command: 'req', exitCode: 2 };
    assignments.push({ path: pathToken, value });
  }
  return {
    ...common,
    command: 'req',
    requestName,
    ...(parameters === undefined ? {} : { requestParameters: parameters }),
    ...(assignments.length === 0 ? {} : { requestAssignments: assignments }),
    ...(sourcePath === undefined ? {} : { requestSourcePath: sourcePath }),
    ...(sourceContent === undefined ? {} : { requestSourceContent: sourceContent }),
  };
}

export async function parseCliArgumentsAsync(args: readonly string[]): Promise<ParsedCliArguments> {
  const parsed = parseFlags(args);
  const common = { debug: parsed.debug, format: parsed.format, printChatId: parsed.printChatId };
  if (!parsed.invalid && parsed.args[0] === 'req') return parseRequestArguments(parsed.args, common);
  return parseCliArguments(args);
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

  if (cleanArgs[0] === 'req') return { ...common, command: 'req', exitCode: 2 };

  const configMode = cleanArgs[0] === '--config';
  const requestPath = configMode ? cleanArgs[1] : cleanArgs[0];
  const valid = Boolean(requestPath) && (configMode ? cleanArgs.length === 2 : cleanArgs.length === 1);
  if (!valid) return { ...common, command: 'config', exitCode: 2 };
  if (configMode || existsSync(requestPath!) || extname(requestPath!) === '.json') return { ...common, command: 'config', requestPath };
  return { ...common, command: 'continue', prompt: requestPath };
}