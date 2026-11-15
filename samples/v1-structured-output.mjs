import { complete } from '../dist/index.js';

const sample = 'v1-structured-output';

try {
  const result = await complete({
    schema: 'https://schemas.handschuh.dev/llm/request/v1',
    task: { operation: 'classify', value: 'sample' },
    systemPrompt: 'Return JSON matching outputSchema.',
    outputSchema: {
      $id: 'https://example.test/sample-output',
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'label'],
      properties: { ok: { type: 'boolean' }, label: { type: 'string' } },
    },
  }, {
    provider: {
      async complete() {
        return { content: JSON.stringify({ ok: true, label: 'structured' }), toolCalls: [], decision: 'stop' };
      },
    },
  });
  const value = result.output?.value;
  const ok = result.status === 'success'
    && result.output?.$type === 'object'
    && value?.ok === true
    && value?.label === 'structured';
  process.stdout.write(`${JSON.stringify({ sample, ok, feature: 'v1-structured-output', assertions: { status: result.status, type: result.output?.$type, value } })}\n`);
  if (!ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ sample, ok: false, feature: 'v1-structured-output', assertions: { error: String(error) } })}\n`);
  process.exitCode = 1;
}