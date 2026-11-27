import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { parseCliArgumentsAsync } from '../src/cli/arguments.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_COMMIT = 'a62c17ee60df7d3356fab185a4cb6a11cb17029a';

interface Captured {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

type Bundle = Readonly<Record<string, string | object>>;

/** FIX-REQUESTS-DIRECTORY: a temporary requests directory selected through LLM_CONFIG. */
async function withRequests(bundles: Readonly<Record<string, Bundle>>, operation: (requests: string) => Promise<void>, configuration?: (root: string, requests: string) => object | undefined): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'llm-request-help-'));
  const requests = join(root, 'requests');
  await mkdir(requests, { recursive: true });
  for (const [name, files] of Object.entries(bundles)) {
    await mkdir(join(requests, name), { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      await writeFile(join(requests, name, file), typeof content === 'string' ? content : JSON.stringify(content));
    }
  }
  const config = configuration ? configuration(root, requests) : { requestsDirectory: requests };
  if (config !== undefined) await writeFile(join(root, 'config.json'), JSON.stringify(config));
  // Isolate both the environment root and the ~/.llm home root from the operator configuration.
  const previous = { LLM_CONFIG: process.env.LLM_CONFIG, HOME: process.env.HOME };
  process.env.LLM_CONFIG = root;
  process.env.HOME = root;
  try {
    await operation(requests);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
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

function assertConfigurationError(result: Captured, message: string): void {
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  const report = JSON.parse(result.stderr) as { status: string; errors: Array<{ code: string; phase: string; message: string }> };
  assert.equal(report.status, 'configuration_error');
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0]!.code, 'CONFIGURATION_INVALID');
  assert.match(report.errors[0]!.message, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
}

const prompt = { 'x.prompt.md': 'Prompt.' };
function bundle(name: string, files: Bundle = {}): Bundle {
  return { [`${name}.prompt.md`]: 'Prompt text.', ...Object.fromEntries(Object.entries(files).map(([file, content]) => [`${name}.${file}`, content])) };
}

const reportSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['audience', 'count'],
  properties: {
    audience: { type: 'string', enum: ['engineering', 'public'], description: 'Who reads the report.' },
    count: { type: 'integer', description: 'How many items to include.', examples: [3] },
    verbose: { type: 'boolean', description: 'Include details.' },
    filters: {
      type: 'object',
      additionalProperties: false,
      required: ['owner'],
      properties: { owner: { type: 'string', description: 'Owner name.' } },
    },
    sections: {
      type: 'array',
      items: { type: 'object', properties: { title: { type: 'string', description: 'Section title.' } } },
    },
    tags: { type: 'array', items: { type: 'string' } },
  },
};

// SDLC-TEST-CASE: WI-0028-10000000_TC-LISTING-OUTPUT
test('WI-0028-10000000_TC-LISTING-OUTPUT lists resolvable requests sorted with descriptions', async () => {
  await withRequests({
    beta: bundle('beta', { 'parameters.schema.json': { type: 'object', title: 'Beta title', description: 'Beta  description\nspanning lines.', properties: {} } }),
    alpha: bundle('alpha', { 'parameters.schema.json': { type: 'object', title: 'Alpha title', properties: {} } }),
    gamma: bundle('gamma'),
  }, async (requests) => {
    for (const flag of ['-h', '--help']) {
      const result = await run(['req', flag]);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, '');
      assert.match(result.stdout, /^Usage: llm req <request-name> \[--parameters <json>\]/u);
      assert.ok(result.stdout.includes('       llm req <request-name> -h|--help\n'));
      assert.ok(result.stdout.includes('       llm req -h|--help\n'));
      assert.ok(result.stdout.includes(`Requests directory: ${requests}\n`));
      assert.ok(result.stdout.includes('Available requests:\n  alpha  Alpha title\n  beta   Beta description spanning lines.\n  gamma  No description.\n'));
      assert.ok(result.stdout.includes("Run 'llm req <request-name> -h' to list a request's parameters."));
      assert.ok(!result.stdout.includes('Unavailable requests'));
    }
  });
});

// SDLC-TEST-CASE: WI-0028-10000000_TC-LISTING-UNAVAILABLE
test('WI-0028-10000000_TC-LISTING-UNAVAILABLE separates broken requests and ignores files and dot-directories', async () => {
  await withRequests({
    good: bundle('good'),
    both: { 'both.prompt.md': 'Prompt.', 'both.task.json': {}, 'both.taskSchema.json': { type: 'object' } },
    empty: {},
    '.hidden': bundle('.hidden'),
  }, async (requests) => {
    await writeFile(join(requests, 'README.md'), '# not a request\n');
    const result = await run(['req', '-h']);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes('Available requests:\n  good  No description.\n'));
    assert.ok(result.stdout.includes("Unavailable requests:\n  both   Request 'both': prompt and task assets are mutually exclusive.\n  empty  Request 'empty': exactly one prompt or task asset is required.\n"));
    assert.ok(!result.stdout.includes('README.md'));
    assert.ok(!result.stdout.includes('.hidden'));
  });
});

