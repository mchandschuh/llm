# WI-0009 TypeScript Implementation Handoff

## Status and evidence boundary

This document is design output `A-006` for `OUT-006`. It maps planned source
files and public symbols for implementation. The listed symbols are a handoff,
not evidence that they already exist.

## File and symbol matrix

| Planned path | Symbols/functions | Responsibility |
| --- | --- | --- |
| `src/types.ts` | `LlmChatMessage`, `LlmSystemMessage`, `LlmUserMessage`, `LlmAssistantMessage`, `LlmToolMessage` | Provider-neutral ordered history. |
| `src/types.ts` | `ChatFactoryCreateSessionOptions`, `LlmChatSession`, `LlmChatProvider` | Public session/factory contracts. |
| `src/types.ts` | `LlmRequest.messages`, `ProviderCompletionRequest.task`, `ProviderCompletionRequest.taskSchema`, `ProviderCompletionRequest.messages` | Initial context/history separation. |
| `src/chat.ts` | `chatFactory`, `createSession`, `LlmChatSession` implementation | Per-session ownership, append-only history, turn lifecycle. |
| `src/chat.ts` | `sendUserMessage`, `complete`, `appendMessage` | Canonical public turn operations. |
| `src/complete.ts` | tool-round integration helpers | Append assistant/tool messages and preserve existing response/error semantics. |
| `src/provider.ts` | `LlmProvider`, `OpenRouterProvider.complete` | Raw provider boundary and response normalization. |
| `src/openrouter-projection.ts` | `OpenRouterHttpProjection.project` | Pure provider request-to-HTTP body mapping. |
| `src/prompt.ts` | `composePrompt`, `composeRequestPrompt` | Initial XML user-message generation only. |
| `schemas/request/v1/request.schema.json` | `messages` request property | Public continuation/history request contract. |
| `schemas/request/v1/request.schema.md` | field projection table | Human-readable HTTP mapping. |
| `schemas/prompt/v1/llm-prompt.xsd` | XML prompt schema | XML structure and documentation. |
| `tests/llm.test.ts` | two-round replay/projection/session tests | Deterministic contract and lifecycle evidence. |
| `tests/samples.test.ts` | sample discovery assertions | Executable documentation integration. |
| `samples/chat-conversation.mjs` | ordinary chat fixture | Back-and-forth session behavior. |
| `samples/chat-interruptible-tool-round.mjs` | long-running interrupt fixture | `true` interruption behavior. |
| `samples/chat-blocked-tool-round.mjs` | long-running blocked fixture | default `false` behavior. |
| `SKILL.md` / `README.md` | chat/session/projection guidance | Public non-concurrency and non-goal documentation. |

## Implementation conventions

- Use strict TypeScript and native ESM with explicit `.js` import suffixes.
- Preserve `readonly` public fields and existing lowerCamelCase naming.
- Do not add dependencies unless confirmed in `package.json` and lockfile.
- Reuse `LlmFailure`, `LlmError`, `ErrorCode`, `ErrorPhase`, `DebugEvent`, and
  `DebugSink` rather than introducing parallel vocabularies.
- Keep credentials out of messages, prompts, debug payloads, samples, and durable
  artifacts.
- Keep the raw provider stateless; session history belongs to
  `LlmChatSession`.
- Do not add compaction, checkpointing, persistence, or automatic session
  concurrency controls.

## Output and verification correlation

The design result must retain these direct correlations:

```text
OUT-001 -> A-001,A-006 -> VER-001
OUT-002 -> A-002 -> VER-002,VER-003,VER-009
OUT-003 -> A-003 -> VER-004
OUT-004 -> A-004 -> VER-005
OUT-005 -> A-005 -> VER-003,VER-006,VER-009
OUT-006 -> A-006 -> VER-001,VER-007,VER-008
```

The later validation task should resolve every `A-*` locator, verify every
planned source symbol/file handoff, and create one validation procedure and one
execution for every required `VER-*` obligation.
