import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runRequestCommand } from '../src/cli/request-command.js';
import { LlmFailure } from '../src/errors.js';
import { completeRequest } from '../src/index.js';
import { constructRequestParameters } from '../src/request-parameters.js';
import {
  discoverParameterValidators,
  PARAMETER_VALIDATION_READ_LIMIT_BYTES,
  PARAMETER_VALIDATION_TIMEOUT_MS,
  runParameterValidators,
} from '../src/request-parameter-validation.js';
import type { InlineJsonSchema, LlmProvider, ProviderCompletionRequest } from '../src/types.js';

const REQUEST = { name: 'check', directory: '/requests/check' } as const;

function validation(source: string | readonly string[], message?: string): Record<string, unknown> {
  return { 'x-llm-req-parameter': { validation: { function: source, ...(message === undefined ? {} : { message }) } } };
}

function objectSchema(properties: Record<string, unknown>, extra: Record<string, unknown> = {}): InlineJsonSchema {
  return { type: 'object', additionalProperties: false, properties, ...extra };
}

function provider(calls: ProviderCompletionRequest[]): LlmProvider {
  return {
    async complete(request) {
      calls.push(request);
      return { content: 'ok', toolCalls: [], decision: 'stop' };
    },
  };
}

function failureMessage(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof LlmFailure, String(error));
    assert.equal(error.code, 'CONFIGURATION_INVALID');
    return error.message;
  }
  assert.fail('expected a CONFIGURATION_INVALID failure');
}

/** Validation failure text after the `failed: ` prefix. */
function reported(operation: () => unknown): string {
  const message = failureMessage(operation);
  const marker = 'failed: ';
  assert.ok(message.includes(marker), message);
  return message.slice(message.indexOf(marker) + marker.length);
}

interface RequestFixture {
  readonly root: string;
  readonly requests: string;
}

async function requestFixture(schema: InlineJsonSchema, prompt = 'Check $${name}$$.'): Promise<RequestFixture> {
  const root = await mkdtemp(join(tmpdir(), 'llm-parameter-validation-'));
  const requests = join(root, 'requests');
  await mkdir(join(requests, 'check'), { recursive: true });
  await writeFile(join(requests, 'check', 'check.prompt.md'), prompt);
  await writeFile(join(requests, 'check', 'check.parameters.schema.json'), JSON.stringify(schema));
  return { root, requests };
}

async function temporaryContentDirectories(): Promise<readonly string[]> {
  return (await readdir(tmpdir())).filter((name) => name.startsWith('llm-request-parameter-files-')).sort();
}

