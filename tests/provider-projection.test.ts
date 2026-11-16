import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenRouterHttpProjection } from '../src/openrouter-projection.js';
import { OpenRouterProvider } from '../src/provider.js';
import type { LlmChatMessage, ProviderCompletionRequest } from '../src/types.js';

function request(messages: readonly LlmChatMessage[]): ProviderCompletionRequest {
  return {
    provider: 'openrouter',
    model: 'openai/gpt-5.6-luna',
    thinking: 'medium',
    systemPrompt: 'System instruction.',
    llmPrompt: '<llmPrompt version="1" />',
    task: { operation: 'inspect' },
    taskSchema: { type: 'object' },
    messages,
    files: [{ name: 'image', path: 'image.png', type: 'image/png', purpose: 'Image', encoding: 'base64', content: 'AQI=', resolvedPath: 'image.png' }],
    credentials: { apiKey: 'do-not-serialize-me' },
    toolOptions: {
      tools: [{ name: 'read_record', description: 'Read a record.', inputSchema: '{"type":"object","properties":{"recordId":{"type":"string"}}}' }],
      autoInvoke: true,
      maxRounds: 3,
      maxCalls: 8,
    },
  };
}

test('OpenRouterHttpProjection maps complete request-3 history and excludes credentials', () => {
  const body = new OpenRouterHttpProjection().project(request([
    { role: 'system', content: 'System instruction.' },
    { role: 'user', content: '<llmPrompt version="1" />' },
    { role: 'assistant', content: null, toolCalls: [{ id: 'call-round-1', name: 'read_record', arguments: { recordId: 'A' } }] },
    { role: 'tool', toolCallId: 'call-round-1', content: '{"recordId":"A","found":true}' },
    { role: 'assistant', content: null, toolCalls: [{ id: 'call-round-2', name: 'read_record', arguments: { recordId: 'B' } }] },
    { role: 'tool', toolCallId: 'call-round-2', content: '{"recordId":"B","found":true}' },
  ]));

  assert.deepEqual(body.messages.map((message) => message.role), ['system', 'user', 'assistant', 'tool', 'assistant', 'tool']);
  assert.deepEqual(body.messages.filter((message) => message.role === 'assistant').map((message) => message.tool_calls?.[0]?.id), ['call-round-1', 'call-round-2']);
  assert.deepEqual(body.messages.filter((message) => message.role === 'tool').map((message) => message.tool_call_id), ['call-round-1', 'call-round-2']);
  assert.equal(body.messages[2]!.tool_calls?.[0]?.function.arguments, '{"recordId":"A"}');
  assert.equal(body.messages[4]!.tool_calls?.[0]?.function.arguments, '{"recordId":"B"}');
  assert.equal(body.reasoning.effort, 'medium');
  assert.equal(body.tools?.[0]?.function.name, 'read_record');
  assert.equal(JSON.stringify(body).includes('do-not-serialize-me'), false);
  assert.deepEqual(body.messages[1]!.content, [
    { type: 'text', text: '<llmPrompt version="1" />' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AQI=', detail: 'high' } },
  ]);
});

test('OpenRouterProvider serializes the projection and keeps credentials in authorization only', async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | undefined;
  let authorization: string | undefined;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    authorization = new Headers(init?.headers).get('authorization') ?? undefined;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'done' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await new OpenRouterProvider().complete(request([{ role: 'system', content: 'System instruction.' }, { role: 'user', content: '<llmPrompt version="1" />' }]));
    assert.equal(result.decision, 'stop');
    assert.equal(authorization, 'Bearer do-not-serialize-me');
    assert.equal(JSON.stringify(body).includes('do-not-serialize-me'), false);
    assert.deepEqual((body?.messages as Array<{ role: string }>).map((message) => message.role), ['system', 'user']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
