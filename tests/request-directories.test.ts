import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { parseCliArgumentsAsync } from '../src/cli/arguments.js';
import { runRequestCommand } from '../src/cli/request-command.js';
import { runSummarizeCommand } from '../src/cli/summarize-command.js';
import { completeRequest } from '../src/request.js';
import * as requestsConfig from '../src/requests-config.js';
import type { LlmProvider, ProviderCompletionRequest } from '../src/types.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRequests = join(repositoryRoot, 'requests');
const BASELINE_COMMIT = 'cb45d3fdbdf8249786b10b87c9a75b168b06bed7';

type Files = Readonly<Record<string, string | object>>;
type Layout = Readonly<Record<string, Readonly<Record<string, Files>>>>;

interface Fixture {
  readonly root: string;
  /** Request directories d1, d2, d3 under the fixture root. */
  readonly directories: readonly [string, string, string];
}

interface Captured {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface Resolution {
  readonly homeDirectory: string;
  readonly applicationSourceDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
}

/** The function under test, looked up at call time so the suite loads against the baseline module too. */
async function resolveDirectories(options: Resolution): Promise<readonly string[]> {
  const resolveRequestDirectories = (requestsConfig as Record<string, unknown>).resolveRequestDirectories as ((value: Resolution) => Promise<readonly string[]>) | undefined;
  assert.equal(typeof resolveRequestDirectories, 'function', 'resolveRequestDirectories is exported');
  return resolveRequestDirectories!(options);
}

function bundle(name: string, files: Files = {}, prompt = `Prompt ${name}.`): Files {
  return { [`${name}.prompt.md`]: prompt, ...Object.fromEntries(Object.entries(files).map(([file, content]) => [`${name}.${file}`, content])) };
}

async function writeLayout(directories: readonly string[], layout: Layout): Promise<void> {
  for (const [index, directory] of directories.entries()) {
    await mkdir(directory, { recursive: true });
    for (const [name, files] of Object.entries(layout[`d${index + 1}`] ?? {})) {
      await mkdir(join(directory, name), { recursive: true });
      for (const [file, content] of Object.entries(files)) {
        await writeFile(join(directory, name, file), typeof content === 'string' ? content : JSON.stringify(content));
      }
    }
  }
}

/**
 * FIX-REQUEST-DIRECTORIES: three request directories and a config.json under a
 * temporary root. HOME and LLM_CONFIG both point at the root, so the operator's
 * ~/.llm/config.json is never read.
 */
async function withDirectories(layout: Layout, configuration: ((fixture: Fixture) => object | undefined) | undefined, operation: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'llm-request-directories-'));
  const fixture: Fixture = { root, directories: [join(root, 'd1'), join(root, 'd2'), join(root, 'd3')] };
  await writeLayout(fixture.directories, layout);
  const config = configuration === undefined ? { requestDirectories: [...fixture.directories] } : configuration(fixture);
  if (config !== undefined) await writeFile(join(root, 'config.json'), JSON.stringify(config));
  const previous = { LLM_CONFIG: process.env.LLM_CONFIG, HOME: process.env.HOME };
  process.env.LLM_CONFIG = root;
  process.env.HOME = root;
  try {
    await operation(fixture);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

function isolated(root: string): Resolution {
  return { homeDirectory: root, applicationSourceDirectory: root, environment: { LLM_CONFIG: root } };
}

function provider(calls: ProviderCompletionRequest[], content = 'done'): LlmProvider {
  return {
    async complete(request: ProviderCompletionRequest) {
      calls.push(request);
      return { content, toolCalls: [], decision: 'stop' };
    },
  } as LlmProvider;
}

async function capture(operation: (write: (text: string) => void, writeError: (text: string) => void) => Promise<number>): Promise<Captured> {
  let stdout = '';
  let stderr = '';
  const exitCode = await operation((text) => { stdout += text; }, (text) => { stderr += text; });
  return { exitCode, stdout, stderr };
}

async function run(args: readonly string[]): Promise<Captured> {
  let stdout = '';
  let stderr = '';
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  const originalLog = console.log;
  process.stdout.write = ((chunk: string | Uint8Array) => { stdout += String(chunk); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => { stderr += String(chunk); return true; }) as typeof process.stderr.write;
  console.log = (...values: unknown[]) => { stdout += `${values.join(' ')}\n`; };
  try {
    const exitCode = await main(args);
    return { exitCode, stdout, stderr };
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
    console.log = originalLog;
  }
}

function configurationError(result: Captured): string {
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  const report = JSON.parse(result.stderr) as { status: string; errors: Array<{ code: string; phase: string; message: string }> };
  assert.equal(report.status, 'configuration_error');
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0]!.code, 'CONFIGURATION_INVALID');
  return report.errors[0]!.message;
}

