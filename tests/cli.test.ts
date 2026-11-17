import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseCliArguments } from '../src/cli/arguments.js';
import { runPromptCommand } from '../src/cli/prompt-command.js';
import { runConfigCommand } from '../src/cli/config-command.js';
import { runChatCommand } from '../src/cli/chat-command.js';
import { loadChatSession, saveChatSession } from '../src/chat-session-store.js';
import type { LlmProvider, ProviderCompletionRequest } from '../src/types.js';

interface CapturedOutput<T> {
  readonly result: T;
  readonly stdout: string;
  readonly stderr: string;
}

interface OutputWriters {
  readonly write: (text: string) => void;
  readonly writeError: (text: string) => void;
  readonly writeHandoff: (text: string) => void;
}

async function capture<T>(operation: (writers: OutputWriters) => Promise<T>): Promise<CapturedOutput<T>> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const write = (text: string): void => stdout.push(text);
  const writeError = (text: string): void => stderr.push(text);
  return { result: await operation({ write, writeError, writeHandoff: write }), stdout: stdout.join(''), stderr: stderr.join('') };
}

function fakeProvider(response: string, calls: ProviderCompletionRequest[] = []): LlmProvider {
  return {
    async complete(request) {
      calls.push(request);
      return { content: response, toolCalls: [], decision: 'stop' };
    },
  };
}

function assertJson(value: string): Record<string, any> {
  return JSON.parse(value) as Record<string, any>;
}

test('CLI parser preserves request-file and config modes while defaulting to full format and accepting both format spellings', () => {
  assert.deepEqual(parseCliArguments(['request.json']), { debug: false, format: 'full', printChatId: false, command: 'config', requestPath: 'request.json' });
  assert.deepEqual(parseCliArguments(['--config', 'request.json', '--format=raw', '--debug']), { debug: true, format: 'raw', printChatId: false, command: 'config', requestPath: 'request.json' });
  assert.deepEqual(parseCliArguments(['-p', 'one shot', '--format', 'full']), { debug: false, format: 'full', printChatId: false, command: 'prompt', prompt: 'one shot' });
  assert.deepEqual(parseCliArguments(['-c', 'start', '--format=raw', '--print-chat-id']), { debug: false, format: 'raw', printChatId: true, command: 'chat', prompt: 'start' });
  assert.deepEqual(parseCliArguments(['continue this', '--format=raw']), { debug: false, format: 'raw', printChatId: false, command: 'continue', prompt: 'continue this' });
});

test('CLI parser rejects missing, invalid, duplicate, and legacy output selectors', () => {
  for (const args of [
    ['--format'],
    ['--format=pretty', 'request.json'],
    ['--format=raw', '--format=full', 'request.json'],
    ['--json', 'request.json'],
  ]) {
    assert.equal(parseCliArguments(args).exitCode, 2, args.join(' '));
  }
  assert.deepEqual(parseCliArguments([]), { debug: false, format: 'full', printChatId: false, command: 'help', exitCode: 0 });
  assert.deepEqual(parseCliArguments(['--help', '--format=raw']), { debug: false, format: 'raw', printChatId: false, command: 'help', exitCode: 0 });
  assert.deepEqual(parseCliArguments(['--version']), { debug: false, format: 'full', printChatId: false, command: 'version', exitCode: 0 });
  assert.equal(parseCliArguments(['request.json', 'extra']).exitCode, 2);
});

test('prompt command performs one completion and prints exact raw model output or the full response envelope', async () => {
  for (const format of ['full', 'raw'] as const) {
    const calls: ProviderCompletionRequest[] = [];
    const output = await capture(({ write, writeError }) => runPromptCommand({ prompt: 'one shot', debug: false, format, provider: fakeProvider('model answer\nwith exact spacing', calls), write, writeError }));
    assert.equal(output.result, 0);
    assert.equal(calls.length, 1);
    if (format === 'raw') {
      assert.equal(output.stdout, 'model answer\nwith exact spacing');
    } else {
      const response = assertJson(output.stdout);
      assert.equal(response.status, 'success');
      assert.equal(response.output.value, 'model answer\nwith exact spacing');
    }
    assert.equal(output.stderr, '');
  }
});

test('config command applies both formats with an injected fake provider', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-cli-format-'));
  const requestPath = join(root, 'request.json');
  await writeFile(requestPath, JSON.stringify({
    schema: 'https://schemas.handschuh.dev/llm/request/v1',
    task: 'configured task',
    systemPrompt: 'Respond.',
  }));
  for (const format of ['full', 'raw'] as const) {
    const output = await capture(({ write, writeError }) => runConfigCommand(requestPath, false, format, fakeProvider('configured answer'), write, writeError));
    assert.equal(output.result, 0);
    if (format === 'raw') assert.equal(output.stdout, 'configured answer');
    else assert.equal(assertJson(output.stdout).output.value, 'configured answer');
    assert.equal(output.stderr, '');
  }
});

