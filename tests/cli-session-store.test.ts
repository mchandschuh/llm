import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chatSessionPath, loadChatSession, saveChatSession, validateChatId } from '../src/chat-session-store.js';
import type { LlmRequest } from '../src/types.js';

const request: LlmRequest = {
  schema: 'https://schemas.handschuh.dev/llm/request/v1',
  task: { operation: 'chat' },
  systemPrompt: 'Answer briefly.',
};

test('chat session store safely validates IDs and contains paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-session-store-'));
  assert.equal(chatSessionPath('chat-1', { rootDirectory: root }), join(root, 'chat-1.json'));
  for (const value of ['../escape', '/absolute', 'nested/id', 'bad id', '', 'x'.repeat(65)]) {
    assert.throws(() => validateChatId(value), /chat identifier/u);
  }
  assert.throws(() => chatSessionPath('../escape', { rootDirectory: root }), /chat identifier/u);
});

test('chat session store atomically persists bounded provider-neutral state without credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-session-store-'));
  const path = await saveChatSession({
    chatId: 'chat-1',
    request: { ...request, credentials: { apiKey: 'must-not-persist' } },
    history: [
      { role: 'system', content: 'Answer briefly.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi', toolCalls: [] },
    ],
  }, { rootDirectory: root });
  const loaded = await loadChatSession('chat-1', { rootDirectory: root });
  assert.equal(path, join(root, 'chat-1.json'));
  assert.equal(loaded?.chatId, 'chat-1');
  assert.equal(loaded?.history.length, 3);
  assert.equal(JSON.stringify(loaded).includes('must-not-persist'), false);
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await readFile(path, 'utf8')).includes('.tmp'), false);
});

test('fresh session saves replace existing state at the explicit chat ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-session-store-'));
  await saveChatSession({ chatId: 'chat-1', request, history: [{ role: 'user', content: 'old' }] }, { rootDirectory: root });
  await saveChatSession({ chatId: 'chat-1', request, history: [{ role: 'user', content: 'new' }] }, { rootDirectory: root });
  assert.deepEqual((await loadChatSession('chat-1', { rootDirectory: root }))?.history, [{ role: 'user', content: 'new' }]);
});

test('chat session store rejects malformed or credential-bearing persisted state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-session-store-'));
  await saveChatSession({ chatId: 'chat-1', request, history: [] }, { rootDirectory: root });
  const path = join(root, 'chat-1.json');
  const original = await readFile(path, 'utf8');
  await writeFile(path, '{bad-json');
  await assert.rejects(() => loadChatSession('chat-1', { rootDirectory: root }), /valid JSON/u);
  await writeFile(path, original.replace('"request": {', '"request": {"credentials":{"apiKey":"secret"},'));
  await assert.rejects(() => loadChatSession('chat-1', { rootDirectory: root }), /invalid|incompatible|credential/u);
  await writeFile(path, original.replace('"request": {', '"request": {"messages":[],'));
  await assert.rejects(() => loadChatSession('chat-1', { rootDirectory: root }), /invalid|incompatible/u);
});

test('chat session store rejects malformed embedded tool calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-session-store-'));
  await saveChatSession({ chatId: 'chat-1', request, history: [] }, { rootDirectory: root });
  const path = join(root, 'chat-1.json');
  const original = JSON.parse(await readFile(path, 'utf8')) as { history: unknown[] };
  original.history = [{ role: 'assistant', content: null, toolCalls: [{ id: 'call-1', name: 'read', arguments: 'not-an-object' }] }];
  await writeFile(path, JSON.stringify(original));
  await assert.rejects(() => loadChatSession('chat-1', { rootDirectory: root }), /invalid|incompatible/u);
});

test('missing chat session is distinguishable from invalid persisted state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-session-store-'));
  assert.equal(await loadChatSession('missing', { rootDirectory: root }), undefined);
});