async function rejection(operation: () => Promise<unknown>): Promise<{ readonly code: string; readonly message: string }> {
  try {
    await operation();
  } catch (error) {
    return { code: String((error as { code?: unknown }).code), message: (error as Error).message };
  }
  assert.fail('expected a rejection');
}

function assertGuidanceNamesBothKeys(message: string): void {
  assert.ok(message.includes('requestsDirectory'), `mentions requestsDirectory: ${message}`);
  assert.ok(message.includes('requestDirectories'), `mentions requestDirectories: ${message}`);
}

const topicSchema = { type: 'object', additionalProperties: false, properties: { topic: { type: 'string', description: 'Topic.' } } };

// SDLC-TEST-CASE: WI-0029-10000000_TC-STRING-ONLY-REGRESSION
test('WI-0029-10000000_TC-STRING-ONLY-REGRESSION keeps a requestsDirectory-only configuration unchanged', async () => {
  await withDirectories({ d1: { report: bundle('report') } }, (fixture) => ({ requestsDirectory: fixture.directories[0] }), async ({ root, directories }) => {
    assert.deepEqual(await resolveDirectories(isolated(root)), [directories[0]]);
    const calls: ProviderCompletionRequest[] = [];
    const result = await capture((write, writeError) => runRequestCommand({ requestName: 'report', debug: false, provider: provider(calls, 'report answer'), write, writeError }));
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'report answer');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.task, 'Prompt report.');
    const listing = await run(['req', '-h']);
    assert.equal(listing.exitCode, 0);
    assert.equal(listing.stderr, '');
    assert.ok(listing.stdout.includes('Run a named request bundle from the configured request directory.\n'));
    assert.ok(listing.stdout.includes(`Requests directory: ${directories[0]}\n`));
    assert.ok(listing.stdout.includes('Available requests:\n  report  No description.\n'));
    assert.ok(!listing.stdout.includes('Request directories:'));
    assert.ok(!listing.stdout.includes('Duplicate requests'));
  });
});

// SDLC-TEST-CASE: WI-0029-10000000_TC-ARRAY-ONLY
test('WI-0029-10000000_TC-ARRAY-ONLY resolves a requestDirectories-only configuration in array order', async () => {
  await withDirectories({ d1: { first: bundle('first') }, d2: {} }, (fixture) => ({ requestDirectories: [fixture.directories[1], fixture.directories[0]] }), async ({ root, directories }) => {
    assert.deepEqual(await resolveDirectories(isolated(root)), [directories[1], directories[0]]);
    const calls: ProviderCompletionRequest[] = [];
    const result = await capture((write, writeError) => runRequestCommand({ requestName: 'first', debug: false, provider: provider(calls), write, writeError }));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.task, 'Prompt first.');
  });
});

