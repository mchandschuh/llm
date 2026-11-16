import { chatFactory } from '../dist/index.js';

const sample = 'chat-conversation';

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

try {
  const calls = [];
  const provider = {
    async complete(request) {
      calls.push(request.messages.map((message) => message.role));
      return {
        content: calls.length === 1 ? 'The first answer.' : 'The second answer sees the first turn.',
        toolCalls: [],
        decision: 'stop',
      };
    },
  };
  const session = chatFactory.createSession({
    request: {
      schema: 'https://schemas.handschuh.dev/llm/request/v1',
      task: { operation: 'ordinary-chat' },
      systemPrompt: 'Answer each user message briefly.',
    },
    provider,
  });

  const first = await session.sendUserMessage('What is the first answer?');
  const second = await session.sendUserMessage('What did you answer before?');
  const ok = first.response.status === 'success'
    && second.response.status === 'success'
    && second.response.output?.value === 'The second answer sees the first turn.'
    && calls.length === 2
    && JSON.stringify(calls[1]) === JSON.stringify(['system', 'user', 'user', 'assistant', 'user'])
    && session.history.at(-1)?.role === 'assistant';
  emit({
    sample,
    ok,
    feature: 'ordinary-chat-history',
    assertions: {
      firstStatus: first.response.status,
      secondStatus: second.response.status,
      providerRequestRoles: calls,
      finalHistoryRole: session.history.at(-1)?.role,
    },
  });
  if (!ok) process.exitCode = 1;
} catch (error) {
  emit({ sample, ok: false, feature: 'ordinary-chat-history', assertions: { error: String(error) } });
  process.exitCode = 1;
}