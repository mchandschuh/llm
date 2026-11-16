import { parseCliArguments } from './cli/arguments.js';
import { runConfigCommand } from './cli/config-command.js';
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
  return runConfigCommand(parsed.requestPath!, parsed.debug);
}
