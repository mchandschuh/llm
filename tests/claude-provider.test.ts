import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CLAUDE_INSTRUCTION,
  ClaudeProvider,
  claudeArguments,
  resolveClaudeExecutable,
} from '../src/claude-provider.js';
import { runSummarizeCommand } from '../src/cli/summarize-command.js';
import { LlmFailure } from '../src/errors.js';
import { complete, completeRequest, DEFAULT_MODELS, DEFAULT_PROVIDER, OpenRouterProvider, REQUEST_SCHEMA } from '../src/index.js';
import { normalizeRequest } from '../src/normalize.js';
import { createProvider, REGISTERED_PROVIDERS } from '../src/providers.js';
import type { LlmProvider, LlmRequest, ProviderCompletionRequest } from '../src/types.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const requestsDirectory = join(process.cwd(), 'requests');

interface Invocation {
  readonly argv: readonly string[];
  readonly stdin: string;
}

interface FakeResponse {
  readonly stdout?: unknown;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly delayMs?: number;
}

interface Fake {
  readonly environment: NodeJS.ProcessEnv;
  invocations(): Promise<readonly Invocation[]>;
}

const success = (fields: Record<string, unknown>): FakeResponse => ({ stdout: { subtype: 'success', is_error: false, ...fields } });

/** Run `operation` with a fake claude whose replies are `responses`; the environment is also applied to process.env. */
async function withFake<T>(responses: readonly FakeResponse[], operation: (fake: Fake) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'llm-fake-claude-'));
  const log = join(root, 'invocations.jsonl');
  const responsesPath = join(root, 'responses.json');
  await writeFile(responsesPath, JSON.stringify(responses));
  const overrides = { LLM_CLAUDE_EXECUTABLE: FAKE, FAKE_CLAUDE_RESPONSES: responsesPath, FAKE_CLAUDE_LOG: log };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  const fake: Fake = {
    environment: { ...process.env },
    async invocations() {
      try {
        return (await readFile(log, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Invocation);
      } catch {
        return [];
      }
    },
  };
  try {
    return await operation(fake);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

function providerRequest(overrides: Partial<ProviderCompletionRequest> = {}): ProviderCompletionRequest {
  return {
    provider: 'claude',
    model: 'sonnet',
    thinking: 'high',
    llmPrompt: '<llmPrompt version="1"><task>Say hello.</task></llmPrompt>',
    task: 'Say hello.',
    messages: [],
    files: [],
    ...overrides,
  };
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

async function rejectsWith(operation: () => Promise<unknown>, code: string, pattern: RegExp): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof LlmFailure, String(error));
    assert.equal(error.code, code);
    assert.match(error.message, pattern);
    return true;
  });
}

