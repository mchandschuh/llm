import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { parseCliArguments } from '../src/cli/arguments.js';
import { buildSummarizeRequest, runSummarizeCommand } from '../src/cli/summarize-command.js';
import { resolveRequestsDirectory } from '../src/requests-config.js';
import type { LlmProvider, ProviderCompletionRequest } from '../src/types.js';

const requestDirectory = resolve(process.cwd(), 'requests');

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

async function writeConfig(root: string, value: unknown): Promise<void> {
  await mkdir(join(root, '.config'), { recursive: true });
  await writeFile(join(root, '.config', 'config.json'), JSON.stringify(value));
}

test('summarize parser accepts exactly one path or content source and common output formats', () => {
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

test('summarize settings defaults are loaded and command-line values override them', async () => {
  const calls: ProviderCompletionRequest[] = [];
  const prepared = await buildSummarizeRequest({ requestDirectory, content: 'settings input' });
  try {
    assert.equal(prepared.request.provider, 'openrouter');
    assert.equal(prepared.request.model, 'openai/gpt-5-nano');
    assert.equal(prepared.request.thinking, 'low');
  } finally {
    if (prepared.temporaryRoot) await rm(prepared.temporaryRoot, { recursive: true, force: true });
  }
  const output = await capture((write, writeError) => runSummarizeCommand({
    requestDirectory,
    content: 'settings input',
    providerName: 'anthropic',
    model: 'anthropic/test-model',
    thinking: 'low',
    debug: false,
    provider: provider('{"summary":"Settings summary."}', calls),
    write,
    writeError,
  }));
  assert.equal(output.result, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.provider, 'anthropic');
  assert.equal(calls[0]?.model, 'anthropic/test-model');
  assert.equal(calls[0]?.thinking, 'low');
});

test('summarize settings fall back to runtime defaults when fields are omitted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-summarize-settings-'));
  const summarizeRoot = join(root, 'summarize');
  try {
    await mkdir(summarizeRoot, { recursive: true });
    await Promise.all([
      readFile(join(requestDirectory, 'summarize', 'summarize.prompt.md'), 'utf8').then((value) => writeFile(join(summarizeRoot, 'summarize.prompt.md'), value)),
      readFile(join(requestDirectory, 'summarize', 'summarize.outputSchema.json'), 'utf8').then((value) => writeFile(join(summarizeRoot, 'summarize.outputSchema.json'), value)),
    ]);
    await writeFile(join(summarizeRoot, 'summarize.defaults.json'), '{}');
    const prepared = await buildSummarizeRequest({ requestDirectory: root, content: 'fallback input' });
    try {
      assert.equal(prepared.request.provider, 'openrouter');
      assert.equal(prepared.request.model, 'openai/gpt-5.6-luna');
      assert.equal(prepared.request.thinking, 'high');
    } finally {
      if (prepared.temporaryRoot) await rm(prepared.temporaryRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('summarize settings reject malformed and unsupported defaults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-summarize-invalid-settings-'));
  const summarizeRoot = join(root, 'summarize');
  try {
    await mkdir(summarizeRoot, { recursive: true });
    await Promise.all([
      readFile(join(requestDirectory, 'summarize', 'summarize.prompt.md'), 'utf8').then((value) => writeFile(join(summarizeRoot, 'summarize.prompt.md'), value)),
      readFile(join(requestDirectory, 'summarize', 'summarize.outputSchema.json'), 'utf8').then((value) => writeFile(join(summarizeRoot, 'summarize.outputSchema.json'), value)),
    ]);
    await writeFile(join(summarizeRoot, 'summarize.defaults.json'), '{"unsupported":true}');
    await assert.rejects(() => buildSummarizeRequest({ requestDirectory: root, content: 'invalid settings' }), /Unsupported settings/u);
    await writeFile(join(summarizeRoot, 'summarize.defaults.json'), '{');
    await assert.rejects(() => buildSummarizeRequest({ requestDirectory: root, content: 'invalid JSON' }), /must contain valid JSON/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('summarize settings are required from the configured request directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-summarize-missing-settings-'));
  const summarizeRoot = join(root, 'summarize');
  try {
    await mkdir(summarizeRoot, { recursive: true });
    await Promise.all([
      readFile(join(requestDirectory, 'summarize', 'summarize.prompt.md'), 'utf8').then((value) => writeFile(join(summarizeRoot, 'summarize.prompt.md'), value)),
      readFile(join(requestDirectory, 'summarize', 'summarize.outputSchema.json'), 'utf8').then((value) => writeFile(join(summarizeRoot, 'summarize.outputSchema.json'), value)),
    ]);
    await assert.rejects(() => buildSummarizeRequest({ requestDirectory: root, content: 'missing settings' }), /summarize\.defaults\.json/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('requestsDirectory uses nodejs-common application, home, and environment precedence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-summarize-config-root-'));
  const home = await mkdtemp(join(tmpdir(), 'llm-summarize-config-home-'));
  const environmentRoot = await mkdtemp(join(tmpdir(), 'llm-summarize-config-environment-'));
  const applicationRequests = await mkdtemp(join(tmpdir(), 'llm-summarize-requests-application-'));
  const homeRequests = await mkdtemp(join(tmpdir(), 'llm-summarize-requests-home-'));
  const environmentRequests = await mkdtemp(join(tmpdir(), 'llm-summarize-requests-environment-'));
  try {
    await writeConfig(root, { requestsDirectory: applicationRequests });
    await mkdir(join(home, '.llm'), { recursive: true });
    await writeFile(join(home, '.llm', 'config.json'), JSON.stringify({ requestsDirectory: homeRequests }));
    await writeFile(join(environmentRoot, 'config.json'), JSON.stringify({ requestsDirectory: environmentRequests }));
    assert.equal(await resolveRequestsDirectory({ applicationSourceDirectory: root, homeDirectory: home, environment: { LLM_CONFIG: environmentRoot } }), environmentRequests);
    assert.equal(await resolveRequestsDirectory({ applicationSourceDirectory: root, homeDirectory: home, environment: {} }), homeRequests);
  } finally {
    await Promise.all([root, home, environmentRoot, applicationRequests, homeRequests, environmentRequests].map((path) => rm(path, { recursive: true, force: true })));
  }
});

test('missing requestsDirectory configuration provides actionable guidance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-summarize-no-config-root-'));
  const home = await mkdtemp(join(tmpdir(), 'llm-summarize-no-config-home-'));
  try {
    await assert.rejects(
      () => resolveRequestsDirectory({ applicationSourceDirectory: root, homeDirectory: home, environment: {} }),
      /Configure ~\/\.llm\/config\.json:requestsDirectory to point to the llm repository request directory\./u,
    );
  } finally {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(home, { recursive: true, force: true })]);
  }
});

