import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stderrDebugSink } from './debug.js';

const packagePath = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json');
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requestSchemaPath = resolve(packageRoot, 'schemas/request/v1/request.schema.json');
const responseSchemaPath = resolve(packageRoot, 'schemas/response/v1/response.schema.json');
const requestSchemaV2Path = resolve(packageRoot, 'schemas/request/v2/request.schema.json');
const responseSchemaV2Path = resolve(packageRoot, 'schemas/response/v2/response.schema.json');

async function version(): Promise<string> {
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as { version: string };
  return packageJson.version;
}

function help(): number {
  console.log('Usage: llm <request.json>');
  console.log('       llm --config <request.json>');
  console.log('       llm --debug <request.json>');
  console.log('       llm --help');
  console.log('\nRun one provider-backed completion from a JSON request configuration.');
  console.log('The --help path loads package metadata only and does not initialize a provider.');
  console.log(`\nMinimal request (${requestSchemaPath}):`);
  console.log('{');
  console.log('  "schema": "https://schemas.handschuh.dev/llm/request/v1",');
  console.log('  "task": "Summarize the current work item.",');
  console.log('  "systemPrompt": "Return a concise plain-text summary."');
  console.log('}');
  console.log(`\nTool-capable request (${requestSchemaV2Path}):`);
  console.log('{');
  console.log('  "schema": "https://schemas.handschuh.dev/llm/request/v2",');
  console.log('  "task": "Inspect the current records.",');
  console.log('  "systemPrompt": "Use declared tools when needed.",');
  console.log('  "tools": [],');
  console.log('  "autoInvokeTools": false');
  console.log('}');
  console.log(`\nTool-capable response (${responseSchemaV2Path}) uses response/v2 status and counters.`);
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
  const debug = args.includes('--debug');
  const cleanArgs = args.filter((arg) => arg !== '--debug');
  if (cleanArgs.length === 0 || cleanArgs[0] === '--help' || cleanArgs[0] === '-h') return help();
  if (cleanArgs[0] === '--version' || cleanArgs[0] === '-v') {
    console.log(await version());
    return 0;
  }
  const path = cleanArgs[0] === '--config' ? cleanArgs[1] : cleanArgs[0];
  if (!path || (cleanArgs[0] === '--config' && cleanArgs.length !== 2) || (cleanArgs[0] !== '--config' && cleanArgs.length !== 1)) {
    console.error('Usage: llm <request.json>');
    return 2;
  }
  try {
    const configurationFilePath = resolve(process.cwd(), path);
    const request = JSON.parse(await readFile(configurationFilePath, 'utf8')) as import('./types.js').LlmRequest | import('./types.js').LlmRequestV2;
    const { complete } = await import('./complete.js');
    const result = await complete(request, { configurationFilePath, ...(debug ? { debug: stderrDebugSink() } : {}) });
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'success' ? 0 : 1;
  } catch {
    console.error(JSON.stringify({ status: 'input_invalid', message: 'The request file could not be read or parsed.' }));
    return 1;
  }
}