// SDLC-TEST-CASE: WI-0026-10000000_TC-CLAUDE-INVOCATION
test('WI-0026-10000000_TC-CLAUDE-INVOCATION runs claude -p with the documented efficient invocation and bounded failures', async () => {
  await withFake([success({ result: 'hello' })], async (fake) => {
    const provider = new ClaudeProvider({ environment: fake.environment });
    assert.deepEqual(provider.validate(), { success: true, errors: [] });
    const response = await provider.complete(providerRequest({ systemPrompt: 'Be brief.', thinking: 'minimal' }));
    assert.deepEqual(response, { content: 'hello', toolCalls: [], decision: 'stop' });
    const [invocation] = await fake.invocations();
    assert.deepEqual(invocation!.argv, [
      '-p', CLAUDE_INSTRUCTION,
      '--output-format', 'json',
      '--model', 'sonnet',
      '--effort', 'low',
      '--system-prompt', 'Be brief.',
      '--safe-mode',
      '--tools', '',
      '--strict-mcp-config',
      '--disallowedTools', 'mcp__*',
      '--no-session-persistence',
    ]);
    assert.equal(invocation!.stdin, providerRequest().llmPrompt);
  });

  // Defaults: the request system prompt is absent, so the provider uses the documented fallback.
  assert.equal(flagValue(claudeArguments(providerRequest()), '--system-prompt'), 'You are a helpful assistant.');
  assert.equal(flagValue(claudeArguments(providerRequest({ thinking: 'xhigh' })), '--effort'), 'xhigh');

  // Executable resolution.
  assert.equal(resolveClaudeExecutable({ executable: FAKE }), FAKE);
  assert.equal(resolveClaudeExecutable({ executable: '/nonexistent/claude' }), undefined);
  assert.equal(resolveClaudeExecutable({ environment: { PATH: '' } }), undefined);
  const missing = new ClaudeProvider({ executable: '/nonexistent/claude' });
  assert.equal(missing.validate().success, false);
  assert.match(missing.validate().errors[0]!.message, /LLM_CLAUDE_EXECUTABLE/u);
  await rejectsWith(() => missing.complete(providerRequest()), 'CONFIGURATION_INVALID', /requires the Claude Code CLI/u);

  const failures: readonly [FakeResponse, RegExp][] = [
    [{ stdout: { subtype: 'error_max_turns', is_error: true, result: 'ran out of turns' }, exitCode: 1 }, /reported error_max_turns: ran out of turns/u],
    [{ stdout: { subtype: 'error_during_execution', is_error: true, result: 'boom' }, exitCode: 0 }, /reported error_during_execution: boom/u],
    [{ stdout: { subtype: 'success', is_error: true, result: 'odd' } }, /reported success: odd/u],
    [{ stdout: 'not json' }, /invalid JSON result envelope/u],
    [{ stdout: '', stderr: 'Error: unknown option', exitCode: 2 }, /exited with 2: Error: unknown option/u],
    [{ stdout: { subtype: 'success', is_error: false } }, /returned no text result/u],
  ];
  for (const [reply, pattern] of failures) {
    await withFake([reply], async (fake) => {
      await rejectsWith(() => new ClaudeProvider({ environment: fake.environment }).complete(providerRequest()), 'PROVIDER_REQUEST_FAILED', pattern);
    });
  }

  // Cancellation stops the process and surfaces as an AbortError, which complete() maps to a cancelled response.
  await withFake([{ ...success({ result: 'late' }), delayMs: 10_000 }], async (fake) => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(() => new ClaudeProvider({ environment: fake.environment }).complete(providerRequest({ signal: controller.signal })), { name: 'AbortError' });
    assert.ok(Date.now() - started < 5_000);
  });

  // Requests the CLI cannot carry are rejected before any process starts.
  await withFake([success({ result: 'unused' })], async (fake) => {
    const provider = new ClaudeProvider({ environment: fake.environment });
    const image = { name: 'a.png', path: 'a.png', type: 'image/png', purpose: 'Image.', encoding: 'base64' as const, content: 'AAAA', resolvedPath: '/tmp/a.png' };
    await rejectsWith(() => provider.complete(providerRequest({ files: [image] })), 'CONFIGURATION_INVALID', /does not support image attachments/u);
    await rejectsWith(() => provider.complete(providerRequest({ llmPrompt: 'x'.repeat(10 * 1024 * 1024 + 1) })), 'CONFIGURATION_INVALID', /10 MB stdin limit/u);
    assert.equal((await fake.invocations()).length, 0);
  });
});

// SDLC-TEST-CASE: WI-0026-10000000_TC-STRUCTURED-OUTPUT
test('WI-0026-10000000_TC-STRUCTURED-OUTPUT maps outputSchema to --json-schema and returns structured output as JSON content', async () => {
  const objectSchema = { type: 'object', additionalProperties: false, required: ['summary'], properties: { summary: { type: 'string' } } };
  await withFake([success({ result: '', structured_output: { summary: 'short' } })], async (fake) => {
    const response = await new ClaudeProvider({ environment: fake.environment }).complete(providerRequest({ outputSchema: objectSchema }));
    assert.equal(response.content, '{"summary":"short"}');
    assert.deepEqual(JSON.parse(flagValue((await fake.invocations())[0]!.argv, '--json-schema')!), objectSchema);
  });

  // A non-object root is wrapped for the CLI and unwrapped for the caller.
  await withFake([success({ structured_output: { value: 'plain text' } })], async (fake) => {
    const response = await new ClaudeProvider({ environment: fake.environment }).complete(providerRequest({ outputSchema: { type: 'string' } }));
    assert.equal(response.content, '"plain text"');
    assert.deepEqual(JSON.parse(flagValue((await fake.invocations())[0]!.argv, '--json-schema')!), {
      type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } },
    });
  });

  await withFake([success({ result: 'no structured output' })], async (fake) => {
    await rejectsWith(() => new ClaudeProvider({ environment: fake.environment }).complete(providerRequest({ outputSchema: objectSchema })), 'PROVIDER_REQUEST_FAILED', /no structured output/u);
  });

  // End to end through complete(): the schema reaches the CLI and the output is validated as usual.
  await withFake([success({ structured_output: { summary: 'from complete' } })], async (fake) => {
    const result = await complete({ schema: REQUEST_SCHEMA, task: 'Summarize.', systemPrompt: 'Return JSON.', outputSchema: objectSchema } as LlmRequest);
    assert.equal(result.status, 'success', JSON.stringify(result.errors));
    assert.deepEqual(result.output?.value, { summary: 'from complete' });
    assert.deepEqual(JSON.parse(flagValue((await fake.invocations())[0]!.argv, '--json-schema')!), objectSchema);
  });
});

