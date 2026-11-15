import { OpenRouterProvider } from '../dist/index.js';

const sample = 'provider-finish-reason';

try {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'finished by model', tool_calls: [] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await new OpenRouterProvider().complete({
      provider: 'openrouter',
      model: 'openai/gpt-5.6-luna',
      thinking: 'low',
      systemPrompt: 'Return a final response.',
      llmPrompt: '<llmPrompt />',
      files: [],
      credentials: { apiKey: 'sample-key' },
      toolOptions: { tools: [{ name: 'unused', description: 'Unused test tool.', inputSchema: '{"type":"object"}' }] },
      toolResults: [],
    });
    const ok = result.decision === 'stop' && result.content === 'finished by model' && result.toolCalls.length === 0;
    process.stdout.write(`${JSON.stringify({ sample, ok, feature: 'provider-finish-reason', assertions: { decision: result.decision, content: result.content, toolCalls: result.toolCalls.length } })}\n`);
    if (!ok) process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
  }
} catch (error) {
  process.stdout.write(`${JSON.stringify({ sample, ok: false, feature: 'provider-finish-reason', assertions: { error: String(error) } })}\n`);
  process.exitCode = 1;
}