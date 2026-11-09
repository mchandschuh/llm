import type { LlmProvider, ProviderCompletionRequest } from './types.js';
import { boundedMessage, LlmFailure } from './errors.js';

function credential(request: ProviderCompletionRequest): string | undefined {
  return request.credentials?.apiKey ?? request.credentials?.accessToken ?? process.env.OPENROUTER_API_KEY;
}

function contentFromMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) {
    return message.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') return (item as { text: string }).text;
      return '';
    }).join('');
  }
  throw new LlmFailure('PROVIDER_REQUEST_FAILED', 'provider', 'The provider returned no usable completion content.');
}

function userContent(request: ProviderCompletionRequest): string | Array<Record<string, unknown>> {
  const images = request.files.filter((file) => file.encoding === 'base64' && file.type.startsWith('image/'));
  if (images.length === 0) return request.llmPrompt;
  return [
    { type: 'text', text: request.llmPrompt },
    ...images.map((file) => ({
      type: 'image_url',
      image_url: {
        url: `data:${file.type};base64,${file.content}`,
        detail: 'high',
      },
    })),
  ];
}

export class OpenRouterProvider implements LlmProvider {
  async complete(request: ProviderCompletionRequest): Promise<string> {
    const apiKey = credential(request);
    if (!apiKey) throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', 'No in-memory provider credential or OPENROUTER_API_KEY is configured.');
    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: [{ role: 'system', content: request.systemPrompt }, { role: 'user', content: userContent(request) }],
          reasoning: { effort: request.thinking },
        }),
      });
    } catch {
      throw new LlmFailure('PROVIDER_REQUEST_FAILED', 'provider', 'The provider request failed before a usable response was returned.');
    }
    if (!response.ok) throw new LlmFailure('PROVIDER_REQUEST_FAILED', 'provider', `The provider request failed with HTTP ${response.status}.`);
    try {
      const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
      return contentFromMessage(body.choices?.[0]?.message?.content);
    } catch (error) {
      if (error instanceof LlmFailure) throw error;
      throw new LlmFailure('PROVIDER_REQUEST_FAILED', 'provider', boundedMessage('The provider returned an invalid response envelope.'));
    }
  }
}