// SDLC-TEST-CASE: WI-0029-10000000_TC-BOTH-KEYS-ORDER-AND-LAYERS
test('WI-0029-10000000_TC-BOTH-KEYS-ORDER-AND-LAYERS orders requestsDirectory first and combines configuration layers', async () => {
  await withDirectories({ d1: {}, d2: {}, d3: {} }, (fixture) => ({ requestsDirectory: fixture.directories[2], requestDirectories: [fixture.directories[0], fixture.directories[1]] }), async ({ root, directories }) => {
    const [d1, d2, d3] = directories;
    assert.deepEqual(await resolveDirectories(isolated(root)), [d3, d1, d2]);

    const home = join(root, 'home');
    const environment = join(root, 'environment');
    const application = join(root, 'application');
    await mkdir(join(home, '.llm'), { recursive: true });
    await mkdir(environment, { recursive: true });
    await mkdir(application, { recursive: true });
    const layered = { homeDirectory: home, applicationSourceDirectory: application, environment: { LLM_CONFIG: environment } };

    await writeFile(join(home, '.llm', 'config.json'), JSON.stringify({ requestsDirectory: d2 }));
    await writeFile(join(environment, 'config.json'), JSON.stringify({ requestDirectories: [d3, d1] }));
    assert.deepEqual(await resolveDirectories(layered), [d2, d3, d1], 'keys from different layers combine');

    await writeFile(join(home, '.llm', 'config.json'), JSON.stringify({ requestDirectories: [d1, d2] }));
    await writeFile(join(environment, 'config.json'), JSON.stringify({ requestDirectories: [d3] }));
    assert.deepEqual(await resolveDirectories(layered), [d3], 'a later array replaces an earlier array');
  });
});

// SDLC-TEST-CASE: WI-0029-10000000_TC-SAME-DIRECTORY-DEDUPLICATED
test('WI-0029-10000000_TC-SAME-DIRECTORY-DEDUPLICATED treats the same directory listed twice as one directory', async () => {
  await withDirectories({ d1: { only: bundle('only') }, d2: { other: bundle('other') } }, (fixture) => {
    const [d1, d2] = fixture.directories;
    return { requestsDirectory: d1, requestDirectories: [`${d1}/`, d1, join(fixture.root, 'alias'), d2] };
  }, async ({ root, directories }) => {
    const [d1, d2] = directories;
    await symlink(d1, join(root, 'alias'));
    assert.deepEqual(await resolveDirectories(isolated(root)), [d1, d2]);
    const calls: ProviderCompletionRequest[] = [];
    const result = await capture((write, writeError) => runRequestCommand({ requestName: 'only', debug: false, provider: provider(calls), write, writeError }));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(calls.length, 1);
    const listing = await run(['req', '-h']);
    assert.equal(listing.exitCode, 0);
    assert.ok(listing.stdout.includes('Available requests:\n  only   No description.\n  other  No description.\n'), listing.stdout);
    assert.ok(!listing.stdout.includes('Duplicate requests'));
  });
});

