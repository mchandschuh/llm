import { complete } from '../dist/index.js';

const sample = 'debug-tool-events';

try {
  const events = [];
  const provider = {
    async complete(request) {
      if (!request.toolOptions) return { content: '', toolCalls: [], decision: 'stop' };
      return (request.toolResults ?? []).length === 0
        ? { decision: 'continue', content: null, toolCalls: [[{ id: 'call-debug', name: 'read_record', arguments: { id: 'record-a' } }]] }
        : { decision: 'stop', content: '{"ok":true}', toolCalls: [] };
    },
  };
  const result = await complete({
    schema: 'https://schemas.handschuh.dev/llm/request/v1',
    task: 'Observe one bounded tool lifecycle.',
    systemPrompt: 'Use the declared tool and return a final response.',
    toolOptions: { tools: [{ name: 'read_record', description: 'Read a record.', inputSchema: JSON.stringify({ type: 'object' }) }], autoInvoke: true },
  }, {
    provider,
    debug: (event) => events.push(event),
    toolInvoker: { invoke: async () => ({ secret: 'do-not-leak', ok: true }) },
  });
  const toolEvents = events.filter((event) => event.event.startsWith('llm.tool.')).map((event) => event.event);
  const expected = ['llm.tool.batch.start', 'llm.tool.call', 'llm.tool.result', 'llm.tool.batch.end'];
  const ok = result.status === 'success'
    && JSON.stringify(toolEvents) === JSON.stringify(expected)
    && !JSON.stringify(events).includes('do-not-leak')
    && JSON.stringify(events).includes('call-debug');
  process.stdout.write(`${JSON.stringify({ sample, ok, feature: 'debug-tool-events', assertions: { status: result.status, toolEvents, sanitized: !JSON.stringify(events).includes('do-not-leak'), correlated: JSON.stringify(events).includes('call-debug') } })}\n`);
  if (!ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ sample, ok: false, feature: 'debug-tool-events', assertions: { error: String(error) } })}\n`);
  process.exitCode = 1;
}