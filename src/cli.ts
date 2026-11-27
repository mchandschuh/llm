import { parseCliArgumentsAsync } from './cli/arguments.js';
import { runConfigCommand } from './cli/config-command.js';
import { runPromptCommand } from './cli/prompt-command.js';
import { runChatCommand } from './cli/chat-command.js';
import { runSummarizeCommand } from './cli/summarize-command.js';
import { runRequestCommand } from './cli/request-command.js';
import { runRequestHelpCommand } from './cli/request-help.js';
import { printHelp, packageVersion } from './cli/help.js';
import { printUsageError } from './cli/output.js';
import { boundedMessage } from './errors.js';

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const parsed = await parseCliArgumentsAsync(args);
  if (parsed.command === 'help') return printHelp();
  if (parsed.command === 'version') {
    console.log(await packageVersion());
    return 0;
  }
  if (parsed.command === 'req-help') return runRequestHelpCommand({ requestName: parsed.requestName });
  if (parsed.command === 'req' && parsed.configurationError !== undefined) {
    // The same configuration_error envelope that `llm req` prints for failures after parsing.
    process.stderr.write(`${JSON.stringify({ status: 'configuration_error', errors: [{ code: 'CONFIGURATION_INVALID', phase: 'configuration', message: boundedMessage(parsed.configurationError) }] })}\n`);
    return 1;
  }
  if (parsed.exitCode !== undefined) return printUsageError(parsed.usageError);
  if (parsed.command === 'prompt') return runPromptCommand({ prompt: parsed.prompt!, debug: parsed.debug, format: parsed.format });
  if (parsed.command === 'chat') return runChatCommand({ prompt: parsed.prompt!, chatId: parsed.chatId, continuation: false, debug: parsed.debug, format: parsed.format, printChatId: parsed.printChatId });
  if (parsed.command === 'continue') return runChatCommand({ prompt: parsed.prompt!, continuation: true, debug: parsed.debug, format: parsed.format, printChatId: parsed.printChatId });
  if (parsed.command === 'summarize') return runSummarizeCommand({ path: parsed.summarizePath, content: parsed.summarizeContent, providerName: parsed.summarizeProvider, model: parsed.summarizeModel, thinking: parsed.summarizeThinking, debug: parsed.debug, format: parsed.format });
  if (parsed.command === 'req') return runRequestCommand({ requestName: parsed.requestName!, parameters: parsed.requestParameters, assignments: parsed.requestAssignments, debug: parsed.debug, format: parsed.format });
  return runConfigCommand(parsed.requestPath!, parsed.debug, parsed.format);
}
