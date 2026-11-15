import { complete } from '../dist/index.js';

const sample = 'unified-provider';

try {
  const requests = [];
  const provider = {
    async complete(request) {
      requests.push(request.toolOptions ? 'tool-capable' : 'ordinary');
      if (!request.toolOptions) return { content: 'unified v1 response', toolCalls: [], decision: 'stop' };
      return { decision: 'stop', content: '{"ok":true}', toolCalls: [] };
    },
  };
  const v1 = await complete({
    schema: 'https://schemas.handschuh.dev/llm/request/v1',
    task: 'Use v1 provider transport.',
    systemPrompt: 'Return the provider response.',
  }, { provider });
  const toolCapable = await complete({
    schema: 'https://schemas.handschuh.dev/llm/request/v1',
    task: 'Use tool-capable provider transport.',
    systemPrompt: 'Return the provider response.',
    toolOptions: { tools: [], autoInvoke: false },
  }, { provider });
  const ok = v1.status === 'success'
    && v1.output?.value === 'unified v1 response'
    && toolCapable.status === 'success'
    && JSON.stringify(requests) === JSON.stringify(['ordinary', 'tool-capable']);
  process.stdout.write(`${JSON.stringify({ sample, ok, feature: 'unified-provider', assertions: { v1Status: v1.status, v1Value: v1.output?.value, toolCapableStatus: toolCapable.status, capabilities: requests } })}\n`);
  if (!ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ sample, ok: false, feature: 'unified-provider', assertions: { error: String(error) } })}\n`);
  process.exitCode = 1;
}