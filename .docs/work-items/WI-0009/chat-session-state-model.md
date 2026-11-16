# WI-0009 Chat Session State Model

## Status and evidence boundary

This document is design output `A-002` for `OUT-002`. It specifies state,
ordering, interruption, and non-concurrency invariants for implementation and
future validation. It is not runtime evidence.

## Canonical history states

The session maintains an append-only canonical history with these logical states:

1. **Initial context** — system instructions and the initial user message whose
   content is the generated `<llmPrompt version="1">` XML.
2. **User turn ready** — the session may append one user message.
3. **Model response pending** — a provider request is in flight; canonical
   history is not mutated until a usable response is validated.
4. **Assistant tool calls pending** — an assistant message containing one or more
   tool calls has been appended; matching tool results are required before the
   main turn can continue.
5. **Tool execution pending** — validated tool calls are running. Calls within a
   batch may run concurrently; batches remain ordered.
6. **Tool results appended** — one tool message exists for every call, with a
   matching `tool_call_id`.
7. **Terminal assistant response** — the assistant response has no tool calls and
   is appended to canonical history.

The valid ordinary sequence is:

```text
system -> user -> assistant(tool_calls) -> tool* -> assistant(tool_calls)
       -> tool* -> assistant(final) -> user -> assistant(final) -> ...
```

There may be multiple assistant/tool rounds. A user message must never be
inserted between an assistant tool-call message and its required tool messages.

## Two-round replay invariant

For calls `call-round-1` and `call-round-2`, provider requests must contain:

```text
request 1: system, user
request 2: system, user, assistant(call-round-1), tool(call-round-1)
request 3: system, user,
           assistant(call-round-1), tool(call-round-1),
           assistant(call-round-2), tool(call-round-2)
```

The assistant messages are not optional metadata. They are required conversation
history and must preserve call IDs, tool names, and arguments. The final
assistant response is appended after the last tool result and remains available
to the next user turn.

## Tool validation and failure invariants

- Validate every assistant tool call before invoking any call in that assistant
  message.
- Reject unknown tools, malformed arguments, duplicate IDs, and budget violations
  before invocation.
- For an invocation failure, append a bounded error tool message with the same
  `tool_call_id`; do not omit the result and do not expose secrets.
- Do not append a synthetic assistant message after a provider failure.
- Do not append tool results for calls that were rejected before invocation.
- Retrying a provider request must not duplicate any history entry.

## User-message policy

`userMessageInterruptsToolRound` defaults to `false`.

### Default false: blocked/deferred mode

When a tool round is active, `sendUserMessage` rejects with a stable
tool-round-active error or returns an explicitly blocked/deferred turn result,
according to the final implementation API. It does not mutate canonical history.
The caller retries after the tool round joins the history. The implementation
must choose one of reject or deferred result and document it; it must not silently
drop the message.

### True: isolated interrupt branch

To satisfy the requirement to provide a response while a long-running tool
continues without violating canonical single-writer history:

1. Capture an immutable snapshot of canonical history up to the last stable point
   before the unresolved assistant tool-call message.
2. Keep the original tool work running and keep its assistant/tool round owned by
   the active turn.
3. Process the new user message against the snapshot in an isolated interrupt
   branch. The branch does not invoke nested tools; it is a response-only model
   request with the declared session context and the new user message.
4. Return the branch assistant response to the caller tagged as an interrupt
   response. It is not inserted into canonical provider history ahead of pending
   tool results.
5. When the original tool round completes, append its tool results, continue the
   main model turn, and then accept the next canonical user message.

This preserves provider-valid assistant/tool ordering. The branch response is
ephemeral with respect to canonical history; callers that need it persisted must
submit a later canonical user turn after the active round joins. The design task
does not permit concurrent public mutation of one session; the branch is an
internal immutable-snapshot operation controlled by the session implementation.

## Cancellation and lifecycle

- Abort before a provider request: no new message is appended.
- Abort after an assistant tool-call message but before invocation: return
  cancellation without fabricating tool results.
- Abort during tools: preserve completed tool results only if the implementation
  can append a complete valid tool-message set; otherwise return cancellation
  without a partially committed assistant/tool exchange.
- Every emitted event identifies the session turn, tool call, and lifecycle phase
  without including credentials or unbounded content.

## Non-goals

The state model has no compaction, truncation, memory retrieval, checkpoint,
restore, persistence, or automatic concurrency-control state. History simply
accumulates for the lifetime of the session.
