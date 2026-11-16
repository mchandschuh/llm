import type { LlmProvider, ProviderCompletionRequest, ProviderCompletionResponse, ToolCall, ToolCalls } from './types.js';
import { boundedMessage, LlmFailure } from './errors.js';
import { OpenRouterHttpProjection, type OpenRouterChatRequest } from './openrouter-projection.js';

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

function normalizedToolCalls(message: unknown): ToolCall[] {
  if (!message || typeof message !== 'object') throw new LlmFailure('TOOL_CALL_INVALID', 'provider', 'The provider returned an invalid tool-call message.');
  const calls = (message as { tool_calls?: unknown }).tool_calls;
  if (calls === undefined) return [];
  if (!Array.isArray(calls)) throw new LlmFailure('TOOL_CALL_INVALID', 'provider', 'The provider returned an invalid tool-call collection.');
  return calls.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new LlmFailure('TOOL_CALL_INVALID', 'provider', 'The provider returned an invalid tool call.');
    const value = entry as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    if (typeof value.id !== 'string' || typeof value.function?.name !== 'string' || typeof value.function.arguments !== 'string') {
      throw new LlmFailure('TOOL_CALL_INVALID', 'provider', 'The provider returned an incomplete tool call.');
    }
    let argumentsValue: unknown;
    try { argumentsValue = JSON.parse(value.function.arguments); } catch { throw new LlmFailure('TOOL_CALL_INVALID', 'provider', 'The provider returned invalid JSON tool arguments.'); }
    if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) throw new LlmFailure('TOOL_CALL_INVALID', 'provider', 'Tool arguments must be a JSON object.');
    return { id: value.id, name: value.function.name, arguments: argumentsValue as Record<string, unknown> };
  });
}

function contentOrNull(message: unknown): string | null {
  if (!message || typeof message !== 'object') throw new LlmFailure('PROVIDER_REQUEST_FAILED', 'provider', 'The provider returned no usable completion message.');
  const content = (message as { content?: unknown }).content;
  if (content === null || content === undefined) return null;
  return contentFromMessage(content);
}

function completionDecision(finishReason: unknown, toolCalls: ToolCalls): 'continue' | 'stop' {
  if (finishReason === 'tool_calls') {
    if (toolCalls.length === 0) throw new LlmFailure('PROVIDER_REQUEST_FAILED', 'provider', 'The provider selected tool-call continuation without returning tool calls.');
    return 'continue';
  }
  if (finishReason === 'stop') {
    if (toolCalls.length > 0) throw new LlmFailure('PROVIDER_REQUEST_FAILED', 'provider', 'The provider selected final completion while returning tool calls.');
    return 'stop';
  }
  throw new LlmFailure('PROVIDER_REQUEST_FAILED', 'provider', 'The provider returned a missing or unsupported completion finish reason.');
}

export class OpenRouterProvider implements LlmProvider {
  private readonly projection = new OpenRouterHttpProjection();

  async complete(request: ProviderCompletionRequest): Promise<ProviderCompletionResponse> {
    if (request.toolOptions) return this.completeWithTools(request);
    const content = await this.completeText(request);
    return { content, toolCalls: [], decision: 'stop' };
  }

  private async completeText(request: ProviderCompletionRequest): Promise<string> {
    const apiKey = credential(request);
    if (!apiKey) throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', 'No in-memory provider credential or OPENROUTER_API_KEY is configured.');
    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        signal: request.signal,
        body: JSON.stringify(this.projection.project(request)),
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

  private async completeWithTools(request: ProviderCompletionRequest): Promise<ProviderCompletionResponse> {
    const apiKey = credential(request);
    if (!apiKey) throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', 'No in-memory provider credential or OPENROUTER_API_KEY is configured.');
    const body: OpenRouterChatRequest = this.projection.project(request);
    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        signal: request.signal,
        body: JSON.stringify(body),
      });
    } catch {
      throw new LlmFailure('PROVIDER_REQUEST_FAILED', 'provider', 'The provider request failed before a usable response was returned.');
    }
    if (!response.ok) throw new LlmFailure('PROVIDER_REQUEST_FAILED', 'provider', `The provider request failed with HTTP ${response.status}.`);
    try {
      const bodyValue = await response.json() as { choices?: Array<{ finish_reason?: unknown; message?: unknown }> };
      const message = bodyValue.choices?.[0]?.message;
      const toolCalls = normalizedToolCalls(message);
      const content = contentOrNull(message);
      const calls = toolCalls.length > 0 ? [toolCalls] : [];
      return { content, toolCalls: calls, decision: completionDecision(bodyValue.choices?.[0]?.finish_reason, calls) };
    } catch (error) {
      if (error instanceof LlmFailure) throw error;
      throw new LlmFailure('PROVIDER_REQUEST_FAILED', 'provider', boundedMessage('The provider returned an invalid response envelope.'));
    }
  }
}