// SDLC-TEST-CASE: WI-0026-10000000_TC-TOOL-CALLING
test('WI-0026-10000000_TC-TOOL-CALLING runs the complete tool loop through the structured stop/continue envelope', async () => {
  const lookupSchema = { type: 'object', additionalProperties: false, required: ['key'], properties: { key: { type: 'string' } } };
  const request = {
    schema: REQUEST_SCHEMA,
    task: 'Look up a and report it.',
    systemPrompt: 'Use tools when needed.',
    toolOptions: {
      tools: [{ name: 'lookup', description: 'Look up a value by key.', inputSchema: JSON.stringify(lookupSchema) }],
      autoInvoke: true,
      maxRounds: 3,
    },
  } as LlmRequest;
  const invoked: unknown[] = [];
  await withFake([
    success({ structured_output: { decision: 'continue', toolCalls: [{ id: 'call-1', name: 'lookup', arguments: { key: 'a' } }] } }),
    success({ structured_output: { decision: 'stop', output: 'a is 42' } }),
  ], async (fake) => {
    const result = await complete(request, { toolInvoker: { invoke: async (call) => { invoked.push(call); return { value: 42 }; } } });
    assert.equal(result.status, 'success', JSON.stringify(result.errors));
    assert.equal(result.output?.value, 'a is 42');
    assert.equal(result.toolCalls, 1);
    assert.deepEqual(invoked, [{ id: 'call-1', name: 'lookup', arguments: { key: 'a' } }]);

    const [first, second] = await fake.invocations();
    const schema = JSON.parse(flagValue(first!.argv, '--json-schema')!) as { oneOf: Record<string, any>[] };
    assert.deepEqual(schema.oneOf.map((branch) => branch.properties.decision), [{ const: 'stop' }, { const: 'continue' }]);
    assert.deepEqual(schema.oneOf[0]!.properties.output, { type: 'string' });
    const callSchema = schema.oneOf[1]!.properties.toolCalls.items.oneOf[0];
    assert.deepEqual(callSchema.required, ['id', 'name', 'arguments']);
    assert.deepEqual(callSchema.properties.name, { const: 'lookup' });
    assert.deepEqual(callSchema.properties.arguments, lookupSchema);

    assert.match(first!.stdin, /<tools><!\[CDATA\[\[\{"name":"lookup","description":"Look up a value by key\.","inputSchema":\{/u);
    assert.match(first!.stdin, /<responseInstructions>/u);
    assert.doesNotMatch(first!.stdin, /<conversation>/u);
    assert.match(second!.stdin, /<message role="assistant">.*"id":"call-1".*<\/message>/su);
    assert.match(second!.stdin, /<message role="tool" toolCallId="call-1"><!\[CDATA\[.*42.*\]\]><\/message>/su);
    assert.doesNotMatch(second!.stdin, /^<toolResults>/mu, 'tool results travel in the conversation, not twice');
  });

  // Malformed envelopes fail as tool-call errors rather than being guessed at.
  await withFake([success({ structured_output: { decision: 'continue', toolCalls: [] } })], async (fake) => {
    const provider = new ClaudeProvider({ environment: fake.environment });
    const normalized = providerRequest({ toolOptions: { tools: request.toolOptions!.tools!, autoInvoke: false, maxRounds: 1, maxCalls: 8 } });
    await rejectsWith(() => provider.complete(normalized), 'TOOL_CALL_INVALID', /invalid tool-call envelope/u);
  });
});

// SDLC-TEST-CASE: WI-0026-10000000_TC-PROVIDER-RESOLUTION
test('WI-0026-10000000_TC-PROVIDER-RESOLUTION resolves registered providers through every selection mechanism', async () => {
  assert.deepEqual(REGISTERED_PROVIDERS, ['claude', 'openrouter']);
  assert.ok(createProvider('claude') instanceof ClaudeProvider);
  assert.ok(createProvider('openrouter') instanceof OpenRouterProvider);
  assert.throws(() => createProvider('acme'), /No provider adapter is registered for acme\. Registered providers: claude, openrouter\./u);
  assert.throws(() => createProvider('toString'), /No provider adapter is registered for toString/u);

  const previousKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    // summarize declares an outputSchema, so its invocations reply with structured output.
    const summary = success({ structured_output: { summary: 'claude summary' } });
    await withFake([success({ result: 'claude answered' }), success({ result: 'claude answered' }), summary, summary], async (fake) => {
      // Default provider and explicit request.provider both reach claude.
      assert.equal((await complete({ schema: REQUEST_SCHEMA, task: 'Hi.', systemPrompt: 'Be brief.' } as LlmRequest)).output?.value, 'claude answered');
      assert.equal((await complete({ schema: REQUEST_SCHEMA, task: 'Hi.', systemPrompt: 'Be brief.', provider: 'claude', model: 'opus' } as LlmRequest)).output?.value, 'claude answered');
      const invocations = await fake.invocations();
      assert.deepEqual(invocations.map((invocation) => flagValue(invocation.argv, '--model')), ['sonnet', 'opus']);

      // completeRequest settings and llm summarize --provider select claude too.
      const viaRequest = await completeRequest({ requestName: 'summarize', requestsDirectory, parameters: { content: 'text' }, settings: { provider: 'claude' } });
      assert.equal(viaRequest.content, '{"summary":"claude summary"}');
      const stdout: string[] = [];
      const exitCode = await runSummarizeCommand({ requestDirectory: requestsDirectory, content: 'text', providerName: 'claude', debug: false, write: (text) => stdout.push(text), writeError: () => undefined });
      assert.equal(exitCode, 0);
      assert.equal(stdout.join(''), '{"summary":"claude summary"}');
      assert.equal((await fake.invocations()).length, 4);
    });

    // openrouter stays selectable; without credentials it fails validation before any network call.
    const openrouter = await complete({ schema: REQUEST_SCHEMA, task: 'Hi.', systemPrompt: 'Be brief.', provider: 'openrouter' } as LlmRequest);
    assert.equal(openrouter.status, 'configuration_error');
    assert.match(openrouter.errors[0]!.message, /OpenRouter requires/u);
    const stderr: string[] = [];
    assert.equal(await runSummarizeCommand({ requestDirectory: requestsDirectory, content: 'text', providerName: 'openrouter', debug: false, write: () => undefined, writeError: (text) => stderr.push(text) }), 1);
    assert.match(stderr.join(''), /OpenRouter requires/u);

    // Unknown names fail as configuration errors on every path.
    const unknown = await complete({ schema: REQUEST_SCHEMA, task: 'Hi.', systemPrompt: 'Be brief.', provider: 'acme' } as LlmRequest);
    assert.equal(unknown.status, 'configuration_error');
    assert.match(unknown.errors[0]!.message, /Registered providers: claude, openrouter/u);
    await assert.rejects(() => completeRequest({ requestName: 'summarize', requestsDirectory, parameters: { content: 'text' }, settings: { provider: 'acme' } }), /Registered providers: claude, openrouter/u);
  } finally {
    if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey;
  }

  // Injected providers win over the registry, even for a registered name.
  await withFake([success({ result: 'must not run' })], async (fake) => {
    const injected: LlmProvider = { async complete() { return { content: 'injected', toolCalls: [], decision: 'stop' }; } };
    const result = await complete({ schema: REQUEST_SCHEMA, task: 'Hi.', systemPrompt: 'Be brief.', provider: 'claude' } as LlmRequest, { provider: injected });
    assert.equal(result.output?.value, 'injected');
    assert.equal((await fake.invocations()).length, 0);
  });
});

// SDLC-TEST-CASE: WI-0026-10000000_TC-DEFAULT-PROVIDER
test('WI-0026-10000000_TC-DEFAULT-PROVIDER defaults to claude with sonnet and keeps per-provider model defaults', async () => {
  assert.equal(DEFAULT_PROVIDER, 'claude');
  assert.deepEqual(DEFAULT_MODELS, { claude: 'sonnet', openrouter: 'openai/gpt-5.6-luna' });
  const normalize = (fields: Partial<LlmRequest>) => normalizeRequest({ schema: REQUEST_SCHEMA, task: 'task', systemPrompt: 'system', ...fields } as LlmRequest, { configurationRoot: process.cwd() });
  const cases: readonly [Partial<LlmRequest>, string, string][] = [
    [{}, 'claude', 'sonnet'],
    [{ provider: 'claude' }, 'claude', 'sonnet'],
    [{ provider: 'claude', model: 'opus' }, 'claude', 'opus'],
    [{ provider: 'openrouter' }, 'openrouter', 'openai/gpt-5.6-luna'],
    [{ provider: 'openrouter', model: 'anthropic/claude-sonnet-4' }, 'openrouter', 'anthropic/claude-sonnet-4'],
    [{ provider: 'custom' }, 'custom', 'openai/gpt-5.6-luna'],
  ];
  for (const [fields, provider, model] of cases) {
    const normalized = await normalize(fields);
    assert.deepEqual([normalized.provider, normalized.model], [provider, model], JSON.stringify(fields));
  }

  assert.deepEqual(JSON.parse(await readFile('requests/summarize/summarize.defaults.json', 'utf8')), { thinking: 'low' });
  const requestSchema = JSON.parse(await readFile('schemas/request/v1/request.schema.json', 'utf8')) as { properties: Record<string, { default: string; description: string }> };
  assert.equal(requestSchema.properties.provider!.default, 'claude');
  assert.match(requestSchema.properties.provider!.description, /defaults this field to claude/u);
  assert.equal(requestSchema.properties.model!.default, 'sonnet');
  assert.match(requestSchema.properties.model!.description, /sonnet for claude and openai\/gpt-5\.6-luna for openrouter/u);
});

// SDLC-TEST-CASE: WI-0026-10000000_TC-DOCUMENTATION-AND-ISOLATION
test('WI-0026-10000000_TC-DOCUMENTATION-AND-ISOLATION documents the claude provider and keeps the suite off the real CLI', async () => {
  const [skill, readme, contract] = await Promise.all([readFile('SKILL.md', 'utf8'), readFile('README.md', 'utf8'), readFile('requests/README.md', 'utf8')]);
  for (const statement of [
    'claude -p',
    '--safe-mode',
    '--json-schema',
    'LLM_CLAUDE_EXECUTABLE',
    '`sonnet`',
    '"decision": "continue"',
    '"decision": "stop"',
    '"toolCalls"',
    'inputSchema',
    'image attachments',
    '`provider: "openrouter"`',
  ]) {
    assert.ok(skill.includes(statement), `SKILL.md documents ${statement}`);
  }
  assert.doesNotMatch(skill, /`provider` defaults to `openrouter`/u);
  assert.doesNotMatch(skill, /Only the `openrouter` adapter is built in/u);
  assert.match(readme, /`claude` provider/u);
  assert.match(contract, /claude/u);

  // The suite-wide guard points the claude provider at the fake CLI, so no test can reach the real one.
  assert.equal(process.env.LLM_CLAUDE_EXECUTABLE, FAKE);
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> };
  assert.match(pkg.scripts.test!, /--import \.\/tests\/support\/claude-guard\.ts/u);
  assert.match(pkg.scripts['test:pattern']!, /--import \.\/tests\/support\/claude-guard\.ts/u);
});