// SDLC-TEST-CASE: WI-0029-10000000_TC-LATER-DIRECTORIES-RESOLVE
test('WI-0029-10000000_TC-LATER-DIRECTORIES-RESOLVE resolves requests from the second and third directories', async () => {
  await withDirectories({
    d1: { first: bundle('first') },
    d2: { second: bundle('second', { 'parameters.schema.json': topicSchema }, 'Second $${topic}$$.') },
    d3: { third: bundle('third') },
  }, (fixture) => ({ requestsDirectory: fixture.directories[0], requestDirectories: [fixture.directories[1], fixture.directories[2]] }), async ({ root }) => {
    const parsed = await parseCliArgumentsAsync(['req', 'second', '--p-topic', 'x']);
    assert.equal(parsed.exitCode, undefined);
    assert.equal(parsed.requestName, 'second');
    assert.deepEqual(parsed.requestAssignments, [{ path: 'topic', value: 'x' }]);

    const calls: ProviderCompletionRequest[] = [];
    const second = await capture((write, writeError) => runRequestCommand({ requestName: 'second', assignments: [{ path: 'topic', value: 'x' }], debug: false, provider: provider(calls), write, writeError }));
    assert.equal(second.exitCode, 0, second.stderr);
    assert.equal(calls.at(-1)!.task, 'Second x.');
    const third = await capture((write, writeError) => runRequestCommand({ requestName: 'third', debug: false, provider: provider(calls), write, writeError }));
    assert.equal(third.exitCode, 0, third.stderr);
    assert.equal(calls.at(-1)!.task, 'Prompt third.');
    await completeRequest({ requestName: 'third', provider: provider(calls) });
    assert.equal(calls.at(-1)!.task, 'Prompt third.');
    assert.equal(calls.length, 3);

    // The repository summarize bundle is reachable only through the third directory.
    await writeFile(join(root, 'config.json'), JSON.stringify({ requestDirectories: [join(root, 'd1'), join(root, 'd2'), repositoryRequests] }));
    const summary = await capture((write, writeError) => runSummarizeCommand({ ...isolated(root), content: 'Matrix input.', debug: false, provider: provider(calls, '{"summary":"s"}'), write, writeError }));
    assert.equal(summary.exitCode, 0, summary.stderr);
    assert.equal(calls.length, 4);
  });
});

// SDLC-TEST-CASE: WI-0029-10000000_TC-DUPLICATE-AMBIGUOUS
test('WI-0029-10000000_TC-DUPLICATE-AMBIGUOUS fails closed for a request name in more than one directory', async () => {
  await withDirectories({
    d1: { dup: bundle('dup'), half: { 'half.defaults.json': {} } },
    d2: { half: bundle('half') },
    d3: { dup: bundle('dup') },
  }, undefined, async ({ directories }) => {
    const [d1, d2, d3] = directories;
    const calls: ProviderCompletionRequest[] = [];
    for (const [name, matches, other] of [['dup', [d1, d3], d2], ['half', [d1, d2], d3]] as const) {
      const result = await capture((write, writeError) => runRequestCommand({ requestName: name, debug: false, provider: provider(calls), write, writeError }));
      const message = configurationError(result);
      assert.match(message, /ambiguous/u);
      for (const directory of matches) assert.ok(message.includes(directory), `${name} names ${directory}: ${message}`);
      assert.ok(!message.includes(`${other},`) && !message.endsWith(other), `${name} does not name ${other}`);
      const failure = await rejection(() => completeRequest({ requestName: name, provider: provider(calls) }));
      assert.equal(failure.code, 'CONFIGURATION_INVALID');
      for (const directory of matches) assert.ok(failure.message.includes(directory));
    }
    assert.equal(calls.length, 0);
  });
});

// SDLC-TEST-CASE: WI-0029-10000000_TC-UNKNOWN-AND-UNSAFE-NAMES
test('WI-0029-10000000_TC-UNKNOWN-AND-UNSAFE-NAMES reports searched directories and rejects unsafe names', async () => {
  await withDirectories({ d1: { report: bundle('report') }, d2: {} }, (fixture) => ({ requestDirectories: [fixture.directories[0], fixture.directories[1]] }), async ({ directories }) => {
    const calls: ProviderCompletionRequest[] = [];
    const missing = await rejection(() => completeRequest({ requestName: 'missing', provider: provider(calls) }));
    assert.equal(missing.code, 'CONFIGURATION_INVALID');
    assert.match(missing.message, /Request 'missing': the request directory does not exist/u);
    for (const directory of directories.slice(0, 2)) assert.ok(missing.message.includes(directory), missing.message);
    const unsafe = await rejection(() => completeRequest({ requestName: '../x', provider: provider(calls) }));
    assert.equal(unsafe.code, 'CONFIGURATION_INVALID');
    assert.match(unsafe.message, /the request name must be one safe child directory name/u);
    assert.equal(calls.length, 0);
  });
});

