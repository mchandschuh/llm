import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseCliArguments, parseCliArgumentsAsync } from '../src/cli/arguments.js';
import { runPromptCommand } from '../src/cli/prompt-command.js';
import { runConfigCommand } from '../src/cli/config-command.js';
import { runChatCommand } from '../src/cli/chat-command.js';
import { ChatSessionStoreFactory } from '../src/chat-session-store.js';
import type { LlmProvider, ProviderCompletionRequest } from '../src/types.js';

async function withRequestCliFixture<T>(operation: () => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'llm-cli-req-'));
  const requests = join(root, 'requests');
  const request = join(requests, 'report');
  const previous = process.env.LLM_CONFIG;
  await mkdir(join(root, '.config'), { recursive: true });
  await mkdir(request, { recursive: true });
  await writeFile(join(root, '.config', 'config.json'), JSON.stringify({ requestsDirectory: requests }));
  await writeFile(join(root, 'config.json'), JSON.stringify({ requestsDirectory: requests }));
  await writeFile(join(request, 'report.prompt.md'), 'prompt');
  await writeFile(join(request, 'report.parameters.schema.json'), JSON.stringify({
    type: 'object',
    additionalProperties: false,
    properties: {
      audience: { type: 'string' },
      filters: { type: 'object', properties: { owner: { type: 'string' } }, additionalProperties: false },
      sections: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' } }, additionalProperties: false } },
      metadata: { type: 'object', additionalProperties: true },
    },
  }));
  process.env.LLM_CONFIG = root;
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.LLM_CONFIG;
    else process.env.LLM_CONFIG = previous;
    await rm(root, { recursive: true, force: true });
  }
}

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

test('CLI parser preserves request-file and config modes while defaulting to raw format and accepting both format spellings', () => {
  assert.deepEqual(parseCliArguments(['request.json']), { debug: false, format: 'raw', printChatId: false, command: 'config', requestPath: 'request.json' });
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
  assert.deepEqual(parseCliArguments([]), { debug: false, format: 'raw', printChatId: false, command: 'help', exitCode: 0 });
  assert.deepEqual(parseCliArguments(['--help', '--format=raw']), { debug: false, format: 'raw', printChatId: false, command: 'help', exitCode: 0 });
  assert.deepEqual(parseCliArguments(['--version']), { debug: false, format: 'raw', printChatId: false, command: 'version', exitCode: 0 });
  assert.equal(parseCliArguments(['request.json', 'extra']).exitCode, 2);
});

test('WI-0019-10000000_TC-REQ-SHAPE recognizes valid req names and rejects malformed forms', async () => {
  await withRequestCliFixture(async () => {
    assert.deepEqual(await parseCliArgumentsAsync(['req', 'report']), { debug: false, format: 'raw', printChatId: false, command: 'req', requestName: 'report' });
    assert.equal((await parseCliArgumentsAsync(['req'])).exitCode, 2);
    assert.equal((await parseCliArgumentsAsync(['req', 'report', '--unknown', 'value'])).exitCode, 2);
  });
});

test('WI-0019-10000000_TC-COMMON-OUTPUT-FLAGS preserves raw/full/debug selectors in req positions', async () => {
  await withRequestCliFixture(async () => {
    assert.deepEqual(await parseCliArgumentsAsync(['--debug', 'req', 'report', '--format=full']), { debug: true, format: 'full', printChatId: false, command: 'req', requestName: 'report' });
    assert.deepEqual(await parseCliArgumentsAsync(['req', 'report', '--format', 'raw', '--debug']), { debug: true, format: 'raw', printChatId: false, command: 'req', requestName: 'report' });
    assert.equal((await parseCliArgumentsAsync(['req', 'report', '--format=raw', '--format=full'])).exitCode, 2);
    assert.equal((await parseCliArgumentsAsync(['req', 'report', '--json'])).exitCode, 2);
  });
});

test('WI-0019-10000000_TC-PARAMETER-FORWARDING preserves full, dotted, indexed, and object-valued tokens', async () => {
  await withRequestCliFixture(async () => {
    assert.deepEqual(await parseCliArgumentsAsync([
      'req', 'report',
      '--parameters', '{"audience":"engineering"}',
      '--filters.owner', 'michael',
      '--sections[0].title=Status',
      '--metadata', '{"region":"us-east-1"}',
    ]), {
      debug: false,
      format: 'raw',
      printChatId: false,
      command: 'req',
      requestName: 'report',
      requestParameters: '{"audience":"engineering"}',
      requestAssignments: [
        { path: 'filters.owner', value: 'michael' },
        { path: 'sections[0].title', value: 'Status' },
        { path: 'metadata', value: '{"region":"us-east-1"}' },
      ],
    });
    assert.equal((await parseCliArgumentsAsync(['req', 'report', '--format=full', '--filters.owner', 'michael'])).requestAssignments?.[0]?.path, 'filters.owner');
  });
});

