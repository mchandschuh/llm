import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatFactory } from '../src/chat.js';
import type {
  DebugEvent,
} from '../src/debug.js';
import type {
  LlmProvider,
  ProviderCompletionRequest,
  ProviderCompletionResponse,
  ToolCall,
  ToolInvoker,
} from '../src/types.js';

const schema = 'https://schemas.handschuh.dev/llm/request/v1' as const;
const taskSchema = { type: 'object', required: ['operation'], additionalProperties: false, properties: { operation: { type: 'string' } } };
const toolDefinition = { name: 'read_record', description: 'Read a record.', inputSchema: JSON.stringify({ type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } }) };

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema,
    task: { operation: 'inspect' },
    taskSchema,
    systemPrompt: 'Use the declared tool when needed.',
    toolOptions: { tools: [toolDefinition], autoInvoke: true, maxRounds: 3, maxCalls: 8 },
    ...overrides,
  };
}

class SequenceProvider implements LlmProvider {
  readonly calls: ProviderCompletionRequest[] = [];
  private index = 0;

  constructor(private readonly responses: readonly (ProviderCompletionResponse | Error)[]) {}

  async complete(requestValue: ProviderCompletionRequest): Promise<ProviderCompletionResponse> {
    this.calls.push({ ...requestValue, messages: requestValue.messages?.map((message) => ({ ...message })) ?? [] });
    const response = this.responses[Math.min(this.index++, this.responses.length - 1)];
    if (response instanceof Error) throw response;
    return response ?? { content: 'done', toolCalls: [], decision: 'stop' };
  }
}

function toolCall(id: string, name = 'read_record'): ToolCall {
  return { id, name, arguments: { id } };
}

function toolResponse(id: string): ProviderCompletionResponse {
  return { content: null, toolCalls: [[toolCall(id)]], decision: 'continue' };
}

function finalResponse(content = 'done'): ProviderCompletionResponse {
  return { content, toolCalls: [], decision: 'stop' };
}

test('chatFactory creates independent sessions and propagates options', async () => {
  const controller = new AbortController();
  const events: DebugEvent[] = [];
  const firstProvider = new SequenceProvider([finalResponse('first')]);
  const secondProvider = new SequenceProvider([finalResponse('second')]);
  const firstInvoker: ToolInvoker = { invoke: async () => ({}) };
  const sessionRequest = request({ toolOptions: { tools: [toolDefinition], autoInvoke: false, maxRounds: 3, maxCalls: 8 } });
  const first = chatFactory.createSession({ request: sessionRequest, provider: firstProvider, toolInvoker: firstInvoker, signal: controller.signal, eventSink: (event) => events.push(event) });
  const second = chatFactory.createSession({ request: sessionRequest, provider: secondProvider });

  await first.sendUserMessage('one');
  await second.sendUserMessage('two');

  assert.notEqual(first.history, second.history);
  assert.equal(firstProvider.calls[0]?.signal, controller.signal);
  assert.equal(first.history.some((message) => message.role === 'assistant' && message.content === 'first'), true);
  assert.equal(second.history.some((message) => message.role === 'assistant' && message.content === 'second'), true);
  assert.equal(events.length > 0, true);
  assert.equal(first.history.some((message) => message.role === 'user' && message.content === 'two'), false);
});

test('session keeps task context separate from ordered provider messages', async () => {
  const provider = new SequenceProvider([finalResponse()]);
  const session = chatFactory.createSession({ request: request(), provider, toolInvoker: { invoke: async () => ({}) } });
  await session.sendUserMessage('hello');

  const call = provider.calls[0]!;
  assert.deepEqual(call.task, { operation: 'inspect' });
  assert.deepEqual(call.taskSchema, taskSchema);
  assert.deepEqual(call.messages.map((message) => message.role), ['system', 'user', 'user']);
  assert.match(call.messages[1]!.role === 'user' ? call.messages[1]!.content : '', /<llmPrompt version="1">/u);
  assert.equal(call.messages[2]!.role, 'user');
  assert.doesNotMatch(call.messages[1]!.role === 'user' ? call.messages[1]!.content : '', /read_record/u);
});