// SDLC-TEST-CASE: WI-0028-10000000_TC-LISTING-EMPTY
test('WI-0028-10000000_TC-LISTING-EMPTY reports an empty requests directory without failing', async () => {
  await withRequests({}, async () => {
    const result = await run(['req', '-h']);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes('No requests are available.\n'));
    assert.ok(!result.stdout.includes('Available requests:'));
  });
});

// SDLC-TEST-CASE: WI-0028-10000000_TC-LISTING-CONFIG-ERROR
test('WI-0028-10000000_TC-LISTING-CONFIG-ERROR fails closed for missing and invalid configuration', async () => {
  await withRequests({}, async () => {
    assertConfigurationError(await run(['req', '-h']), 'No llm request configuration was found.');
  }, () => undefined);
  await withRequests({}, async () => {
    assertConfigurationError(await run(['req', '--help']), 'requestsDirectory must be an absolute path');
  }, () => ({ requestsDirectory: 'relative/requests' }));
  await withRequests({}, async () => {
    assertConfigurationError(await run(['req', '-h']), 'requestsDirectory does not exist or is not a directory');
  }, (root) => ({ requestsDirectory: join(root, 'missing') }));
});

// SDLC-TEST-CASE: WI-0028-10000000_TC-PARAMETER-LINES
test('WI-0028-10000000_TC-PARAMETER-LINES prints each parameter with its command-line form', async () => {
  await withRequests({
    report: bundle('report', { 'parameters.schema.json': reportSchema, 'defaults.json': { parameters: { audience: 'engineering' } } }),
  }, async () => {
    const result = await run(['req', 'report', '-h']);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /^Usage: llm req report \[--parameters <json>\] \[--p-<path> <value>\] \[--format=full\|raw\] \[--debug\]\n/u);
    assert.ok(result.stdout.includes('Parameters:\n  --p-audience <value>\n      Type: one of "engineering", "public". Required. Default: "engineering" (from defaults.json).\n      Who reads the report.\n'));
    assert.ok(result.stdout.includes('  --p-count <value>\n      Type: integer. Required.\n      How many items to include.\n      Example: --p-count 3\n'));
    assert.ok(result.stdout.includes('  --p-verbose <value>\n      Type: boolean. Optional.\n      Include details.\n'));
  });
});

// SDLC-TEST-CASE: WI-0028-10000000_TC-ANNOTATIONS
test('WI-0028-10000000_TC-ANNOTATIONS prints file binding and validation annotations', async () => {
  await withRequests({
    files: bundle('files', {
      'parameters.schema.json': {
        type: 'object',
        properties: {
          source: { type: 'string', 'x-llm-req-parameter': { file: { mode: 'path', type: 'text/markdown', purpose: 'Sources to review.' } } },
          notes: { type: 'string', 'x-llm-req-parameter': { file: { mode: 'content', type: 'application/octet-stream', name: 'notes.bin', encoding: 'base64', purpose: 'Encoded notes.' } } },
          limit: { type: 'integer', 'x-llm-req-parameter': { validation: { function: '(value) => value > 0', message: 'limit must be positive' } } },
        },
      },
    }),
  }, async () => {
    const result = await run(['req', 'files', '--help']);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('      File binding: path mode, text/markdown; the value is a file or directory path whose contents are sent to the request.\n      File purpose: Sources to review.\n'));
    assert.ok(result.stdout.includes('      File binding: content mode, application/octet-stream, name notes.bin, encoding base64; the value is sent to the request as file content.\n      File purpose: Encoded notes.\n'));
    assert.ok(result.stdout.includes('      Validation: checked by an inline validation function before the request runs.\n      Validation message: limit must be positive\n'));
    assert.ok(!result.stdout.includes('value > 0'));
  });
});

// SDLC-TEST-CASE: WI-0028-10000000_TC-NESTED-ARRAYS-ENUMS
test('WI-0028-10000000_TC-NESTED-ARRAYS-ENUMS prints nested paths, array elements, and allowed values', async () => {
  await withRequests({ report: bundle('report', { 'parameters.schema.json': reportSchema }) }, async () => {
    const result = await run(['req', 'report', '-h']);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('  --p-filters <json-object>\n      Type: object. Optional.\n      Accepts a JSON object, or set its properties individually as --p-filters.<property>.\n'));
    assert.ok(result.stdout.includes('  --p-filters.owner <value>\n      Type: string. Required.\n      Owner name.\n'));
    assert.ok(result.stdout.includes('  --p-sections <json-array>\n      Type: array. Optional.\n      Accepts a JSON array, or set elements individually as --p-sections[<index>].\n'));
    assert.ok(result.stdout.includes('  --p-sections[<index>].title <value>\n      Type: string. Optional.\n      Section title.\n'));
    assert.ok(result.stdout.includes('  --p-tags[<index>] <value>\n      Type: string. One array element.\n'));
    assert.ok(result.stdout.includes('Type: one of "engineering", "public".'));
  });
});

