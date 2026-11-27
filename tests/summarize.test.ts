import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { parseCliArguments, parseCliArgumentsAsync } from '../src/cli/arguments.js';
import { runRequestCommand } from '../src/cli/request-command.js';
import { runSummarizeCommand } from '../src/cli/summarize-command.js';
import { resolveRequestDirectories } from '../src/requests-config.js';
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

// SDLC-TEST-CASE: WI-0021-10000000_TC-GENERIC-EXAMPLE
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
  // WI-0026: summarize no longer pins openrouter, so it uses the claude/sonnet default.
  assert.equal(calls[0]?.provider, 'claude');
  assert.equal(calls[0]?.model, 'sonnet');
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

// SDLC-TEST-CASE: WI-0021-10000000_TC-PARAMETER-PREFIX-GUIDANCE
test('WI-0021-10000000_TC-PARAMETER-PREFIX-GUIDANCE requires schema-derived summarize parameters to use --p-', async () => {
  const configurationRoot = await mkdtemp(join(tmpdir(), 'llm-summarize-cli-repro-'));
  const previousConfiguration = process.env.LLM_CONFIG;
  const calls: ProviderCompletionRequest[] = [];

  try {
    await mkdir(join(configurationRoot, '.config'), { recursive: true });
    const configuration = JSON.stringify({ requestsDirectory });
    await Promise.all([
      writeFile(join(configurationRoot, 'config.json'), configuration),
      writeFile(join(configurationRoot, '.config', 'config.json'), configuration),
    ]);
    process.env.LLM_CONFIG = configurationRoot;

    for (const [option, expected] of [
      ['--content', "Option '--content' is a request parameter. Request parameters must use the '--p-' prefix; use '--p-content <value>'."],
      ['--path', "Option '--path' is a request parameter. Request parameters must use the '--p-' prefix; use '--p-path <value>'."],
    ] as const) {
      const parsed = await parseCliArgumentsAsync(['req', 'summarize', option, option === '--content' ? 'some-content' : 'notes.md']);
      assert.equal(parsed.exitCode, 2);
      assert.equal(parsed.usageError, expected);
    }

    const contentParsed = await parseCliArgumentsAsync(['req', 'summarize', '--p-content', 'some-content']);
    assert.deepEqual(contentParsed, {
      debug: false,
      format: 'raw',
      printChatId: false,
      command: 'req',
      requestName: 'summarize',
      requestAssignments: [{ path: 'content', value: 'some-content' }],
    });

    const pathParsed = await parseCliArgumentsAsync(['req', 'summarize', '--p-path=notes.md']);
    assert.deepEqual(pathParsed, {
      debug: false,
      format: 'raw',
      printChatId: false,
      command: 'req',
      requestName: 'summarize',
      requestAssignments: [{ path: 'path', value: 'notes.md' }],
    });

    const sourcePath = join(configurationRoot, 'notes.md');
    await writeFile(sourcePath, 'Path-backed summarize content.');
    const contentOutput = await capture((write, writeError) => runRequestCommand({
      requestName: contentParsed.requestName!,
      requestsDirectory,
      assignments: contentParsed.requestAssignments,
      debug: contentParsed.debug,
      format: contentParsed.format,
      provider: provider('{"summary":"content success"}', calls),
      write,
      writeError,
    }));
    assert.equal(contentOutput.result, 0);
    assert.equal(calls[0]?.files[0]?.content, 'some-content');

    const pathOutput = await capture((write, writeError) => runRequestCommand({
      requestName: pathParsed.requestName!,
      requestsDirectory,
      assignments: [{ path: 'path', value: sourcePath }],
      debug: pathParsed.debug,
      format: pathParsed.format,
      provider: provider('{"summary":"path success"}', calls),
      write,
      writeError,
    }));
    assert.equal(pathOutput.result, 0);
    assert.equal(calls[1]?.files[0]?.content, 'Path-backed summarize content.');
  } finally {
    if (previousConfiguration === undefined) delete process.env.LLM_CONFIG;
    else process.env.LLM_CONFIG = previousConfiguration;
    await rm(configurationRoot, { recursive: true, force: true });
  }
});

