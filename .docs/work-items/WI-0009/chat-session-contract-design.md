# WI-0009 Chat Session Contract Design

## Status and evidence boundary

This document is the completed design output `A-001` for `OUT-001`. It defines
the public TypeScript contract and ownership boundary for the later implementation
task. It does not claim that the source files or runtime behavior already exist.

## Public factory boundary

The public package should export a factory-shaped `LlmChatProvider` value:

```ts
export interface LlmChatProvider {
  createSession(options: ChatFactoryCreateSessionOptions): LlmChatSession;
}

export const chatFactory: LlmChatProvider;
```

`chatFactory.createSession(...)` creates one independent `LlmChatSession`. The
factory value is not the mutable conversation. Each session owns its initial
request context, message history, signal/event options, provider dependency, and
tool invocation boundary.

## Session options

The implementation should define the following public options. Names should use
the repository's existing lowerCamelCase TypeScript convention.

```ts
export interface ChatFactoryCreateSessionOptions {
  readonly provider?: LlmProvider;
  readonly toolInvoker?: ToolInvoker;
  readonly signal?: AbortSignal;
  readonly eventSink?: DebugSink;
  readonly userMessageInterruptsToolRound?: boolean;
  readonly configurationRoot?: string;
}
```

`eventSink` is the requested EventSink concept and is compatible with the
repository's `DebugSink`/`DebugEvent` contract. The default for
`userMessageInterruptsToolRound` is `false`. Provider pass-through options must
be explicit and must not duplicate credentials or create a second error vocabulary.

## Provider-neutral messages

The design introduces one ordered provider-neutral message union. It must retain
the information needed to project valid OpenRouter Chat Completions messages.

```ts
export type LlmChatMessage =
  | LlmSystemMessage
  | LlmUserMessage
  | LlmAssistantMessage
  | LlmToolMessage;

export interface LlmSystemMessage {
  readonly role: 'system';
  readonly content: string;
}

export interface LlmUserMessage {
  readonly role: 'user';
  readonly content: string;
}

export interface LlmAssistantMessage {
  readonly role: 'assistant';
  readonly content: string | null;
  readonly toolCalls: readonly ToolCall[];
}

export interface LlmToolMessage {
  readonly role: 'tool';
  readonly toolCallId: string;
  readonly content: string;
}
```

Assistant tool-call messages must be preserved, not reconstructed from tool
results. A tool result is valid only when its `toolCallId` matches a tool call in
the immediately preceding assistant message. One assistant message may contain
multiple calls; one tool message is appended per call.

## Initial request and provider request separation

The public `LlmRequest` retains the initial task context separately from chat
messages:

```ts
export interface LlmRequest {
  readonly schema: typeof REQUEST_SCHEMA;
  readonly task: TaskValue;
  readonly taskSchema?: InlineJsonSchema;
  readonly systemPrompt: string;
  readonly files?: readonly ReferenceFile[];
  readonly outputSchema?: InlineJsonSchema;
  readonly messages?: readonly LlmChatMessage[];
  readonly toolOptions?: ToolOptions;
}
```

The session creates the initial system/user context from `systemPrompt`, `task`,
`taskSchema`, files, and `outputSchema`. Explicit `messages` are subsequent
conversation messages or a caller-provided continuation, subject to history
validation. Tool results are never embedded into the initial XML prompt.

The raw provider boundary carries both the context and the canonical history:

```ts
export interface ProviderCompletionRequest {
  readonly provider: string;
  readonly model: string;
  readonly thinking: Thinking;
  readonly task: TaskValue;
  readonly taskSchema?: InlineJsonSchema;
  readonly systemPrompt: string;
  readonly llmPrompt: string;
  readonly messages: readonly LlmChatMessage[];
  readonly files: readonly NormalizedReferenceFile[];
  readonly credentials?: Credentials;
  readonly toolOptions?: NormalizedToolOptions;
  readonly signal?: AbortSignal;
}
```

`messages` is the only cross-round conversation source sent to the provider.
`toolResults` is not a replacement for history; it remains a reporting shape on
the public response where needed. The provider adapter must not maintain hidden
session state.

## Session API

The implementation handoff should expose operations equivalent to:

```ts
export interface LlmChatSession {
  // history doesn't belong on the chat session interface as a field
  //readonly history: readonly LlmChatMessage[];

  sendUserMessage(message: string): Promise<LlmChatTurn>;
  complete(): Promise<LlmChatTurn>;
  appendMessage(message: LlmChatMessage): void;
}
```

The exact method names may be refined during implementation, but the following
semantic requirements are fixed:

1. A session has one immutable initial context and one append-only canonical
   history.
2. Each assistant response is appended before the next public turn is accepted.
3. Each assistant tool-call message is appended before any matching tool result.
4. Each tool result is appended exactly once.
5. A later provider request receives all prior system, user, assistant, and tool
   messages in order.
6. A final assistant response is retained before a subsequent user message.
7. Session callers must serialize public mutations and turns. The session does
   not add a mutex, queue, checkpoint, or persistence mechanism.

## Error and cancellation boundary

Use the existing `LlmFailure`, `LlmError`, `ErrorCode`, and `ErrorPhase`
vocabulary. Do not add a second error hierarchy. Session cancellation uses the
session signal and must preserve the existing cancellation response/event
semantics. Credentials remain adapter-only and are excluded from history,
debug events, design artifacts, and returned errors.

## Planned implementation locations

The exact file/symbol handoff is recorded in `A-006`:

- `src/types.ts`: public request/message/session option/provider contract types.
- `src/chat.ts`: `LlmChatProvider`, `LlmChatSession`, `chatFactory`, and session
  orchestration boundary.
- `src/complete.ts`: integration of completion/tool lifecycle with session
  history, if the implementation keeps high-level orchestration there.
- `src/provider.ts`: provider interface adaptation and response normalization.
- `src/openrouter-projection.ts`: dedicated OpenRouter HTTP projection class.
- `src/prompt.ts`: initial XML prompt generation only.
- `schemas/request/v1/request.schema.md`: HTTP projection documentation.
- `schemas/prompt/v1/llm-prompt.xsd`: generated prompt XML contract.

The implementation task must confirm final paths before changing source files.