// SDLC-TEST-CASE: WI-0029-10000000_TC-CLI-CONFIGURATION-ERROR-PROVIDER-FREE
test('WI-0029-10000000_TC-CLI-CONFIGURATION-ERROR-PROVIDER-FREE surfaces configuration errors from llm req without a provider', async () => {
  const log = join(await mkdtemp(join(tmpdir(), 'llm-request-directories-guard-')), 'claude.log');
  const previousLog = process.env.FAKE_CLAUDE_LOG;
  process.env.FAKE_CLAUDE_LOG = log;
  try {
    await withDirectories({
      d1: { dup: bundle('dup', { 'parameters.schema.json': topicSchema }), report: bundle('report') },
      d2: { dup: bundle('dup', { 'parameters.schema.json': topicSchema }) },
    }, (fixture) => ({ requestDirectories: [fixture.directories[0], fixture.directories[1]] }), async ({ root, directories }) => {
      const ambiguous = configurationError(await run(['req', 'dup', '--p-topic', 'x']));
      for (const directory of directories.slice(0, 2)) assert.ok(ambiguous.includes(directory), ambiguous);
      assert.equal(existsSync(log), false, 'no claude invocation for an ambiguous name');

      const usage = await run(['req', 'report', '--bogus']);
      assert.equal(usage.exitCode, 2);
      assert.equal((JSON.parse(usage.stderr) as { status: string }).status, 'input_invalid');

      await writeFile(join(root, 'config.json'), JSON.stringify({ requestDirectories: [directories[0], 'relative/requests'] }));
      const invalid = configurationError(await run(['req', 'report']));
      assert.match(invalid, /requestDirectories\[1\]/u);
      assertGuidanceNamesBothKeys(invalid);
      assert.equal(existsSync(log), false, 'no claude invocation for an invalid configuration');

      // Control: a valid invocation does reach the guarded fake claude CLI, so the log would record a provider start.
      await writeFile(join(root, 'config.json'), JSON.stringify({ requestDirectories: [directories[0]] }));
      await run(['req', 'report']);
      assert.equal(existsSync(log), true, 'the guard log records a real provider start');
    });
  } finally {
    if (previousLog === undefined) delete process.env.FAKE_CLAUDE_LOG;
    else process.env.FAKE_CLAUDE_LOG = previousLog;
    await rm(dirname(log), { recursive: true, force: true });
  }
});

// SDLC-TEST-CASE: WI-0029-10000000_TC-INVALID-ARRAY-SHAPE
test('WI-0029-10000000_TC-INVALID-ARRAY-SHAPE rejects a non-array or empty requestDirectories', async () => {
  for (const value of ['/tmp', { path: '/tmp' }, []]) {
    await withDirectories({}, () => ({ requestDirectories: value }), async ({ root }) => {
      const failure = await rejection(() => resolveDirectories(isolated(root)));
      assert.equal(failure.code, 'CONFIGURATION_INVALID');
      assert.match(failure.message, /requestDirectories must be a non-empty array/u);
      assertGuidanceNamesBothKeys(failure.message);
    });
  }
});

