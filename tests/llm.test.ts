import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { complete, completeV2 } from '../src/index.js';
import { main as cliMain } from '../src/cli.js';
import { composePrompt } from '../src/prompt.js';
import { normalizeRequest, normalizeRequestV2 } from '../src/normalize.js';
import { OpenRouterProvider } from '../src/provider.js';
import type { ILlmProvider, LlmProvider, ProviderCompletionRequest, ProviderCompletionRequestV2 } from '../src/types.js';

const schema = 'https://schemas.handschuh.dev/llm/request/v1';
const schemaV2 = 'https://schemas.handschuh.dev/llm/request/v2';
const outputSchema = JSON.stringify({ $id: 'https://example.test/output', type: 'object', required: ['ok'], additionalProperties: false, properties: { ok: { type: 'boolean' } } });
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

class SequenceProvider implements LlmProvider {
  calls: ProviderCompletionRequest[] = [];
  constructor(private readonly sequence: readonly (string | Error)[]) {}
  async complete(request: ProviderCompletionRequest): Promise<string> {
    this.calls.push(request);
    const next = this.sequence[this.calls.length - 1];
    if (next instanceof Error) throw next;
    return next ?? '{"ok":true}';
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return { schema, task: '{"operation":"test"}', systemPrompt: 'Return the requested result.', outputSchema, ...overrides };
}

test('normalizes closed request defaults', async () => {
  const normalized = await normalizeRequest({ schema, task: 'task', systemPrompt: 'system' }, { configurationRoot: process.cwd() });
  assert.equal(normalized.provider, 'openrouter');
  assert.equal(normalized.model, 'openai/gpt-5.6-luna');
  assert.equal(normalized.thinking, 'high');
  assert.equal(normalized.maxFailedAttempts, 3);
  assert.equal(normalized.maxIterations, 3);
});

test('normalizes v2 tool declarations and bounded tool settings', async () => {
  const normalized = await normalizeRequestV2({
    schema: schemaV2,
    task: 'Inspect records.',
    systemPrompt: 'Use tools only when needed.',
    tools: [{ name: 'read_record', description: 'Read one record.', inputSchema: JSON.stringify({ type: 'object' }) }],
    autoInvokeTools: true,
  }, { configurationRoot: process.cwd() });
  assert.equal(normalized.schema, schemaV2);
  assert.equal(normalized.maxToolRounds, 3);
  assert.equal(normalized.maxToolCalls, 128);
  assert.equal(normalized.autoInvokeTools, true);
  assert.equal(normalized.tools[0]?.name, 'read_record');
});

test('rejects duplicate v2 tool names before provider use', async () => {
  await assert.rejects(() => normalizeRequestV2({
    schema: schemaV2,
    task: 'Inspect records.',
    systemPrompt: 'Use tools only when needed.',
    tools: [
      { name: 'read_record', description: 'Read one record.', inputSchema: JSON.stringify({ type: 'object' }) },
      { name: 'read_record', description: 'Read another record.', inputSchema: JSON.stringify({ type: 'object' }) },
    ],
  }, { configurationRoot: process.cwd() }), /Tool names must be unique/u);
});

class V2SequenceProvider implements LlmProvider {
  private readonly sequence: readonly string[];
  readonly calls: ProviderCompletionRequest[] = [];
  constructor(sequence: readonly string[]) { this.sequence = sequence; }
  async complete(request: ProviderCompletionRequest): Promise<string> { this.calls.push(request); return this.sequence[this.calls.length - 1] ?? this.sequence.at(-1) ?? ''; }
  async completeV2(request: ProviderCompletionRequestV2): Promise<import('../src/types.js').ProviderCompletionResponse> {
    this.calls.push(request);
    const value = JSON.parse(this.sequence[this.calls.length - 1] ?? this.sequence.at(-1) ?? '{}') as { content?: string | null; toolCalls?: unknown[] | unknown[][] };
    const rawCalls = value.toolCalls ?? [];
    return { content: value.content ?? null, toolCalls: Array.isArray(rawCalls[0]) ? rawCalls as import('../src/types.js').ToolCalls : (rawCalls.length > 0 ? [rawCalls as import('../src/types.js').ToolCall[]] : []) };
  }
}

const v2Request = (overrides: Record<string, unknown> = {}) => ({
  schema: schemaV2,
  task: 'Inspect records.',
  systemPrompt: 'Use tools only when needed.',
  tools: [{ name: 'read_record', description: 'Read one record.', inputSchema: JSON.stringify({ type: 'object', required: ['logicalId'], properties: { logicalId: { type: 'string' } } }) }],
  outputSchema: JSON.stringify({ type: 'object', required: ['ok'], additionalProperties: false, properties: { ok: { type: 'boolean' } } }),
  ...overrides,
});

test('v2 manual mode returns pending parallel tool call batches without invoking tools', async () => {
  const provider = new V2SequenceProvider([JSON.stringify({ toolCalls: [{ id: 'call-1', name: 'read_record', arguments: { logicalId: 'a' } }] })]);
  let invoked = 0;
  const result = await completeV2(v2Request(), { provider: provider as unknown as import('../src/types.js').LlmProviderV2, toolInvoker: { invoke: async () => { invoked += 1; return {}; } } });
  assert.equal(result.status, 'tool_calls_pending');
  assert.equal(invoked, 0);
  assert.equal(result.toolCalls, 1);
});

test('v2 tool-round-limit violation is unvalidated and invokes zero calls', async () => {
  const provider = new V2SequenceProvider([JSON.stringify({ toolCalls: [{ id: 'call-1', name: 'read_record', arguments: { logicalId: 'a' } }] })]);
  let invoked = 0;
  const result = await completeV2(v2Request({ autoInvokeTools: true, maxToolRounds: 0 }), { provider: provider as unknown as import('../src/types.js').LlmProviderV2, toolInvoker: { invoke: async () => { invoked += 1; return {}; } } });
  assert.equal(result.status, 'unvalidated');
  assert.equal(invoked, 0);
  assert.equal(result.toolRounds, 0);
});

test('v2 automatic invocation runs calls in parallel within each batch and batches sequentially', async () => {
  const provider = new V2SequenceProvider([
    JSON.stringify({ toolCalls: [{ id: 'call-a', name: 'read_record', arguments: { logicalId: 'a' } }, { id: 'call-b', name: 'read_record', arguments: { logicalId: 'b' } }] }),
    JSON.stringify({ content: '{"ok":true}', toolCalls: [] }),
  ]);
  const active: string[] = [];
  let maxActive = 0;
  const result = await completeV2(v2Request({ autoInvokeTools: true, maxToolRounds: 3 }), {
    provider: provider as unknown as import('../src/types.js').LlmProviderV2,
    toolInvoker: { invoke: async (call) => { active.push(call.id); maxActive = Math.max(maxActive, active.length); await new Promise((resolve) => setTimeout(resolve, call.id === 'call-a' ? 5 : 1)); active.splice(active.indexOf(call.id), 1); return { id: call.id }; } },
  });
  assert.equal(result.status, 'success');
  assert.equal(maxActive, 2);
  assert.equal(result.toolRounds, 1);
});

test('treats long literal task and system prompt values as literals', async () => {
  const provider = new SequenceProvider(['ok']);
  const longLiteral = 'word '.repeat(100);
  const result = await complete({ schema, task: longLiteral, systemPrompt: longLiteral }, { provider });
  assert.equal(result.status, 'success');
  assert.equal(provider.calls.length, 1);
  assert.ok(provider.calls[0].llmPrompt.includes(longLiteral));
  assert.equal(provider.calls[0].systemPrompt, longLiteral);
});

test('exposes the normalized completion service through ILlmProvider', async () => {
  const service: ILlmProvider = { complete };
  const result = await service.complete({ schema, task: 'task', systemPrompt: 'system' }, { configurationRoot: process.cwd(), provider: new SequenceProvider(['ok']) });
  assert.equal(result.status, 'success');
  assert.equal(result.output?.$type, 'string');
});

test('unified complete dispatches v1 and v2 requests to matching response schemas', async () => {
  const v1 = await complete({ schema, task: 'task', systemPrompt: 'system' }, { provider: new SequenceProvider(['ok']) });
  const v2 = await complete(v2Request(), { provider: new V2SequenceProvider([JSON.stringify({ content: '{"ok":true}', toolCalls: [] })]) as unknown as import('../src/types.js').LlmProviderV2 });
  assert.equal(v1.schema, 'https://schemas.handschuh.dev/llm/response/v1');
  assert.equal(v2.schema, 'https://schemas.handschuh.dev/llm/response/v2');
  assert.equal(v2.status, 'success');
});

test('unified complete routes malformed known v2 requests to response/v2', async () => {
  const result = await complete({ schema: schemaV2, task: '', systemPrompt: 'system' }, { provider: new V2SequenceProvider([]) as unknown as import('../src/types.js').LlmProviderV2 });
  assert.equal(result.schema, 'https://schemas.handschuh.dev/llm/response/v2');
  assert.equal(result.status, 'input_invalid');
});

test('unified complete rejects an unknown request schema without mislabeling it as v2', async () => {
  const result = await complete({ schema: 'https://schemas.handschuh.dev/llm/request/v9', task: 'task', systemPrompt: 'system' } as never, { provider: new SequenceProvider(['ok']) });
  assert.equal(result.schema, 'https://schemas.handschuh.dev/llm/response/v1');
  assert.equal(result.status, 'input_invalid');
});

test('ILlmProvider accepts a v2 request and returns response/v2', async () => {
  const service: ILlmProvider = { complete };
  const result = await service.complete(v2Request(), { provider: new V2SequenceProvider([JSON.stringify({ content: '{"ok":true}', toolCalls: [] })]) as unknown as import('../src/types.js').LlmProviderV2 });
  assert.equal(result.schema, 'https://schemas.handschuh.dev/llm/response/v2');
});

test('ILlmProvider performs bounded output-schema correction iterations', async () => {
  const outputSchema = JSON.stringify({
    $id: 'https://example.test/act-result',
    type: 'object',
    required: ['status', 'summary'],
    additionalProperties: false,
    properties: {
      status: { const: 'completed' },
      summary: { type: 'string', minLength: 1 },
    },
  });
  const taskSchema = JSON.stringify({
    $id: 'https://example.test/act-task',
    type: 'object',
    required: ['target'],
    additionalProperties: false,
    properties: { target: { type: 'string', minLength: 1 } },
  });
  const service: ILlmProvider = { complete };
  const provider = new SequenceProvider([
    '{"status":"completed"}',
    '{"status":"completed","summary":"validated completion"}',
  ]);
  const result = await service.complete(
    {
      schema,
      task: '{"target":"B0056-04"}',
      taskSchema,
      systemPrompt: 'Return only the structured Act result.',
      outputSchema,
      maxIterations: 2,
    },
    { configurationRoot: process.cwd(), provider },
  );

  assert.equal(result.status, 'success');
  assert.equal(result.iterations, 2);
  assert.equal(provider.calls.length, 2);
  assert.deepEqual((result.output as { value: unknown }).value, {
    status: 'completed',
    summary: 'validated completion',
  });
  assert.match(provider.calls[1].llmPrompt, /correctionInstruction/);

  const exhaustedProvider = new SequenceProvider([
    '{"status":"completed"}',
    '{"status":"completed"}',
    '{"status":"completed"}',
  ]);
  const exhausted = await service.complete(
    {
      schema,
      task: '{"target":"B0056-04"}',
      taskSchema,
      systemPrompt: 'Return only the structured Act result.',
      outputSchema,
      maxIterations: 2,
    },
    { configurationRoot: process.cwd(), provider: exhaustedProvider },
  );
  assert.equal(exhausted.status, 'output_invalid');
  assert.equal(exhausted.iterations, 2);
  assert.equal(exhaustedProvider.calls.length, 2);
});

test('rejects unknown and out-of-range request settings before provider invocation', async () => {
  const provider = new SequenceProvider(['{"ok":true}']);
  const result = await complete({ ...request(), extra: true, maxIterations: 11 }, { provider });
  assert.equal(result.status, 'input_invalid');
  assert.equal(provider.calls.length, 0);
});

test('resolves regular files and rejects traversal, forbidden files, directories, symlinks, and outside paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-source-'));
  await writeFile(join(root, 'task.json'), '{"ok":true}');
  await mkdir(join(root, 'nested'));
  await symlink(root, join(root, 'nested', 'root-link'));
  await mkdir(join(root, 'dir'));
  await symlink(join(root, 'task.json'), join(root, 'link.json'));
  const normalized = await normalizeRequest({ schema, task: 'task.json', systemPrompt: 'literal system', files: [{ name: 'task', path: 'task.json', type: 'application/json', purpose: 'test' }] }, { configurationRoot: root });
  assert.equal(normalized.task.path, 'task.json');
  await assert.rejects(() => normalizeRequest({ schema, task: '../outside', systemPrompt: 'system' }, { configurationRoot: root }));
  await assert.rejects(() => normalizeRequest({ schema, task: '.env', systemPrompt: 'system' }, { configurationRoot: root }));
  await assert.rejects(() => normalizeRequest({ schema, task: 'dir', systemPrompt: 'system' }, { configurationRoot: root }));
  await assert.rejects(() => normalizeRequest({ schema, task: 'link.json', systemPrompt: 'system' }, { configurationRoot: root }));
  await assert.rejects(() => normalizeRequest({ schema, task: 'nested/root-link/task.json', systemPrompt: 'system' }, { configurationRoot: root }));
});

