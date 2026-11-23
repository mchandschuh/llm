import { parseCliArguments } from './cli/arguments.js';
import { runConfigCommand } from './cli/config-command.js';
import { runPromptCommand } from './cli/prompt-command.js';
import { runChatCommand } from './cli/chat-command.js';
import { runSummarizeCommand } from './cli/summarize-command.js';
import { printHelp, packageVersion } from './cli/help.js';
import { printUsageError } from './cli/output.js';

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseCliArguments(args);
  if (parsed.command === 'help') return printHelp();
  if (parsed.command === 'version') {
    console.log(await packageVersion());
    return 0;
  }
  if (parsed.exitCode !== undefined) return printUsageError();
  if (parsed.command === 'prompt') return runPromptCommand({ prompt: parsed.prompt!, debug: parsed.debug, format: parsed.format });
  if (parsed.command === 'chat') return runChatCommand({ prompt: parsed.prompt!, chatId: parsed.chatId, continuation: false, debug: parsed.debug, format: parsed.format, printChatId: parsed.printChatId });
  if (parsed.command === 'continue') return runChatCommand({ prompt: parsed.prompt!, continuation: true, debug: parsed.debug, format: parsed.format, printChatId: parsed.printChatId });
  if (parsed.command === 'summarize') return runSummarizeCommand({ path: parsed.summarizePath, content: parsed.summarizeContent, debug: parsed.debug, format: parsed.format });
  return runConfigCommand(parsed.requestPath!, parsed.debug, parsed.format);
}
