import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runRequestCommand } from '../src/cli/request-command.js';
import type { LlmProvider, ProviderCompletionRequest } from '../src/types.js';

interface Fixture {
  readonly root: string;
  readonly requests: string;
  readonly request: string;
}

interface CapturedOutput {
  readonly result: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'llm-request-cli-'));
  const requests = join(root, 'requests');
  const request = join(requests, 'report');
  await mkdir(request, { recursive: true });
  await mkdir(join(root, '.config'), { recursive: true });
  await writeFile(join(root, '.config', 'config.json'), JSON.stringify({ requestsDirectory: requests }));
  await writeFile(join(root, 'config.json'), JSON.stringify({ requestsDirectory: requests }));
  await Promise.all([
    writeFile(join(request, 'report.defaults.json'), JSON.stringify({ parameters: { audience: 'engineering' } })),
    writeFile(join(request, 'report.prompt.md'), 'Prepare a report for $${audience}$$.'),
    writeFile(join(request, 'report.parameters.schema.json'), JSON.stringify({
      type: 'object',
      additionalProperties: false,
      required: ['audience', 'filters'],
      properties: {
        audience: { type: 'string' },
        filters: {
          type: 'object',
          additionalProperties: false,
          required: ['owner'],
          properties: { owner: { type: 'string' } },
        },
      },
    })),
  ]);
  return { root, requests, request };
}

async function withConfiguration<T>(configurationRoot: string, operation: () => Promise<T>): Promise<T> {
  const previous = process.env.LLM_CONFIG;
  process.env.LLM_CONFIG = configurationRoot;
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.LLM_CONFIG;
    else process.env.LLM_CONFIG = previous;
  }
}

async function capture(operation: (write: (text: string) => void, writeError: (text: string) => void) => Promise<number>): Promise<CapturedOutput> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const result = await operation((text) => stdout.push(text), (text) => stderr.push(text));
  return { result, stdout: stdout.join(''), stderr: stderr.join('') };
}

function provider(response: string, calls: ProviderCompletionRequest[]): LlmProvider {
  return {
    async complete(request) {
      calls.push(request);
      return { content: response, toolCalls: [], decision: 'stop' };
    },
  };
}

test('WI-0020-10000000_TC-CONFIGURED-LOOKUP resolves the configured request and forwards schema parameters', async () => {
  const value = await fixture();
  const calls: ProviderCompletionRequest[] = [];
  try {
    const output = await withConfiguration(value.root, () => capture((write, writeError) => runRequestCommand({
      requestName: 'report',
      parameters: JSON.stringify({ filters: { owner: 'michael' } }),
      debug: false,
      provider: provider('report answer', calls),
      write,
      writeError,
    })));
    assert.equal(output.result, 0);
    assert.equal(output.stdout, 'report answer');
    assert.equal(output.stderr, '');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.task, 'Prepare a report for engineering.');
    const contentOutput = await withConfiguration(value.root, () => capture((write, writeError) => runRequestCommand({
      requestName: 'report',
      parameters: JSON.stringify({ audience: 'engineering' }),
      assignments: [{ path: 'filters.owner', value: 'michael' }],
      debug: false,
      provider: provider('content answer', calls),
      write,
      writeError,
    })));
    assert.equal(contentOutput.result, 0);
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.task, 'Prepare a report for engineering.');

    const missingConfiguration = await withConfiguration(join(value.root, 'missing-config'), () => capture((write, writeError) => runRequestCommand({
      requestName: 'report',
      debug: false,
      provider: provider('must not run', calls),
      write,
      writeError,
    })));
    assert.equal(missingConfiguration.result, 1);
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(missingConfiguration.stderr).errors[0].code, 'CONFIGURATION_INVALID');
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('WI-0020-10000000_TC-SHARED-COMPLETION constructs parameters once and rejects invalid input before provider use', async () => {
  const value = await fixture();
  const calls: ProviderCompletionRequest[] = [];
  try {
    const valid = await withConfiguration(value.root, () => capture((write, writeError) => runRequestCommand({
      requestName: 'report',
      assignments: [{ path: 'filters.owner', value: 'michael' }],
      debug: false,
      provider: provider('done', calls),
      write,
      writeError,
    })));
    assert.equal(valid.result, 0);
    assert.equal(calls.length, 1);
    const invalid = await withConfiguration(value.root, () => capture((write, writeError) => runRequestCommand({
      requestName: 'report',
      assignments: [{ path: 'unknown', value: 'rejected' }],
      debug: false,
      provider: provider('must not run', calls),
      write,
      writeError,
    })));
    assert.equal(invalid.result, 1);
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(invalid.stderr).errors[0].code, 'CONFIGURATION_INVALID');
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('WI-0020-10000000_TC-OUTPUT-CONTRACT emits raw and full success output and JSON errors with nonzero exit', async () => {
  const value = await fixture();
  try {
    for (const format of [undefined, 'raw', 'full'] as const) {
      const output = await withConfiguration(value.root, () => capture((write, writeError) => runRequestCommand({
        requestName: 'report',
        assignments: [{ path: 'filters.owner', value: 'michael' }],
        debug: false,
        format,
        provider: provider('exact answer', []),
        write,
        writeError,
      })));
      assert.equal(output.result, 0);
      assert.equal(output.stderr, '');
      if (format === 'full') {
        const response = JSON.parse(output.stdout);
        assert.equal(response.status, 'success');
        assert.equal(response.output.value, 'exact answer');
      } else {
        assert.equal(output.stdout, 'exact answer');
      }
    }
    const error = await withConfiguration(value.root, () => capture((write, writeError) => runRequestCommand({
      requestName: '../unsafe',
      debug: false,
      provider: provider('must not run', []),
      write,
      writeError,
    })));
    assert.equal(error.result, 1);
    assert.equal(error.stdout, '');
    assert.equal(JSON.parse(error.stderr).errors[0].code, 'CONFIGURATION_INVALID');
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('WI-0020-10000000_TC-CLI-REGRESSION keeps existing parser modes and common req flags intact', async () => {
  const { parseCliArguments, parseCliArgumentsAsync } = await import('../src/cli/arguments.js');
  assert.deepEqual(parseCliArguments(['-p', 'prompt', '--format=full']), { debug: false, format: 'full', printChatId: false, command: 'prompt', prompt: 'prompt' });
  assert.deepEqual(parseCliArguments(['request.json']), { debug: false, format: 'raw', printChatId: false, command: 'config', requestPath: 'request.json' });
  const value = await fixture();
  try {
    await withConfiguration(value.root, async () => {
      assert.deepEqual(await parseCliArgumentsAsync(['--debug', 'req', 'report', '--format=full', '--p-audience', 'input']), {
        debug: true,
        format: 'full',
        printChatId: false,
        command: 'req',
        requestName: 'report',
        requestAssignments: [{ path: 'audience', value: 'input' }],
      });
    });
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});