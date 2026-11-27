import { readFile } from 'node:fs/promises';
import { packagePath, requestSchemaPath, responseSchemaPath } from './paths.js';

export async function packageVersion(): Promise<string> {
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as { version: string };
  return packageJson.version;
}

export function printHelp(): number {
  console.log('Usage: llm <request.json>');
  console.log('       llm --config <request.json>');
  console.log('       llm -p <prompt> [--format=full|raw]');
  console.log('       llm -c <prompt> [--format=full|raw] [--chat-id <id>] [--print-chat-id]');
  console.log('       llm summarize --path <path> [--provider <provider>] [--model <model>] [--thinking <thinking>] [--format=full|raw]');
  console.log('       llm summarize --content <text> [--provider <provider>] [--model <model>] [--thinking <thinking>] [--format=full|raw]');
  console.log('       llm req <request-name> [--parameters <json>] [--p-<path> <value>] [--format=full|raw] [--debug]');
  console.log('       llm req <request-name> -h|--help  # list the request parameters and how to set them');
  console.log('       llm req -h|--help  # list the available requests');
  console.log('       llm <prompt>  # continue the LLM_CHAT_ID session [--format=full|raw]');
  console.log('       llm --debug <request.json>');
  console.log('       llm --help');
  console.log('\nRun one provider-backed completion from a JSON request configuration.');
  console.log('Successful responses default to raw model output; use --format=full for the response envelope.');
  console.log('Errors are always emitted as JSON for both response formats.');
  console.log('The --help path loads package metadata only and does not initialize a provider.');
  console.log(`\nMinimal request (${requestSchemaPath}):`);
  console.log('{');
  console.log('  "schema": "https://schemas.handschuh.dev/llm/request/v1",');
  console.log('  "task": { "operation": "summarize", "target": "current work item" },');
  console.log('  "systemPrompt": "Return a concise plain-text summary."');
  console.log('}');
  console.log(`\nTool-capable request (${requestSchemaPath}):`);
  console.log('{');
  console.log('  "schema": "https://schemas.handschuh.dev/llm/request/v1",');
  console.log('  "task": { "operation": "inspect", "target": "current records" },');
  console.log('  "systemPrompt": "Use declared tools when needed.",');
  console.log('  "toolOptions": { "tools": [], "autoInvoke": false, "maxRounds": 3, "maxCalls": 128 }');
  console.log('}');
  console.log(`\nTool-capable responses use ${responseSchemaPath} with tool counters and results.`);
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