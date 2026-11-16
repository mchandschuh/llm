import { chatFactory } from '../dist/index.js';

const sample = 'chat-blocked-tool-round';

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

try {
  let toolStarted;
  const started = new Promise((resolve) => { toolStarted = resolve; });
  let providerTurns = 0;
  const provider = {
    async complete(request) {
      providerTurns += 1;
      if (providerTurns === 1) {
        return {
          content: null,
          toolCalls: [[{ id: 'call-three-second-tool', name: 'three_second_tool', arguments: {} }]],
          decision: 'continue',
        };
      }
      return { content: 'The blocked round completed.', toolCalls: [], decision: 'stop' };
    },
  };
  const session = chatFactory.createSession({
    request: {
      schema: 'https://schemas.handschuh.dev/llm/request/v1',
      task: 'Demonstrate the default blocked user-message policy.',
      systemPrompt: 'Run the bounded tool before finishing.',
      toolOptions: {
        tools: [{ name: 'three_second_tool', description: 'A bounded approximately three-second tool.', inputSchema: '{"type":"object"}' }],
        autoInvoke: true,
        maxRounds: 2,
        maxCalls: 2,
      },
    },
    provider,
    toolInvoker: {
      async invoke() {
        toolStarted();
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return { completed: true };
      },
    },
  });

  const startedAt = Date.now();
  const mainTurn = session.sendUserMessage('Start the bounded long-running tool.');
  await started;
  const blocked = await session.sendUserMessage('This must wait until the tool completes.');
  const blockedElapsedMs = Date.now() - startedAt;
  const completed = await mainTurn;
  const ok = blocked.blocked === true
    && blocked.response.status === 'tool_calls_pending'
    && blockedElapsedMs < 1500
    && !session.history.some((message) => message.role === 'user' && message.content === 'This must wait until the tool completes.')
    && completed.response.status === 'success';
  emit({
    sample,
    ok,
    feature: 'blocked-tool-round',
    assertions: {
      blocked: blocked.blocked,
      blockedStatus: blocked.response.status,
      blockedElapsedMs,
      providerTurns,
      processedEarly: session.history.some((message) => message.role === 'user' && message.content === 'This must wait until the tool completes.'),
      completedStatus: completed.response.status,
    },
  });
  if (!ok) process.exitCode = 1;
} catch (error) {
  emit({ sample, ok: false, feature: 'blocked-tool-round', assertions: { error: String(error) } });
  process.exitCode = 1;
}