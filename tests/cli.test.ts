import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCliArguments } from '../src/cli/arguments.js';

test('CLI parser preserves request-file and config modes', () => {
  assert.deepEqual(parseCliArguments(['request.json']), {
    debug: false,
    command: 'config',
    requestPath: 'request.json',
  });
  assert.deepEqual(parseCliArguments(['--config', 'request.json', '--debug']), {
    debug: true,
    command: 'config',
    requestPath: 'request.json',
  });
});

test('CLI parser routes help/version and rejects invalid config shapes', () => {
  assert.deepEqual(parseCliArguments([]), { debug: false, command: 'help', exitCode: 0 });
  assert.deepEqual(parseCliArguments(['--help']), { debug: false, command: 'help', exitCode: 0 });
  assert.deepEqual(parseCliArguments(['--version']), { debug: false, command: 'version', exitCode: 0 });
  assert.deepEqual(parseCliArguments(['--config']), { debug: false, command: 'config', exitCode: 2 });
  assert.deepEqual(parseCliArguments(['request.json', 'extra']), { debug: false, command: 'config', exitCode: 2 });
});

test('CLI parser treats debug as an orthogonal output concern', () => {
  const parsed = parseCliArguments(['--debug', '--config', 'request.json']);
  assert.equal(parsed.debug, true);
  assert.equal(parsed.command, 'config');
  assert.equal(parsed.requestPath, 'request.json');
});