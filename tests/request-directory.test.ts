import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LlmFailure } from '../src/errors.js';
import { loadRequestDirectory } from '../src/request-directory.js';
import { resolveRequestsDirectory } from '../src/requests-config.js';

const taskSchema = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.test/request-task/v1',
  type: 'object',
  additionalProperties: false,
  required: ['operation'],
  properties: { operation: { type: 'string' } },
});

const parametersSchema = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.test/request-parameters/v1',
  type: 'object',
  additionalProperties: false,
  properties: { audience: { type: 'string' } },
});

const outputSchema = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.test/request-output/v1',
  type: 'object',
  properties: { ok: { type: 'boolean' } },
});

async function makeRequestDirectory(): Promise<{ readonly root: string; readonly requests: string; readonly request: string }> {
  const root = await mkdtemp(join(tmpdir(), 'llm-request-directory-'));
  const requests = join(root, 'requests');
  const request = join(requests, 'report');
  await mkdir(request, { recursive: true });
  return { root, requests, request };
}

async function writeCompletePromptBundle(request: string): Promise<void> {
  await Promise.all([
    writeFile(join(request, 'report.defaults.json'), '{"provider":"openrouter","parameters":{"audience":"engineering"}}'),
    writeFile(join(request, 'report.prompt.md'), 'Summarize the report.'),
    writeFile(join(request, 'report.prompt.system.md'), 'Return concise JSON.'),
    writeFile(join(request, 'report.taskSchema.json'), taskSchema),
    writeFile(join(request, 'report.parameters.schema.json'), parametersSchema),
    writeFile(join(request, 'report.outputSchema.json'), outputSchema),
    writeFile(join(request, 'notes.txt'), 'not a recognized request asset'),
  ]);
}

async function assertConfigurationFailure(operation: () => Promise<unknown>, message: RegExp): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.equal(error instanceof LlmFailure, true);
    assert.equal((error as LlmFailure).code, 'CONFIGURATION_INVALID');
    assert.equal((error as LlmFailure).phase, 'configuration');
    assert.match((error as Error).message, message);
    assert.ok((error as Error).message.length <= 500);
    return true;
  });
}

