import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { complete } from '../src/index.js';
import { main as cliMain } from '../src/cli.js';
import { composePrompt } from '../src/prompt.js';
import { normalizeRequest } from '../src/normalize.js';
import type { LlmProvider, ProviderCompletionRequest } from '../src/types.js';

const schema = 'https://schemas.handschuh.dev/llm/request/v1';
const outputSchema = JSON.stringify({ $id: 'https://example.test/output', type: 'object', required: ['ok'], additionalProperties: false, properties: { ok: { type: 'boolean' } } });

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
  const normalized = await normalizeRequest({ schema, task: 'task.json', systemPrompt: 'literal system', files: [{ name: 'task', path: 'task.json', type: 'fixture', purpose: 'test' }] }, { configurationRoot: root });
  assert.equal(normalized.task.path, 'task.json');
  await assert.rejects(() => normalizeRequest({ schema, task: '../outside', systemPrompt: 'system' }, { configurationRoot: root }));
  await assert.rejects(() => normalizeRequest({ schema, task: '.env', systemPrompt: 'system' }, { configurationRoot: root }));
  await assert.rejects(() => normalizeRequest({ schema, task: 'dir', systemPrompt: 'system' }, { configurationRoot: root }));
  await assert.rejects(() => normalizeRequest({ schema, task: 'link.json', systemPrompt: 'system' }, { configurationRoot: root }));
  await assert.rejects(() => normalizeRequest({ schema, task: 'nested/root-link/task.json', systemPrompt: 'system' }, { configurationRoot: root }));
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
  const first = composePrompt({ task: 'a ]]> b', taskSchema: '{"type":"object"}', files: [{ name: 'one', path: 'one.md', type: 'guidance', purpose: 'context', content: '<unsafe>' }], outputSchema: '{"type":"object"}' });
  const second = composePrompt({ task: 'a ]]> b', taskSchema: '{"type":"object"}', files: [{ name: 'one', path: 'one.md', type: 'guidance', purpose: 'context', content: '<unsafe>' }], outputSchema: '{"type":"object"}' });
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