test('WI-0019-10000000_TC-EXISTING-MODES preserves existing parser mode shapes', async () => {
  await withRequestCliFixture(async () => {
    assert.deepEqual(await parseCliArgumentsAsync(['-p', 'prompt']), { debug: false, format: 'raw', printChatId: false, command: 'prompt', prompt: 'prompt' });
    assert.deepEqual(await parseCliArgumentsAsync(['summarize', '--content', 'text']), { debug: false, format: 'raw', printChatId: false, command: 'summarize', summarizeContent: 'text' });
    assert.deepEqual(await parseCliArgumentsAsync(['request.json']), { debug: false, format: 'raw', printChatId: false, command: 'config', requestPath: 'request.json' });
  });
});

test('prompt command performs one completion, defaults to exact raw model output, and supports the full response envelope', async () => {
  for (const format of [undefined, 'full', 'raw'] as const) {
    const calls: ProviderCompletionRequest[] = [];
    const output = await capture(({ write, writeError }) => runPromptCommand({ prompt: 'one shot', debug: false, format, provider: fakeProvider('model answer\nwith exact spacing', calls), write, writeError }));
    assert.equal(output.result, 0);
    assert.equal(calls.length, 1);
    if (format !== 'full') {
      assert.equal(output.stdout, 'model answer\nwith exact spacing');
    } else {
      const response = assertJson(output.stdout);
      assert.equal(response.status, 'success');
      assert.equal(response.output.value, 'model answer\nwith exact spacing');
    }
    assert.equal(output.stderr, '');
  }
});

test('config command defaults to raw and applies both explicit formats with an injected fake provider', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-cli-format-'));
  const requestPath = join(root, 'request.json');
  await writeFile(requestPath, JSON.stringify({
    schema: 'https://schemas.handschuh.dev/llm/request/v1',
    task: 'configured task',
    systemPrompt: 'Respond.',
  }));
  for (const format of [undefined, 'full', 'raw'] as const) {
    const output = await capture(({ write, writeError }) => runConfigCommand(requestPath, false, format, fakeProvider('configured answer'), write, writeError));
    assert.equal(output.result, 0);
    if (format !== 'full') assert.equal(output.stdout, 'configured answer');
    else assert.equal(assertJson(output.stdout).output.value, 'configured answer');
    assert.equal(output.stderr, '');
  }
});

test('fresh chat start replaces explicit-ID state, defaults to raw, and preserves export-only handoff', async () => {
  for (const format of [undefined, 'full', 'raw'] as const) {
    const root = await mkdtemp(join(tmpdir(), 'llm-cli-chat-'));
    const chatId = `format-${format ?? 'default'}`;
    const output = await capture(({ write, writeError, writeHandoff }) => runChatCommand({
      chatId,
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
    assert.equal(output.stdout, `export LLM_CHAT_ID="${chatId}"\n`);
    if (format !== 'full') assert.equal(output.stderr, 'fresh answer');
    else assert.equal(assertJson(output.stderr).output.value, 'fresh answer');
    assert.equal((await ChatSessionStoreFactory.createChatSessionStore({ type: 'tempFile', rootDirectory: root }).load(chatId))?.chatId, chatId);
  }
});

test('subsequent bare continuation rehydrates history, defaults to raw, and applies both explicit formats', async () => {
  const originalChatId = process.env.LLM_CHAT_ID;
  const root = await mkdtemp(join(tmpdir(), 'llm-cli-chat-'));
  process.env.LLM_CHAT_ID = 'continued-chat';
  try {
    await ChatSessionStoreFactory.createChatSessionStore({ type: 'tempFile', rootDirectory: root }).save({
      chatId: 'continued-chat',
      request: { schema: 'https://schemas.handschuh.dev/llm/request/v1', task: 'start', systemPrompt: 'Respond.' },
      history: [
        { role: 'system', content: 'Respond.' },
        { role: 'user', content: 'previous prompt' },
        { role: 'assistant', content: 'previous answer', toolCalls: [] },
      ],
    });
    for (const format of [undefined, 'full', 'raw'] as const) {
      const requests: ProviderCompletionRequest[] = [];
      const output = await capture(({ write, writeError }) => runChatCommand({ prompt: 'continue', continuation: true, debug: false, format, printChatId: false, rootDirectory: root, provider: fakeProvider('continued answer', requests), write, writeError }));
      assert.equal(output.result, 0);
      assert.equal(requests.length, 1);
      assert.match(JSON.stringify(requests[0]?.messages), /previous answer/u);
      if (format !== 'full') assert.equal(output.stdout, 'continued answer');
      else assert.equal(assertJson(output.stdout).output.value, 'continued answer');
    }
  } finally {
    if (originalChatId === undefined) delete process.env.LLM_CHAT_ID;
    else process.env.LLM_CHAT_ID = originalChatId;
  }
});

test('default, raw, and full formats serialize provider errors identically as JSON', async () => {
  for (const format of [undefined, 'raw', 'full'] as const) {
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
    if (format === undefined) {
      const rawOutput = await capture(({ write, writeError }) => runPromptCommand({ prompt: 'failure', debug: false, format: 'raw', provider: {
        async complete() { throw new Error('provider unavailable'); },
      }, write, writeError }));
      assert.equal(output.stderr, rawOutput.stderr);
    }
  }
});

test('default, raw, and full formats serialize pre-provider chat errors as JSON without calling the fake provider', async () => {
  const originalChatId = process.env.LLM_CHAT_ID;
  delete process.env.LLM_CHAT_ID;
  try {
    for (const format of [undefined, 'raw', 'full'] as const) {
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