// SDLC-TEST-CASE: WI-0029-10000000_TC-INVALID-ARRAY-ENTRIES
test('WI-0029-10000000_TC-INVALID-ARRAY-ENTRIES reports each invalid requestDirectories entry by index', async () => {
  const cases: ReadonlyArray<readonly [string, (fixture: Fixture) => unknown, RegExp]> = [
    ['number', () => 42, /requestDirectories\[1\] must be a non-empty absolute directory path/u],
    ['empty string', () => '', /requestDirectories\[1\] must be a non-empty absolute directory path/u],
    ['relative path', () => 'relative/requests', /requestDirectories\[1\] must be an absolute path without parent traversal/u],
    ['parent traversal', (fixture) => `${fixture.directories[0]}/../d1`, /requestDirectories\[1\] must be an absolute path without parent traversal/u],
    ['missing directory', (fixture) => join(fixture.root, 'missing'), /requestDirectories\[1\] does not exist or is not a directory/u],
    ['regular file', (fixture) => join(fixture.root, 'config.json'), /requestDirectories\[1\] does not exist or is not a directory/u],
  ];
  for (const [label, entry, expected] of cases) {
    await withDirectories({ d1: {} }, (fixture) => ({ requestDirectories: [fixture.directories[0], entry(fixture)] }), async ({ root }) => {
      const failure = await rejection(() => resolveDirectories(isolated(root)));
      assert.equal(failure.code, 'CONFIGURATION_INVALID', label);
      assert.match(failure.message, expected, label);
      assertGuidanceNamesBothKeys(failure.message);
    });
  }
  await withDirectories({}, () => ({ requestsDirectory: 'relative/requests' }), async ({ root }) => {
    assert.match((await rejection(() => resolveDirectories(isolated(root)))).message, /requestsDirectory must be an absolute path without parent traversal/u);
  });
  await withDirectories({}, (fixture) => ({ requestsDirectory: join(fixture.root, 'missing') }), async ({ root }) => {
    assert.match((await rejection(() => resolveDirectories(isolated(root)))).message, /requestsDirectory does not exist or is not a directory/u);
  });
});

// SDLC-TEST-CASE: WI-0029-10000000_TC-NEITHER-KEY
test('WI-0029-10000000_TC-NEITHER-KEY rejects a configuration with neither key', async () => {
  await withDirectories({}, () => ({ chatSessionStore: { type: 'tempFile' } }), async ({ root }) => {
    const failure = await rejection(() => resolveDirectories(isolated(root)));
    assert.equal(failure.code, 'CONFIGURATION_INVALID');
    assert.match(failure.message, /requestsDirectory or requestDirectories must be configured/u);
    assertGuidanceNamesBothKeys(failure.message);
  });
  await withDirectories({}, () => undefined, async ({ root }) => {
    const failure = await rejection(() => resolveDirectories(isolated(root)));
    assert.equal(failure.code, 'CONFIGURATION_INVALID');
    assert.match(failure.message, /No llm request configuration was found\./u);
    assertGuidanceNamesBothKeys(failure.message);
    const help = configurationError(await run(['req', '-h']));
    assertGuidanceNamesBothKeys(help);
  });
});

// SDLC-TEST-CASE: WI-0029-10000000_TC-SCHEMA-ROOTS-OWN-DIRECTORY
test('WI-0029-10000000_TC-SCHEMA-ROOTS-OWN-DIRECTORY resolves a non-first request schema refs within its own directory', async () => {
  const id = 'https://example.test/wi-0029/brief-parameters/v1';
  const briefSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: id,
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    $defs: { name: { type: 'string', minLength: 3 } },
    properties: { name: { $ref: '#/$defs/name' } },
  };
  await withDirectories({ d1: {}, d2: {}, d3: { brief: bundle('brief', { 'parameters.schema.json': briefSchema }, 'Brief $${name}$$.') } }, undefined, async ({ directories }) => {
    // A different schema with the same $id in another configured directory must not be consulted.
    await writeFile(join(directories[0], 'shared.schema.json'), JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: id, type: 'object', properties: { name: { type: 'integer' } } }));
    const calls: ProviderCompletionRequest[] = [];
    await completeRequest({ requestName: 'brief', parameters: { name: 'Ada' }, provider: provider(calls) });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.task, 'Brief Ada.');
    const failure = await rejection(() => completeRequest({ requestName: 'brief', parameters: { name: 'A' }, provider: provider(calls) }));
    assert.match(failure.message, /\/name must NOT have fewer than 3 characters/u);
    assert.equal(calls.length, 1);
  });
});

