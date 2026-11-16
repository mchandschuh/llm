export interface ParsedCliArguments {
  readonly debug: boolean;
  readonly command: 'help' | 'version' | 'config';
  readonly requestPath?: string;
  readonly exitCode?: number;
}

export function parseCliArguments(args: readonly string[]): ParsedCliArguments {
  const debug = args.includes('--debug');
  const cleanArgs = args.filter((arg) => arg !== '--debug');
  if (cleanArgs.length === 0 || cleanArgs[0] === '--help' || cleanArgs[0] === '-h') return { debug, command: 'help', exitCode: 0 };
  if (cleanArgs[0] === '--version' || cleanArgs[0] === '-v') return { debug, command: 'version', exitCode: 0 };
  const configMode = cleanArgs[0] === '--config';
  const requestPath = configMode ? cleanArgs[1] : cleanArgs[0];
  const valid = Boolean(requestPath) && (configMode ? cleanArgs.length === 2 : cleanArgs.length === 1);
  if (!valid) return { debug, command: 'config', exitCode: 2 };
  return { debug, command: 'config', requestPath };
}