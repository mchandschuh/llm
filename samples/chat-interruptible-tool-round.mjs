import { chatFactory } from '../dist/index.js';

const sample = 'chat-interruptible-tool-round';

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

try {
  let releaseTool;
  let toolStarted;
  const started = new Promise((resolve) => { toolStarted = resolve; });
  const release = new Promise((resolve) => { releaseTool = resolve; });
  const events = [];
  const mainRequests = [];
  const provider = {
    async complete(request) {
      if (!request.toolOptions) {
        return { content: 'Interrupt response while the tool remains pending.', toolCalls: [], decision: 'stop' };
      }
      mainRequests.push(request.messages.map((message) => message.role));
      if (mainRequests.length === 1) {
        return {
          content: null,
          toolCalls: [[{ id: 'call-long-tool', name: 'long_tool', arguments: { work: 'sample' } }]],
          decision: 'continue',
        };
      }
      return { content: 'Main tool round completed.', toolCalls: [], decision: 'stop' };
    },
  };
  const session = chatFactory.createSession({
    request: {
      schema: 'https://schemas.handschuh.dev/llm/request/v1',
      task: 'Demonstrate an interruptible tool round.',
      systemPrompt: 'Use the long tool, then finish the main turn.',
      toolOptions: {
        tools: [{ name: 'long_tool', description: 'A controlled long-running tool.', inputSchema: '{"type":"object"}' }],
        autoInvoke: true,
        maxRounds: 2,
        maxCalls: 2,
      },
    },
    provider,
    userMessageInterruptsToolRound: true,
    eventSink: (event) => events.push(event.event),
    toolInvoker: {
      async invoke() {
        toolStarted();
        await release;
        return { completed: true };
      },
    },
  });

  const mainTurn = session.sendUserMessage('Start the long-running work.');
  await started;
  const interrupt = await session.sendUserMessage('Can I get an update while it runs?');
  const historyDuringTool = session.history;
  releaseTool();
  const completed = await mainTurn;
  const ok = interrupt.interrupted === true
    && interrupt.response.status === 'success'
    && interrupt.response.output?.value === 'Interrupt response while the tool remains pending.'
    && completed.response.status === 'success'
    && historyDuringTool.some((message) => message.role === 'user' && message.content === 'Start the long-running work.')
    && !historyDuringTool.some((message) => message.role === 'user' && message.content === 'Can I get an update while it runs?')
    && events.includes('llm.tool.call')
    && events.includes('llm.tool.result');
  emit({
    sample,
    ok,
    feature: 'interruptible-tool-round',
    assertions: {
      interrupted: interrupt.interrupted,
      interruptStatus: interrupt.response.status,
      mainStatus: completed.response.status,
      interruptHistoryMutation: historyDuringTool.some((message) => message.role === 'user' && message.content === 'Can I get an update while it runs?'),
      lifecycleEvents: events,
      mainRequestRoles: mainRequests,
    },
  });
  if (!ok) process.exitCode = 1;
} catch (error) {
  emit({ sample, ok: false, feature: 'interruptible-tool-round', assertions: { error: String(error) } });
  process.exitCode = 1;
}