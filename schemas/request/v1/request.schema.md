# LLM Request v1 OpenRouter projection

This document describes the provider-neutral request fields and their
OpenRouter Chat Completions destinations. The request schema remains closed;
`messages` is an ordered continuation history and is not a replacement for the
initial task context.

| Provider-neutral field | OpenRouter field | Projection rule |
| --- | --- | --- |
| `model` | `body.model` | Copy unchanged. |
| `thinking` | `body.reasoning.effort` | Copy the provider-neutral reasoning effort. |
| `systemPrompt` | `body.messages` system entry | Keep system instructions separate from the XML prompt. |
| `llmPrompt` | initial `body.messages` user entry | The generated XML contains task, taskSchema, files, and outputSchema. Binary image files become image parts on this entry. |
| `messages` | `body.messages[]` | Project the complete ordered system/user/assistant/tool history. Do not send only the latest tool result. |
| user message | `{ role: "user", content }` | Preserve order and content. |
| assistant message | `{ role: "assistant", content, tool_calls }` | Preserve every tool call ID, name, and JSON arguments. |
| tool message | `{ role: "tool", tool_call_id, content }` | Emit after its matching assistant call and preserve the correlation ID. |
| `toolOptions.tools` | `body.tools[]` | Map each declaration to an OpenRouter function tool with parsed JSON Schema parameters. |
| `credentials` | Authorization header | Use only for transport authorization. Never serialize credentials into the body, history, events, prompts, or errors. |
| `task` / `taskSchema` | local provider context and initial XML | Preserve as separate provider request fields; do not add ad hoc duplicate model messages. |
| retry, round, and call limits | local orchestration | These are not HTTP message fields. |

The discoverable pure implementation is
[`src/openrouter-projection.ts`](../../../src/openrouter-projection.ts), exposed
as `OpenRouterHttpProjection`. Transport, authorization, response parsing, and
finish-reason mapping remain in `OpenRouterProvider`.

The exact request-3 fixture and mocked HTTP assertions are in
[`tests/provider-projection.test.ts`](../../../tests/provider-projection.test.ts).
The canonical provider-neutral message types are declared in
[`src/types.ts`](../../../src/types.ts).

Credentials are intentionally absent from the projected body. The provider
adds the in-memory authorization header only at the HTTP boundary.