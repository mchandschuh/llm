# WI-0004 — Unify the raw LLM provider interface across request versions

## Status

`complete` for the bounded local package scope. The raw provider interface,
OpenRouter implementation, orchestration call site, tests, declarations,
documentation, validation, review, and delivery records are committed. This
status does not claim authenticated provider availability, production readiness,
deployment, or downstream integration.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0004/work-item.json`
- Classification: `/home/michael/src/github/llm/.docs/work-items/WI-0004/classification-result.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0004/steps/`
- Baseline: `a5a423e3ee96b969794a57f39c950fd4c1ac8f2f`

## Outcome

The raw provider seam now exposes one overloaded `LlmProvider.complete`:

- `ProviderCompletionRequestV2` → `ProviderCompletionResponse`
- `ProviderCompletionRequest` → `string`

Provider requests carry explicit `protocol: "v1"` or `protocol: "v2"`
discriminators. `OpenRouterProvider` dispatches both versions through one
implementation. Raw `LlmProviderV2` and provider-level `completeV2` variants
were removed. The high-level `completeV2` function remains as a terminal
response convenience entry point; request/response schemas and behavior remain
versioned and unchanged.

## Ordered steps

| Order | Task | Commit |
| --- | --- | --- |
| `00000000` | Design unified raw provider boundary | `2c4e611` |
| `10000000` | Implement unified provider interface | `fcc1b9e` |
| `80000000` | Validate declarations, behavior, and scope | `1d4e4e3` |
| `90000000` | Review compatibility and migration | `9bdd015` |
| `91000000` | Record local delivery and limitations | delivery commit |

## Commit chain

| Stage | Commit |
| --- | --- |
| Preparation | `30256aa` — `WI-0004: prepare unified provider interface work item` |
| Design | `2c4e611` — `WI-0004: 01: design(llm): define unified provider interface` |
| Implementation | `fcc1b9e` — `WI-0004: 02: refactor(llm): unify provider complete interface` |
| Validation | `1d4e4e3` — `WI-0004: 03: test(llm): validate unified provider interface` |
| Review | `9bdd015` — `WI-0004: 04: review(llm): assess unified provider interface` |
| Delivery | delivery commit — `WI-0004: 05: chore(llm): record unified provider delivery` |

## Evidence summary

- Work-item and classification records passed their SDLC schema checks.
- All WI-0004 task envelopes and selected nested payloads passed their SDLC
  schema checks.
- `npm run typecheck` passed.
- `npm test` passed with 50 tests.
- `npm run build` passed.
- Generated declarations expose one overloaded `LlmProvider.complete`, protocol
  discriminators, and no raw `LlmProviderV2` or provider `completeV2` method.
- Existing v1/v2 response contracts, finish-reason behavior, tool results, and
  high-level completion service tests remain passing.
- Two unrelated request-schema edits were present before WI-0004 processing and
  remain uncommitted.

## Explicit non-claims

- No authenticated provider request is claimed.
- No real external tool invocation or side effect is claimed.
- No production deployment, registry publication, or downstream integration is
  included.
- Provider-free tests and local build/declaration evidence do not establish
  operational or production readiness.