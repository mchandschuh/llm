# WI-0003 — Use provider finish reasons for bounded tool-loop termination

## Status

`complete` for the bounded local package scope. Provider finish-reason parsing,
normalized completion decisions, explicit v2 loop control, deterministic tests,
documentation, validation, review, and delivery records are committed. This
status does not claim authenticated provider availability, production readiness,
deployment, or downstream integration.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0003/work-item.json`
- Classification: `/home/michael/src/github/llm/.docs/work-items/WI-0003/classification-result.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0003/steps/`
- Baseline: `2178980358bfbb9f0b6a8f2c484df2af53588588`

## Outcome

`ProviderCompletionResponse` now requires `decision: "continue" | "stop"`.
OpenRouter `choices[0].finish_reason` is normalized as follows:

- `tool_calls` → `continue`
- `stop` → `stop`

Automatic v2 orchestration invokes tools only for `continue` with non-empty
tool calls and returns terminal output only for `stop` without tool calls.
Missing, unsupported, or contradictory provider responses fail closed. The
terminal `llm/response/v2` schema remains unchanged; its `toolResults` history
continues to describe executed tools.

## Ordered steps

| Order | Task | Commit |
| --- | --- | --- |
| `00000000` | Design finish-reason termination boundary | `9c488bb` |
| `10000000` | Implement provider decision and loop control | `8b101e9` |
| `80000000` | Validate finish-reason behavior and scope | `a0fd62c` |
| `90000000` | Review compatibility, safety, and evidence | `861fff1` |
| `91000000` | Record local delivery and limitations | delivery commit |

## Commit chain

| Stage | Commit |
| --- | --- |
| Preparation | `6b84870` — `WI-0003: prepare finish reason termination work item` |
| Design | `9c488bb` — `WI-0003: 01: design(llm): define finish reason termination` |
| Implementation | `8b101e9` — `WI-0003: 02: feat(llm): use finish reason for tool loop termination` |
| Validation | `a0fd62c` — `WI-0003: 03: test(llm): validate finish reason termination` |
| Review | `861fff1` — `WI-0003: 04: review(llm): assess finish reason termination` |
| Delivery | delivery commit — `WI-0003: 05: chore(llm): record finish reason termination delivery` |

## Evidence summary

- Work-item and classification records passed their SDLC schema checks.
- All WI-0003 task envelopes and selected nested payloads passed their SDLC
  schema checks.
- `npm run typecheck` passed.
- `npm test` passed with 50 tests.
- `npm run build` passed.
- Mocked OpenRouter tests cover `tool_calls`, `stop`, missing/unsupported
  finish reasons, explicit continuation, explicit stopping, and contradictory
  decision/call combinations.
- `schemas/response/v2/response.schema.json` remains unchanged from WI-0002.
- Two unrelated request-schema edits were present before WI-0003 processing and
  remain uncommitted.

## Explicit non-claims

- No authenticated OpenRouter request is claimed.
- No real external tool invocation or side effect is claimed.
- No production deployment, registry publication, or downstream integration is
  included.
- Provider-free and mocked transport tests do not establish operational or
  production readiness.