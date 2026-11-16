import { existsSync } from 'node:fs';
import { extname } from 'node:path';

export interface ParsedCliArguments {
  readonly debug: boolean;
  readonly json: boolean;
  readonly printChatId: boolean;
  readonly command: 'help' | 'version' | 'config' | 'prompt' | 'chat' | 'continue';
  readonly prompt?: string;
  readonly chatId?: string;
  readonly requestPath?: string;
  readonly exitCode?: number;
}

function parseFlags(args: readonly string[]): { readonly debug: boolean; readonly json: boolean; readonly printChatId: boolean; readonly args: string[] } {
  const debug = args.includes('--debug');
  const json = args.includes('--json');
  const printChatId = args.includes('--print-chat-id');
  return {
    debug,
    json,
    printChatId,
    args: args.filter((arg) => !['--debug', '--json', '--print-chat-id'].includes(arg)),
  };
}

export function parseCliArguments(args: readonly string[]): ParsedCliArguments {
  const parsed = parseFlags(args);
  const cleanArgs = parsed.args;
  const common = { debug: parsed.debug, json: parsed.json, printChatId: parsed.printChatId };
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

  const configMode = cleanArgs[0] === '--config';
  const requestPath = configMode ? cleanArgs[1] : cleanArgs[0];
  const valid = Boolean(requestPath) && (configMode ? cleanArgs.length === 2 : cleanArgs.length === 1);
  if (!valid) return { ...common, command: 'config', exitCode: 2 };
  if (configMode || existsSync(requestPath!) || extname(requestPath!) === '.json') return { ...common, command: 'config', requestPath };
  return { ...common, command: 'continue', prompt: requestPath };
}