test('session replays two complete assistant/tool rounds and retains the final assistant', async () => {
  const provider = new SequenceProvider([toolResponse('call-round-1'), toolResponse('call-round-2'), finalResponse('rounds complete')]);
  const session = chatFactory.createSession({ request: request(), provider, toolInvoker: { invoke: async (call) => ({ id: call.id }) } });
  const turn = await session.sendUserMessage('start');

  assert.equal(turn.response.status, 'success');
  assert.deepEqual(provider.calls.map((call) => call.messages.map((message) => message.role)), [
    ['system', 'user', 'user'],
    ['system', 'user', 'user', 'assistant', 'tool'],
    ['system', 'user', 'user', 'assistant', 'tool', 'assistant', 'tool'],
  ]);
  assert.equal(provider.calls[1]!.messages[3]!.role === 'assistant' && provider.calls[1]!.messages[3]!.toolCalls[0]?.id, 'call-round-1');
  assert.equal(provider.calls[2]!.messages[5]!.role === 'assistant' && provider.calls[2]!.messages[5]!.toolCalls[0]?.id, 'call-round-2');
  assert.equal(session.history.at(-1)?.role, 'assistant');
  assert.equal(session.history.at(-1)?.content, 'rounds complete');
});

test('a later user turn follows the retained assistant in complete provider history', async () => {
  const provider = new SequenceProvider([finalResponse('first answer'), finalResponse('second answer')]);
  const session = chatFactory.createSession({ request: request({ toolOptions: { tools: [toolDefinition], autoInvoke: false, maxRounds: 3, maxCalls: 8 } }), provider });

  await session.sendUserMessage('first question');
  await session.sendUserMessage('second question');

  assert.deepEqual(provider.calls[1]!.messages.map((message) => message.role), ['system', 'user', 'user', 'assistant', 'user']);
  assert.equal(provider.calls[1]!.messages.at(-2)?.role, 'assistant');
  assert.equal(provider.calls[1]!.messages.at(-2)?.content, 'first answer');
  assert.equal(provider.calls[1]!.messages.at(-1)?.role, 'user');
  assert.equal(provider.calls[1]!.messages.at(-1)?.content, 'second question');
});

test('parallel calls produce one assistant message and one matching tool result per call', async () => {
  const provider = new SequenceProvider([{ content: null, toolCalls: [[toolCall('a'), toolCall('b')]], decision: 'continue' }, finalResponse()]);
  const session = chatFactory.createSession({ request: request(), provider, toolInvoker: { invoke: async (call) => call.id } });
  await session.sendUserMessage('parallel');
  const history = session.history;
  assert.equal(history.filter((message) => message.role === 'assistant' && message.toolCalls.length === 2).length, 1);
  assert.deepEqual(history.filter((message) => message.role === 'tool').map((message) => message.role === 'tool' ? message.toolCallId : ''), ['a', 'b']);
});

test('failed tools append bounded matching error messages without leaking secrets', async () => {
  const provider = new SequenceProvider([toolResponse('failed'), finalResponse()]);
  const session = chatFactory.createSession({ request: request(), provider, toolInvoker: { invoke: async () => { throw new Error(`secret=hidden ${'x'.repeat(600)}`); } } });
  await session.sendUserMessage('fail');
  const result = session.history.find((message) => message.role === 'tool');
  assert.ok(result && result.role === 'tool');
  assert.equal(result.toolCallId, 'failed');
  assert.ok(result.content.length <= 500);
  assert.doesNotMatch(result.content, /secret=hidden/u);
});

test('invalid tool calls do not enter canonical history', async () => {
  const provider = new SequenceProvider([{ content: null, toolCalls: [[toolCall('invalid', 'missing_tool')]], decision: 'continue' }]);
  const session = chatFactory.createSession({ request: request(), provider, toolInvoker: { invoke: async () => ({}) } });
  const turn = await session.sendUserMessage('invalid');
  assert.equal(turn.response.status, 'output_invalid');
  assert.equal(session.history.some((message) => message.role === 'assistant'), false);
  assert.equal(session.history.some((message) => message.role === 'tool'), false);
});

