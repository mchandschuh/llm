import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

interface SampleResult {
  readonly sample: string;
  readonly ok: boolean;
  readonly feature: string;
  readonly assertions: Record<string, unknown>;
}

function runSample(path: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [path], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => resolvePromise({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }));
  });
}

async function execute(name: string): Promise<SampleResult> {
  const execution = await runSample(join(resolve(process.cwd(), 'samples'), `${name}.mjs`));
  assert.equal(execution.code, 0, `${name} exited ${execution.code}: ${execution.stderr}`);
  assert.equal(execution.stderr, '', `${name} wrote stderr: ${execution.stderr}`);
  const lines = execution.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `${name} must emit one JSON line`);
  return JSON.parse(lines[0]!) as SampleResult;
}

test('ordinary chat sample proves retained final assistant history', async () => {
  const result = await execute('chat-conversation');
  assert.equal(result.ok, true);
  assert.equal(result.feature, 'ordinary-chat-history');
  assert.deepEqual(result.assertions.providerRequestRoles, [
    ['system', 'user', 'user'],
    ['system', 'user', 'user', 'assistant', 'user'],
  ]);
});

test('interruptible chat sample proves response-only interruption and lifecycle evidence', async () => {
  const result = await execute('chat-interruptible-tool-round');
  assert.equal(result.ok, true);
  assert.equal(result.feature, 'interruptible-tool-round');
  assert.equal(result.assertions.interrupted, true);
  assert.equal(result.assertions.interruptHistoryMutation, false);
  assert.ok((result.assertions.lifecycleEvents ?? []).includes('llm.tool.call'));
});

test('blocked chat sample proves the default policy does not process early', async () => {
  const result = await execute('chat-blocked-tool-round');
  assert.equal(result.ok, true);
  assert.equal(result.feature, 'blocked-tool-round');
  assert.equal(result.assertions.blocked, true);
  assert.equal(result.assertions.processedEarly, false);
  assert.ok(Number(result.assertions.blockedElapsedMs) < 1500);
});