test('buildSummarizeRequest loads the prompt/schema assets and constructs inline content as a synthetic file', async () => {
  const prepared = await buildSummarizeRequest({ requestDirectory, content: 'inline\nsummary input' });
  try {
    assert.match(prepared.request.systemPrompt, /summarize the content of every file supplied in `<files>`/iu);
    assert.equal(prepared.request.outputSchema?.['$id'], 'https://schemas.handschuh.dev/llm/llm-summarize/output/v1');
    assert.deepEqual(prepared.request.files, [{
      name: 'content',
      path: 'content',
      type: 'text/plain',
      purpose: 'Content supplied by the --content command-line option; this is not a filesystem file.',
    }]);
    assert.equal(prepared.temporaryRoot !== undefined, true);
    assert.equal(await readFile(join(prepared.temporaryRoot!, 'content'), 'utf8'), 'inline\nsummary input');
  } finally {
    if (prepared.temporaryRoot) await rm(prepared.temporaryRoot, { recursive: true, force: true });
  }
});

test('summarize path mode sends path-backed file content and raw output returns the summary field', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-summarize-path-'));
  const path = join(root, 'notes.md');
  const calls: ProviderCompletionRequest[] = [];
  await writeFile(path, '# Notes\nImportant content.');
  try {
    const output = await capture((write, writeError) => runSummarizeCommand({
      requestDirectory,
      path,
      debug: false,
      provider: provider('{"summary":"Important content."}', calls),
      write,
      writeError,
    }));
    assert.equal(output.result, 0);
    assert.equal(output.stdout, 'Important content.');
    assert.equal(output.stderr, '');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.files[0]?.content, '# Notes\nImportant content.');
    assert.equal(calls[0]?.files[0]?.name, 'notes.md');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('summarize directory mode recursively includes regular files and symlink files without traversing symlink directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-summarize-directory-'));
  const nested = join(root, 'nested');
  const deep = join(nested, 'deep');
  const outside = await mkdtemp(join(tmpdir(), 'llm-summarize-directory-target-'));
  const calls: ProviderCompletionRequest[] = [];
  await mkdir(deep, { recursive: true });
  await writeFile(join(root, 'root.md'), 'root content');
  await writeFile(join(nested, 'child.md'), 'child content');
  await writeFile(join(deep, 'deep.md'), 'deep content');
  await writeFile(join(outside, 'linked.md'), 'linked content');
  await symlink(join(outside, 'linked.md'), join(root, 'linked.md'));
  await symlink(nested, join(root, 'nested-link'));
  try {
    const output = await capture((write, writeError) => runSummarizeCommand({
      requestDirectory,
      path: root,
      debug: false,
      provider: provider('{"summary":"Directory summary."}', calls),
      write,
      writeError,
    }));
    assert.equal(output.result, 0);
    assert.equal(output.stdout, 'Directory summary.');
    assert.equal(output.stderr, '');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.files.map((file) => ({ path: file.path, content: file.content })), [
      { path: 'linked.md', content: 'linked content' },
      { path: 'nested/child.md', content: 'child content' },
      { path: 'nested/deep/deep.md', content: 'deep content' },
      { path: 'root.md', content: 'root content' },
    ]);
  } finally {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  }
});