// SDLC-TEST-CASE: WI-0029-10000000_TC-HELP-LISTING-MULTI
test('WI-0029-10000000_TC-HELP-LISTING-MULTI lists requests from every directory and reports duplicates', async () => {
  await withDirectories({
    d1: { alpha: bundle('alpha', { 'parameters.schema.json': { type: 'object', description: 'Alpha request.', properties: {} } }), dup: bundle('dup') },
    d2: { beta: bundle('beta'), broken: { 'broken.defaults.json': {} } },
    d3: { gamma: bundle('gamma'), dup: bundle('dup') },
  }, undefined, async ({ directories }) => {
    const [d1, d2, d3] = directories;
    const result = await run(['req', '-h']);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes('Run a named request bundle from the configured request directories.\n'), result.stdout);
    assert.ok(result.stdout.includes(`Request directories:\n  ${d1}\n  ${d2}\n  ${d3}\n`), result.stdout);
    assert.ok(!result.stdout.includes('Requests directory:'));
    assert.ok(result.stdout.includes('Available requests:\n  alpha  Alpha request.\n  beta   No description.\n  gamma  No description.\n'), result.stdout);
    assert.ok(result.stdout.includes("Unavailable requests:\n  broken  Request 'broken': exactly one prompt or task asset is required.\n"), result.stdout);
    assert.ok(result.stdout.includes(`Duplicate requests (ambiguous; 'llm req <name>' fails until only one directory provides the name):\n  dup  ${d1}, ${d3}\n`), result.stdout);
    assert.equal(result.stdout.split('\n').filter((line) => /^\s+dup\s/u.test(line)).length, 1, 'dup is listed once, as a duplicate');
  });
});

// SDLC-TEST-CASE: WI-0029-10000000_TC-REQUEST-HELP-MULTI
test('WI-0029-10000000_TC-REQUEST-HELP-MULTI prints request help across directories and fails on duplicates', async () => {
  await withDirectories({
    d1: { dup: bundle('dup') },
    d2: {},
    d3: { gamma: bundle('gamma', { 'parameters.schema.json': topicSchema }), dup: bundle('dup') },
  }, undefined, async ({ directories }) => {
    const help = await run(['req', 'gamma', '-h']);
    assert.equal(help.exitCode, 0, help.stderr);
    assert.equal(help.stderr, '');
    assert.ok(help.stdout.includes('  --p-topic <value>\n'), help.stdout);
    const message = configurationError(await run(['req', 'dup', '-h']));
    assert.match(message, /ambiguous/u);
    assert.ok(message.includes(directories[0]) && message.includes(directories[2]), message);
  });
});

/** Old-file line numbers touched by the diff (removed lines, and the anchor line of each insertion). */
function changedBaselineLines(diff: string): number[] {
  const lines: number[] = [];
  let oldLine = 0;
  for (const line of diff.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/u.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      continue;
    }
    if (oldLine === 0 || line.startsWith('---') || line.startsWith('+++')) continue;
    if (line.startsWith('-')) lines.push(oldLine++);
    else if (line.startsWith('+')) lines.push(oldLine);
    else if (line.startsWith(' ')) oldLine += 1;
  }
  return lines;
}

