import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ChatSessionStoreFactory, type ChatSessionStore } from '../src/chat-session-store.js';
import type { LlmRequest } from '../src/types.js';

const request: LlmRequest = {
  schema: 'https://schemas.handschuh.dev/llm/request/v1',
  task: { operation: 'chat' },
  systemPrompt: 'Answer briefly.',
};

function tempFileStore(rootDirectory: string): ChatSessionStore {
  return ChatSessionStoreFactory.createChatSessionStore({ type: 'tempFile', rootDirectory });
}

test('chat session store safely validates IDs and contains paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-session-store-'));
  const store = tempFileStore(root);
  for (const value of ['../escape', '/absolute', 'nested/id', 'bad id', '', 'x'.repeat(65)]) {
    await assert.rejects(() => store.load(value), /chat identifier/u);
  }
});

test('chat session store atomically persists bounded provider-neutral state without credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-session-store-'));
  const store = tempFileStore(root);
  const path = await store.save({
    chatId: 'chat-1',
    request: { ...request, credentials: { apiKey: 'must-not-persist' } },
    history: [
      { role: 'system', content: 'Answer briefly.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi', toolCalls: [] },
    ],
  });
  const loaded = await store.load('chat-1');
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
  const store = tempFileStore(root);
  await store.save({ chatId: 'chat-1', request, history: [{ role: 'user', content: 'old' }] });
  await store.save({ chatId: 'chat-1', request, history: [{ role: 'user', content: 'new' }] });
  assert.deepEqual((await store.load('chat-1'))?.history, [{ role: 'user', content: 'new' }]);
});

test('query returns sorted chat IDs and applies inclusive updatedAt bounds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-session-store-'));
  const store = tempFileStore(root);
  await store.save({ chatId: 'chat-z', request, history: [] });
  await store.save({ chatId: 'chat-a', request, history: [] });
  const firstPath = join(root, 'chat-a.json');
  const secondPath = join(root, 'chat-z.json');
  await writeFile(firstPath, JSON.stringify({ ...JSON.parse(await readFile(firstPath, 'utf8')), updatedAt: '2026-01-01T00:00:00.000Z' }));
  await writeFile(secondPath, JSON.stringify({ ...JSON.parse(await readFile(secondPath, 'utf8')), updatedAt: '2026-01-02T00:00:00.000Z' }));
  assert.deepEqual(await store.query(), ['chat-a', 'chat-z']);
  assert.deepEqual(await store.query({ from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-01-02T00:00:00.000Z') }), ['chat-a', 'chat-z']);
  assert.deepEqual(await store.query({ from: new Date('2026-01-02T00:00:00.000Z') }), ['chat-z']);
  assert.deepEqual(await store.query({ to: new Date('2026-01-01T00:00:00.000Z') }), ['chat-a']);
});

test('query handles a missing directory and rejects an inverted range', async () => {
  const root = join(await mkdtemp(join(tmpdir(), 'llm-session-store-')), 'missing');
  const store = tempFileStore(root);
  assert.deepEqual(await store.query(), []);
  await assert.rejects(
    () => store.query({ from: new Date('2026-01-02'), to: new Date('2026-01-01') }),
    /must not be after/u,
  );
});

test('store rejects malformed or credential-bearing persisted state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-session-store-'));
  const store = tempFileStore(root);
  await store.save({ chatId: 'chat-1', request, history: [] });
  const path = join(root, 'chat-1.json');
  const original = await readFile(path, 'utf8');
  await writeFile(path, '{bad-json');
  await assert.rejects(() => store.load('chat-1'), /valid JSON/u);
  await writeFile(path, original.replace('"request": {', '"request": {"credentials":{"apiKey":"secret"},'));
  await assert.rejects(() => store.load('chat-1'), /invalid|incompatible|credential/u);
  await writeFile(path, original.replace('"request": {', '"request": {"messages":[],'));
  await assert.rejects(() => store.load('chat-1'), /invalid|incompatible/u);
});

test('store rejects malformed embedded tool calls and distinguishes missing sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-session-store-'));
  const store = tempFileStore(root);
  assert.equal(await store.load('missing'), undefined);
  await store.save({ chatId: 'chat-1', request, history: [] });
  const path = join(root, 'chat-1.json');
  const original = JSON.parse(await readFile(path, 'utf8')) as { history: unknown[] };
  original.history = [{ role: 'assistant', content: null, toolCalls: [{ id: 'call-1', name: 'read', arguments: 'not-an-object' }] }];
  await writeFile(path, JSON.stringify(original));
  await assert.rejects(() => store.load('chat-1'), /invalid|incompatible/u);
});

test('factory selects both built-in implementations and supports registration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-session-store-'));
  const persistent = ChatSessionStoreFactory.createChatSessionStore({ type: 'file', rootDirectory: root });
  assert.deepEqual(await persistent.query(), []);
  const registeredType = `test-${process.pid}-${Date.now()}`;
  let receivedRoot: string | undefined;
  ChatSessionStoreFactory.register(registeredType, (config) => {
    receivedRoot = config.rootDirectory;
    return { load: async () => undefined, save: async () => 'registered', query: async () => [] };
  });
  const registered = ChatSessionStoreFactory.createChatSessionStore({ type: registeredType, rootDirectory: root });
  assert.equal(receivedRoot, root);
  assert.equal(await registered.save({ chatId: 'chat-1', request, history: [] }), 'registered');
});

test('factory rejects missing and unknown implementation names', () => {
  assert.throws(() => ChatSessionStoreFactory.createChatSessionStore({ type: '' }), /type is required/u);
  assert.throws(() => ChatSessionStoreFactory.createChatSessionStore({ type: 'missing-session-store' }), /Unknown chat session store implementation/u);
});