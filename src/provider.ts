import type { LlmProvider, ProviderCompletionRequest, ProviderCompletionRequestV2, ProviderCompletionResponse, ToolCall, ToolCalls, ToolDefinition } from './types.js';
import { boundedMessage, LlmFailure } from './errors.js';

function credential(request: ProviderCompletionRequest | ProviderCompletionRequestV2): string | undefined {
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

function userContent(request: ProviderCompletionRequest | ProviderCompletionRequestV2): string | Array<Record<string, unknown>> {
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

function toolParameters(tool: ToolDefinition): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(tool.inputSchema); } catch { throw new LlmFailure('TOOL_SCHEMA_INVALID', 'configuration', `Tool '${tool.name}' inputSchema must be valid JSON.`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new LlmFailure('TOOL_SCHEMA_INVALID', 'configuration', `Tool '${tool.name}' inputSchema must be a JSON Schema object.`);
  return parsed as Record<string, unknown>;
}

function toolMessages(request: ProviderCompletionRequestV2): Array<Record<string, unknown>> {
  return request.toolResults.map((result) => ({
    role: 'tool',
    tool_call_id: result.callId,
    content: JSON.stringify(result.status === 'success' ? result.value : { error: result.error }),
  }));
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
  async complete(request: ProviderCompletionRequestV2): Promise<ProviderCompletionResponse>;

  async complete(request: ProviderCompletionRequest): Promise<string>;

  async complete(request: ProviderCompletionRequest | ProviderCompletionRequestV2): Promise<string | ProviderCompletionResponse> {
    if (request.protocol === 'v2') return this.completeV2Internal(request);
    return this.completeV1Internal(request);
  }

  private async completeV1Internal(request: ProviderCompletionRequest): Promise<string> {
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

  private async completeV2Internal(request: ProviderCompletionRequestV2): Promise<ProviderCompletionResponse> {
    const apiKey = credential(request);
    if (!apiKey) throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', 'No in-memory provider credential or OPENROUTER_API_KEY is configured.');
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: userContent(request) },
      ...toolMessages(request),
    ];
    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      reasoning: { effort: request.thinking },
      ...(request.tools.length > 0 ? { tools: request.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: toolParameters(tool) } })) } : {}),
    };
    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
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