test('normalizes image files as base64 without placing binary content in the text prompt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-image-'));
  await writeFile(join(root, 'tile.png'), pngBytes);
  const provider = new SequenceProvider(['{"ok":true}']);
  const result = await complete(request({ files: [{ name: 'tile', path: 'tile.png', type: 'image/png', purpose: 'Satellite tile' }] }), { provider, configurationRoot: root });
  assert.equal(result.status, 'success');
  assert.equal(provider.calls.length, 1);
  const file = provider.calls[0].files[0];
  assert.equal(file.type, 'image/png');
  assert.equal(file.encoding, 'base64');
  assert.equal(file.content, pngBytes.toString('base64'));
  assert.ok(!provider.calls[0].llmPrompt.includes(pngBytes.toString('base64')));
  assert.match(provider.calls[0].llmPrompt, /encoding="base64"/u);
  assert.match(provider.calls[0].llmPrompt, /binary attachment supplied separately/u);
});

test('normalizes text files as utf8 and rejects a mismatched image signature', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-file-'));
  await writeFile(join(root, 'notes.txt'), 'plain text');
  await writeFile(join(root, 'not-an-image.png'), 'plain text');
  const text = await normalizeRequest({ schema, task: 'task', systemPrompt: 'system', files: [{ name: 'notes', path: 'notes.txt', type: 'text/plain', purpose: 'Notes' }] }, { configurationRoot: root });
  assert.equal(text.files[0].encoding, 'utf8');
  assert.equal(text.files[0].content, 'plain text');
  await assert.rejects(
    () => normalizeRequest({ schema, task: 'task', systemPrompt: 'system', files: [{ name: 'bad-image', path: 'not-an-image.png', type: 'image/png', purpose: 'Invalid image' }] }, { configurationRoot: root }),
    /does not match its image MIME type/u,
  );
});

