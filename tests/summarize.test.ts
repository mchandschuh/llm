import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { parseCliArguments, parseCliArgumentsAsync } from '../src/cli/arguments.js';
import { runRequestCommand } from '../src/cli/request-command.js';
import { runSummarizeCommand } from '../src/cli/summarize-command.js';
import { resolveRequestsDirectory } from '../src/requests-config.js';
import type { LlmProvider, ProviderCompletionRequest } from '../src/types.js';

const requestsDirectory = resolve(process.cwd(), 'requests');
const summarizeDirectory = join(requestsDirectory, 'summarize');

interface CapturedOutput {
  readonly result: number;
  readonly stdout: string;
  readonly stderr: string;
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

function provider(response: string, calls: ProviderCompletionRequest[]): LlmProvider {
  return {
    async complete(request) {
      calls.push(request);
      return { content: response, toolCalls: [], decision: 'stop' };
    },
  };
}

test('WI-0021-10000000_TC-GENERIC-EXAMPLE executes summarize assets through the generic req boundary', async () => {
  const calls: ProviderCompletionRequest[] = [];
  const prompt = await readFile(join(summarizeDirectory, 'summarize.prompt.md'), 'utf8');
  const outputSchema = JSON.parse(await readFile(join(summarizeDirectory, 'summarize.outputSchema.json'), 'utf8')) as Record<string, unknown>;
  const output = await capture((write, writeError) => runRequestCommand({
    requestName: 'summarize',
    requestsDirectory,
    parameters: JSON.stringify({ content: 'Inline source content.' }),
    debug: false,
    provider: provider('{"summary":"Inline source summary."}', calls),
    write,
    writeError,
  }));

  assert.equal(output.result, 0);
  assert.equal(output.stdout, '{"summary":"Inline source summary."}');
  assert.equal(output.stderr, '');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.task, prompt);
  assert.equal(calls[0]?.systemPrompt, undefined);
  assert.equal(calls[0]?.provider, 'openrouter');
  assert.equal(calls[0]?.model, 'openai/gpt-5-nano');
  assert.equal(calls[0]?.thinking, 'low');
  assert.deepEqual(calls[0]?.outputSchema, outputSchema);
  assert.deepEqual(calls[0]?.files.map((file) => ({ name: file.name, content: file.content, purpose: file.purpose })), [{
    name: 'content',
    content: 'Inline source content.',
    purpose: 'Content supplied to the request.',
  }]);

  const invalidCalls: ProviderCompletionRequest[] = [];
  for (const parameters of [{}, { path: 'notes.md', content: 'both sources' }]) {
    const invalid = await capture((write, writeError) => runRequestCommand({
      requestName: 'summarize',
      requestsDirectory,
      parameters: JSON.stringify(parameters),
      debug: false,
      provider: provider('must not run', invalidCalls),
      write,
      writeError,
    }));
    assert.equal(invalid.result, 1);
    assert.equal(invalid.stdout, '');
    assert.match(invalid.stderr, /resolved parameters do not satisfy/u);
  }
  assert.equal(invalidCalls.length, 0);
});

test('reports the --p-content fix for llm req summarize --content parameter validation', async () => {
  const configurationRoot = await mkdtemp(join(tmpdir(), 'llm-summarize-cli-repro-'));
  const previousConfiguration = process.env.LLM_CONFIG;
  const calls: ProviderCompletionRequest[] = [];
  const expectedError = {
    status: 'configuration_error',
    errors: [{
      code: 'CONFIGURATION_INVALID',
      phase: 'configuration',
      message: "Request parameters are invalid. The resolved parameters do not satisfy the parameter schema: $ must have required property 'path'; $ must have required property 'content'; $ must match exactly one schema in oneOf. The --content option supplies an additional input file; it does not set the request's content parameter. Use --p-content <value> (for example, llm req summarize --p-content 'some-content').",
    }],
  };

  try {
    await mkdir(join(configurationRoot, '.config'), { recursive: true });
    const configuration = JSON.stringify({ requestsDirectory });
    await Promise.all([
      writeFile(join(configurationRoot, 'config.json'), configuration),
      writeFile(join(configurationRoot, '.config', 'config.json'), configuration),
    ]);
    process.env.LLM_CONFIG = configurationRoot;

    const parsed = await parseCliArgumentsAsync(['req', 'summarize', '--content', 'some-content']);
    assert.deepEqual(parsed, {
      debug: false,
      format: 'raw',
      printChatId: false,
      command: 'req',
      requestName: 'summarize',
      requestSourceContent: 'some-content',
    });

    const output = await capture((write, writeError) => runRequestCommand({
      requestName: parsed.requestName!,
      sourceContent: parsed.requestSourceContent,
      debug: parsed.debug,
      format: parsed.format,
      provider: provider('must not run', calls),
      write,
      writeError,
    }));

    assert.equal(output.result, 1);
    assert.equal(output.stdout, '');
    assert.deepEqual(JSON.parse(output.stderr), expectedError);
    assert.equal(calls.length, 0);
  } finally {
    if (previousConfiguration === undefined) delete process.env.LLM_CONFIG;
    else process.env.LLM_CONFIG = previousConfiguration;
    await rm(configurationRoot, { recursive: true, force: true });
  }
});

