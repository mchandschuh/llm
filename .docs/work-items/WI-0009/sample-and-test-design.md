# WI-0009 Sample and Test Design

## Status and evidence boundary

This document is design output `A-005` for `OUT-005`. It defines deterministic
tests and executable samples for the later implementation. No sample is claimed
to run until implementation exists.

## Required executable samples

All samples must be provider-free `.mjs` programs discovered by
`tests/samples.test.ts`, emit exactly one JSON result line, write no stderr, and
avoid credentials and real external side effects.

| Sample | Required path | Required proof |
| --- | --- | --- |
| ordinary chat | `samples/chat-conversation.mjs` | User/model back-and-forth, retained final assistant message, later user turn sees prior history. |
| interruptible tools | `samples/chat-interruptible-tool-round.mjs` | Long-running tool, `userMessageInterruptsToolRound: true`, interrupt response while tool remains pending, lifecycle/history evidence. |
| blocked tools | `samples/chat-blocked-tool-round.mjs` | Approximately three-second tool, default `false`, user message rejected/deferred until tool round completion. |

## Required unit/component tests

Add focused tests to `tests/llm.test.ts` or a new discovered test file:

- factory creates independent sessions;
- session options propagate signal, event sink, provider, and tool invoker;
- task/taskSchema remain separate from public and raw `messages`;
- request 2 contains the first assistant/tool pair;
- request 3 contains both assistant/tool pairs for two rounds;
- final assistant response is retained before a later user message;
- parallel tool calls preserve one assistant message and one result per call;
- failed tools emit bounded matching tool messages;
- invalid calls do not enter history;
- blocked user messages do not mutate history;
- interrupt branches use an immutable stable snapshot and do not nest tools;
- no duplicate messages occur after provider retry;
- projection excludes credentials and maps all fields correctly;
- generated XML validates against `schemas/prompt/v1/llm-prompt.xsd`;
- caller-enforced non-concurrency behavior is documented and tested at the
  public boundary.

## Verification mapping

| Design obligation | Test/sample evidence |
| --- | --- |
| `VER-001` | `tests/llm.test.ts` public contract/projection tests; `samples/chat-conversation.mjs` |
| `VER-002` | Two-round provider projection test; captured request 3 role sequence |
| `VER-003` | Both long-running tool samples and cancellation/event tests |
| `VER-004` | Mocked fetch body assertions in `tests/llm.test.ts` |
| `VER-005` | XSD fixture validation command and generated prompt fixture |
| `VER-006` | `tests/samples.test.ts` discovery plus all three sample paths |
| `VER-007` | Public documentation scan and changed-path audit |
| `VER-008` | Typecheck, tests, build, schema validation, declaration inspection |
| `VER-009` | State-model decision in `chat-session-state-model.md` and interruptible sample |

## Evidence boundary

These tests establish local provider-free behavior and contract evidence. They do
not establish authenticated provider behavior, production readiness, deployment,
durable sessions, compaction, checkpointing, or real external tool effects.
