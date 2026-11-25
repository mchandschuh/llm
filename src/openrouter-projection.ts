import { LlmFailure } from './errors.js';
import type { LlmChatMessage, LlmAssistantMessage, ProviderCompletionRequest, ToolDefinition } from './types.js';

export interface OpenRouterFunctionTool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export interface OpenRouterMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: unknown;
  readonly tool_calls?: readonly {
    readonly id: string;
    readonly type: 'function';
    readonly function: {
      readonly name: string;
      readonly arguments: string;
    };
  }[];
  readonly tool_call_id?: string;
}

export interface OpenRouterChatRequest {
  readonly model: string;
  readonly messages: readonly OpenRouterMessage[];
  readonly reasoning: {
    readonly effort: ProviderCompletionRequest['thinking'];
  };
  readonly tools?: readonly OpenRouterFunctionTool[];
}

function toolParameters(tool: ToolDefinition): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(tool.inputSchema);
  } catch {
    throw new LlmFailure('TOOL_SCHEMA_INVALID', 'configuration', `Tool '${tool.name}' inputSchema must be valid JSON.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LlmFailure('TOOL_SCHEMA_INVALID', 'configuration', `Tool '${tool.name}' inputSchema must be a JSON Schema object.`);
  }
  return parsed as Record<string, unknown>;
}

function imageParts(request: ProviderCompletionRequest): Array<Record<string, unknown>> {
  return request.files
    .filter((file) => file.encoding === 'base64' && file.type.startsWith('image/'))
    .map((file) => ({
      type: 'image_url',
      image_url: {
        url: `data:${file.type};base64,${file.content}`,
        detail: 'high',
      },
    }));
}

function initialUserContent(request: ProviderCompletionRequest): string | Array<Record<string, unknown>> {
  const images = imageParts(request);
  if (images.length === 0) return request.llmPrompt;
  return [{ type: 'text', text: request.llmPrompt }, ...images];
}

function projectMessage(message: LlmChatMessage, request: ProviderCompletionRequest, isInitialUserMessage: boolean): OpenRouterMessage {
  if (message.role === 'system') return { role: 'system', content: message.content };
  if (message.role === 'user') {
    const content = isInitialUserMessage ? initialUserContent(request) : message.content;
    return { role: 'user', content };
  }
  if (message.role === 'tool') return { role: 'tool', content: message.content, tool_call_id: message.toolCallId };
  const assistant: LlmAssistantMessage = message;
  return {
    role: 'assistant',
    content: assistant.content,
    tool_calls: assistant.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    })),
  };
}

function legacyMessages(request: ProviderCompletionRequest): OpenRouterMessage[] {
  return [
    ...(request.systemPrompt !== undefined ? [{ role: 'system' as const, content: request.systemPrompt }] : []),
    { role: 'user', content: initialUserContent(request) },
    ...(request.toolResults ?? []).map((result) => ({
      role: 'tool' as const,
      content: JSON.stringify(result.status === 'success' ? result.value : { error: result.error }),
      tool_call_id: result.callId,
    })),
  ];
}

function projectTools(request: ProviderCompletionRequest): readonly OpenRouterFunctionTool[] | undefined {
  const tools = request.toolOptions?.tools ?? [];
  if (tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toolParameters(tool),
    },
  }));
}

export class OpenRouterHttpProjection {
  project(request: ProviderCompletionRequest): OpenRouterChatRequest {
    const sourceMessages = request.messages ?? [];
    const messages = sourceMessages.length > 0
      ? sourceMessages.map((message, index) => projectMessage(message, request, index === sourceMessages.findIndex((candidate) => candidate.role === 'user')))
      : legacyMessages(request);
    const tools = projectTools(request);
    return {
      model: request.model,
      messages,
      reasoning: { effort: request.thinking },
      ...(tools ? { tools } : {}),
    };
  }
}