test('blocked user messages do not mutate history while a tool round is active', async () => {
  let release!: () => void;
  let started!: () => void;
  const toolStarted = new Promise<void>((resolve) => { started = resolve; });
  const toolRelease = new Promise<void>((resolve) => { release = resolve; });
  const provider = new SequenceProvider([toolResponse('slow'), finalResponse('complete')]);
  const session = chatFactory.createSession({ request: request(), provider, toolInvoker: { invoke: async () => { started(); await toolRelease; return 'finished'; } } });
  const active = session.sendUserMessage('start');
  await toolStarted;
  const before = session.history;
  const blocked = await session.sendUserMessage('too soon');
  assert.equal(blocked.blocked, true);
  assert.deepEqual(session.history, before);
  release();
  await active;
  assert.equal(session.history.some((message) => message.role === 'user' && message.content === 'too soon'), false);
});

test('caller-enforced non-concurrency rejects direct mutation during an active turn', async () => {
  let release!: () => void;
  let started!: () => void;
  const toolStarted = new Promise<void>((resolve) => { started = resolve; });
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const provider = new SequenceProvider([toolResponse('active'), finalResponse()]);
  const session = chatFactory.createSession({ request: request(), provider, toolInvoker: { invoke: async () => { started(); await pending; return 'done'; } } });
  const active = session.sendUserMessage('active');
  await toolStarted;
  assert.throws(() => session.appendMessage({ role: 'user', content: 'concurrent' }), /mutations must be serialized/u);
  release();
  await active;
});

test('interrupt branches use a stable snapshot and do not nest tools', async () => {
  let release!: () => void;
  let started!: () => void;
  const toolStarted = new Promise<void>((resolve) => { started = resolve; });
  const toolRelease = new Promise<void>((resolve) => { release = resolve; });
  const mainProvider = new SequenceProvider([toolResponse('slow'), finalResponse('main complete')]);
  const provider: LlmProvider = {
    calls: mainProvider.calls,
    async complete(requestValue) {
      if (!requestValue.toolOptions) return finalResponse('interrupt response');
      const response = await mainProvider.complete(requestValue);
      return response;
    },
  };
  const session = chatFactory.createSession({ request: request(), provider, userMessageInterruptsToolRound: true, toolInvoker: { invoke: async () => { started(); await toolRelease; return 'finished'; } } });
  const active = session.sendUserMessage('start');
  await toolStarted;
  const interrupt = await session.sendUserMessage('interrupt');
  assert.equal(interrupt.interrupted, true);
  assert.equal(interrupt.response.output?.value, 'interrupt response');
  assert.equal(session.history.some((message) => message.role === 'user' && message.content === 'interrupt'), false);
  release();
  await active;
  assert.equal(session.history.some((message) => message.role === 'assistant' && message.content === 'main complete'), true);
  assert.equal(mainProvider.calls.some((call) => !call.toolOptions && call.messages.some((message) => message.role === 'assistant')), false);
});

test('provider retries do not duplicate canonical messages and cancellation remains bounded', async () => {
  const provider = new SequenceProvider([new Error('provider down'), finalResponse('retried')]);
  const session = chatFactory.createSession({ request: { ...request({ toolOptions: { tools: [toolDefinition], autoInvoke: false, maxRounds: 3, maxCalls: 8 } }), maxFailedAttempts: 2 }, provider });
  const turn = await session.sendUserMessage('retry');
  assert.equal(turn.response.status, 'success');
  assert.equal(session.history.filter((message) => message.role === 'assistant').length, 1);
  assert.equal(provider.calls.length, 2);

  const controller = new AbortController();
  controller.abort();
  const cancelledProvider = new SequenceProvider([finalResponse()]);
  const cancelled = chatFactory.createSession({ request: request(), provider: cancelledProvider, signal: controller.signal, toolInvoker: { invoke: async () => ({}) } });
  const cancelledTurn = await cancelled.sendUserMessage('cancel');
  assert.equal(cancelledTurn.response.status, 'cancelled');
  assert.equal(cancelledProvider.calls.length, 0);
  assert.equal(cancelled.history.some((message) => message.role === 'assistant'), false);
});