test('requires file.type to be a concrete MIME type', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-mime-'));
  await writeFile(join(root, 'notes.txt'), 'plain text');
  await assert.rejects(
    () => normalizeRequest({ schema, task: 'task', systemPrompt: 'system', files: [{ name: 'notes', path: 'notes.txt', type: 'guidance', purpose: 'Notes' }] }, { configurationRoot: root }),
    /must match pattern/u,
  );
  await assert.rejects(
    () => normalizeRequest({ schema, task: 'task', systemPrompt: 'system', files: [{ name: 'notes', path: 'notes.txt', type: 'text\/*', purpose: 'Notes' }] }, { configurationRoot: root }),
    /must match pattern/u,
  );
});

test('rejects malformed or schema-invalid task before provider invocation', async () => {
  const provider = new SequenceProvider(['{"ok":true}']);
  const taskSchema = JSON.stringify({ type: 'object', required: ['required'], additionalProperties: false, properties: { required: { type: 'boolean' } } });
  const malformed = await complete({ schema, task: '{', systemPrompt: 'system', taskSchema }, { provider });
  assert.equal(malformed.status, 'input_invalid');
  assert.equal(provider.calls.length, 0);
  const result = await complete({ schema, task: '{"wrong":true}', systemPrompt: 'system', taskSchema }, { provider });
  assert.equal(result.status, 'input_invalid');
  assert.equal(provider.calls.length, 0);
});

