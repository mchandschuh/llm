import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packagePath = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json');
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const requestSchemaPath = resolve(repositoryRoot, 'llm/schemas/request/v1/request.schema.json');
const responseSchemaPath = resolve(repositoryRoot, 'llm/schemas/response/v1/response.schema.json');

async function version(): Promise<string> {
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as { version: string };
  return packageJson.version;
}

function help(): number {
  console.log('Usage: llm <request.json>');
  console.log('       llm --config <request.json>');
  console.log('       llm --help');
  console.log('\nRun one provider-backed completion from a JSON request configuration.');
  console.log('The --help path loads package metadata only and does not initialize a provider.');
  console.log(`\nMinimal request (${requestSchemaPath}):`);
  console.log('{');
  console.log('  "schema": "https://schemas.handschuh.dev/llm/request/v1",');
  console.log('  "task": "Summarize the current work item.",');
  console.log('  "systemPrompt": "Return a concise plain-text summary."');
  console.log('}');
  console.log(`\nSuccessful raw-text response (${responseSchemaPath}):`);
  console.log('{');
  console.log('  "schema": "https://schemas.handschuh.dev/llm/response/v1",');
  console.log('  "status": "success",');
  console.log('  "output": {');
  console.log('    "$type": "string",');
  console.log('    "schema": null,');
  console.log('    "value": "The work item is ready for decomposition."');
  console.log('  },');
  console.log('  "failedAttempts": 0,');
  console.log('  "iterations": 1,');
  console.log('  "errors": []');
  console.log('}');
  return 0;
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') return help();
  if (args[0] === '--version' || args[0] === '-v') {
    console.log(await version());
    return 0;
  }
  const path = args[0] === '--config' ? args[1] : args[0];
  if (!path || (args[0] === '--config' && args.length !== 2) || (args[0] !== '--config' && args.length !== 1)) {
    console.error('Usage: llm <request.json>');
    return 2;
  }
  try {
    const configurationFilePath = resolve(process.cwd(), path);
    const request = JSON.parse(await readFile(configurationFilePath, 'utf8')) as unknown;
    const { complete } = await import('./complete.js');
    const result = await complete(request, { configurationFilePath });
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'success' ? 0 : 1;
  } catch {
    console.error(JSON.stringify({ status: 'input_invalid', message: 'The request file could not be read or parsed.' }));
    return 1;
  }
}
