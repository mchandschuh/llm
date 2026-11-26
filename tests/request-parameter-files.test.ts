import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LlmFailure } from '../src/errors.js';
import { completeRequest } from '../src/request.js';
import { validateParameterFileSchema } from '../src/request-parameter-files.js';
import { runRequestCommand } from '../src/cli/request-command.js';
import type { LlmProvider, ProviderCompletionRequest } from '../src/types.js';

interface Fixture {
  readonly root: string;
  readonly requests: string;
  readonly request: string;
  readonly configuration: string;
}

interface CapturedOutput {
  readonly result: number;
  readonly stdout: string;
  readonly stderr: string;
}

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.test/request-parameter-files/v1',
  type: 'object',
  additionalProperties: false,
  required: ['path', 'content'],
  properties: {
    path: {
      type: 'string',
      minLength: 1,
      'x-llm-req-parameter': {
        file: { mode: 'path', type: 'text/plain', purpose: 'Path source.' },
      },
    },
    content: {
      type: 'string',
      minLength: 1,
      'x-llm-req-parameter': {
        file: { mode: 'content', name: 'inline.txt', type: 'text/plain', purpose: 'Inline source.' },
      },
    },
  },
} as const;

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'llm-request-parameter-files-'));
  const requests = join(root, 'requests');
  const request = join(requests, 'report');
  const configuration = join(root, 'configuration');
  await mkdir(request, { recursive: true });
  await mkdir(join(configuration, '.config'), { recursive: true });
  await Promise.all([
    writeFile(join(configuration, 'config.json'), JSON.stringify({ requestsDirectory: requests })),
    writeFile(join(configuration, '.config', 'config.json'), JSON.stringify({ requestsDirectory: requests })),
    writeFile(join(request, 'report.prompt.md'), 'Use every supplied source.'),
    writeFile(join(request, 'report.parameters.schema.json'), JSON.stringify(schema)),
  ]);
  return { root, requests, request, configuration };
}

function provider(response: string, calls: ProviderCompletionRequest[], beforeReturn?: (request: ProviderCompletionRequest) => Promise<void>): LlmProvider {
  return {
    async complete(request) {
      calls.push(request);
      await beforeReturn?.(request);
      return { content: response, toolCalls: [], decision: 'stop' };
    },
  };
}

async function capture(operation: (write: (text: string) => void, writeError: (text: string) => void) => Promise<number>): Promise<CapturedOutput> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    result: await operation((text) => stdout.push(text), (text) => stderr.push(text)),
    stdout: stdout.join(''),
    stderr: stderr.join(''),
  };
}

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(() => access(path), { code: 'ENOENT' });
}

async function withRequestConfiguration<T>(configuration: string, operation: () => Promise<T>): Promise<T> {
  const previous = process.env.LLM_CONFIG;
  process.env.LLM_CONFIG = configuration;
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.LLM_CONFIG;
    else process.env.LLM_CONFIG = previous;
  }
}

test('WI-0024-10000000_TC-METADATA-VALIDATION accepts supported bindings and rejects malformed or executable metadata', () => {
  const bindings = validateParameterFileSchema(schema);
  assert.deepEqual(bindings.map((binding) => binding.path), ['path', 'content']);
  assert.equal(bindings[0]?.metadata.mode, 'path');
  assert.equal(bindings[1]?.metadata.mode, 'content');

  const invalidSchemas: readonly [string, unknown][] = [
    ['unknown file member', { ...schema, properties: { path: { ...schema.properties.path, 'x-llm-req-parameter': { file: { mode: 'path', type: 'text/plain', purpose: 'Source.', execute: 'code' } } } } }],
    ['invalid MIME type', { ...schema, properties: { path: { ...schema.properties.path, 'x-llm-req-parameter': { file: { mode: 'path', type: 'plain', purpose: 'Source.' } } } } }],
    ['missing content name', { ...schema, properties: { content: { ...schema.properties.content, 'x-llm-req-parameter': { file: { mode: 'content', type: 'text/plain', purpose: 'Source.' } } } } }],
    ['object binding', { ...schema, properties: { path: { type: 'object', 'x-llm-req-parameter': { file: { mode: 'path', type: 'text/plain', purpose: 'Source.' } } } } }],
    ['array binding', { ...schema, properties: { path: { type: 'array', items: { type: 'string' }, 'x-llm-req-parameter': { file: { mode: 'path', type: 'text/plain', purpose: 'Source.' } } } } }],
    ['custom validation metadata', { ...schema, 'x-llm-req-parameter': { validation: { function: 'validate' } } }],
  ];
  for (const [name, invalid] of invalidSchemas) {
    assert.throws(() => validateParameterFileSchema(invalid as typeof schema), (error: unknown) => {
      assert.equal(error instanceof LlmFailure, true, name);
      assert.equal((error as LlmFailure).code, 'CONFIGURATION_INVALID', name);
      assert.match((error as Error).message, /file|metadata|schema/u, name);
      return true;
    });
  }
});