// SDLC-TEST-CASE: WI-0021-10000000_TC-COMPATIBILITY
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

// SDLC-TEST-CASE: WI-0021-10000000_TC-SOURCE-REGRESSIONS
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

// SDLC-TEST-CASE: WI-0021-10000000_TC-EXAMPLE-QUALITY
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

function contractSection(readme: string, heading: string): string {
  const start = readme.indexOf(`## ${heading}\n`);
  assert.notEqual(start, -1, `missing contract section: ${heading}`);
  const end = readme.indexOf('\n## ', start + 1);
  return readme.slice(start, end === -1 ? undefined : end);
}

// SDLC-TEST-CASE: WI-0021-10000000_TC-CONTRACT-DOCUMENTATION
test('WI-0021-10000000_TC-CONTRACT-DOCUMENTATION keeps summarize contract examples aligned with the CLI', async () => {
  const readme = await readFile(join(requestsDirectory, 'README.md'), 'utf8');
  const compatibility = contractSection(readme, 'Prompt, schema, and summarize compatibility');
  const additionalFiles = contractSection(readme, 'Additional input files');
  const examples = [...compatibility.matchAll(/^llm req summarize (--p-(path|content)) <(path|text)> \[--format=raw\|full\]$/gmu)];
  assert.deepEqual(examples.map((match) => match[1]), ['--p-path', '--p-content']);

  const configurationRoot = await mkdtemp(join(tmpdir(), 'llm-summarize-contract-docs-'));
  const previousConfiguration = process.env.LLM_CONFIG;
  try {
    await writeFile(join(configurationRoot, 'config.json'), JSON.stringify({ requestsDirectory }));
    process.env.LLM_CONFIG = configurationRoot;
    for (const [, flag, name] of examples) {
      for (const format of ['raw', 'full'] as const) {
        const parsed = await parseCliArgumentsAsync(['req', 'summarize', flag!, 'value', `--format=${format}`]);
        assert.equal(parsed.exitCode, undefined, `${flag} --format=${format}`);
        assert.equal(parsed.format, format);
        assert.deepEqual(parsed.requestAssignments, [{ path: name, value: 'value' }]);
      }
    }
    for (const option of ['--path', '--content']) {
      const parsed = await parseCliArgumentsAsync(['req', 'summarize', option, 'value']);
      assert.equal(parsed.exitCode, 2);
      assert.match(parsed.usageError ?? '', /must use the '--p-' prefix/u);
    }
    assert.match(additionalFiles, /`llm req summarize --path notes\.md`, is rejected with a usage\s+error that suggests the `--p-` form/u);
  } finally {
    if (previousConfiguration === undefined) delete process.env.LLM_CONFIG;
    else process.env.LLM_CONFIG = previousConfiguration;
    await rm(configurationRoot, { recursive: true, force: true });
  }

  assert.doesNotMatch(readme, /\[--path <path> \| --content <text>\]/u);
  const legacyOptions = [...compatibility.matchAll(/^\| `--(path|content|provider|model|thinking) </gmu)].map((match) => match[1]);
  assert.deepEqual(legacyOptions, ['path', 'content', 'provider', 'model', 'thinking']);
  assert.equal(parseCliArguments(['summarize', '--path', 'notes.md', '--provider', 'p', '--model', 'm', '--thinking', 'low']).exitCode, undefined);
  assert.equal(parseCliArguments(['summarize', '--path', 'notes.md', '--system-prompt', 'legacy']).exitCode, 2);
  assert.match(compatibility, /adds no\s+prompt text, system prompt, or source handling of its own/u);
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
    assert.deepEqual(await resolveRequestDirectories({ applicationSourceDirectory: root, homeDirectory: home, environment: { LLM_CONFIG: environmentRoot } }), [environmentRequests]);
    assert.deepEqual(await resolveRequestDirectories({ applicationSourceDirectory: root, homeDirectory: home, environment: {} }), [homeRequests]);
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