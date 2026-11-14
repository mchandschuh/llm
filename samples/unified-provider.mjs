import { complete, completeV2 } from '../dist/index.js';

const sample = 'unified-provider';

try {
  const requests = [];
  const provider = {
    async complete(request) {
      requests.push(request.protocol);
      if (request.protocol === 'v1') return 'unified v1 response';
      return { decision: 'stop', content: '{"ok":true}', toolCalls: [] };
    },
  };
  const v1 = await complete({
    schema: 'https://schemas.handschuh.dev/llm/request/v1',
    task: 'Use v1 provider transport.',
    systemPrompt: 'Return the provider response.',
  }, { provider });
  const v2 = await completeV2({
    schema: 'https://schemas.handschuh.dev/llm/request/v2',
    task: 'Use v2 provider transport.',
    systemPrompt: 'Return the provider response.',
    tools: [],
    autoInvokeTools: false,
  }, { provider });
  const ok = v1.status === 'success'
    && v1.output?.value === 'unified v1 response'
    && v2.status === 'success'
    && JSON.stringify(requests) === JSON.stringify(['v1', 'v2']);
  process.stdout.write(`${JSON.stringify({ sample, ok, feature: 'unified-provider', assertions: { v1Status: v1.status, v1Value: v1.output?.value, v2Status: v2.status, protocols: requests } })}\n`);
  if (!ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ sample, ok: false, feature: 'unified-provider', assertions: { error: String(error) } })}\n`);
  process.exitCode = 1;
}