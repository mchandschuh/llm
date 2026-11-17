import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveChatSessionStoreConfig } from '../src/chat-session-config.js';

async function fixture() {
  const root = await mkdtemp('/tmp/llm-session-config-');
  const home = await mkdtemp('/tmp/llm-session-home-');
  const environment = await mkdtemp('/tmp/llm-session-environment-');
  return { root, home, environment };
}

async function writeConfig(directory: string, value: unknown): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'config.json'), JSON.stringify(value));
}

test('configuration falls back from current directory to home and then environment roots', async () => {
  const value = await fixture();
  await writeConfig(join(value.root, '.config'), { chatSessionStore: { type: 'tempFile', rootDirectory: '/tmp/application-sessions' } });
  await writeConfig(join(value.home, '.llm'), { chatSessionStore: { type: 'file', rootDirectory: '/tmp/home-sessions' } });
  await writeConfig(value.environment, { chatSessionStore: { type: 'tempFile', rootDirectory: '/tmp/environment-sessions' } });
  assert.deepEqual(resolveChatSessionStoreConfig({
    workingDirectory: value.root,
    homeDirectory: value.home,
    environment: { LLM_CONFIG: value.environment },
  }), { type: 'tempFile', rootDirectory: '/tmp/environment-sessions' });
});

test('configuration uses defaults when no roots or environment overrides are present', () => {
  assert.deepEqual(resolveChatSessionStoreConfig({
    workingDirectory: '/tmp/llm-no-config-working',
    homeDirectory: '/tmp/llm-no-config-home',
    environment: {},
  }), { type: 'tempFile' });
});

test('environment variables override files and require absolute configuration roots', async () => {
  const value = await fixture();
  await writeConfig(join(value.root, '.config'), { chatSessionStore: { type: 'file', rootDirectory: '/tmp/file-sessions' } });
  assert.deepEqual(resolveChatSessionStoreConfig({
    workingDirectory: value.root,
    homeDirectory: value.home,
    environment: { LLM_CHAT_SESSION_STORE: 'tempFile', LLM_CHAT_SESSION_ROOT: '/tmp/environment-sessions' },
  }), { type: 'tempFile', rootDirectory: '/tmp/environment-sessions' });
  assert.throws(() => resolveChatSessionStoreConfig({
    workingDirectory: value.root,
    homeDirectory: value.home,
    environment: { LLM_CONFIG: 'relative' },
  }), /LLM_CONFIG must be an absolute directory/u);
  assert.throws(() => resolveChatSessionStoreConfig({
    workingDirectory: value.root,
    homeDirectory: value.home,
    environment: { LLM_CHAT_SESSION_ROOT: 'relative' },
  }), /LLM_CHAT_SESSION_ROOT must be an absolute directory/u);
});

test('configuration rejects malformed JSON and invalid store values', async () => {
  const value = await fixture();
  await mkdir(join(value.root, '.config'), { recursive: true });
  await writeFile(join(value.root, '.config', 'config.json'), '{bad-json');
  assert.throws(() => resolveChatSessionStoreConfig({ workingDirectory: value.root, homeDirectory: value.home, environment: {} }), /configuration file could not be read/u);
  await writeConfig(join(value.root, '.config'), { chatSessionStore: { type: 42 } });
  assert.throws(() => resolveChatSessionStoreConfig({ workingDirectory: value.root, homeDirectory: value.home, environment: {} }), /chatSessionStore.type must be a non-empty string/u);
});