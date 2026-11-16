import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCliArguments } from '../src/cli/arguments.js';
import { runPromptCommand } from '../src/cli/prompt-command.js';
import { runChatCommand } from '../src/cli/chat-command.js';
import { loadChatSession, saveChatSession } from '../src/chat-session-store.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('fresh chat start replaces explicit-ID state and emits export-only handoff', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-cli-chat-'));
  await saveChatSession({
    chatId: 'chat-1',
    request: { schema: 'https://schemas.handschuh.dev/llm/request/v1', task: 'old task', systemPrompt: 'old system' },
    history: [{ role: 'user', content: 'old history' }],
  }, { rootDirectory: root });
  const originalLog = console.log;
  const originalError = console.error;
  const output: string[] = [];
  const errors: string[] = [];
  const providerRequests: Array<{ readonly messages?: readonly { readonly role: string; readonly content: unknown }[] }> = [];
  console.log = (...values: unknown[]) => output.push(values.join(' '));
  console.error = (...values: unknown[]) => errors.push(values.join(' '));
  try {
    assert.equal(await runChatCommand({
      chatId: 'chat-1',
      prompt: 'fresh prompt',
      continuation: false,
      debug: false,
      json: false,
      printChatId: true,
      rootDirectory: root,
      provider: {
        async complete(request) {
          providerRequests.push(request);
          return { content: 'fresh answer', toolCalls: [], decision: 'stop' };
        },
      },
    }), 0);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  assert.deepEqual(output, ['export LLM_CHAT_ID="chat-1"']);
  assert.deepEqual(errors, ['fresh answer']);
  assert.deepEqual(providerRequests[0]?.messages?.map((message) => message.role), ['system', 'user']);
  assert.equal(providerRequests[0]?.messages?.filter((message) => message.role === 'user').length, 1);
  assert.match(String(providerRequests[0]?.messages?.[1]?.content), /^<llmPrompt version="1">/u);
  assert.match(String(providerRequests[0]?.messages?.[1]?.content), /fresh prompt/u);
  const persisted = await loadChatSession('chat-1', { rootDirectory: root });
  assert.equal(persisted?.history.some((message) => message.role === 'user' && message.content === 'old history'), false);
  assert.equal(persisted?.history.some((message) => message.role === 'user' && message.content.includes('fresh prompt')), true);
  assert.equal(persisted?.history.some((message) => message.role === 'user' && message.content.startsWith('<llmPrompt version="1">')), true);
});

test('subsequent bare continuation rehydrates history through LLM_CHAT_ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-cli-chat-'));
  const originalChatId = process.env.LLM_CHAT_ID;
  process.env.LLM_CHAT_ID = 'chat-1';
  try {
    await runChatCommand({ chatId: 'chat-1', prompt: 'first', continuation: false, debug: false, json: false, printChatId: false, rootDirectory: root, provider: fakeProvider('first answer') });
    const calls: Array<{ messages?: readonly unknown[] }> = [];
    const provider: LlmProvider = { async complete(request) { calls.push(request); return { content: 'second answer', toolCalls: [], decision: 'stop' }; } };
    assert.equal(await runChatCommand({ prompt: 'second', continuation: true, debug: false, json: false, printChatId: false, rootDirectory: root, provider }), 0);
    assert.equal(JSON.stringify(calls[0]?.messages).includes('first'), true);
    assert.equal(calls[0]?.messages?.filter((message) => message.role === 'user').every((message) => message.content.includes('<llmPrompt version="1">')), true);
  } finally {
    if (originalChatId === undefined) delete process.env.LLM_CHAT_ID;
    else process.env.LLM_CHAT_ID = originalChatId;
  }
});

test('continuation without an ambient handoff fails before any provider call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-cli-chat-'));
  const originalChatId = process.env.LLM_CHAT_ID;
  delete process.env.LLM_CHAT_ID;
  let called = false;
  const originalError = console.error;
  const errors: string[] = [];
  console.error = (...values: unknown[]) => errors.push(values.join(' '));
  try {
    assert.equal(await runChatCommand({ prompt: 'continue', continuation: true, debug: false, json: false, printChatId: false, rootDirectory: root, provider: { async complete() { called = true; return { content: 'unexpected', toolCalls: [], decision: 'stop' }; } } }), 1);
  } finally {
    console.error = originalError;
    if (originalChatId === undefined) delete process.env.LLM_CHAT_ID;
    else process.env.LLM_CHAT_ID = originalChatId;
  }
  assert.equal(called, false);
  assert.match(errors.join('\n'), /No active chat session/u);
});