// SDLC-TEST-CASE: WI-0028-10000000_TC-CONSTRAINTS-AND-SETTINGS
test('WI-0028-10000000_TC-CONSTRAINTS-AND-SETTINGS prints requirement groups, --parameters usage, and settings', async () => {
  const properties = { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } };
  await withRequests({
    exact: bundle('exact', {
      'parameters.schema.json': { type: 'object', properties, oneOf: [{ required: ['a'] }, { required: ['b', 'c'] }] },
      'defaults.json': { thinking: 'high', maxIterations: 2 },
    }),
    some: bundle('some', { 'parameters.schema.json': { type: 'object', properties, anyOf: [{ required: ['a'] }, { required: ['b'] }] } }),
  }, async () => {
    const exact = await run(['req', 'exact', '-h']);
    assert.equal(exact.exitCode, 0);
    assert.ok(exact.stdout.includes('Constraints:\n  Exactly one of: --p-a, --p-b + --p-c\n'));
    assert.ok(exact.stdout.includes('Set parameters individually with --p-<path> <value>, or all at once with --parameters <json>.\n'));
    assert.ok(exact.stdout.includes('Parameter schema: exact.parameters.schema.json\n'));
    assert.ok(exact.stdout.includes('Request settings (from exact.defaults.json):\n  thinking: high\n  maxIterations: 2\n'));
    const some = await run(['req', 'some', '-h']);
    assert.equal(some.exitCode, 0);
    assert.ok(some.stdout.includes('Constraints:\n  At least one of: --p-a, --p-b\n'));
    assert.ok(!some.stdout.includes('Request settings'));
  });
});

// SDLC-TEST-CASE: WI-0028-10000000_TC-NO-PARAMETERS-AND-SUMMARIZE
test('WI-0028-10000000_TC-NO-PARAMETERS-AND-SUMMARIZE describes parameterless requests and the bundled summarize request', async () => {
  await withRequests({ plain: bundle('plain') }, async () => {
    const result = await run(['req', 'plain', '-h']);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'Usage: llm req plain [--format=full|raw] [--debug]\n\nNo description.\n\nThis request accepts no parameters.\n');
  });
  await withRequests({}, async () => {
    const result = await run(['req', 'summarize', '-h']);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes('  --p-path <value>\n'));
    assert.ok(result.stdout.includes('File binding: path mode, text/plain;'));
    assert.ok(result.stdout.includes('  --p-content <value>\n'));
    assert.ok(result.stdout.includes('File binding: content mode, text/plain, name content;'));
    assert.ok(result.stdout.includes('Constraints:\n  Exactly one of: --p-path, --p-content\n'));
  }, () => ({ requestsDirectory: join(repositoryRoot, 'requests') }));
});

// SDLC-TEST-CASE: WI-0028-10000000_TC-HELP-ERRORS
test('WI-0028-10000000_TC-HELP-ERRORS reports unknown, unsafe, and invalid requests', async () => {
  await withRequests({ broken: { 'broken.defaults.json': {} } }, async () => {
    assertConfigurationError(await run(['req', 'missing', '-h']), "Request 'missing': the request directory does not exist.");
    assertConfigurationError(await run(['req', '../x', '-h']), 'the request name must be one safe child directory name.');
    assertConfigurationError(await run(['req', 'broken', '--help']), "Request 'broken': exactly one prompt or task asset is required.");
  });
});