// SDLC-TEST-CASE: WI-0029-10000000_TC-DOCUMENTATION-AND-CONTRACT
test('WI-0029-10000000_TC-DOCUMENTATION-AND-CONTRACT documents both keys, the naming convention, and the confirmed contract change', async () => {
  const [readme, skill, contract, decisions] = await Promise.all(['README.md', 'SKILL.md', 'requests/README.md', 'requests/decisions.md'].map((path) => readFile(join(repositoryRoot, path), 'utf8')));
  for (const [name, surface] of [['README.md', readme], ['SKILL.md', skill]] as const) {
    assert.ok(surface.includes('`requestsDirectory`'), `${name} names requestsDirectory`);
    assert.ok(surface.includes('`requestDirectories`'), `${name} names requestDirectories`);
    assert.match(surface, /`requestsDirectory`\s+first/u, `${name} states the search order`);
    assert.match(surface, /same\s+(real\s+)?directory/u, `${name} states de-duplication`);
    assert.match(surface, /more\s+than\s+one\s+(configured\s+)?(request\s+)?director/u, `${name} states the duplicate-name error`);
  }
  assert.ok(skill.includes('sdlc-work-item-expand'), 'SKILL.md gives the sdlc prefix example');
  assert.match(skill, /prefix/u, 'SKILL.md asks for a repository prefix');
  assert.match(skill, /`summarize`/u, 'SKILL.md names summarize as a general request');

  for (const heading of ['Request bundle layout', 'Processing order', 'Prompt, schema, and summarize compatibility']) {
    const start = contract.indexOf(`## ${heading}\n`);
    assert.notEqual(start, -1, heading);
    const end = contract.indexOf('\n## ', start + 1);
    assert.ok(contract.slice(start, end).includes('requestDirectories'), `${heading} mentions requestDirectories`);
  }
  assert.match(contract, /bundles as trusted code[^#]*?`requestDirectories`/u, 'the trust note mentions requestDirectories');
  assert.match(decisions, /^## D20 — /mu);
  const d20 = decisions.slice(decisions.indexOf('## D20'));
  assert.ok(d20.includes('WI-0029'), 'D20 cites WI-0029');
  assert.match(d20, /confirm/u, 'D20 records the operator confirmation');

  const changed = execFileSync('git', ['-C', repositoryRoot, 'diff', '--name-only', BASELINE_COMMIT, '--', 'requests/'], { encoding: 'utf8' }).trim().split('\n').sort();
  assert.deepEqual(changed, ['requests/README.md', 'requests/decisions.md']);
  const confirmed: ReadonlyArray<readonly [number, number]> = [[26, 31], [385, 389], [392, 398], [583, 588]];
  const diff = execFileSync('git', ['-C', repositoryRoot, 'diff', '-U0', BASELINE_COMMIT, '--', 'requests/README.md'], { encoding: 'utf8' });
  const outside = changedBaselineLines(diff).filter((line) => !confirmed.some(([from, to]) => line >= from && line <= to));
  assert.deepEqual(outside, [], 'requests/README.md changes only the operator-confirmed passages');
});

const WI_0029_TEST_CASES = [
  'STRING-ONLY-REGRESSION', 'ARRAY-ONLY', 'BOTH-KEYS-ORDER-AND-LAYERS', 'SAME-DIRECTORY-DEDUPLICATED', 'LATER-DIRECTORIES-RESOLVE',
  'DUPLICATE-AMBIGUOUS', 'UNKNOWN-AND-UNSAFE-NAMES', 'CLI-CONFIGURATION-ERROR-PROVIDER-FREE', 'INVALID-ARRAY-SHAPE',
  'INVALID-ARRAY-ENTRIES', 'NEITHER-KEY', 'SCHEMA-ROOTS-OWN-DIRECTORY', 'HELP-LISTING-MULTI', 'REQUEST-HELP-MULTI',
  'DOCUMENTATION-AND-CONTRACT', 'QUALITY-GATES',
].map((name) => `WI-0029-10000000_TC-${name}`);

// SDLC-TEST-CASE: WI-0029-10000000_TC-QUALITY-GATES
test('WI-0029-10000000_TC-QUALITY-GATES traces every WI-0029 test case to a marked test', async () => {
  const source = await readFile(fileURLToPath(import.meta.url), 'utf8');
  for (const id of WI_0029_TEST_CASES) {
    assert.ok(source.includes(`// SDLC-TEST-CASE: ${id}\ntest('${id} `), `${id} has a marker immediately above a test named with its id`);
    assert.equal(source.split(`// SDLC-TEST-CASE: ${id}\n`).length, 2, `${id} has exactly one marker`);
  }
});