test('WI-0015-10000000_TC-SAFE-RESOLUTION resolves valid names and rejects unsafe request selectors', async () => {
  const fixture = await makeRequestDirectory();
  try {
    await writeFile(join(fixture.request, 'report.prompt.md'), 'valid prompt');
    const loaded = await loadRequestDirectory(fixture.requests, 'report');
    assert.equal(loaded.requestName, 'report');
    assert.equal(loaded.requestDirectory, fixture.request);
    assert.equal(loaded.assets.task.kind, 'prompt');
    assert.equal(loaded.assets.task.value, 'valid prompt');

    for (const name of ['/tmp/report', '../report', 'nested/report', 'nested\\report', '']) {
      await assertConfigurationFailure(() => loadRequestDirectory(fixture.requests, name), /request name|safe child directory/u);
    }
    await symlink(fixture.request, join(fixture.requests, 'linked'));
    await assertConfigurationFailure(() => loadRequestDirectory(fixture.requests, 'linked'), /symlinked request directories/u);
    await assertConfigurationFailure(() => loadRequestDirectory(fixture.requests, 'missing'), /does not exist/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('WI-0015-10000000_TC-ASSET-SET discovers recognized assets and ignores unknown files', async () => {
  const fixture = await makeRequestDirectory();
  try {
    await writeCompletePromptBundle(fixture.request);
    const loaded = await loadRequestDirectory(fixture.requests, 'report');
    assert.deepEqual(loaded.assets.defaults?.value, { provider: 'openrouter', parameters: { audience: 'engineering' } });
    assert.deepEqual(loaded.assets.task, { kind: 'prompt', path: join(fixture.request, 'report.prompt.md'), value: 'Summarize the report.' });
    assert.equal(loaded.assets.systemPrompt?.value, 'Return concise JSON.');
    assert.equal(loaded.assets.taskSchema?.value.$id, 'https://example.test/request-task/v1');
    assert.equal(loaded.assets.parametersSchema?.value.$id, 'https://example.test/request-parameters/v1');
    assert.equal(loaded.assets.outputSchema?.value.$id, 'https://example.test/request-output/v1');
    assert.deepEqual(loaded.ignoredFiles, ['notes.txt']);

    await writeFile(join(fixture.request, 'report.task.json'), '{"operation":"inspect"}');
    await assertConfigurationFailure(() => loadRequestDirectory(fixture.requests, 'report'), /mutually exclusive/u);
    await rm(join(fixture.request, 'report.prompt.md'));
    await rm(join(fixture.request, 'report.taskSchema.json'));
    await assertConfigurationFailure(() => loadRequestDirectory(fixture.requests, 'report'), /task schema asset is required/u);
    await writeFile(join(fixture.request, 'report.taskSchema.json'), taskSchema);
    const structured = await loadRequestDirectory(fixture.requests, 'report');
    assert.deepEqual(structured.assets.task, { kind: 'json', path: join(fixture.request, 'report.task.json'), value: { operation: 'inspect' } });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('WI-0015-10000000_TC-PARSING-ERRORS rejects malformed, unreadable, and wrong-shaped assets before provider use', async () => {
  const fixture = await makeRequestDirectory();
  try {
    await writeFile(join(fixture.request, 'report.prompt.md'), 'prompt');
    await writeFile(join(fixture.request, 'report.defaults.json'), '{');
    await assertConfigurationFailure(() => loadRequestDirectory(fixture.requests, 'report'), /defaults.*valid JSON/u);

    await writeFile(join(fixture.request, 'report.defaults.json'), '[]');
    await assertConfigurationFailure(() => loadRequestDirectory(fixture.requests, 'report'), /defaults.*JSON object/u);

    await writeFile(join(fixture.request, 'report.defaults.json'), '{}');
    await writeFile(join(fixture.request, 'report.outputSchema.json'), '[]');
    await assertConfigurationFailure(() => loadRequestDirectory(fixture.requests, 'report'), /output schema.*JSON object/u);

    await writeFile(join(fixture.request, 'report.outputSchema.json'), '{"type":"not-a-schema"}');
    await assertConfigurationFailure(() => loadRequestDirectory(fixture.requests, 'report'), /output schema.*valid JSON Schema/u);

    await rm(join(fixture.request, 'report.outputSchema.json'));
    await mkdir(join(fixture.request, 'report.taskSchema.json'));
    await assertConfigurationFailure(() => loadRequestDirectory(fixture.requests, 'report'), /task schema.*regular file|task schema.*symbolic link/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('WI-0015-10000000_TC-CONFIGURATION-REUSE uses the shared requestsDirectory precedence and guidance', async () => {
  const applicationRoot = await mkdtemp(join(tmpdir(), 'llm-request-config-application-'));
  const homeRoot = await mkdtemp(join(tmpdir(), 'llm-request-config-home-'));
  const environmentRoot = await mkdtemp(join(tmpdir(), 'llm-request-config-environment-'));
  const applicationRequests = await mkdtemp(join(tmpdir(), 'llm-request-config-requests-application-'));
  const homeRequests = await mkdtemp(join(tmpdir(), 'llm-request-config-requests-home-'));
  const environmentRequests = await mkdtemp(join(tmpdir(), 'llm-request-config-requests-environment-'));
  const missingApplicationRoot = await mkdtemp(join(tmpdir(), 'llm-request-config-missing-application-'));
  try {
    await mkdir(join(applicationRoot, '.config'), { recursive: true });
    await writeFile(join(applicationRoot, '.config', 'config.json'), JSON.stringify({ requestsDirectory: applicationRequests }));
    await mkdir(join(homeRoot, '.llm'), { recursive: true });
    await writeFile(join(homeRoot, '.llm', 'config.json'), JSON.stringify({ requestsDirectory: homeRequests }));
    await writeFile(join(environmentRoot, 'config.json'), JSON.stringify({ requestsDirectory: environmentRequests }));
    assert.equal(await resolveRequestsDirectory({ applicationSourceDirectory: applicationRoot, homeDirectory: homeRoot, environment: { LLM_CONFIG: environmentRoot } }), environmentRequests);
    assert.equal(await resolveRequestsDirectory({ applicationSourceDirectory: applicationRoot, homeDirectory: homeRoot, environment: {} }), homeRequests);
    await assert.rejects(() => resolveRequestsDirectory({ applicationSourceDirectory: missingApplicationRoot, homeDirectory: join(homeRoot, 'missing'), environment: {} }), /Configure ~\/\.llm\/config\.json:requestsDirectory/u);
  } finally {
    await Promise.all([applicationRoot, homeRoot, environmentRoot, applicationRequests, homeRequests, environmentRequests, missingApplicationRoot].map((path) => rm(path, { recursive: true, force: true })));
  }
});