test('composes deterministic ordered XML with safe CDATA and output schema last', () => {
  const first = composePrompt({ task: 'a ]]> b', taskSchema: '{"type":"object"}', files: [{ name: 'one', path: 'one.md', type: 'text/markdown', purpose: 'context', content: '<unsafe>' }], outputSchema: '{"type":"object"}' });
  const second = composePrompt({ task: 'a ]]> b', taskSchema: '{"type":"object"}', files: [{ name: 'one', path: 'one.md', type: 'text/markdown', purpose: 'context', content: '<unsafe>' }], outputSchema: '{"type":"object"}' });
  assert.equal(first, second);
  assert.ok(first.indexOf('<task ') < first.indexOf('<taskSchema>'));
  assert.ok(first.indexOf('<taskSchema>') < first.indexOf('<files>'));
  assert.ok(first.indexOf('<files>') < first.indexOf('<outputSchema '));
  assert.ok(!first.includes(']]> b'));
  assert.match(first, /taskSchema=/);
  assert.match(first, /outputSchema/);
});

test('returns structured and raw output without reparsing raw text', async () => {
  const structured = await complete(request(), { provider: new SequenceProvider(['{"ok":true}']) });
  assert.equal(structured.status, 'success');
  assert.equal(structured.output?.$type, 'object');
  assert.equal((structured.output as { schema: { name: string } }).schema.name, 'https://example.test/output');
  assert.deepEqual((structured.output as { value: unknown }).value, { ok: true });
  const raw = await complete(request({ outputSchema: undefined }), { provider: new SequenceProvider(['not-json']) });
  assert.equal(raw.status, 'success');
  assert.equal(raw.output?.$type, 'string');
  assert.equal((raw.output as { value: string }).value, 'not-json');
});