test('WI-0021-10000000_TC-COMPATIBILITY keeps legacy summarize as a generic-request adapter', async () => {
  const genericCalls: ProviderCompletionRequest[] = [];
  const legacyCalls: ProviderCompletionRequest[] = [];
  const response = '{"summary":"Compatibility summary."}';
  const generic = await capture((write, writeError) => runRequestCommand({
    requestName: 'summarize',
    requestsDirectory,
    parameters: JSON.stringify({ content: 'Compatibility input.' }),
    debug: false,
    provider: provider(response, genericCalls),
    write,
    writeError,
  }));
  const legacy = await capture((write, writeError) => runSummarizeCommand({
    requestDirectory: requestsDirectory,
    content: 'Compatibility input.',
    providerName: 'anthropic',
    model: 'anthropic/test-model',
    thinking: 'medium',
    debug: false,
    provider: provider(response, legacyCalls),
    write,
    writeError,
  }));

  assert.equal(generic.result, 0);
  assert.equal(legacy.result, 0);
  assert.equal(generic.stdout, response);
  assert.equal(legacy.stdout, response);
  assert.equal(generic.stderr, '');
  assert.equal(legacy.stderr, '');
  assert.equal(genericCalls.length, 1);
  assert.equal(legacyCalls.length, 1);
  assert.equal(legacyCalls[0]?.task, genericCalls[0]?.task);
  assert.deepEqual(legacyCalls[0]?.outputSchema, genericCalls[0]?.outputSchema);
  assert.deepEqual(legacyCalls[0]?.files.map((file) => ({ name: file.name, content: file.content, type: file.type, purpose: file.purpose })), genericCalls[0]?.files.map((file) => ({ name: file.name, content: file.content, type: file.type, purpose: file.purpose })));
  assert.equal(legacyCalls[0]?.provider, 'anthropic');
  assert.equal(legacyCalls[0]?.model, 'anthropic/test-model');
  assert.equal(legacyCalls[0]?.thinking, 'medium');
});

test('WI-0021-10000000_TC-SOURCE-REGRESSIONS preserves generic path, directory, symlink, content, raw, and full cases', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-summarize-generic-sources-'));
  const nested = join(root, 'nested');
  const deep = join(nested, 'deep');
  const outside = await mkdtemp(join(tmpdir(), 'llm-summarize-generic-target-'));
  const calls: ProviderCompletionRequest[] = [];
  await mkdir(deep, { recursive: true });
  await Promise.all([
    writeFile(join(root, 'root.md'), 'root content'),
    writeFile(join(nested, 'child.md'), 'child content'),
    writeFile(join(deep, 'deep.md'), 'deep content'),
    writeFile(join(outside, 'linked.md'), 'linked content'),
  ]);
  await symlink(join(outside, 'linked.md'), join(root, 'linked.md'));
  await symlink(nested, join(root, 'nested-link'));

  try {
    const pathOutput = await capture((write, writeError) => runRequestCommand({
      requestName: 'summarize',
      requestsDirectory,
      parameters: JSON.stringify({ path: root }),
      debug: false,
      provider: provider('path summary', calls),
      write,
      writeError,
    }));
    assert.equal(pathOutput.result, 0);
    assert.equal(pathOutput.stdout, 'path summary');
    assert.deepEqual(calls[0]?.files.map((file) => ({ path: file.path, content: file.content })), [
      { path: join(root, 'linked.md'), content: 'linked content' },
      { path: join(root, 'nested/child.md'), content: 'child content' },
      { path: join(root, 'nested/deep/deep.md'), content: 'deep content' },
      { path: join(root, 'root.md'), content: 'root content' },
    ]);

    const contentOutput = await capture((write, writeError) => runRequestCommand({
      requestName: 'summarize',
      requestsDirectory,
      parameters: JSON.stringify({ content: 'content source' }),
      format: 'full',
      debug: false,
      provider: provider('full summary', calls),
      write,
      writeError,
    }));
    assert.equal(contentOutput.result, 0);
    assert.equal(JSON.parse(contentOutput.stdout).output.value, 'full summary');
    assert.equal(calls[1]?.files[0]?.content, 'content source');

    const symlinkDirectory = join(root, 'directory-link');
    await symlink(deep, symlinkDirectory);
    const invalid = await capture((write, writeError) => runRequestCommand({
      requestName: 'summarize',
      requestsDirectory,
      parameters: JSON.stringify({ path: symlinkDirectory }),
      debug: false,
      provider: provider('must not run', calls),
      write,
      writeError,
    }));
    assert.equal(invalid.result, 1);
    assert.match(invalid.stderr, /regular files or directories/u);
    assert.equal(calls.length, 2);
  } finally {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  }
});