test('fresh chat start replaces explicit-ID state, applies both formats, and preserves export-only handoff', async () => {
  for (const format of ['full', 'raw'] as const) {
    const root = await mkdtemp(join(tmpdir(), 'llm-cli-chat-'));
    const output = await capture(({ write, writeError, writeHandoff }) => runChatCommand({
      chatId: `format-${format}`,
      prompt: 'fresh prompt',
      continuation: false,
      debug: false,
      format,
      printChatId: true,
      rootDirectory: root,
      provider: fakeProvider('fresh answer'),
      write,
      writeError,
      writeHandoff,
    }));
    assert.equal(output.result, 0);
    assert.match(output.stdout, /^export LLM_CHAT_ID="format-(full|raw)"\n$/u);
    if (format === 'raw') assert.equal(output.stderr, 'fresh answer');
    else assert.equal(assertJson(output.stderr).output.value, 'fresh answer');
    assert.equal((await loadChatSession(`format-${format}`, { rootDirectory: root }))?.chatId, `format-${format}`);
  }
});

test('subsequent bare continuation rehydrates history through LLM_CHAT_ID and applies both formats', async () => {
  const originalChatId = process.env.LLM_CHAT_ID;
  const root = await mkdtemp(join(tmpdir(), 'llm-cli-chat-'));
  process.env.LLM_CHAT_ID = 'continued-chat';
  try {
    await saveChatSession({
      chatId: 'continued-chat',
      request: { schema: 'https://schemas.handschuh.dev/llm/request/v1', task: 'start', systemPrompt: 'Respond.' },
      history: [
        { role: 'system', content: 'Respond.' },
        { role: 'user', content: 'previous prompt' },
        { role: 'assistant', content: 'previous answer', toolCalls: [] },
      ],
    }, { rootDirectory: root });
    for (const format of ['full', 'raw'] as const) {
      const requests: ProviderCompletionRequest[] = [];
      const output = await capture(({ write, writeError }) => runChatCommand({ prompt: 'continue', continuation: true, debug: false, format, printChatId: false, rootDirectory: root, provider: fakeProvider('continued answer', requests), write, writeError }));
      assert.equal(output.result, 0);
      assert.equal(requests.length, 1);
      assert.match(JSON.stringify(requests[0]?.messages), /previous answer/u);
      if (format === 'raw') assert.equal(output.stdout, 'continued answer');
      else assert.equal(assertJson(output.stdout).output.value, 'continued answer');
    }
  } finally {
    if (originalChatId === undefined) delete process.env.LLM_CHAT_ID;
    else process.env.LLM_CHAT_ID = originalChatId;
  }
});

test('raw and full formats serialize provider errors identically as JSON', async () => {
  for (const format of ['full', 'raw'] as const) {
    let calls = 0;
    const provider: LlmProvider = {
      async complete() {
        calls += 1;
        throw new Error('provider unavailable');
      },
    };
    const output = await capture(({ write, writeError }) => runPromptCommand({ prompt: 'failure', debug: false, format, provider, write, writeError }));
    assert.equal(output.result, 1);
    assert.equal(calls, 3);
    const response = assertJson(output.stderr);
    assert.equal(response.status, 'attempts_exhausted');
    assert.equal(response.errors[0].code, 'ATTEMPTS_EXHAUSTED');
    assert.equal(output.stdout, '');
    if (format === 'full') {
      const rawOutput = await capture(({ write, writeError }) => runPromptCommand({ prompt: 'failure', debug: false, format: 'raw', provider: {
        async complete() { throw new Error('provider unavailable'); },
      }, write, writeError }));
      assert.equal(output.stderr, rawOutput.stderr);
    }
  }
});

test('raw and full formats serialize pre-provider chat errors as JSON without calling the fake provider', async () => {
  const originalChatId = process.env.LLM_CHAT_ID;
  delete process.env.LLM_CHAT_ID;
  try {
    for (const format of ['full', 'raw'] as const) {
      let called = false;
      const output = await capture(({ write, writeError }) => runChatCommand({
        prompt: 'continue',
        continuation: true,
        debug: false,
        format,
        printChatId: false,
        provider: { async complete() { called = true; return { content: 'unexpected', toolCalls: [], decision: 'stop' }; } },
        write,
        writeError,
      }));
      assert.equal(output.result, 1);
      assert.equal(called, false);
      assert.equal(assertJson(output.stderr).errors[0].code, 'CONFIGURATION_INVALID');
      assert.equal(output.stdout, '');
    }
  } finally {
    if (originalChatId === undefined) delete process.env.LLM_CHAT_ID;
    else process.env.LLM_CHAT_ID = originalChatId;
  }
});