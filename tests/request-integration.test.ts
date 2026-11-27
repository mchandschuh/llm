import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { parseCliArgumentsAsync } from '../src/cli/arguments.js';
import { printHelp } from '../src/cli/help.js';
import { runRequestCommand } from '../src/cli/request-command.js';
import { runSummarizeCommand } from '../src/cli/summarize-command.js';
import { completeRequest } from '../src/index.js';
import { constructRequestParameters } from '../src/request-parameters.js';
import type { InlineJsonSchema, LlmProvider, ProviderCompletionRequest } from '../src/types.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const requestsDirectory = resolve(repositoryRoot, 'requests');

/** The dynamic request-lookup sequence whose strategy cases this matrix accounts for. */
const SEQUENCE = ['WI-0014', 'WI-0015', 'WI-0016', 'WI-0017', 'WI-0018', 'WI-0019', 'WI-0020', 'WI-0021', 'WI-0022', 'WI-0024'] as const;

/** Generic request modules that must never branch on a specific request name. */
const GENERIC_REQUEST_MODULES = [
  'src/request.ts',
  'src/request-directory.ts',
  'src/request-parameters.ts',
  'src/request-parameter-files.ts',
  'src/request-variables.ts',
  'src/cli/request-command.ts',
] as const;

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

async function repositoryText(path: string): Promise<string> {
  return readFile(join(repositoryRoot, path), 'utf8');
}

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}\n`);
  assert.notEqual(start, -1, `missing section: ${heading}`);
  const end = markdown.indexOf('\n## ', start + 1);
  return markdown.slice(start, end === -1 ? undefined : end);
}

/** GitHub-style heading anchor. */
function anchor(heading: string): string {
  return heading.trim().toLowerCase().replace(/[^a-z0-9 -]/gu, '').replace(/ /gu, '-');
}

async function strategyPath(workItemId: string): Promise<string> {
  const steps = join(repositoryRoot, '.docs/work-items', workItemId, 'steps');
  const name = (await readdir(steps)).find((entry) => entry.endsWith('-test-strategy.yaml'));
  assert.ok(name, `${workItemId} has no test-strategy task`);
  return join(steps, name);
}

async function minimumRequiredCases(workItemId: string): Promise<readonly string[]> {
  const strategy = await readFile(await strategyPath(workItemId), 'utf8');
  const start = strategy.indexOf('minimumRequiredTestCaseRefs:');
  assert.notEqual(start, -1, `${workItemId} strategy has no minimumRequiredTestCaseRefs`);
  const block = strategy.slice(start, strategy.indexOf('recommendedTestCaseRefs:', start));
  return [...block.matchAll(/#result\/testCases\/([A-Z]+-[0-9]+-[0-9]{8}_TC-[A-Z0-9-]+)/gu)].map((match) => match[1]!);
}

async function testSources(): Promise<ReadonlyMap<string, string>> {
  const names = (await readdir(join(repositoryRoot, 'tests'))).filter((name) => name.endsWith('.test.ts')).sort();
  return new Map(await Promise.all(names.map(async (name) => [`tests/${name}`, await repositoryText(`tests/${name}`)] as const)));
}

function captureHelp(): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => { lines.push(values.join(' ')); };
  try {
    printHelp();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

function optionSet(form: string): readonly string[] {
  return [...form.matchAll(/--[a-z][a-z-]*(?:<[a-z-]+>)?/gu)].map((match) => match[0]).sort();
}

async function withRequestsConfiguration<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const configurationRoot = await mkdtemp(join(tmpdir(), 'llm-request-integration-config-'));
  const previous = process.env.LLM_CONFIG;
  try {
    await writeFile(join(configurationRoot, 'config.json'), JSON.stringify({ requestsDirectory: directory }));
    process.env.LLM_CONFIG = configurationRoot;
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.LLM_CONFIG;
    else process.env.LLM_CONFIG = previous;
    await rm(configurationRoot, { recursive: true, force: true });
  }
}

const REPORT_SCHEMA: InlineJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    audience: { type: 'string', enum: ['engineering', 'public'] },
    filters: { type: 'object', additionalProperties: false, properties: { owner: { type: 'string' } } },
    sections: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' } } } },
    metadata: { type: 'object' },
    notes: {
      type: 'string',
      minLength: 1,
      'x-llm-req-parameter': { file: { mode: 'path', type: 'text/plain', purpose: 'Notes supplied to the report.' } },
    },
  },
};

// SDLC-TEST-CASE: WI-0014-10000000_TC-DOCUMENTATION
test('WI-0014-10000000_TC-DOCUMENTATION documents the request-directory tree, mappings, order, safety, and output', async () => {
  const contract = await repositoryText('requests/README.md');
  for (const heading of [
    'Request bundle layout',
    'Asset mapping and optionality',
    'Request defaults and parameter defaults',
    'Parameter contract',
    'Processing order',
    'Placeholder substitution',
    'Request-name and filesystem safety',
  ]) section(contract, heading);

  const layout = section(contract, 'Request bundle layout');
  const mapping = section(contract, 'Asset mapping and optionality');
  const suffixes = ['defaults.json', 'prompt.md', 'task.json', 'prompt.system.md', 'taskSchema.json', 'parameters.schema.json', 'outputSchema.json'];
  for (const suffix of suffixes) {
    assert.match(layout, new RegExp(`<request-name>\\.${suffix.replace(/\./gu, '\\.')}`, 'u'), suffix);
    assert.match(mapping, new RegExp(`\\| \`<request-name>\\.${suffix.replace(/\./gu, '\\.')}\` \\|`, 'u'), suffix);
  }
  assert.match(section(contract, 'Processing order'), /^11\. Serialize through the existing raw\/full response contract\.$/mu);
  assert.match(section(contract, 'Request-name and filesystem safety'), /rejects absolute paths,\s+traversal, path separators/u);
  assert.match(section(contract, 'Parameter contract'), /`parameter` is reserved/u);
  assert.match(section(contract, 'Placeholder substitution'), /No unresolved placeholder reaches the\s+provider\./u);

  // A bundle using an undocumented suffix is not loaded as configuration.
  const root = await mkdtemp(join(tmpdir(), 'llm-request-integration-layout-'));
  const calls: ProviderCompletionRequest[] = [];
  try {
    await mkdir(join(root, 'notes'));
    await writeFile(join(root, 'notes', 'notes.prompt.md'), 'Documented prompt.');
    await writeFile(join(root, 'notes', 'notes.extra.md'), 'Undocumented asset.');
    await completeRequest({ requestName: 'notes', requestsDirectory: root, provider: provider('ok', calls) });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.task, 'Documented prompt.');
    assert.doesNotMatch(calls[0]?.llmPrompt ?? '', /Undocumented asset/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// SDLC-TEST-CASE: WI-0014-10000000_TC-PROMPT-MAPPING
test('WI-0014-10000000_TC-PROMPT-MAPPING maps prompt and system-prompt assets to the existing LlmRequest fields', async () => {
  const contract = await repositoryText('requests/README.md');
  const mapping = section(contract, 'Asset mapping and optionality');
  assert.match(mapping, /\| `<request-name>\.prompt\.md` \| Exactly one task source \| `LlmRequest\.task` as text \|/u);
  assert.match(mapping, /\| `<request-name>\.prompt\.system\.md` \| No \| `LlmRequest\.systemPrompt` \|/u);
  assert.match(mapping, /When it is absent, the request uses `systemPrompt: null`\./u);
  const compatibility = section(contract, 'Prompt, schema, and summarize compatibility');
  assert.match(compatibility, /schema: REQUEST_SCHEMA,\n\s+task: promptMdTextOrTaskJson,\n\s+systemPrompt: promptSystemMdTextOrNull,/u);
  assert.match(compatibility, /compatibility adapter over `llm req summarize`/u);

  const root = await mkdtemp(join(tmpdir(), 'llm-request-integration-prompt-'));
  const calls: ProviderCompletionRequest[] = [];
  try {
    await mkdir(join(root, 'brief'));
    await writeFile(join(root, 'brief', 'brief.prompt.md'), 'Task text.\n');
    await completeRequest({ requestName: 'brief', requestsDirectory: root, provider: provider('ok', calls) });
    await writeFile(join(root, 'brief', 'brief.prompt.system.md'), 'System text.\n');
    await completeRequest({ requestName: 'brief', requestsDirectory: root, provider: provider('ok', calls) });
    await writeFile(join(root, 'brief', 'brief.task.json'), '{"operation":"ambiguous"}');
    await assert.rejects(() => completeRequest({ requestName: 'brief', requestsDirectory: root, provider: provider('must not run', calls) }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.task, 'Task text.\n');
  assert.equal(calls[0]?.systemPrompt, undefined);
  assert.equal(calls[1]?.systemPrompt, 'System text.\n');
});

// SDLC-TEST-CASE: WI-0014-10000000_TC-PARAMETER-CONTRACT
test('WI-0014-10000000_TC-PARAMETER-CONTRACT executes the documented parameter examples and failure rules', async () => {
  const contract = section(await repositoryText('requests/README.md'), 'Parameter contract');
  for (const form of ['root', 'root.child', 'root.items[0]', 'root.items.0', 'root.map[key]']) {
    assert.match(contract, new RegExp(`^${form.replace(/[.[\]]/gu, '\\$&')}$`, 'mu'), form);
  }
  const examples = [
    'llm req report --p-filters.owner michael --p-sections[0].title Overview',
    "llm req deploy --p-metadata '{\"environment\":\"test\",\"region\":\"us-east-1\"}'",
    "--parameters '{\"audience\":\"engineering\",\"sections\":[{\"title\":\"Status\"}]}' \\\n  --p-audience public",
  ];
  for (const example of examples) assert.ok(contract.includes(example), example);

  assert.deepEqual(constructRequestParameters({
    schema: REPORT_SCHEMA,
    assignments: [{ path: 'filters.owner', value: 'michael' }, { path: 'sections[0].title', value: 'Overview' }],
  }), { filters: { owner: 'michael' }, sections: [{ title: 'Overview' }] });
  assert.deepEqual(constructRequestParameters({
    schema: REPORT_SCHEMA,
    assignments: [{ path: 'metadata', value: '{"environment":"test","region":"us-east-1"}' }],
  }), { metadata: { environment: 'test', region: 'us-east-1' } });
  assert.deepEqual(constructRequestParameters({
    schema: REPORT_SCHEMA,
    defaults: { audience: 'engineering' },
    parameters: '{"audience":"engineering","sections":[{"title":"Status"}]}',
    assignments: [{ path: 'audience', value: 'public' }],
  }), { audience: 'public', sections: [{ title: 'Status' }] });

  for (const assignments of [
    [{ path: 'audience', value: 'public' }, { path: 'audience', value: 'engineering' }],
    [{ path: 'parameter', value: 'reserved' }],
    [{ path: 'unknown', value: 'root' }],
    [{ path: 'sections[-1].title', value: 'negative' }],
    [{ path: 'audience', value: 'internal' }],
  ]) {
    assert.throws(() => constructRequestParameters({ schema: REPORT_SCHEMA, assignments }), JSON.stringify(assignments));
  }
});

// SDLC-TEST-CASE: WI-0014-10000000_TC-EVIDENCE-BOUNDARY
test('WI-0014-10000000_TC-EVIDENCE-BOUNDARY records provider-free evidence, the validation gate, and the work-item matrix', async () => {
  const contract = await repositoryText('requests/README.md');
  const boundary = section(contract, 'Evidence boundary');
  assert.match(boundary, /They do not establish authenticated provider availability,\s+deployment, publication, production readiness/u);
  assert.match(boundary, /No credentials may be committed\./u);
  assert.match(section(contract, 'Work-item validation gates'), /^npm run typecheck && npm test && npm run build && git diff --check$/mu);
  const table = section(contract, 'Work-item contract references and edit gate');
  for (const workItem of ['WI-0015', 'WI-0016', 'WI-0017', 'WI-0018', 'WI-0019', 'WI-0020', 'WI-0021', 'WI-0022']) {
    assert.match(table, new RegExp(`^\\| ${workItem} \\| \\[`, 'mu'), workItem);
  }
});

// SDLC-TEST-CASE: WI-0022-10000000_TC-MATRIX-COVERAGE
test('WI-0022-10000000_TC-MATRIX-COVERAGE executes every preceding required case and the combined request matrix', async () => {
  const sources = await testSources();
  for (const workItemId of SEQUENCE) {
    const cases = await minimumRequiredCases(workItemId);
    assert.ok(cases.length > 0, `${workItemId} declares no required cases`);
    for (const id of cases) {
      const owners = [...sources].filter(([, source]) => source.includes(`test('${id} `));
      assert.equal(owners.length, 1, `${id} must be implemented by exactly one trace-named test; found ${owners.map(([path]) => path).join(', ') || 'none'}`);
    }
  }

  // Combined positive, boundary, negative, and compatibility execution without provider credentials.
  const root = await mkdtemp(join(tmpdir(), 'llm-request-integration-matrix-'));
  const requests = join(root, 'requests');
  const report = join(requests, 'report');
  const previousKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const calls: ProviderCompletionRequest[] = [];
  try {
    await mkdir(report, { recursive: true });
    const notesPath = join(root, 'notes.md');
    const explicitPath = join(root, 'explicit.md');
    await Promise.all([
      writeFile(notesPath, 'Schema-declared notes.'),
      writeFile(explicitPath, 'Explicit library file.'),
      writeFile(join(report, 'report.prompt.md'), 'Report for $${audience}$$ on $${sections[0].title}$$ owned by $${filters.owner}$$.'),
      writeFile(join(report, 'report.defaults.json'), JSON.stringify({ model: 'test/model', parameters: { audience: 'engineering' } })),
      writeFile(join(report, 'report.parameters.schema.json'), JSON.stringify(REPORT_SCHEMA)),
    ]);

    const parsed = await withRequestsConfiguration(requests, () => parseCliArgumentsAsync([
      'req', 'report', '--p-filters.owner', 'michael', '--p-sections[0].title=Overview', '--p-notes', notesPath, '--format=full',
    ]));
    assert.equal(parsed.exitCode, undefined);
    const cli = await capture((write, writeError) => runRequestCommand({
      requestName: parsed.requestName!,
      requestsDirectory: requests,
      assignments: parsed.requestAssignments,
      debug: parsed.debug,
      format: parsed.format,
      provider: provider('report output', calls),
      write,
      writeError,
    }));
    assert.equal(cli.result, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).output.value, 'report output');
    assert.equal(calls[0]?.task, 'Report for engineering on Overview owned by michael.');
    assert.equal(calls[0]?.model, 'test/model');
    assert.deepEqual(calls[0]?.files.map((file) => file.content), ['Schema-declared notes.']);

    await completeRequest({
      requestName: 'report',
      requestsDirectory: requests,
      parameters: { audience: 'public', filters: { owner: 'lib' }, sections: [{ title: 'Status' }], notes: notesPath },
      files: [{ name: 'explicit.md', path: explicitPath, type: 'text/plain', purpose: 'Explicit library file.' }],
      provider: provider('library output', calls),
    });
    assert.equal(calls[1]?.task, 'Report for public on Status owned by lib.');
    assert.deepEqual(calls[1]?.files.map((file) => file.content), ['Schema-declared notes.', 'Explicit library file.']);

    for (const parameters of [
      { audience: 'internal', filters: { owner: 'x' }, sections: [{ title: 'y' }] },
      { filters: { owner: 'x' } },
      { audience: 'public', filters: { owner: 'x' }, sections: [{ title: 'y' }], notes: join(root, 'missing.md') },
    ]) {
      await assert.rejects(() => completeRequest({ requestName: 'report', requestsDirectory: requests, parameters, provider: provider('must not run', calls) }), JSON.stringify(parameters));
    }
    await assert.rejects(() => completeRequest({ requestName: '../report', requestsDirectory: requests, provider: provider('must not run', calls) }));
    assert.equal(calls.length, 2, 'invalid requests must not reach the provider');

    const generic = await capture((write, writeError) => runRequestCommand({
      requestName: 'summarize', requestsDirectory, parameters: JSON.stringify({ content: 'Matrix input.' }), debug: false, provider: provider('{"summary":"s"}', calls), write, writeError,
    }));
    const legacy = await capture((write, writeError) => runSummarizeCommand({
      requestDirectory: requestsDirectory, content: 'Matrix input.', debug: false, provider: provider('{"summary":"s"}', calls), write, writeError,
    }));
    assert.equal(generic.result, 0, generic.stderr);
    assert.equal(legacy.result, 0, legacy.stderr);
    assert.equal(legacy.stdout, generic.stdout);
    const stableTemporaryPaths = (prompt: string | undefined) => prompt?.replace(/path="[^"]*\/content"/gu, 'path="<temporary>/content"');
    assert.equal(stableTemporaryPaths(calls[3]?.llmPrompt), stableTemporaryPaths(calls[2]?.llmPrompt));
  } finally {
    if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey;
    await rm(root, { recursive: true, force: true });
  }
});

// SDLC-TEST-CASE: WI-0022-10000000_TC-PACKAGE-GATES
test('WI-0022-10000000_TC-PACKAGE-GATES declares the package gate and exports completeRequest in generated declarations', async () => {
  const manifest = JSON.parse(await repositoryText('package.json')) as {
    scripts: Record<string, string>;
    exports: { '.': { types: string; import: string } };
  };
  assert.equal(manifest.scripts.typecheck, 'tsc --noEmit');
  assert.equal(manifest.scripts.build, 'tsc');
  assert.match(manifest.scripts.test ?? '', /tests\/\*\.test\.ts/u);
  assert.equal(manifest.exports['.'].types, './dist/index.d.ts');

  const gate = 'npm run typecheck && npm test && npm run build && git diff --check';
  assert.ok(section(await repositoryText('requests/README.md'), 'Work-item validation gates').includes(gate));
  assert.ok((await repositoryText('.docs/work-items/WI-0022/steps/WI-0022-80000000-validation.yaml')).includes(`command: ${gate}`));

  const outDir = await mkdtemp(join(tmpdir(), 'llm-request-integration-declarations-'));
  try {
    await execFileAsync(join(repositoryRoot, 'node_modules/.bin/tsc'), [
      '-p', join(repositoryRoot, 'tsconfig.json'), '--emitDeclarationOnly', '--declarationMap', 'false', '--outDir', outDir,
    ], { cwd: repositoryRoot });
    const index = await readFile(join(outDir, 'index.d.ts'), 'utf8');
    const request = await readFile(join(outDir, 'request.d.ts'), 'utf8');
    assert.match(index, /export \{ completeRequest \} from '\.\/request\.js';/u);
    assert.match(index, /CompleteRequestOptions/u);
    assert.match(request, /export declare function completeRequest\(options: CompleteRequestOptions\): Promise<ProviderCompletionResponse>;/u);
    assert.doesNotMatch(index, /runRequestCommand|parseCliArguments/u);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

// SDLC-TEST-CASE: WI-0022-10000000_TC-SCOPE-REVIEW
test('WI-0022-10000000_TC-SCOPE-REVIEW keeps the request feature generic, credential-free, and free of release claims', async () => {
  const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: repositoryRoot });
  const tracked = stdout.split('\n').filter(Boolean);
  const forbidden = tracked.filter((path) => path.split('/').some((segment) => segment === '.env' || segment.startsWith('.env.') || segment === 'credentials' || segment === 'secrets'));
  assert.deepEqual(forbidden, []);

  for (const path of GENERIC_REQUEST_MODULES) {
    assert.doesNotMatch(await repositoryText(path), /summarize/u, `${path} must not special-case a request name`);
  }

  for (const workItemId of SEQUENCE) {
    const steps = join(repositoryRoot, '.docs/work-items', workItemId, 'steps');
    for (const name of (await readdir(steps)).filter((entry) => /-(80000000-validation|90000000-review)\.yaml$/u.test(entry))) {
      const record = await readFile(join(steps, name), 'utf8');
      if (!/^ {4}status: (passed|complete)$/mu.test(record)) continue;
      assert.match(record, /does not (establish|claim|authorize)[^\n]*(production|deployment|publication|release)/u, `${workItemId}/${name} must bound its claims`);
      assert.doesNotMatch(record, /production[- ]ready(?! ?ness)|\bwas (released|published|deployed)\b/iu, `${workItemId}/${name} must not claim release`);
    }
  }
});

// SDLC-TEST-CASE: WI-0022-10000000_TC-DOCUMENTATION-CONSISTENCY
test('WI-0022-10000000_TC-DOCUMENTATION-CONSISTENCY keeps help, public docs, and the request contract aligned', async () => {
  const help = captureHelp();
  const [readme, skill, contract, index] = await Promise.all([
    repositoryText('README.md'),
    repositoryText('SKILL.md'),
    repositoryText('requests/README.md'),
    repositoryText('src/index.ts'),
  ]);
  const requestHelp = help.split('\n').map((line) => line.trim()).find((line) => line.startsWith('llm req '));
  assert.ok(requestHelp, 'help documents llm req');
  assert.ok(readme.includes(requestHelp), 'README.md matches the llm req help line');
  assert.ok(skill.includes(requestHelp), 'SKILL.md matches the llm req help line');
  const contractForm = contract.match(/^llm req <request-name> .+$/mu)?.[0];
  assert.ok(contractForm, 'requests/README.md documents the llm req form');
  assert.deepEqual(optionSet(contractForm.replace('raw|full', 'full|raw')), optionSet(requestHelp));
  assert.doesNotMatch(requestHelp, /--path|--content/u);

  for (const line of help.split('\n').map((entry) => entry.trim()).filter((entry) => entry.startsWith('llm summarize '))) {
    assert.ok(skill.includes(line), `SKILL.md documents: ${line}`);
  }
  assert.match(readme, /`llm summarize --path <path> \| --content <text>`/u);

  assert.match(index, /export \{ completeRequest \} from '\.\/request\.js';/u);
  assert.match(readme, /import \{ completeRequest \} from 'llm';/u);
  assert.match(skill, /`completeRequest\(\{ requestName, parameters, assignments, files, settings, provider \}\)`/u);

  const headings = new Set([...contract.matchAll(/^#{1,6} (.+)$/gmu)].map((match) => anchor(match[1]!)));
  const links = [...contract.matchAll(/\]\(#([^)]+)\)/gu)].map((match) => match[1]!);
  assert.ok(links.length > 0);
  assert.deepEqual(links.filter((link) => !headings.has(link)), [], 'every requests/README.md anchor resolves');
  assert.ok(readme.includes('[`requests/README.md`](requests/README.md)'));

  const examples = [...readme.matchAll(/^llm req summarize (--p-(?:path|content)) (\S+|'[^']*')(?: (--format=\w+))?$/gmu)];
  assert.equal(examples.length, 2);
  await withRequestsConfiguration(requestsDirectory, async () => {
    for (const [, flag, value, format] of examples) {
      const parsed = await parseCliArgumentsAsync(['req', 'summarize', flag!, value!.replace(/^'|'$/gu, ''), ...(format ? [format] : [])]);
      assert.equal(parsed.exitCode, undefined, `${flag} ${value}`);
      assert.equal(parsed.requestAssignments?.[0]?.path, flag!.slice('--p-'.length));
    }
  });
});