test('WI-0024-10000000_TC-MATERIALIZATION-BOUNDARY orders declared and explicit files, emits prompt XML, and cleans content files', async () => {
  const value = await fixture();
  const sourcePath = join(value.root, 'source.txt');
  const explicitPath = join(value.root, 'explicit.txt');
  const calls: ProviderCompletionRequest[] = [];
  let materializedContentPath: string | undefined;
  await Promise.all([writeFile(sourcePath, 'path source'), writeFile(explicitPath, 'explicit source')]);
  try {
    await withRequestConfiguration(value.configuration, () => completeRequest({
      requestName: 'report',
      configurationRoot: value.configuration,
      parameters: { path: sourcePath, content: 'inline source' },
      files: [{ name: 'explicit', path: explicitPath, type: 'text/plain', purpose: 'Explicit source.' }],
      provider: provider('done', calls, async (request) => {
        materializedContentPath = request.files[1]?.path;
        assert.deepEqual(request.files.map((file) => file.name), ['source.txt', 'inline.txt', 'explicit']);
        assert.deepEqual(request.files.map((file) => file.content), ['path source', 'inline source', 'explicit source']);
        assert.match(request.llmPrompt, /<files>/u);
        assert.match(request.llmPrompt, /inline source/u);
      }),
    }));
    assert.equal(calls.length, 1);
    await assertMissing(materializedContentPath!);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('WI-0024-10000000_TC-CLEANUP-FAILURE removes content files when provider delegation throws', async () => {
  const value = await fixture();
  let materializedContentPath: string | undefined;
  try {
    await writeFile(join(value.root, 'source.txt'), 'path source');
    const failure = await withRequestConfiguration(value.configuration, () => completeRequest({
        requestName: 'report',
        configurationRoot: value.configuration,
        parameters: { path: join(value.root, 'source.txt'), content: 'inline source' },
        provider: {
          async complete(request) {
            materializedContentPath = request.files[1]?.path;
            throw new Error('provider failure');
          },
        },
      })).then(() => undefined, (error: unknown) => error);
    assert.ok(failure instanceof Error);
    assert.match(failure.message, /provider failure/u);
    await assertMissing(materializedContentPath!);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('WI-0024-10000000_TC-SAFETY-BOUNDARY rejects symlink directories before provider use', async () => {
  const value = await fixture();
  const target = join(value.root, 'target');
  const link = join(value.root, 'directory-link');
  const calls: ProviderCompletionRequest[] = [];
  try {
    await mkdir(target);
    await symlink(target, link);
    await assert.rejects(
      () => withRequestConfiguration(value.configuration, () => completeRequest({
        requestName: 'report',
        configurationRoot: value.configuration,
        parameters: { path: link, content: 'inline source' },
        provider: provider('must not run', calls),
      })),
      /regular files or directories/u,
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('WI-0024-10000000_TC-SHARED-BOUNDARY forwards raw parameters and assignments through completeRequest without request-name semantics', async () => {
  const value = await fixture();
  const sourcePath = join(value.root, 'source.txt');
  const calls: ProviderCompletionRequest[] = [];
  await writeFile(sourcePath, 'shared path source');
  try {
    const output = await withRequestConfiguration(value.configuration, () => capture((write, writeError) => runRequestCommand({
        requestName: 'report',
        parameters: JSON.stringify({ path: sourcePath }),
        assignments: [{ path: 'content', value: 'shared inline source' }],
        debug: false,
        provider: provider('shared boundary', calls),
        write,
        writeError,
      })));
    assert.equal(output.result, 0);
    assert.equal(output.stdout, 'shared boundary');
    assert.equal(output.stderr, '');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.files.map((file) => file.content), ['shared path source', 'shared inline source']);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('WI-0024-10000000_TC-COMPATIBILITY-GATE preserves explicit additional files and raw output', async () => {
  const value = await fixture();
  const explicitPath = join(value.root, 'explicit.txt');
  const calls: ProviderCompletionRequest[] = [];
  await writeFile(explicitPath, 'explicit compatibility source');
  try {
    const result = await withRequestConfiguration(value.configuration, () => completeRequest({
      requestName: 'report',
      configurationRoot: value.configuration,
      parameters: { path: explicitPath, content: 'declared source' },
      files: [{ name: 'explicit', path: explicitPath, type: 'text/plain', purpose: 'Compatibility source.' }],
      provider: provider('raw compatibility response', calls),
    }));
    assert.equal(result.content, 'raw compatibility response');
    assert.equal(calls[0]?.files.at(-1)?.name, 'explicit');
    assert.equal(calls[0]?.files.at(-1)?.content, 'explicit compatibility source');
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test('WI-0024-10000000_TC-SUMMARIZE-EXAMPLE uses summarize schema bindings for path and content with ordinary oneOf validation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-summarize-binding-'));
  const configuration = join(root, 'configuration');
  const sourcePath = join(root, 'notes.md');
  const calls: ProviderCompletionRequest[] = [];
  await mkdir(configuration, { recursive: true });
  await Promise.all([
    writeFile(join(configuration, 'config.json'), JSON.stringify({ requestsDirectory: join(process.cwd(), 'requests') })),
    writeFile(sourcePath, '# Notes\nImportant source.'),
  ]);
  try {
    await completeRequest({ requestName: 'summarize', configurationRoot: configuration, parameters: { path: sourcePath }, provider: provider('{"summary":"done"}', calls) });
    assert.equal(calls[0]?.files[0]?.content, '# Notes\nImportant source.');
    await completeRequest({ requestName: 'summarize', configurationRoot: configuration, parameters: { content: 'inline source' }, provider: provider('{"summary":"done"}', calls) });
    assert.equal(calls[1]?.files[0]?.content, 'inline source');
    await assert.rejects(() => completeRequest({ requestName: 'summarize', configurationRoot: configuration, parameters: {} , provider: provider('must not run', calls) }), /resolved parameters do not satisfy/u);
    await assert.rejects(() => completeRequest({ requestName: 'summarize', configurationRoot: configuration, parameters: { path: sourcePath, content: 'both' }, provider: provider('must not run', calls) }), /resolved parameters do not satisfy/u);
    assert.equal(calls.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});