// SDLC-TEST-CASE: WI-0028-10000000_TC-HELP-POSITIONS-PROVIDER-FREE
test('WI-0028-10000000_TC-HELP-POSITIONS-PROVIDER-FREE recognizes help only at its positions and stays provider-free', async () => {
  const fileSchema = { type: 'object', properties: { path: { type: 'string', 'x-llm-req-parameter': { file: { mode: 'path', type: 'text/plain', purpose: 'Sources.' } } }, content: { type: 'string' } } };
  await withRequests({ report: bundle('report', { 'parameters.schema.json': fileSchema, 'defaults.json': { provider: 'openrouter' } }) }, async (requests) => {
    const previousExecutable = process.env.LLM_CLAUDE_EXECUTABLE;
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.LLM_CLAUDE_EXECUTABLE = join(requests, 'no-such-claude');
    delete process.env.OPENROUTER_API_KEY;
    try {
      const result = await run(['req', 'report', '-h', '--p-path', join(requests, 'missing.txt'), '--bogus']);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, '');
      assert.ok(result.stdout.includes('  --p-path <value>\n'));
    } finally {
      if (previousExecutable === undefined) delete process.env.LLM_CLAUDE_EXECUTABLE;
      else process.env.LLM_CLAUDE_EXECUTABLE = previousExecutable;
      if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey;
    }
    const valueNotHelp = await parseCliArgumentsAsync(['req', 'report', '--p-content', '-h']);
    assert.equal(valueNotHelp.command, 'req');
    assert.deepEqual(valueNotHelp.requestAssignments, [{ path: 'content', value: '-h' }]);
    const helpLater = await parseCliArgumentsAsync(['req', 'report', '--p-content', 'x', '-h']);
    assert.equal(helpLater.command, 'req');
    assert.equal(helpLater.exitCode, 2);
    assert.equal((await parseCliArgumentsAsync(['req', '-h', 'report'])).command, 'req-help');
    assert.equal((await parseCliArgumentsAsync(['req', '-h', 'report'])).requestName, undefined);
    assert.equal((await parseCliArgumentsAsync(['--debug', 'req', 'report', '--help'])).requestName, 'report');
  });
});

// SDLC-TEST-CASE: WI-0028-10000000_TC-NON-HELP-UNCHANGED
test('WI-0028-10000000_TC-NON-HELP-UNCHANGED keeps non-help request invocations unchanged', async () => {
  const result = await run(['req']);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, '');
  const report = JSON.parse(result.stderr) as { status: string; errors: Array<{ code: string; message: string }> };
  assert.equal(report.status, 'input_invalid');
  assert.equal(report.errors[0]!.code, 'REQUEST_INVALID');
  assert.match(report.errors[0]!.message, /^Usage: llm <request\.json>/u);
  await withRequests({ report: bundle('report', { 'parameters.schema.json': reportSchema }) }, async () => {
    const parsed = await parseCliArgumentsAsync(['req', 'report', '--p-audience', 'public']);
    assert.equal(parsed.command, 'req');
    assert.equal(parsed.requestName, 'report');
    assert.deepEqual(parsed.requestAssignments, [{ path: 'audience', value: 'public' }]);
    assert.equal((await parseCliArgumentsAsync(['req', 'report', '--audience', 'public'])).exitCode, 2);
  });
});

// SDLC-TEST-CASE: WI-0028-10000000_TC-HELP-DOCUMENTATION
test('WI-0028-10000000_TC-HELP-DOCUMENTATION documents both help forms and keeps the request contract unchanged', async () => {
  const help = await run(['--help']);
  assert.equal(help.exitCode, 0);
  for (const surface of [help.stdout, await readFile(join(repositoryRoot, 'README.md'), 'utf8'), await readFile(join(repositoryRoot, 'SKILL.md'), 'utf8')]) {
    assert.ok(surface.includes('llm req -h'), 'mentions llm req -h');
    assert.ok(surface.includes('llm req <request-name> -h'), 'mentions llm req <request-name> -h');
  }
  const baseline = execFileSync('git', ['-C', repositoryRoot, 'show', `${BASELINE_COMMIT}:requests/README.md`], { encoding: 'utf8' });
  assert.equal(await readFile(join(repositoryRoot, 'requests', 'README.md'), 'utf8'), baseline);
});

const WI_0028_TEST_CASES = [
  'LISTING-OUTPUT', 'LISTING-UNAVAILABLE', 'LISTING-EMPTY', 'LISTING-CONFIG-ERROR', 'PARAMETER-LINES', 'ANNOTATIONS',
  'NESTED-ARRAYS-ENUMS', 'CONSTRAINTS-AND-SETTINGS', 'NO-PARAMETERS-AND-SUMMARIZE', 'HELP-ERRORS',
  'HELP-POSITIONS-PROVIDER-FREE', 'NON-HELP-UNCHANGED', 'HELP-DOCUMENTATION', 'QUALITY-GATES',
].map((name) => `WI-0028-10000000_TC-${name}`);

// SDLC-TEST-CASE: WI-0028-10000000_TC-QUALITY-GATES
test('WI-0028-10000000_TC-QUALITY-GATES traces every WI-0028 test case to a marked test', async () => {
  const source = await readFile(fileURLToPath(import.meta.url), 'utf8');
  for (const id of WI_0028_TEST_CASES) {
    assert.ok(source.includes(`// SDLC-TEST-CASE: ${id}\ntest('${id} `), `${id} has a marker immediately above a test named with its id`);
  }
  void prompt;
});
