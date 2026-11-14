import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
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

test('every executable feature sample runs and validates its result envelope', async () => {
  const sampleDirectory = resolve(process.cwd(), 'samples');
  const sampleNames = (await readdir(sampleDirectory)).filter((name) => name.endsWith('.mjs')).sort();
  assert.ok(sampleNames.length > 0, 'samples/ must contain at least one executable sample');
  for (const sampleName of sampleNames) {
    const path = join(sampleDirectory, sampleName);
    const execution = await runSample(path);
    assert.equal(execution.code, 0, `${sampleName} exited ${execution.code}: ${execution.stderr}`);
    assert.equal(execution.stderr, '', `${sampleName} wrote diagnostics to stderr: ${execution.stderr}`);
    const lines = execution.stdout.trim().split('\n');
    assert.equal(lines.length, 1, `${sampleName} must emit exactly one JSON line`);
    const result = JSON.parse(lines[0]!) as Partial<SampleResult>;
    assert.equal(typeof result.sample, 'string', `${sampleName} must include a sample identifier`);
    assert.equal(result.sample, sampleName.slice(0, -4), `${sampleName} identifier must match its filename`);
    assert.equal(result.ok, true, `${sampleName} reported failure: ${JSON.stringify(result)}`);
    assert.equal(typeof result.feature, 'string', `${sampleName} must include a feature identifier`);
    assert.ok(result.assertions && typeof result.assertions === 'object', `${sampleName} must include assertions`);
  }
});