test('counts provider failures separately from successful correction iterations', async () => {
  const provider = new SequenceProvider([new Error('network secret=hidden'), '{"bad":true}', '{"ok":true}']);
  const result = await complete(request({ maxFailedAttempts: 2, maxIterations: 3 }), { provider });
  assert.equal(result.status, 'success');
  assert.equal(result.failedAttempts, 1);
  assert.equal(result.iterations, 2);
  assert.equal(provider.calls.length, 3);
  assert.ok(provider.calls[2].llmPrompt.includes('previousResult'));
  assert.ok(provider.calls[2].llmPrompt.includes('validationErrors'));
  assert.ok(provider.calls[2].llmPrompt.includes('correctionInstruction'));
  assert.ok(!JSON.stringify(result).includes('network secret'));
});

test('retains image attachments across output correction iterations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-image-retry-'));
  await writeFile(join(root, 'tile.png'), pngBytes);
  const provider = new SequenceProvider(['{"bad":true}', '{"ok":true}']);
  const result = await complete(request({ files: [{ name: 'tile', path: 'tile.png', type: 'image/png', purpose: 'Satellite tile' }] }), { provider, configurationRoot: root });
  assert.equal(result.status, 'success');
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[0].files[0].encoding, 'base64');
  assert.equal(provider.calls[1].files[0].content, pngBytes.toString('base64'));
});

test('returns bounded output-invalid and attempts-exhausted responses', async () => {
  const outputInvalid = await complete(request({ maxIterations: 1 }), { provider: new SequenceProvider(['{"bad":true}']) });
  assert.equal(outputInvalid.status, 'output_invalid');
  assert.equal(outputInvalid.output, null);
  assert.equal(outputInvalid.iterations, 1);
  const invalidJson = await complete(request({ maxIterations: 1 }), { provider: new SequenceProvider(['not-json']) });
  assert.equal(invalidJson.status, 'output_invalid');
  assert.equal(invalidJson.errors[0]?.code, 'OUTPUT_JSON_INVALID');
  const exhausted = await complete(request({ maxFailedAttempts: 1 }), { provider: new SequenceProvider([new Error('secret=hidden'), new Error('secret=hidden')]) });
  assert.equal(exhausted.status, 'attempts_exhausted');
  assert.equal(exhausted.failedAttempts, 1);
  assert.equal(exhausted.iterations, 0);
  assert.ok(!JSON.stringify(exhausted).includes('secret=hidden'));
});