test('WI-0021-10000000_TC-EXAMPLE-QUALITY keeps the summarize bundle generic and provider-free', async () => {
  const names = (await readdir(summarizeDirectory)).sort();
  assert.deepEqual(names, [
    'summarize.defaults.json',
    'summarize.outputSchema.json',
    'summarize.parameters.schema.json',
    'summarize.prompt.md',
  ]);
  await assert.rejects(() => readFile(join(summarizeDirectory, 'summarize.prompt.system.md')), { code: 'ENOENT' });
  assert.match(await readFile(join(summarizeDirectory, 'summarize.prompt.md'), 'utf8'), /<files>/u);
  assert.match(await readFile(join(summarizeDirectory, 'summarize.parameters.schema.json'), 'utf8'), /x-llm-req-parameter/u);
  assert.doesNotMatch(await readFile(join(summarizeDirectory, 'summarize.prompt.md'), 'utf8'), /provider|credential|api key/u);
});

test('legacy summarize argument parsing remains a compatibility surface while req owns generic parameters', () => {
  assert.deepEqual(parseCliArguments(['summarize', '--path', 'notes.md', '--provider', 'anthropic', '--model=openai/test', '--thinking=low', '--format=full']), {
    debug: false,
    format: 'full',
    printChatId: false,
    command: 'summarize',
    summarizePath: 'notes.md',
    summarizeProvider: 'anthropic',
    summarizeModel: 'openai/test',
    summarizeThinking: 'low',
  });
  assert.deepEqual(parseCliArguments(['summarize', '--content=inline text', '--format', 'raw']), {
    debug: false,
    format: 'raw',
    printChatId: false,
    command: 'summarize',
    summarizeContent: 'inline text',
  });
  for (const args of [
    ['summarize'],
    ['summarize', '--path', 'a.md', '--content', 'inline'],
    ['summarize', '--path', 'a.md', '--path', 'b.md'],
    ['summarize', '--content', 'one', '--content', 'two'],
    ['summarize', '--content', ''],
    ['summarize', '--unknown', 'value'],
    ['summarize', '--provider'],
    ['summarize', '--provider', 'bad provider'],
    ['summarize', '--model', 'bad model'],
    ['summarize', '--thinking', 'extreme'],
    ['summarize', '--provider', 'one', '--provider', 'two'],
  ]) {
    assert.equal(parseCliArguments(args).exitCode, 2, args.join(' '));
  }
});

test('requestsDirectory uses shared configuration precedence and missing configuration remains bounded', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-summarize-config-root-'));
  const home = await mkdtemp(join(tmpdir(), 'llm-summarize-config-home-'));
  const environmentRoot = await mkdtemp(join(tmpdir(), 'llm-summarize-config-environment-'));
  const applicationRequests = await mkdtemp(join(tmpdir(), 'llm-summarize-requests-application-'));
  const homeRequests = await mkdtemp(join(tmpdir(), 'llm-summarize-requests-home-'));
  const environmentRequests = await mkdtemp(join(tmpdir(), 'llm-summarize-requests-environment-'));
  try {
    await mkdir(join(root, '.config'), { recursive: true });
    await writeFile(join(root, '.config', 'config.json'), JSON.stringify({ requestsDirectory: applicationRequests }));
    await mkdir(join(home, '.llm'), { recursive: true });
    await writeFile(join(home, '.llm', 'config.json'), JSON.stringify({ requestsDirectory: homeRequests }));
    await writeFile(join(environmentRoot, 'config.json'), JSON.stringify({ requestsDirectory: environmentRequests }));
    assert.equal(await resolveRequestsDirectory({ applicationSourceDirectory: root, homeDirectory: home, environment: { LLM_CONFIG: environmentRoot } }), environmentRequests);
    assert.equal(await resolveRequestsDirectory({ applicationSourceDirectory: root, homeDirectory: home, environment: {} }), homeRequests);
  } finally {
    await Promise.all([root, home, environmentRoot, applicationRequests, homeRequests, environmentRequests].map((path) => rm(path, { recursive: true, force: true })));
  }

  const missingRoot = await mkdtemp(join(tmpdir(), 'llm-summarize-no-config-root-'));
  const missingHome = await mkdtemp(join(tmpdir(), 'llm-summarize-no-config-home-'));
  const calls: ProviderCompletionRequest[] = [];
  try {
    const output = await capture((write, writeError) => runSummarizeCommand({
      applicationSourceDirectory: missingRoot,
      homeDirectory: missingHome,
      environment: {},
      content: 'input',
      debug: false,
      provider: provider('unexpected', calls),
      write,
      writeError,
    }));
    assert.equal(output.result, 1);
    assert.equal(calls.length, 0);
    assert.match(output.stderr, /~\/\.llm\/config\.json:requestsDirectory/u);
    assert.equal(output.stdout, '');
  } finally {
    await Promise.all([rm(missingRoot, { recursive: true, force: true }), rm(missingHome, { recursive: true, force: true })]);
  }
});