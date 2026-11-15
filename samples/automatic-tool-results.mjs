import { complete } from '../dist/index.js';

  const sample = 'automatic-tool-results';

try {
  const calls = [];
  let providerTurn = 0;
  const result = await complete({
    schema: 'https://schemas.handschuh.dev/llm/request/v1',
    task: 'Read two records and summarize the results.',
    systemPrompt: 'Use the declared tool, then return the final answer.',
    toolOptions: { tools: [{ name: 'read_record', description: 'Read a record.', inputSchema: JSON.stringify({ type: 'object', properties: { id: { type: 'string' } } }) }], autoInvoke: true },
  }, {
    provider: {
      async complete(request) {
        if (!request.toolOptions) return { content: '', toolCalls: [], decision: 'stop' };
        providerTurn += 1;
        if (providerTurn === 1) return { decision: 'continue', content: null, toolCalls: [[
          { id: 'call-auto-a', name: 'read_record', arguments: { id: 'record-a' } },
          { id: 'call-auto-b', name: 'read_record', arguments: { id: 'record-b' } },
        ]] };
        return { decision: 'stop', content: 'records complete', toolCalls: [] };
      },
    },
    toolInvoker: {
      async invoke(call) {
        calls.push(call.id);
        return { id: call.arguments.id, ok: true };
      },
    },
  });
  const resultIds = result.toolResults.map((item) => item.callId);
  const ok = result.status === 'success'
    && result.toolRounds === 1
    && result.toolResults.length === 2
    && JSON.stringify(resultIds) === JSON.stringify(['call-auto-a', 'call-auto-b'])
    && JSON.stringify(calls) === JSON.stringify(['call-auto-a', 'call-auto-b']);
  process.stdout.write(`${JSON.stringify({ sample, ok, feature: 'tool-automatic-tool-results', assertions: { status: result.status, toolRounds: result.toolRounds, providerTurn, invocations: calls, resultIds } })}\n`);
  if (!ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ sample, ok: false, feature: 'tool-automatic-tool-results', assertions: { error: String(error) } })}\n`);
  process.exitCode = 1;
}