// SDLC-TEST-CASE: WI-0023-10000000_TC-METADATA-CONTRACT
test('WI-0023-10000000_TC-METADATA-CONTRACT accepts declared validators and fails closed on malformed metadata', async () => {
  const valid = objectSchema({
    name: { type: 'string', ...validation('(value) => value.length > 1') },
    notes: {
      type: 'string',
      'x-llm-req-parameter': {
        file: { mode: 'path', type: 'text/plain', purpose: 'Notes.' },
        validation: { function: ['function (value, context) {', '  return context.fs.isFile(value);', '}'], message: 'notes must be a file' },
      },
    },
    tags: { type: 'array', items: { type: 'string', ...validation('(tag) => tag === tag.toLowerCase()') } },
  }, validation('() => true'));
  assert.deepEqual(discoverParameterValidators(valid).map((validator) => validator.location), ['<root>', 'name', 'notes', 'tags[]']);
  assert.deepEqual(constructRequestParameters({ schema: valid, parameters: { name: 'ok' } }), { name: 'ok' });

  const invalid: readonly [string, InlineJsonSchema, RegExp][] = [
    ['unknown member', objectSchema({ name: { type: 'string', 'x-llm-req-parameter': { validation: { function: '() => true', module: './x.js' } } } }), /unsupported member 'module'/u],
    ['non-object validation', objectSchema({ name: { type: 'string', 'x-llm-req-parameter': { validation: '() => true' } } }), /validation must be an object/u],
    ['missing function', objectSchema({ name: { type: 'string', 'x-llm-req-parameter': { validation: { message: 'm' } } } }), /non-empty string or an array of strings/u],
    ['non-string source', objectSchema({ name: { type: 'string', 'x-llm-req-parameter': { validation: { function: 42 } } } }), /non-empty string or an array of strings/u],
    ['empty message', objectSchema({ name: { type: 'string', ...validation('() => true', '') } }), /validation\.message must be a non-empty string/u],
    ['syntax error', objectSchema({ name: { type: 'string', ...validation('(value) => {') } }), /is not valid JavaScript/u],
    ['non-function expression', objectSchema({ name: { type: 'string', ...validation('42') } }), /must be a JavaScript function expression/u],
    ['statement injection', objectSchema({ name: { type: 'string', ...validation('() => true); globalThis.injected = (1') } }), /must be a JavaScript function expression|not valid JavaScript/u],
    ['oneOf position', objectSchema({ name: { type: 'string' } }, { oneOf: [{ required: ['name'], ...validation('() => true') }] }), /supported only on the schema root, properties, and array items/u],
    ['$defs position', objectSchema({ name: { type: 'string' } }, { $defs: { named: { type: 'string', ...validation('() => true') } } }), /supported only on the schema root, properties, and array items/u],
  ];
  for (const [name, schema, pattern] of invalid) {
    assert.match(failureMessage(() => constructRequestParameters({ schema, parameters: { name: 'ok' } })), pattern, name);
    const fixture = await requestFixture(schema);
    const calls: ProviderCompletionRequest[] = [];
    try {
      await assert.rejects(() => completeRequest({ requestName: 'check', requestsDirectory: fixture.requests, parameters: { name: 'ok' }, provider: provider(calls) }), pattern, name);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
    assert.equal(calls.length, 0, name);
  }
  assert.equal((globalThis as Record<string, unknown>).injected, undefined);
});

// SDLC-TEST-CASE: WI-0023-10000000_TC-INVOCATION-CONTEXT
test('WI-0023-10000000_TC-INVOCATION-CONTEXT passes the value and a frozen context in declaration order', () => {
  // Each validator fails with its concrete path unless already listed in `skip`; growing `skip` reveals the order.
  const reportPath = '(value, context) => context.parameters.skip.includes(context.path) || `seen:${context.path}`';
  const schema = objectSchema({
    skip: { type: 'array', items: { type: 'string' } },
    name: { type: 'string', ...validation(reportPath) },
    owner: { type: 'object', properties: { id: { type: 'string', ...validation(reportPath) } } },
    sections: { type: 'array', items: { type: 'object', properties: { title: { type: 'string', ...validation(reportPath) } } } },
    optional: { type: 'string', ...validation(reportPath) },
  }, validation(reportPath));
  const base = { name: 'Ada', owner: { id: 'u-1' }, sections: [{ title: 'First' }, { title: 'Second' }] };
  const order: string[] = [];
  for (;;) {
    const parameters = { ...base, skip: [...order] };
    try {
      runParameterValidators(schema, parameters, REQUEST);
      break;
    } catch {
      const path = reported(() => runParameterValidators(schema, parameters, REQUEST)).replace(/^seen:/u, '');
      order.push(path);
      assert.ok(order.length <= 6, order.join(','));
    }
  }
  assert.deepEqual(order, ['', 'name', 'owner.id', 'sections[0].title', 'sections[1].title']);

  const describe = objectSchema({
    name: {
      type: 'string',
      ...validation([
        '(value, context) => JSON.stringify({',
        '  keys: Object.keys(context).sort(), path: context.path, value, same: value === context.value,',
        '  name: context.parameters.name, owner: context.parameters.owner.id, schemaType: context.schema.type,',
        '  request: context.request, cwd: context.workingDirectory, fs: Object.keys(context.fs).sort(),',
        '  frozen: [context, context.parameters, context.parameters.owner, context.schema, context.request, context.fs].every(Object.isFrozen),',
        '})',
      ]),
    },
    owner: { type: 'object', properties: { id: { type: 'string' } } },
  });
  assert.deepEqual(JSON.parse(reported(() => runParameterValidators(describe, { name: 'Ada', owner: { id: 'u-1' } }, REQUEST))), {
    keys: ['fs', 'parameters', 'path', 'request', 'schema', 'value', 'workingDirectory'],
    path: 'name',
    value: 'Ada',
    same: true,
    name: 'Ada',
    owner: 'u-1',
    schemaType: 'string',
    request: { name: REQUEST.name, directory: REQUEST.directory },
    cwd: process.cwd(),
    fs: ['exists', 'isDirectory', 'isFile', 'readText', 'resolve'],
    frozen: true,
  });

  const mutating = objectSchema({ name: { type: 'string', ...validation("(value, context) => { context.parameters.name = 'changed'; }") } });
  const original = { name: 'Ada' };
  assert.match(reported(() => runParameterValidators(mutating, original, REQUEST)), /read.only|Cannot assign/u);
  assert.equal(original.name, 'Ada');
});

// SDLC-TEST-CASE: WI-0023-10000000_TC-FILESYSTEM-HELPERS
test('WI-0023-10000000_TC-FILESYSTEM-HELPERS resolves from the working directory and bounds reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-parameter-validation-fs-'));
  try {
    await mkdir(join(root, 'folder'));
    await writeFile(join(root, 'note.txt'), 'hello validator');
    await writeFile(join(root, 'large.txt'), Buffer.alloc(PARAMETER_VALIDATION_READ_LIMIT_BYTES + 1, 'a'));
    const probe = objectSchema({
      target: {
        type: 'string',
        ...validation('(value, context) => JSON.stringify({ resolved: context.fs.resolve(value), exists: context.fs.exists(value), file: context.fs.isFile(value), directory: context.fs.isDirectory(value) })'),
      },
    });
    const observe = (target: string) => JSON.parse(reported(() => runParameterValidators(probe, { target }, { ...REQUEST, workingDirectory: root }))) as Record<string, unknown>;
    assert.deepEqual(observe('note.txt'), { resolved: join(root, 'note.txt'), exists: true, file: true, directory: false });
    assert.deepEqual(observe('folder'), { resolved: join(root, 'folder'), exists: true, file: false, directory: true });
    assert.deepEqual(observe('missing'), { resolved: join(root, 'missing'), exists: false, file: false, directory: false });
    assert.deepEqual(observe(join(root, 'note.txt')), { resolved: join(root, 'note.txt'), exists: true, file: true, directory: false });

    const read = objectSchema({ target: { type: 'string', ...validation("(value, context) => context.fs.readText(value) === 'hello validator'") } });
    runParameterValidators(read, { target: 'note.txt' }, { ...REQUEST, workingDirectory: root });
    assert.match(reported(() => runParameterValidators(read, { target: 'large.txt' }, { ...REQUEST, workingDirectory: root })), /exceeds the 1048576-byte read limit/u);
    assert.match(reported(() => runParameterValidators(read, { target: 'folder' }, { ...REQUEST, workingDirectory: root })), /Not a regular file/u);

    const write = objectSchema({ target: { type: 'string', ...validation("(value, context) => { context.fs.writeText = () => 1; }") } });
    assert.match(reported(() => runParameterValidators(write, { target: 'note.txt' }, { ...REQUEST, workingDirectory: root })), /not extensible|Cannot add property/u);
    assert.equal(await readFile(join(root, 'note.txt'), 'utf8'), 'hello validator');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// SDLC-TEST-CASE: WI-0023-10000000_TC-RESULT-SEMANTICS
test('WI-0023-10000000_TC-RESULT-SEMANTICS maps results, errors, and timeouts to bounded outcomes in an isolated context', () => {
  const run = (source: string, message?: string) => () => runParameterValidators(objectSchema({ name: { type: 'string', ...validation(source, message) } }), { name: 'Ada' }, REQUEST);

  run('() => true')();
  run('() => undefined')();
  run('() => {}')();
  assert.equal(reported(run('() => false')), 'the value was rejected by its validation function.');
  assert.equal(reported(run('() => false', 'name must be approved')), 'name must be approved');
  assert.equal(reported(run('(value) => `unknown name: ${value}`')), 'unknown name: Ada');
  assert.equal(reported(run("() => { throw new Error('lookup failed'); }")), 'lookup failed');
  assert.equal(reported(run("() => { throw 'plain text'; }")), 'plain text');
  assert.match(failureMessage(run('() => 1')), /must return true, false, undefined, or a non-empty failure message/u);
  assert.match(failureMessage(run("() => ''")), /must return true, false, undefined, or a non-empty failure message/u);
  assert.match(failureMessage(run('async () => true')), /must return synchronously/u);
  assert.match(failureMessage(run('() => ({ then() {} })')), /must return synchronously/u);

  const started = Date.now();
  assert.equal(reported(run('() => { for (;;) {} }')), `the validation function exceeded the ${PARAMETER_VALIDATION_TIMEOUT_MS} ms timeout.`);
  assert.ok(Date.now() - started < PARAMETER_VALIDATION_TIMEOUT_MS * 5);

  assert.equal(JSON.parse(reported(run("() => JSON.stringify([typeof require, typeof process, typeof setTimeout, typeof globalThis.fetch, typeof module])"))).join(','), 'undefined,undefined,undefined,undefined,undefined');
  assert.match(reported(run("() => eval('1')")), /Code generation from strings disallowed/u);
  assert.match(reported(run("() => Function('return 1')()")), /Code generation from strings disallowed/u);
  run('() => { globalThis.leak = 1; }')();
  run("() => typeof globalThis.leak === 'undefined' || 'state leaked between calls'")();
  assert.equal((globalThis as Record<string, unknown>).leak, undefined);
  assert.ok(reported(run(`() => '${'x'.repeat(2000)}'`)).length < 600);
});

// SDLC-TEST-CASE: WI-0023-10000000_TC-PIPELINE-ORDER
test('WI-0023-10000000_TC-PIPELINE-ORDER runs validators after schema validation and before files and provider use', async () => {
  const schema = objectSchema({
    name: { type: 'string', minLength: 2, ...validation("(value) => value !== 'blocked' || 'name is blocked'") },
    content: {
      type: 'string',
      'x-llm-req-parameter': {
        file: { mode: 'content', name: 'content.txt', type: 'text/plain', purpose: 'Inline content.' },
        validation: { function: "(value, context) => context.parameters.name !== 'quiet' || 'content is not allowed for quiet'" },
      },
    },
  }, { required: ['name'] });
  const fixture = await requestFixture(schema);
  const calls: ProviderCompletionRequest[] = [];
  const before = await temporaryContentDirectories();
  try {
    // JSON Schema rejects the value first, so the validator's message never appears.
    await assert.rejects(() => completeRequest({ requestName: 'check', requestsDirectory: fixture.requests, parameters: { name: 'x' }, provider: provider(calls) }), /do not satisfy the parameter schema/u);
    await assert.rejects(() => completeRequest({ requestName: 'check', requestsDirectory: fixture.requests, parameters: { name: 'blocked' }, provider: provider(calls) }), /Validation of 'name' failed: name is blocked/u);
    await assert.rejects(() => completeRequest({ requestName: 'check', requestsDirectory: fixture.requests, parameters: { name: 'quiet', content: 'text' }, provider: provider(calls) }), /Validation of 'content' failed: content is not allowed for quiet/u);
    assert.equal(calls.length, 0);
    assert.deepEqual(await temporaryContentDirectories(), before, 'failing validators must not materialize files');

    await completeRequest({ requestName: 'check', requestsDirectory: fixture.requests, parameters: { name: 'allowed', content: 'text' }, provider: provider(calls) });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.task, 'Check allowed.');
    assert.deepEqual(calls[0]?.files.map((file) => file.content), ['text']);

    const stderr: string[] = [];
    const cliFailure = await runRequestCommand({
      requestName: 'check',
      requestsDirectory: fixture.requests,
      assignments: [{ path: 'name', value: 'blocked' }],
      debug: false,
      provider: provider(calls),
      write: () => undefined,
      writeError: (text) => stderr.push(text),
    });
    assert.equal(cliFailure, 1);
    assert.match(stderr.join(''), /Validation of 'name' failed: name is blocked/u);
    const cliSuccess = await runRequestCommand({
      requestName: 'check',
      requestsDirectory: fixture.requests,
      assignments: [{ path: 'name', value: 'cli' }],
      debug: false,
      provider: provider(calls),
      write: () => undefined,
      writeError: () => undefined,
    });
    assert.equal(cliSuccess, 0);
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.task, 'Check cli.');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }

  for (const path of ['src/request.ts', 'src/request-parameter-validation.ts']) {
    assert.doesNotMatch(await readFile(path, 'utf8'), /summarize/u, path);
  }
});