test('OpenRouterProvider sends base64 images as image_url content parts', async () => {
  const originalFetch = globalThis.fetch;
  let body: { messages?: Array<{ content?: unknown }> } | undefined;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: unknown }> };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const provider = new OpenRouterProvider();
    const result = await provider.complete({
      provider: 'openrouter',
      model: 'openai/gpt-5.6-luna',
      thinking: 'low',
      systemPrompt: 'Inspect the image.',
      llmPrompt: '<llmPrompt />',
      files: [{ name: 'tile', path: 'tile.png', type: 'image/png', purpose: 'Satellite tile', encoding: 'base64', content: pngBytes.toString('base64'), resolvedPath: 'tile.png' }],
      credentials: { apiKey: 'test-key' },
    });
    assert.equal(result, 'ok');
    const content = body?.messages?.[1]?.content as Array<{ type?: string; text?: string; image_url?: { url?: string; detail?: string } }>;
    assert.equal(content[0].type, 'text');
    assert.equal(content[0].text, '<llmPrompt />');
    assert.equal(content[1].type, 'image_url');
    assert.equal(content[1].image_url?.url, `data:image/png;base64,${pngBytes.toString('base64')}`);
    assert.equal(content[1].image_url?.detail, 'high');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenRouterProvider maps v2 tools, tool results, and native tool calls', async () => {
  const originalFetch = globalThis.fetch;
  let body: { tools?: unknown[]; messages?: Array<Record<string, unknown>> } | undefined;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as { tools?: unknown[]; messages?: Array<Record<string, unknown>> };
    return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'call-read-1', function: { name: 'read_record', arguments: '{"logicalId":"record-a"}' } }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const provider = new OpenRouterProvider();
    const request: ProviderCompletionRequestV2 = {
      provider: 'openrouter',
      model: 'openai/gpt-5.6-luna',
      thinking: 'low',
      systemPrompt: 'Use tools.',
      llmPrompt: '<llmPrompt />',
      files: [],
      credentials: { apiKey: 'test-key' },
      tools: [{ name: 'read_record', description: 'Read a record.', inputSchema: JSON.stringify({ type: 'object', properties: { logicalId: { type: 'string' } } }) }],
      toolResults: [{ callId: 'call-prior', name: 'previous_tool', status: 'success', value: { ok: true } }],
    };
    const result = await provider.completeV2(request);
    assert.deepEqual(result.toolCalls, [[{ id: 'call-read-1', name: 'read_record', arguments: { logicalId: 'record-a' } }]]);
    assert.equal(result.content, null);
    assert.equal((body?.tools?.[0] as { type?: string }).type, 'function');
    assert.equal((body?.messages?.[2] as { role?: string; tool_call_id?: string }).role, 'tool');
    assert.equal((body?.messages?.[2] as { tool_call_id?: string }).tool_call_id, 'call-prior');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenRouterProvider rejects malformed native tool arguments', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'call-bad', function: { name: 'read_record', arguments: '{' } }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(() => new OpenRouterProvider().completeV2({
      provider: 'openrouter', model: 'openai/gpt-5.6-luna', thinking: 'low', systemPrompt: 'Use tools.', llmPrompt: '<llmPrompt />', files: [], credentials: { apiKey: 'test-key' }, tools: [], toolResults: [],
    }), /invalid JSON tool arguments/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects unsupported provider names without an injected adapter', async () => {
  const result = await complete(request({ provider: 'unknown-provider' }));
  assert.equal(result.status, 'configuration_error');
  assert.equal(result.errors[0]?.code, 'CONFIGURATION_INVALID');
});

test('help does not import or initialize the provider path', async () => {
  assert.equal(await cliMain(['--help']), 0);
});

test('help documents minimal request and response contracts', async () => {
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => output.push(args.join(' '));
  try {
    assert.equal(await cliMain(['--help']), 0);
  } finally {
    console.log = originalLog;
  }
  const text = output.join('\n');
  assert.match(text, /Minimal request \(.*llm\/schemas\/request\/v1\/request\.schema\.json\)/);
  assert.match(text, /Successful raw-text response \(.*llm\/schemas\/response\/v1\/response\.schema\.json\)/);
  assert.match(text, /"schema": "https:\/\/schemas\.handschuh\.dev\/llm\/request\/v1"/);
  assert.match(text, /"status": "success"/);
  assert.match(text, /"failedAttempts": 0/);
  assert.match(text, /"iterations": 1/);
});
