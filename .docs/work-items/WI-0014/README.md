---
status: complete
workItemId: WI-0014
recordType: work-item-summary
---

# WI-0014 — Document and finalize the dynamic request-directory contract

## Status

`complete` for the bounded local contract/documentation scope. The request-directory contract, provider-free contract tests, validation evidence, and review record are present. No authenticated provider, deployment, publication, production-readiness, or Git commit claim is made.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0014/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0014/steps/`
- Baseline: `51984b6064503b576c52ca460d7cf21cc356f52b`

## Intended outcome

Define the request-directory layout, asset mapping, parameter syntax, placeholder syntax, processing order, compatibility decisions, and evidence boundary before implementation.

## Scope

- **documentation:** The request-directory contract is documented at requests/README.md. Implementers and users need one source of truth.
- **prompt-mapping:** The contract explicitly maps prompt.md and prompt.system.md to existing LlmRequest fields and records summarize compatibility. Otherwise generic construction can invert task and system instructions.
- **parameter-contract:** The contract defines direct, nested, indexed, object-valued, full-object, precedence, duplicate, conversion, and schema-validation rules. Parameter behavior must be deterministic and independently testable.
- **evidence-boundary:** The contract defines provider-free evidence and explicit non-goals for subsequent work. Planning must distinguish requirements from implementation claims.

## Non-goals

- Do not make authenticated provider calls, publish, deploy, or claim production readiness.
- Do not expand into unrelated commands, providers, schemas, or persistence.

## Ordered task graph

| Order | Task | Dependency | Evidence |
| --- | --- | --- | --- |
| `10000000` | Define test strategy | none | Complete strategy |
| `20000000` | Implement the declared feature slice | `10000000` | Complete documentation and test implementation |
| `80000000` | Validate implementation | `10000000`, `20000000` | Passed provider-free validation |
| `90000000` | Review scope and coverage | `80000000` | Accepted review |

## Test strategy expectation

The strategy includes one required executable provider-free test case per requirement and explicit mappings for every acceptance criterion. The implementation maps all four cases to trace-marked tests in `tests/request-integration.test.ts`. The tests were originally recorded at `tests/wi-0014-contract.test.ts`, which was never committed. WI-0022 implemented them in `tests/request-integration.test.ts` under the same trace markers, and this record was corrected with operator approval (WI-0022-90000000_FIND-001). Validation executed the focused audit, full package gates, and changed-path checks; review independently inspected scope, non-goals, and evidence limitations.

## Evidence boundary

Evidence is local and provider-free. It establishes the documented contract, the four-case contract audit, and the package gates for this bounded scope. It does not establish authenticated provider behavior, deployment, publication, downstream integration, or production readiness. Changes remain uncommitted for human operator review.
