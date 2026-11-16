import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCliArguments } from '../src/cli/arguments.js';
import { runPromptCommand } from '../src/cli/prompt-command.js';
import type { LlmProvider } from '../src/types.js';

test('CLI parser preserves request-file and config modes', () => {
  assert.deepEqual(parseCliArguments(['request.json']), { debug: false, json: false, printChatId: false, command: 'config', requestPath: 'request.json' });
  assert.deepEqual(parseCliArguments(['--config', 'request.json', '--debug']), { debug: true, json: false, printChatId: false, command: 'config', requestPath: 'request.json' });
});

test('CLI parser routes help/version and rejects invalid config shapes', () => {
  assert.deepEqual(parseCliArguments([]), { debug: false, json: false, printChatId: false, command: 'help', exitCode: 0 });
  assert.deepEqual(parseCliArguments(['--help']), { debug: false, json: false, printChatId: false, command: 'help', exitCode: 0 });
  assert.deepEqual(parseCliArguments(['--version']), { debug: false, json: false, printChatId: false, command: 'version', exitCode: 0 });
  assert.deepEqual(parseCliArguments(['--config']), { debug: false, json: false, printChatId: false, command: 'config', exitCode: 2 });
  assert.deepEqual(parseCliArguments(['request.json', 'extra']), { debug: false, json: false, printChatId: false, command: 'config', exitCode: 2 });
});

test('CLI parser treats debug as an orthogonal output concern', () => {
  const parsed = parseCliArguments(['--debug', '--config', 'request.json']);
  assert.equal(parsed.debug, true);
  assert.equal(parsed.command, 'config');
  assert.equal(parsed.requestPath, 'request.json');
});

test('CLI parser routes one-shot prompt, fresh chat, and continuation modes', () => {
  assert.deepEqual(parseCliArguments(['-p', 'one shot', '--json']), { debug: false, json: true, printChatId: false, command: 'prompt', prompt: 'one shot' });
  assert.deepEqual(parseCliArguments(['-c', 'start', '--print-chat-id']), { debug: false, json: false, printChatId: true, command: 'chat', prompt: 'start' });
  assert.deepEqual(parseCliArguments(['-c', '--chat-id', 'project-a', 'start']), { debug: false, json: false, printChatId: false, command: 'chat', prompt: 'start', chatId: 'project-a' });
  assert.deepEqual(parseCliArguments(['continue this', '--json']), { debug: false, json: true, printChatId: false, command: 'continue', prompt: 'continue this' });
  assert.deepEqual(parseCliArguments(['-c']), { debug: false, json: false, printChatId: false, command: 'chat', exitCode: 2 });
});

function fakeProvider(response: string): LlmProvider {
  return { async complete() { return { content: response, toolCalls: [], decision: 'stop' }; } };
}

test('prompt command performs one completion and supports JSON output without session access', async () => {
  const original = console.log;
  const output: string[] = [];
  console.log = (...values: unknown[]) => output.push(values.join(' '));
  try {
    assert.equal(await runPromptCommand({ prompt: 'one shot', debug: false, json: false, provider: fakeProvider('prompt answer') }), 0);
  } finally {
    console.log = original;
  }
  assert.deepEqual(output, ['prompt answer']);
});

test('prompt command supports machine-readable JSON output', async () => {
  const original = console.log;
  const output: string[] = [];
  console.log = (...values: unknown[]) => output.push(values.join(' '));
  try {
    assert.equal(await runPromptCommand({ prompt: 'one shot', debug: false, json: true, provider: fakeProvider('json answer') }), 0);
  } finally {
    console.log = original;
  }
  assert.equal(JSON.parse(output[0]!).status, 'success');
});