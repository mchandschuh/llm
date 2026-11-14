# WI-0002 — Expose executed tool results in `llm/response/v2`

## Status

`complete` for the bounded local package scope. The response/v2 type, runtime
envelope, JSON Schema, deterministic tests, validation, review, and delivery
records are committed. This status does not claim authenticated provider
availability, production readiness, deployment, or downstream integration.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0002/work-item.json`
- Classification: `/home/michael/src/github/llm/.docs/work-items/WI-0002/classification-result.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0002/steps/`
- Baseline: `b796ae4e0835478d6020cdc06913f61cd92dedf7`

## Outcome

`LlmResponseV2` now exposes a required `toolResults` collection using the
existing normalized `ToolResult` shape. Automatic tool results are retained in
call and round order, capped at 128 entries, and surfaced on terminal responses.
Manual pending and non-executing paths return an empty collection. Existing
sanitized tool errors are preserved. `llm/request/v1` and `llm/response/v1`
remain unchanged.

## Ordered steps

| Order | Task | Commit |
| --- | --- | --- |
| `00000000` | Design response/v2 tool-result contract | `819381d` |
| `10000000` | Implement response/v2 tool-result capture | `9616b9b` |
| `80000000` | Validate schema, tests, build, and scope | `40068fd` |
| `90000000` | Review compatibility, safety, and evidence | `32acd7c` |
| `91000000` | Record local delivery and limitations | delivery commit |

## Commit chain

| Stage | Commit |
| --- | --- |
| Preparation | `7f5effd` — `WI-0002: prepare response tool result work item` |
| Design | `819381d` — `WI-0002: 01: design(llm): define response tool result contract` |
| Implementation | `9616b9b` — `WI-0002: 02: feat(llm): expose response tool results` |
| Validation | `40068fd` — `WI-0002: 03: test(llm): validate response tool results` |
| Review | `32acd7c` — `WI-0002: 04: review(llm): assess response tool result capture` |
| Delivery | delivery commit — `WI-0002: 05: chore(llm): record response tool result delivery` |

## Evidence summary

- Work-item and classification records passed their SDLC schema checks.
- The design, implementation, validation, and review task envelopes and nested
  payloads passed their corresponding SDLC schema checks.
- `npm run typecheck` passed.
- `npm test` passed with 46 tests.
- `npm run build` passed.
- Response/v2 examples passed direct Ajv validation.
- The implementation commit is limited to response/v2 schema, types,
  completion logic, tests, and the implementation task record. Two unrelated
  request-schema edits were present before WI-0002 and remain uncommitted.

## Explicit non-claims

- No authenticated OpenRouter request is claimed.
- No real external tool invocation or side effect is claimed.
- No production deployment, registry publication, or downstream integration is
  included.
- Provider-free tests and local build evidence do not establish operational or
  production readiness.