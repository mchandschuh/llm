import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { complete } from '../src/index.js';
import { main as cliMain } from '../src/cli.js';
import { composePrompt } from '../src/prompt.js';
import { normalizeRequest } from '../src/normalize.js';
import { OpenRouterProvider } from '../src/provider.js';
import { LlmFailure } from '../src/errors.js';
import type { ILlmProvider, LlmProvider, ProviderCompletionRequest, ProviderCompletionResponse } from '../src/types.js';

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;

const schema = 'https://schemas.handschuh.dev/llm/request/v1';
const toolSchema = 'https://schemas.handschuh.dev/llm/request/v1';
const outputSchema = { $id: 'https://example.test/output', type: 'object', required: ['ok'], additionalProperties: false, properties: { ok: { type: 'boolean' } } };
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('published request and response schema examples validate', async () => {
  for (const kind of ['request', 'response'] as const) {
    for (const version of ['v1'] as const) {
      const relativePath = `schemas/${kind}/${version}/${kind}.schema.json`;
      const schema = JSON.parse(await readFile(join(process.cwd(), relativePath), 'utf8')) as {
        examples?: unknown[];
        'x-negativeExamples'?: Array<{ name: string; data: unknown; reason: string }>;
      };
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(ajv);
      const validate = ajv.compile(schema);
      for (const [index, example] of (schema.examples ?? []).entries()) {
        assert.equal(validate(example), true, `${relativePath} example ${index + 1} should validate: ${JSON.stringify(validate.errors)}`);
      }
      for (const negative of schema['x-negativeExamples'] ?? []) {
        assert.equal(validate(negative.data), false, `${relativePath} negative example ${negative.name} should fail: ${negative.reason}`);
      }
    }
  }
});

