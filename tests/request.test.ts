import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { completeRequest } from '../src/index.js';
import type { LlmProvider, ProviderCompletionRequest, ProviderCompletionResponse, ReferenceFile } from '../src/types.js';

const schema = 'https://schemas.handschuh.dev/llm/request/v1';

function provider(response: ProviderCompletionResponse, calls: ProviderCompletionRequest[]): LlmProvider {
  return {
    async complete(request) {
      calls.push(request);
      return response;
    },
  };
}

async function fixture(): Promise<{ readonly root: string; readonly requests: string; readonly request: string }> {
  const root = await mkdtemp(join(tmpdir(), 'llm-complete-request-'));
  const requests = join(root, 'requests');
  const request = join(requests, 'report');
  const configRoot = join(root, 'config');
  await mkdir(configRoot, { recursive: true });
  await mkdir(request, { recursive: true });
  await Promise.all([
    writeFile(join(configRoot, 'config.json'), JSON.stringify({ requestsDirectory: requests })),
    writeFile(join(request, 'report.defaults.json'), JSON.stringify({ provider: 'fake', model: 'test/model', thinking: 'low', parameters: { audience: 'engineering' } })),
    writeFile(join(request, 'report.prompt.md'), 'Summarize $${audience}$$ for $${metadata[owner]}$$.'),
    writeFile(join(request, 'report.prompt.system.md'), 'Return a concise answer for $${audience}$$.'),
    writeFile(join(request, 'report.parameters.schema.json'), JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.test/report-parameters/v1',
      type: 'object',
      additionalProperties: false,
      required: ['audience', 'metadata'],
      properties: { audience: { type: 'string' }, metadata: { type: 'object', additionalProperties: { type: 'string' } } },
    })),
    writeFile(join(request, 'report.outputSchema.json'), JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://example.test/report-output/v1', type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } })),
  ]);
  return { root: configRoot, requests, request };
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

test('WI-0018-10000000_TC-EXPORTED-API exports completeRequest with usable fake-provider controls', async () => {
  const fixtureValue = await fixture();
  const calls: ProviderCompletionRequest[] = [];
  try {
    const response = await withConfiguration(fixtureValue.root, () => completeRequest({
      requestName: 'report',
      parameters: { metadata: { owner: 'michael' } },
      configurationRoot: fixtureValue.root,
      provider: provider({ content: 'done', toolCalls: [], decision: 'stop' }, calls),
    }));
    assert.deepEqual(response, { content: 'done', toolCalls: [], decision: 'stop' });
    assert.equal(calls.length, 1);
  } finally {
    await rm(fixtureValue.root, { recursive: true, force: true });
  }
});

test('WI-0018-10000000_TC-CONSTRUCTED-REQUEST captures the existing provider request contract', async () => {
  const fixtureValue = await fixture();
  const calls: ProviderCompletionRequest[] = [];
  try {
    await withConfiguration(fixtureValue.root, () => completeRequest({
      requestName: 'report',
      parameters: { audience: 'public', metadata: { owner: 'michael' } },
      configurationRoot: fixtureValue.root,
      provider: provider({ content: 'done', toolCalls: [], decision: 'stop' }, calls),
    }));
    const request = calls[0]!;
    assert.equal(request.provider, 'fake');
    assert.equal(request.model, 'test/model');
    assert.equal(request.thinking, 'low');
    assert.equal(request.task, 'Summarize public for michael.');
    assert.equal(request.systemPrompt, 'Return a concise answer for public.');
    assert.equal(request.files.length, 0);
    assert.equal(request.taskSchema, undefined);
    assert.deepEqual(request.messages, []);
  } finally {
    await rm(fixtureValue.root, { recursive: true, force: true });
  }
});

test('WI-0018-10000000_TC-SINGLE-DELEGATION calls the provider once and rejects invalid input before provider use', async () => {
  const fixtureValue = await fixture();
  const calls: ProviderCompletionRequest[] = [];
  try {
    await withConfiguration(fixtureValue.root, () => completeRequest({ requestName: 'report', parameters: { metadata: { owner: 'michael' } }, configurationRoot: fixtureValue.root, provider: provider({ content: 'done', toolCalls: [], decision: 'stop' }, calls) }));
    assert.equal(calls.length, 1);
    await assert.rejects(() => withConfiguration(fixtureValue.root, () => completeRequest({ requestName: 'report', parameters: { audience: 7 } as never, configurationRoot: fixtureValue.root, provider: provider({ content: 'never', toolCalls: [], decision: 'stop' }, calls) })));
    assert.equal(calls.length, 1);
  } finally {
    await rm(fixtureValue.root, { recursive: true, force: true });
  }
});

test('WI-0018-10000000_TC-RELATIVE-ROOT resolves external files from CWD and passes controls', async () => {
  const fixtureValue = await fixture();
  const calls: ProviderCompletionRequest[] = [];
  const fileName = `complete-request-${Date.now()}.txt`;
  const filePath = resolve(process.cwd(), fileName);
  const signal = new AbortController().signal;
  const files: readonly ReferenceFile[] = [{ name: 'external', path: fileName, type: 'text/plain', purpose: 'External fixture' }];
  try {
    await writeFile(filePath, 'external content');
    await withConfiguration(fixtureValue.root, () => completeRequest({ requestName: 'report', parameters: { metadata: { owner: 'michael' } }, files, signal, configurationRoot: fixtureValue.root, provider: provider({ content: 'done', toolCalls: [], decision: 'stop' }, calls) }));
    assert.equal(calls[0]?.files.at(-1)?.content, 'external content');
    assert.equal(calls[0]?.signal, signal);
  } finally {
    await Promise.all([rm(fixtureValue.root, { recursive: true, force: true }), rm(filePath, { force: true })]);
  }
});