test('summarize directory mode reads an in-root symlink through its link path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-summarize-directory-link-'));
  const nested = join(root, 'nested');
  const calls: ProviderCompletionRequest[] = [];
  await mkdir(nested, { recursive: true });
  await writeFile(join(root, 'root.md'), 'root content');
  await writeFile(join(nested, 'child.md'), 'child content');
  await symlink(join(root, 'root.md'), join(nested, 'linked.md'));
  try {
    const output = await capture((write, writeError) => runSummarizeCommand({
      requestDirectory,
      path: root,
      debug: false,
      provider: provider('{"summary":"Directory summary."}', calls),
      write,
      writeError,
    }));
    assert.equal(output.result, 0);
    assert.equal(output.stdout, 'Directory summary.');
    assert.equal(output.stderr, '');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.files.map((file) => ({ name: file.name, path: file.path, content: file.content })), [
      { name: 'nested__child.md', path: 'nested/child.md', content: 'child content' },
      { name: 'nested__linked.md', path: 'nested/linked.md', content: 'root content' },
      { name: 'root.md', path: 'root.md', content: 'root content' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('summarize rejects a directly supplied symlink directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-summarize-symlink-directory-'));
  const target = join(root, 'target');
  const link = join(root, 'link');
  await mkdir(target);
  await symlink(target, link);
  try {
    await assert.rejects(
      () => buildSummarizeRequest({ requestDirectory, path: link }),
      /Configured sources must be regular files/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('summarize content mode supports the full response envelope and issues one LLM call', async () => {
  const calls: ProviderCompletionRequest[] = [];
  const output = await capture((write, writeError) => runSummarizeCommand({
    requestDirectory,
    content: 'Command-line supplied content.',
    format: 'full',
    debug: false,
    provider: provider('{"summary":"A complete summary."}', calls),
    write,
    writeError,
  }));
  assert.equal(output.result, 0);
  const response = JSON.parse(output.stdout) as { readonly status: string; readonly output: { readonly value: { readonly summary: string } } };
  assert.equal(response.status, 'success');
  assert.equal(response.output.value.summary, 'A complete summary.');
  assert.equal(output.stderr, '');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.files[0]?.name, 'content');
  assert.equal(calls[0]?.files[0]?.content, 'Command-line supplied content.');
  assert.match(calls[0]?.llmPrompt ?? '', /not a filesystem file/u);
});

test('summarize command stops before the LLM call when request configuration is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-summarize-command-no-config-'));
  const home = await mkdtemp(join(tmpdir(), 'llm-summarize-command-no-home-'));
  const calls: ProviderCompletionRequest[] = [];
  try {
    const output = await capture((write, writeError) => runSummarizeCommand({
      applicationSourceDirectory: root,
      homeDirectory: home,
      environment: {},
      content: 'input',
      debug: false,
      provider: provider('{"summary":"unexpected"}', calls),
      write,
      writeError,
    }));
    assert.equal(output.result, 1);
    assert.equal(calls.length, 0);
    assert.match(output.stderr, /~\/\.llm\/config\.json:requestsDirectory/u);
    assert.equal(output.stdout, '');
  } finally {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(home, { recursive: true, force: true })]);
  }
});