class SequenceProvider implements LlmProvider {
  calls: ProviderCompletionRequest[] = [];
  constructor(private readonly sequence: readonly (string | Error)[]) {}
  async complete(request: ProviderCompletionRequest): Promise<ProviderCompletionResponse> {
    this.calls.push(request);
    const next = this.sequence[this.calls.length - 1];
    if (next instanceof Error) throw next;
    return { content: next ?? '{"ok":true}', toolCalls: [], decision: 'stop' };
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return { schema, task: { operation: 'test' }, systemPrompt: 'Return the requested result.', outputSchema, ...overrides };
}

test('normalizes closed request defaults', async () => {
  const normalized = await normalizeRequest({ schema, task: 'task', systemPrompt: 'system' }, { configurationRoot: process.cwd() });
  assert.equal(normalized.provider, 'openrouter');
  assert.equal(normalized.model, 'openai/gpt-5.6-luna');
  assert.equal(normalized.thinking, 'high');
  assert.equal(normalized.maxFailedAttempts, 3);
  assert.equal(normalized.maxIterations, 3);
});

test('OpenRouterProvider validates request credentials and environment fallback', () => {
  const provider = new OpenRouterProvider();
  const original = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    assert.equal(provider.validate?.({ provider: 'openrouter', credentials: { apiKey: 'request-key' } }).success, true);
    assert.equal(provider.validate?.({ provider: 'openrouter', credentials: { accessToken: 'request-token' } }).success, true);
    const missing = provider.validate?.({ provider: 'openrouter', credentials: undefined });
    assert.equal(missing?.success, false);
    assert.equal(missing?.errors[0]?.code, 'CONFIGURATION_INVALID');
    process.env.OPENROUTER_API_KEY = 'environment-key';
    assert.equal(provider.validate?.({ provider: 'openrouter', credentials: undefined }).success, true);
  } finally {
    if (original === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = original;
  }
});

test('provider validation fails before complete and retry attempts', async () => {
  let completeCalls = 0;
  const provider: LlmProvider = {
    validate: () => ({ success: false, errors: [{ code: 'CONFIGURATION_INVALID', phase: 'configuration', message: 'Missing provider configuration.' }] }),
    async complete() {
      completeCalls += 1;
      return { content: 'unexpected', toolCalls: [], decision: 'stop' };
    },
  };
  const events: Array<{ event: string; data?: unknown }> = [];
  const result = await complete({ schema, task: 'task', systemPrompt: 'system' }, { provider, debug: (event) => events.push(event) });
  assert.equal(result.status, 'configuration_error');
  assert.equal(result.failedAttempts, 0);
  assert.equal(result.iterations, 0);
  assert.equal(completeCalls, 0);
  assert.equal(events.some((event) => event.event === 'llm.validation.failed'), true);
});

test('normalizes toolCapable tool declarations and bounded tool settings', async () => {
  const normalized = await normalizeRequest({
    schema: toolSchema,
    task: 'Inspect records.',
    systemPrompt: 'Use tools only when needed.',
    toolOptions: { tools: [{ name: 'read_record', description: 'Read one record.', inputSchema: JSON.stringify({ type: 'object' }) }], autoInvoke: true },
  }, { configurationRoot: process.cwd() });
  assert.equal(normalized.schema, toolSchema);
  assert.equal(normalized.toolOptions?.maxRounds, 3);
  assert.equal(normalized.toolOptions?.maxCalls, 128);
  assert.equal(normalized.toolOptions?.autoInvoke, true);
  assert.equal(normalized.toolOptions?.tools[0]?.name, 'read_record');
});

test('preserves structured v1 and toolCapable tasks and inline schemas at the request boundary', async () => {
  const v1Task = { operation: 'assess', target: 'WI-0004' };
  const v1TaskSchema = { type: 'object', required: ['operation', 'target'], additionalProperties: false, properties: { operation: { type: 'string' }, target: { type: 'string' } } };
  const v1OutputSchema = { type: 'object', required: ['ok'], additionalProperties: false, properties: { ok: { type: 'boolean' } } };
  const v1Provider = new SequenceProvider(['{"ok":true}']);
  const v1Events: Array<{ event: string; data?: unknown }> = [];
  const v1 = await complete({ schema, task: v1Task, taskSchema: v1TaskSchema, outputSchema: v1OutputSchema, systemPrompt: 'Return JSON.' }, { provider: v1Provider, debug: (event) => v1Events.push(event) });
  assert.equal(v1.status, 'success');
  const v1Request = v1Events.find((event) => event.event === 'llm.request')?.data as Record<string, unknown>;
  assert.deepEqual(v1Request.task, v1Task);
  assert.deepEqual(v1Request.taskSchema, v1TaskSchema);
  assert.deepEqual(v1Request.outputSchema, v1OutputSchema);
  assert.match(v1Provider.calls[0]!.llmPrompt, /"operation":"assess"/u);

  const toolProvider = new ToolSequenceProvider([JSON.stringify({ content: '{"ok":true}', toolCalls: [] })]);
  const toolEvents: Array<{ event: string; data?: unknown }> = [];
  const toolTask = { operation: 'inspect', target: 'records' };
  const toolResult = await complete(toolRequest({ task: toolTask, outputSchema: v1OutputSchema }), { provider: toolProvider, debug: (event) => toolEvents.push(event) });
  assert.equal(toolResult.status, 'success');
  const toolRequestEvent = toolEvents.find((event) => event.event === 'llm.request')?.data as Record<string, unknown>;
  assert.deepEqual(toolRequestEvent.task, toolTask);
  assert.equal(typeof toolRequestEvent.taskSchema, 'object');
  assert.deepEqual(toolRequestEvent.outputSchema, v1OutputSchema);
});

test('rejects duplicate toolCapable tool names before provider use', async () => {
  await assert.rejects(() => normalizeRequest({
    schema: toolSchema,
    task: 'Inspect records.',
    systemPrompt: 'Use tools only when needed.',
    toolOptions: { tools: [
      { name: 'read_record', description: 'Read one record.', inputSchema: JSON.stringify({ type: 'object' }) },
      { name: 'read_record', description: 'Read another record.', inputSchema: JSON.stringify({ type: 'object' }) },
    ] },
  }, { configurationRoot: process.cwd() }), /Tool names must be unique/u);
});

class ToolSequenceProvider implements LlmProvider {
  private readonly sequence: readonly string[];
  readonly calls: ProviderCompletionRequest[] = [];
  constructor(sequence: readonly string[]) { this.sequence = sequence; }
  async complete(request: ProviderCompletionRequest): Promise<ProviderCompletionResponse> {
    this.calls.push(request);
    const value = JSON.parse(this.sequence[this.calls.length - 1] ?? this.sequence.at(-1) ?? '{}') as { content?: string | null; toolCalls?: unknown[] | unknown[][]; decision?: 'continue' | 'stop' };
    const rawCalls = value.toolCalls ?? [];
    const toolCalls = Array.isArray(rawCalls[0]) ? rawCalls as import('../src/types.js').ToolCalls : (rawCalls.length > 0 ? [rawCalls as import('../src/types.js').ToolCall[]] : []);
    return { content: value.content ?? null, toolCalls, decision: value.decision ?? (toolCalls.length > 0 ? 'continue' : 'stop') };
  }
}

const toolRequest = (overrides: Record<string, unknown> = {}) => {
  const base = {
    schema: toolSchema,
    task: { operation: 'inspect', target: 'records' },
    systemPrompt: 'Use tools only when needed.',
    taskSchema: { type: 'object', required: ['operation', 'target'], additionalProperties: false, properties: { operation: { const: 'inspect' }, target: { type: 'string' } } },
    toolOptions: { tools: [{ name: 'read_record', description: 'Read one record.', inputSchema: JSON.stringify({ type: 'object', required: ['logicalId'], properties: { logicalId: { type: 'string' } } }) }] },
    outputSchema: { type: 'object', required: ['ok'], additionalProperties: false, properties: { ok: { type: 'boolean' } } },
  };
  return { ...base, ...overrides, toolOptions: { ...base.toolOptions, ...((overrides.toolOptions as Record<string, unknown> | undefined) ?? {}) } };
};

test('toolCapable manual mode returns pending parallel tool call batches without invoking tools', async () => {
  const provider = new ToolSequenceProvider([JSON.stringify({ toolCalls: [{ id: 'call-1', name: 'read_record', arguments: { logicalId: 'a' } }] })]);
  let invoked = 0;
  const result = await complete(toolRequest(), { provider: provider, toolInvoker: { invoke: async () => { invoked += 1; return {}; } } });
  assert.equal(result.status, 'tool_calls_pending');
  assert.equal(invoked, 0);
  assert.equal(result.toolCalls, 1);
});

test('toolCapable tool-round-limit violation is unvalidated and invokes zero calls', async () => {
  const provider = new ToolSequenceProvider([JSON.stringify({ toolCalls: [{ id: 'call-1', name: 'read_record', arguments: { logicalId: 'a' } }] })]);
  let invoked = 0;
  const result = await complete(toolRequest({ toolOptions: { autoInvoke: true, maxRounds: 0 } }), { provider: provider, toolInvoker: { invoke: async () => { invoked += 1; return {}; } } });
  assert.equal(result.status, 'unvalidated');
  assert.equal(invoked, 0);
  assert.equal(result.toolRounds, 0);
});

test('toolCapable automatic invocation runs calls in parallel within each batch and batches sequentially', async () => {
  const provider = new ToolSequenceProvider([
    JSON.stringify({ toolCalls: [{ id: 'call-a', name: 'read_record', arguments: { logicalId: 'a' } }, { id: 'call-b', name: 'read_record', arguments: { logicalId: 'b' } }] }),
    JSON.stringify({ content: '{"ok":true}', toolCalls: [] }),
  ]);
  const active: string[] = [];
  let maxActive = 0;
  const result = await complete(toolRequest({ toolOptions: { autoInvoke: true, maxRounds: 3 } }), {
    provider: provider,
    toolInvoker: { invoke: async (call) => { active.push(call.id); maxActive = Math.max(maxActive, active.length); await new Promise((resolve) => setTimeout(resolve, call.id === 'call-a' ? 5 : 1)); active.splice(active.indexOf(call.id), 1); return { id: call.id }; } },
  });
  assert.equal(result.status, 'success');
  assert.equal(maxActive, 2);
  assert.equal(result.toolRounds, 1);
  assert.deepEqual(result.toolResults, [
    { callId: 'call-a', name: 'read_record', status: 'success', value: { id: 'call-a' } },
    { callId: 'call-b', name: 'read_record', status: 'success', value: { id: 'call-b' } },
  ]);
});

test('toolCapable automatic invocation executes multiple parallel tool call batches sequentially', async () => {
  const provider = new ToolSequenceProvider([
    JSON.stringify({ toolCalls: [[{ id: 'call-a', name: 'read_record', arguments: { logicalId: 'a' } }, { id: 'call-b', name: 'read_record', arguments: { logicalId: 'b' } }], [{ id: 'call-c', name: 'read_record', arguments: { logicalId: 'c' } }]] }),
    JSON.stringify({ content: '{"ok":true}', toolCalls: [] }),
  ]);
  const events: string[] = [];
  const result = await complete(toolRequest({ toolOptions: { autoInvoke: true } }), {
    provider: provider,
    toolInvoker: { invoke: async (call) => { events.push(`start:${call.id}`); await new Promise((resolve) => setTimeout(resolve, call.id === 'call-a' ? 5 : 1)); events.push(`end:${call.id}`); return call.id; } },
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(events, ['start:call-a', 'start:call-b', 'end:call-b', 'end:call-a', 'start:call-c', 'end:call-c']);
  assert.equal(result.toolRounds, 2);
  assert.deepEqual(result.toolResults, [
    { callId: 'call-a', name: 'read_record', status: 'success', value: 'call-a' },
    { callId: 'call-b', name: 'read_record', status: 'success', value: 'call-b' },
    { callId: 'call-c', name: 'read_record', status: 'success', value: 'call-c' },
  ]);
});

test('toolCapable rejects undeclared tool calls before invoking any tool', async () => {
  const provider = new ToolSequenceProvider([JSON.stringify({ toolCalls: [{ id: 'call-unknown', name: 'delete_everything', arguments: {} }] })]);
  let invoked = 0;
  const result = await complete(toolRequest({ toolOptions: { autoInvoke: true } }), { provider: provider, toolInvoker: { invoke: async () => { invoked += 1; return {}; } } });
  assert.equal(result.status, 'output_invalid');
  assert.equal(invoked, 0);
  assert.equal(result.errors[0]?.code, 'TOOL_CALL_INVALID');
});

test('toolCapable rejects duplicate call IDs before invoking any tool', async () => {
  const calls = [{ id: 'same-id', name: 'read_record', arguments: { logicalId: 'a' } }, { id: 'same-id', name: 'read_record', arguments: { logicalId: 'b' } }];
  const provider = new ToolSequenceProvider([JSON.stringify({ toolCalls: calls })]);
  let invoked = 0;
  const result = await complete(toolRequest({ toolOptions: { autoInvoke: true } }), { provider: provider, toolInvoker: { invoke: async () => { invoked += 1; return {}; } } });
  assert.equal(result.status, 'output_invalid');
  assert.equal(invoked, 0);
  assert.match(result.errors[0]?.message ?? '', /unique/u);
});

test('toolCapable rejects invalid arguments before invoking any tool', async () => {
  const provider = new ToolSequenceProvider([JSON.stringify({ toolCalls: [{ id: 'call-invalid', name: 'read_record', arguments: { wrong: true } }] })]);
  let invoked = 0;
  const result = await complete(toolRequest({ toolOptions: { autoInvoke: true } }), { provider: provider, toolInvoker: { invoke: async () => { invoked += 1; return {}; } } });
  assert.equal(result.status, 'output_invalid');
  assert.equal(invoked, 0);
  assert.equal(result.errors[0]?.code, 'TOOL_SCHEMA_VALIDATION_FAILED');
});

test('toolCapable rejects empty parallel tool call batches before invoking any tool', async () => {
  const provider = new ToolSequenceProvider([JSON.stringify({ toolCalls: [[]] })]);
  let invoked = 0;
  const result = await complete(toolRequest({ toolOptions: { autoInvoke: true } }), { provider: provider, toolInvoker: { invoke: async () => { invoked += 1; return {}; } } });
  assert.equal(result.status, 'output_invalid');
  assert.equal(invoked, 0);
});

test('toolCapable rejects maxCalls before invoking any tool', async () => {
  const provider = new ToolSequenceProvider([JSON.stringify({ toolCalls: [{ id: 'call-a', name: 'read_record', arguments: { logicalId: 'a' } }, { id: 'call-b', name: 'read_record', arguments: { logicalId: 'b' } }] })]);
  let invoked = 0;
  const result = await complete(toolRequest({ toolOptions: { autoInvoke: true, maxCalls: 1 } }), { provider: provider, toolInvoker: { invoke: async () => { invoked += 1; return {}; } } });
  assert.equal(result.status, 'unvalidated');
  assert.equal(invoked, 0);
  assert.equal(result.toolCalls, 0);
});

test('toolCapable requires a ToolInvoker when autoInvoke is enabled', async () => {
  const provider = new ToolSequenceProvider([JSON.stringify({ toolCalls: [{ id: 'call-1', name: 'read_record', arguments: { logicalId: 'a' } }] })]);
  const result = await complete(toolRequest({ toolOptions: { autoInvoke: true } }), { provider: provider });
  assert.equal(result.status, 'configuration_error');
  assert.equal(result.errors[0]?.code, 'CONFIGURATION_INVALID');
});

test('toolCapable converts tool failures into bounded error results and continues', async () => {
  const provider = new ToolSequenceProvider([JSON.stringify({ toolCalls: [{ id: 'call-fail', name: 'read_record', arguments: { logicalId: 'a' } }] }), JSON.stringify({ content: '{"ok":true}', toolCalls: [] })]);
  const result = await complete(toolRequest({ toolOptions: { autoInvoke: true } }), { provider: provider, toolInvoker: { invoke: async () => { throw new Error('secret=hidden'); } } });
  assert.equal(result.status, 'success');
  assert.equal(provider.calls[1]?.toolResults[0]?.status, 'error');
  assert.deepEqual(result.toolResults, [{
    callId: 'call-fail',
    name: 'read_record',
    status: 'error',
    error: { code: 'TOOL_INVOCATION_FAILED', message: '[redacted]' },
  }]);
  assert.doesNotMatch(JSON.stringify(provider.calls[1]?.toolResults), /secret=hidden/u);
});

test('toolCapable automatic invocation stops only on an explicit provider decision', async () => {
  const provider = new ToolSequenceProvider([
    JSON.stringify({ decision: 'continue', toolCalls: [{ id: 'call-stop', name: 'read_record', arguments: { logicalId: 'a' } }] }),
    JSON.stringify({ decision: 'stop', content: '{"ok":true}', toolCalls: [] }),
  ]);
  const result = await complete(toolRequest({ toolOptions: { autoInvoke: true } }), {
    provider: provider,
    toolInvoker: { invoke: async () => ({ ok: true }) },
  });
  assert.equal(result.status, 'success');
  assert.equal(provider.calls.length, 2);
  assert.deepEqual(result.toolResults, [{ callId: 'call-stop', name: 'read_record', status: 'success', value: { ok: true } }]);
});

test('toolCapable rejects invalid provider decision and tool-call combinations', async () => {
  const stopWithCalls = new ToolSequenceProvider([JSON.stringify({ decision: 'stop', toolCalls: [{ id: 'call-invalid-stop', name: 'read_record', arguments: { logicalId: 'a' } }] })]);
  const stopResult = await complete(toolRequest({ toolOptions: { autoInvoke: true } }), { provider: stopWithCalls, toolInvoker: { invoke: async () => ({}) } });
  assert.equal(stopResult.status, 'provider_error');
  assert.equal(stopResult.errors[0]?.code, 'PROVIDER_REQUEST_FAILED');

  const continueWithoutCalls = new ToolSequenceProvider([JSON.stringify({ decision: 'continue', content: 'not enough' })]);
  const continueResult = await complete(toolRequest({ toolOptions: { autoInvoke: true } }), { provider: continueWithoutCalls, toolInvoker: { invoke: async () => ({}) } });
  assert.equal(continueResult.status, 'provider_error');
  assert.equal(continueResult.errors[0]?.code, 'PROVIDER_REQUEST_FAILED');
});

test('toolCapable forwards the abort signal to each tool invocation', async () => {
  const provider = new ToolSequenceProvider([JSON.stringify({ toolCalls: [{ id: 'call-abort', name: 'read_record', arguments: { logicalId: 'a' } }] }), JSON.stringify({ content: '{"ok":true}', toolCalls: [] })]);
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const result = await complete(toolRequest({ toolOptions: { autoInvoke: true } }), { provider: provider, signal: controller.signal, toolInvoker: { invoke: async (_call, context) => { received = context.signal; return {}; } } });
  assert.equal(result.status, 'success');
  assert.equal(received, controller.signal);
});

test('toolCapable emits correlated tool lifecycle events through DebugSink', async () => {
  const events: Array<{ event: string; data?: Record<string, unknown> }> = [];
  const provider = new ToolSequenceProvider([JSON.stringify({ toolCalls: [[{ id: 'call-event-a', name: 'read_record', arguments: { logicalId: 'a' } }, { id: 'call-event-b', name: 'read_record', arguments: { logicalId: 'b' } }]] }), JSON.stringify({ content: '{"ok":true}', toolCalls: [] })]);
  const result = await complete(toolRequest({ toolOptions: { autoInvoke: true } }), {
    provider,
    debug: (event) => events.push(event as { event: string; data?: Record<string, unknown> }),
    toolInvoker: { invoke: async (call) => ({ secret: 'redact-me', callId: call.id }) },
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(events.map((event) => event.event).filter((event) => event.startsWith('llm.tool.')), [
    'llm.tool.batch.start', 'llm.tool.call', 'llm.tool.call', 'llm.tool.result', 'llm.tool.result', 'llm.tool.batch.end',
  ]);
  assert.match(JSON.stringify(events), /call-event-a/u);
  assert.match(JSON.stringify(events), /call-event-b/u);
  assert.doesNotMatch(JSON.stringify(events), /redact-me/u);
});

test('toolCapable returns cancelled before starting provider work', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const provider = new ToolSequenceProvider([JSON.stringify({ content: 'never', toolCalls: [] })]);
  const result = await complete(toolRequest({ toolOptions: { autoInvoke: true } }), {
    provider,
    signal: controller.signal,
    toolInvoker: { invoke: async () => { calls += 1; return {}; } },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.errors[0]?.code, 'CANCELLED');
  assert.equal(provider.calls.length, 0);
  assert.equal(calls, 0);
});

test('toolCapable cancellation preserves completed results and does not start later model work', async () => {
  const controller = new AbortController();
  let providerCalls = 0;
  const provider: LlmProvider = {
    async complete(request) {
      providerCalls += 1;
      if (request.protocol === 'v1') return 'unused';
      if (providerCalls === 1) return { decision: 'continue', content: null, toolCalls: [[{ id: 'call-cancel', name: 'read_record', arguments: { logicalId: 'a' } }]] };
      return { decision: 'stop', content: 'unexpected', toolCalls: [] };
    },
  };
  const result = await complete(toolRequest({ toolOptions: { autoInvoke: true } }), {
    provider,
    signal: controller.signal,
    toolInvoker: { invoke: async () => { controller.abort(); return { ok: true }; } },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(providerCalls, 1);
  assert.deepEqual(result.toolResults, [{ callId: 'call-cancel', name: 'read_record', status: 'success', value: { ok: true } }]);
});

test('toolCapable cancellation observed after provider response prevents terminal success', async () => {
  const controller = new AbortController();
  const events: string[] = [];
  const provider = new ToolSequenceProvider([JSON.stringify({ content: '{"ok":true}', toolCalls: [] })]);
  const result = await complete(toolRequest(), {
    provider,
    signal: controller.signal,
    debug: (event) => {
      events.push(event.event);
      if (event.event === 'llm.provider.response') controller.abort();
    },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.output, null);
  assert.deepEqual(result.errors[0], { code: 'CANCELLED', message: 'The completion was cancelled.', phase: 'cancellation' });
  assert.deepEqual(events.slice(-4), ['llm.provider.response', 'llm.cancel.observed', 'llm.cancelled', 'llm.response']);
  assert.equal(events.includes('llm.response'), true);
  assert.equal(events.includes('llm.cancelled'), true);
});

test('toolCapable provider abort errors emit the cancellation lifecycle', async () => {
  const events: string[] = [];
  const provider: LlmProvider = {
    async complete(request) {
      if (request.protocol === 'v1') return 'unused';
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    },
  };
  const result = await complete(toolRequest(), { provider, debug: (event) => events.push(event.event) });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.errors[0]?.phase, 'cancellation');
  assert.deepEqual(events.slice(-4), ['llm.provider.request', 'llm.cancel.observed', 'llm.cancelled', 'llm.response']);
});

test('toolCapable cancellation during parallel tool events prevents unstarted tool invocation', async () => {
  const controller = new AbortController();
  const events: string[] = [];
  let invocations = 0;
  const provider = new ToolSequenceProvider([JSON.stringify({ toolCalls: [
    { id: 'call-race-a', name: 'read_record', arguments: { logicalId: 'a' } },
    { id: 'call-race-b', name: 'read_record', arguments: { logicalId: 'b' } },
  ] })]);
  const result = await complete(toolRequest({ toolOptions: { autoInvoke: true } }), {
    provider,
    signal: controller.signal,
    debug: (event) => {
      events.push(event.event);
      if (event.event === 'llm.tool.call' && event.data && typeof event.data === 'object' && (event.data as { callId?: unknown }).callId === 'call-race-a') controller.abort();
    },
    toolInvoker: { invoke: async () => { invocations += 1; return { ok: true }; } },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(invocations, 0);
  assert.deepEqual(result.toolResults, []);
  assert.equal(result.errors[0]?.phase, 'cancellation');
  assert.deepEqual(events.slice(-3), ['llm.cancel.observed', 'llm.cancelled', 'llm.response']);
  assert.ok(events.indexOf('llm.cancel.observed') < events.indexOf('llm.cancelled'));
  assert.ok(events.indexOf('llm.cancelled') < events.indexOf('llm.response'));
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

test('unified complete dispatches v1 and toolCapable requests to matching response schemas', async () => {
  const v1 = await complete({ schema, task: 'task', systemPrompt: 'system' }, { provider: new SequenceProvider(['ok']) });
  const toolCapable = await complete(toolRequest(), { provider: new ToolSequenceProvider([JSON.stringify({ content: '{"ok":true}', toolCalls: [] })]) });
  assert.equal(v1.schema, 'https://schemas.handschuh.dev/llm/response/v1');
  assert.equal(toolCapable.schema, 'https://schemas.handschuh.dev/llm/response/v1');
  assert.equal(toolCapable.status, 'success');
});

test('unified complete routes malformed known toolCapable requests to response/toolCapable', async () => {
  const result = await complete({ schema: toolSchema, task: '', systemPrompt: 'system' }, { provider: new ToolSequenceProvider([]) });
  assert.equal(result.schema, 'https://schemas.handschuh.dev/llm/response/v1');
  assert.equal(result.status, 'input_invalid');
});

test('unified complete rejects an unknown request schema without mislabeling it as toolCapable', async () => {
  const result = await complete({ schema: 'https://schemas.handschuh.dev/llm/request/v9', task: 'task', systemPrompt: 'system' } as never, { provider: new SequenceProvider(['ok']) });
  assert.equal(result.schema, 'https://schemas.handschuh.dev/llm/response/v1');
  assert.equal(result.status, 'input_invalid');
});

test('reports v1 and toolCapable request-schema violations before provider invocation', async () => {
  const v1Provider = new SequenceProvider(['ok']);
  const v1 = await complete({ ...request(), extra: true }, { provider: v1Provider });
  assert.equal(v1.schema, 'https://schemas.handschuh.dev/llm/response/v1');
  assert.equal(v1.status, 'input_invalid');
  assert.equal(v1.errors[0]?.code, 'REQUEST_INVALID');
  assert.match(v1.errors[0]?.message ?? '', /additional properties/u);
  assert.equal(v1Provider.calls.length, 0);

  const toolCapableProvider = new ToolSequenceProvider([]);
  const toolCapable = await complete(toolRequest({ extra: true }), { provider: toolCapableProvider });
  assert.equal(toolCapable.schema, 'https://schemas.handschuh.dev/llm/response/v1');
  assert.equal(toolCapable.status, 'input_invalid');
  assert.equal(toolCapable.errors[0]?.code, 'REQUEST_INVALID');
  assert.match(toolCapable.errors[0]?.message ?? '', /additional properties/u);
  assert.equal(toolCapableProvider.calls.length, 0);
});

test('ILlmProvider accepts a toolCapable request and returns response/toolCapable', async () => {
  const service: ILlmProvider = { complete };
  const result = await service.complete(toolRequest(), { provider: new ToolSequenceProvider([JSON.stringify({ content: '{"ok":true}', toolCalls: [] })]) });
  assert.equal(result.schema, 'https://schemas.handschuh.dev/llm/response/v1');
});

test('ILlmProvider performs bounded output-schema correction iterations', async () => {
  const outputSchema = {
    $id: 'https://example.test/act-result',
    type: 'object',
    required: ['status', 'summary'],
    additionalProperties: false,
    properties: {
      status: { const: 'completed' },
      summary: { type: 'string', minLength: 1 },
    },
  };
  const taskSchema = {
    $id: 'https://example.test/act-task',
    type: 'object',
    required: ['target'],
    additionalProperties: false,
    properties: { target: { type: 'string', minLength: 1 } },
  };
  const service: ILlmProvider = { complete };
  const provider = new SequenceProvider([
    '{"status":"completed"}',
    '{"status":"completed","summary":"validated completion"}',
  ]);
  const result = await service.complete(
    {
      schema,
      task: { target: 'B0056-04' },
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
      task: { target: 'B0056-04' },
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

test('toolCapable includes output-schema violations in correction retries', async () => {
  const provider = new ToolSequenceProvider([
    JSON.stringify({ content: '{\"ok\":\"wrong type\"}', toolCalls: [] }),
    JSON.stringify({ content: '{\"ok\":true}', toolCalls: [] }),
  ]);
  const result = await complete(toolRequest({ maxIterations: 2 }), {
    provider: provider,
  });

  assert.equal(result.status, 'success');
  assert.equal(result.iterations, 2);
  assert.equal(provider.calls.length, 2);
  assert.match(provider.calls[1]?.llmPrompt ?? '', /correctionInstruction/u);
  assert.match(provider.calls[1]?.llmPrompt ?? '', /must be boolean/u);
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
  assert.equal(normalized.task, '{"ok":true}');
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
  const taskSchema = { type: 'object', required: ['required'], additionalProperties: false, properties: { required: { type: 'boolean' } } };
  const malformed = await complete({ schema, task: { required: 'wrong' }, systemPrompt: 'system', taskSchema }, { provider });
  assert.equal(malformed.status, 'input_invalid');
  assert.equal(provider.calls.length, 0);
  const result = await complete({ schema, task: { wrong: true }, systemPrompt: 'system', taskSchema }, { provider });
  assert.equal(result.status, 'input_invalid');
  assert.equal(provider.calls.length, 0);
});

test('validates uri formats in configured schemas without provider use for invalid values', async () => {
  const taskSchema = { type: 'string', format: 'uri' };
  const validProvider = new SequenceProvider(['ok']);
  const valid = await complete({ schema, task: 'https://example.test/task', systemPrompt: 'Return text.', taskSchema }, { provider: validProvider });
  assert.equal(valid.status, 'success');
  assert.equal(validProvider.calls.length, 1);

  const invalidProvider = new SequenceProvider(['ok']);
  const invalid = await complete({ schema, task: 'not a uri', systemPrompt: 'Return text.', taskSchema }, { provider: invalidProvider });
  assert.equal(invalid.status, 'input_invalid');
  assert.equal(invalid.errors[0]?.code, 'TASK_SCHEMA_VALIDATION_FAILED');
  assert.equal(invalidProvider.calls.length, 0);
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

test('debug emits sanitized provider exceptions while preserving retry response behavior', async () => {
  const events: Array<{ event: string; data?: unknown }> = [];
  const provider: LlmProvider = {
    async complete() {
      throw new Error('network secret=hidden');
    },
  };
  const result = await complete({ ...request(), maxFailedAttempts: 1 }, { provider, debug: (event) => events.push(event) });
  assert.equal(result.status, 'attempts_exhausted');
  const errorEvent = events.find((event) => event.event === 'llm.error');
  assert.ok(errorEvent);
  const data = errorEvent.data as { phase?: string; attempt?: number; error?: { name?: string; message?: string; stack?: string } };
  assert.equal(data.phase, 'provider');
  assert.equal(data.attempt, 1);
  assert.equal(data.error?.name, 'Error');
  assert.equal(data.error?.message, 'network [redacted]');
  assert.match(data.error?.stack ?? '', /Error: network \[redacted\]/u);
  assert.equal(JSON.stringify(errorEvent).includes('network secret=hidden'), false);
});

test('debug emits LlmFailure metadata for provider configuration exceptions', async () => {
  const events: Array<{ event: string; data?: unknown }> = [];
  const provider: LlmProvider = {
    async complete() {
      throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', 'No credential secret=hidden');
    },
  };
  const result = await complete({ ...request(), maxFailedAttempts: 1 }, { provider, debug: (event) => events.push(event) });
  assert.equal(result.status, 'attempts_exhausted');
  const errorEvent = events.find((event) => event.event === 'llm.error');
  assert.ok(errorEvent);
  const data = errorEvent.data as { error?: { code?: string; phase?: string; message?: string } };
  assert.equal(data.error?.code, 'CONFIGURATION_INVALID');
  assert.equal(data.error?.phase, 'configuration');
  assert.equal(data.error?.message, 'No credential [redacted]');
  assert.equal(JSON.stringify(errorEvent).includes('secret=hidden'), false);
});

test('debug preserves wrapped provider transport exceptions', async () => {
  const originalFetch = globalThis.fetch;
  const events: Array<{ event: string; data?: unknown }> = [];
  globalThis.fetch = async () => {
    throw new Error('socket secret=hidden');
  };
  try {
    const result = await complete({ ...request(), credentials: { apiKey: 'test-key' }, maxFailedAttempts: 1 }, { debug: (event) => events.push(event) });
    assert.equal(result.status, 'attempts_exhausted');
    const errorEvent = events.find((event) => event.event === 'llm.error');
    assert.ok(errorEvent);
    const data = errorEvent.data as { error?: { cause?: { message?: string } } };
    assert.equal(data.error?.cause?.message, 'socket [redacted]');
    assert.equal(JSON.stringify(errorEvent).includes('socket secret=hidden'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    assert.equal(result.content, 'ok');
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

test('OpenRouterProvider maps toolCapable tools, tool results, and native tool calls', async () => {
  const originalFetch = globalThis.fetch;
  let body: { tools?: unknown[]; messages?: Array<Record<string, unknown>> } | undefined;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as { tools?: unknown[]; messages?: Array<Record<string, unknown>> };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call-read-1', function: { name: 'read_record', arguments: '{"logicalId":"record-a"}' } }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const provider = new OpenRouterProvider();
    const request: ProviderCompletionRequest = {
      provider: 'openrouter',
      model: 'openai/gpt-5.6-luna',
      thinking: 'low',
      systemPrompt: 'Use tools.',
      llmPrompt: '<llmPrompt />',
      files: [],
      credentials: { apiKey: 'test-key' },
      toolOptions: { tools: [{ name: 'read_record', description: 'Read a record.', inputSchema: JSON.stringify({ type: 'object', properties: { logicalId: { type: 'string' } } }) }] },
      toolResults: [{ callId: 'call-prior', name: 'previous_tool', status: 'success', value: { ok: true } }],
    };
    const result = await provider.complete(request);
    assert.deepEqual(result.toolCalls, [[{ id: 'call-read-1', name: 'read_record', arguments: { logicalId: 'record-a' } }]]);
    assert.equal(result.content, null);
    assert.equal(result.decision, 'continue');
    assert.equal((body?.tools?.[0] as { type?: string }).type, 'function');
    assert.equal((body?.messages?.[2] as { role?: string; tool_call_id?: string }).role, 'tool');
    assert.equal((body?.messages?.[2] as { tool_call_id?: string }).tool_call_id, 'call-prior');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenRouterProvider maps finish_reason stop to a terminal decision', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}', tool_calls: [] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await new OpenRouterProvider().complete({
      provider: 'openrouter', model: 'openai/gpt-5.6-luna', thinking: 'low', systemPrompt: 'Finish.', llmPrompt: '<llmPrompt />', files: [], credentials: { apiKey: 'test-key' }, toolOptions: { tools: [] }, toolResults: [],
    });
    assert.equal(result.decision, 'stop');
    assert.equal(result.content, '{"ok":true}');
    assert.deepEqual(result.toolCalls, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenRouterProvider rejects missing or unsupported finish_reason', async () => {
  const originalFetch = globalThis.fetch;
  for (const finishReason of [undefined, 'length']) {
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ ...(finishReason === undefined ? {} : { finish_reason: finishReason }), message: { content: '{"ok":true}', tool_calls: [] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    await assert.rejects(() => new OpenRouterProvider().complete({
      provider: 'openrouter', model: 'openai/gpt-5.6-luna', thinking: 'low', systemPrompt: 'Finish.', llmPrompt: '<llmPrompt />', files: [], credentials: { apiKey: 'test-key' }, toolOptions: { tools: [] }, toolResults: [],
    }), /missing or unsupported completion finish reason/u);
  }
  globalThis.fetch = originalFetch;
});

test('OpenRouterProvider rejects malformed native tool arguments', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call-bad', function: { name: 'read_record', arguments: '{' } }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(() => new OpenRouterProvider().complete({
      provider: 'openrouter', model: 'openai/gpt-5.6-luna', thinking: 'low', systemPrompt: 'Use tools.', llmPrompt: '<llmPrompt />', files: [], credentials: { apiKey: 'test-key' }, toolOptions: { tools: [{ name: 'read_record', description: 'Read', inputSchema: '{"type":"object"}' }] }, toolResults: [],
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
  assert.match(text, /"task": \{ "operation": "summarize"/);
  assert.match(text, /"status": "success"/);
  assert.match(text, /"failedAttempts": 0/);
  assert.match(text, /"iterations": 1/);
});

test('debug sink emits bounded redacted request and response events', async () => {
  const events: Array<{ event: string; data?: unknown }> = [];
  const provider: LlmProvider = { async complete() { return { content: 'debug response', toolCalls: [], decision: 'stop' }; } };
  const result = await complete({
    schema,
    task: 'debug task',
    systemPrompt: 'debug system',
    credentials: { apiKey: 'secret-key' },
  }, { provider, debug: (event) => events.push(event) });
  assert.equal(result.status, 'success');
  assert.deepEqual(events.map((event) => event.event), ['llm.request', 'llm.provider.request', 'llm.provider.response', 'llm.response']);
  assert.match(JSON.stringify(events), /debug task/u);
  assert.doesNotMatch(JSON.stringify(events), /secret-key/u);
  assert.match(JSON.stringify(events), /redacted/u);
});

test('CLI --debug preserves stdout response and writes JSONL diagnostics to stderr', async () => {
  const originalError = console.error;
  const errors: string[] = [];
  console.error = (...args: unknown[]) => errors.push(args.join(' '));
  try {
    assert.equal(await cliMain(['--debug', '--help']), 0);
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(errors, []);
});