// SDLC-TEST-CASE: WI-0023-10000000_TC-CONTRACT-DOCUMENTATION
test('WI-0023-10000000_TC-CONTRACT-DOCUMENTATION documents the validation function contract and trust boundary', async () => {
  const [contract, decisions, readme, skill] = await Promise.all([
    readFile('requests/README.md', 'utf8'),
    readFile('requests/decisions.md', 'utf8'),
    readFile('README.md', 'utf8'),
    readFile('SKILL.md', 'utf8'),
  ]);
  const start = contract.indexOf('## x-llm-req-parameter metadata\n');
  const metadata = contract.slice(start, contract.indexOf('\n## ', start + 1));
  for (const statement of [
    '"validation": {',
    '"function":',
    '`message`',
    '`fn(value, context)`',
    '`path`',
    '`parameters`',
    '`schema`',
    '`request`',
    '`workingDirectory`',
    '`fs.resolve(path)`',
    '`fs.readText(path)`',
    `${PARAMETER_VALIDATION_TIMEOUT_MS} ms`,
    `${PARAMETER_VALIDATION_READ_LIMIT_BYTES} bytes`,
    'not a security boundary',
  ]) {
    assert.ok(metadata.includes(statement), `x-llm-req-parameter metadata documents ${statement}`);
  }
  assert.doesNotMatch(contract, /`validation` member remains reserved/u);
  assert.doesNotMatch(contract, /does not evaluate function references or execute code from\s+request assets/u);
  assert.doesNotMatch(contract, /must remain fail-closed until implemented and tested/u);
  assert.match(contract, /Run every `x-llm-req-parameter\.validation\.function`/u);
  assert.match(decisions, /## D17 — Inline parameter validation functions/u);
  assert.match(readme, /x-llm-req-parameter\.validation\.function/u);
  assert.match(skill, /x-llm-req-parameter\.validation\.function/u);
});
