# WI-0009 OpenRouter HTTP Projection Design

## Status and evidence boundary

This document is design output `A-003` for `OUT-003`. It defines the mapping
that the future dedicated projection class must implement and test. It does not
claim that the projection class exists yet.

## Discoverable module

Create a dedicated module at:

```text
src/openrouter-projection.ts
```

with an exported class or pure projection object equivalent to:

```ts
export class OpenRouterHttpProjection {
  project(request: ProviderCompletionRequest): OpenRouterChatRequest;
}
```

The projection must be deterministic and side-effect free. `OpenRouterProvider`
owns HTTP transport, authorization, response parsing, and finish-reason mapping;
the projection owns only request-body construction.

## Field mapping

| Provider/session field | OpenRouter destination | Rule |
| --- | --- | --- |
| `model` | `body.model` | Copy unchanged. |
| `thinking` | `body.reasoning.effort` | Copy provider-neutral effort. |
| `systemPrompt` | `messages` system entry | Remains separate from XML. |
| initial `llmPrompt` | first user message content | Contains task, taskSchema, files, and outputSchema XML. |
| `messages` | `body.messages[]` | Project complete ordered history, not only latest results. |
| user message | `{role:"user",content}` | Preserve order. |
| assistant message | `{role:"assistant",content,tool_calls}` | Preserve every tool call and ID. |
| tool message | `{role:"tool",tool_call_id,content}` | Follow the matching assistant call. |
| `toolOptions.tools` | `body.tools[]` | Map to OpenRouter function declarations. |
| text files | initial user message content | Already represented by prompt XML. |
| binary files | user content image parts | Preserve existing attachment behavior. |
| credentials | HTTP authorization header only | Never serialize into body/history/events. |
| task/taskSchema | session/provider context and initial XML | Not duplicated as a second ad hoc message. |
| retry/round/call limits | local orchestration only | Not sent as model message fields unless an explicit prompt instruction requires it. |

## Assistant/tool projection

The provider response must be normalized into an assistant message before any
tool result is appended:

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call-round-1",
      "type": "function",
      "function": {
        "name": "read_record",
        "arguments": "{\"recordId\":\"A\"}"
      }
    }
  ]
}
```

Each normalized result becomes a separate message:

```json
{
  "role": "tool",
  "tool_call_id": "call-round-1",
  "content": "{\"recordId\":\"A\",\"found\":true}"
}
```

Request 3 must contain the assistant/tool pairs for both rounds. A projection
that emits a `role: "tool"` message without its preceding assistant message is
invalid for this contract.

## Request 3 acceptance fixture

The projection test must assert this role sequence:

```text
system
user
assistant(call-round-1)
tool(call-round-1)
assistant(call-round-2)
tool(call-round-2)
```

It must also assert that the two assistant messages preserve their IDs and
function arguments, and that tool results preserve their `tool_call_id` values.

## Documentation location

Add the implementation-facing projection document next to the request schema:

```text
schemas/request/v1/request.schema.md
```

That document should link to this design output, the projection source module,
the provider-neutral message types, and the exact HTTP fixture test.
