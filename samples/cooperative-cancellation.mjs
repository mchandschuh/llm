import { completeV2 } from '../dist/index.js';

const sample = 'cooperative-cancellation';

try {
  const controller = new AbortController();
  controller.abort();
  let providerCalls = 0;
  let toolCalls = 0;
  const result = await completeV2({
    schema: 'https://schemas.handschuh.dev/llm/request/v2',
    task: 'Cancel before work begins.',
    systemPrompt: 'This sample should not invoke the provider.',
    tools: [{ name: 'read_record', description: 'Read a record.', inputSchema: JSON.stringify({ type: 'object' }) }],
    autoInvokeTools: true,
  }, {
    signal: controller.signal,
    provider: {
      async complete() {
        providerCalls += 1;
        return { decision: 'stop', content: 'unexpected', toolCalls: [] };
      },
    },
    toolInvoker: { invoke: async () => { toolCalls += 1; return {}; } },
  });
  const ok = result.status === 'cancelled'
    && result.errors[0]?.code === 'CANCELLED'
    && providerCalls === 0
    && toolCalls === 0
    && result.toolResults.length === 0;
  process.stdout.write(`${JSON.stringify({ sample, ok, feature: 'cooperative-cancellation', assertions: { status: result.status, errorCode: result.errors[0]?.code, providerCalls, toolCalls, preservedResults: result.toolResults.length } })}\n`);
  if (!ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ sample, ok: false, feature: 'cooperative-cancellation', assertions: { error: String(error) } })}\n`);
  process.exitCode = 1;
}