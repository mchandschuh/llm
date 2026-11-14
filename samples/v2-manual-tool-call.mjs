import { completeV2 } from '../dist/index.js';

const sample = 'v2-manual-tool-call';

try {
  let invocations = 0;
  const result = await completeV2({
    schema: 'https://schemas.handschuh.dev/llm/request/v2',
    task: 'Read one record after approval.',
    systemPrompt: 'Request the declared tool and wait for the caller to execute it.',
    tools: [{ name: 'read_record', description: 'Read a record.', inputSchema: JSON.stringify({ type: 'object', properties: { id: { type: 'string' } } }) }],
    autoInvokeTools: false,
  }, {
    provider: {
      async complete(request) {
        if (request.protocol === 'v1') return '';
        return { decision: 'continue', content: null, toolCalls: [[{ id: 'call-manual', name: 'read_record', arguments: { id: 'record-a' } }]] };
      },
    },
    toolInvoker: { invoke: async () => { invocations += 1; return {}; } },
  });
  const calls = result.output?.value?.tool_calls;
  const ok = result.status === 'tool_calls_pending'
    && result.toolCalls === 1
    && Array.isArray(calls)
    && calls[0]?.[0]?.id === 'call-manual'
    && invocations === 0;
  process.stdout.write(`${JSON.stringify({ sample, ok, feature: 'v2-manual-tool-call', assertions: { status: result.status, toolCalls: result.toolCalls, callId: calls?.[0]?.[0]?.id, invocations } })}\n`);
  if (!ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ sample, ok: false, feature: 'v2-manual-tool-call', assertions: { error: String(error) } })}\n`);
  process.exitCode = 1;
}