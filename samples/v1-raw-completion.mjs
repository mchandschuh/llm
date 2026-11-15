import { complete } from '../dist/index.js';

const sample = 'v1-raw-completion';

try {
  const result = await complete({
    schema: 'https://schemas.handschuh.dev/llm/request/v1',
    task: 'Return a concise sample status.',
    systemPrompt: 'Return the injected provider text unchanged.',
  }, {
    provider: {
      async complete() {
        return { content: 'v1 raw sample response', toolCalls: [], decision: 'stop' };
      },
    },
  });
  const ok = result.status === 'success'
    && result.output?.$type === 'string'
    && result.output.value === 'v1 raw sample response';
  process.stdout.write(`${JSON.stringify({ sample, ok, feature: 'v1-raw-completion', assertions: { status: result.status, value: result.output?.value } })}\n`);
  if (!ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ sample, ok: false, feature: 'v1-raw-completion', assertions: { error: String(error) } })}\n`);
  process.exitCode = 1;
}