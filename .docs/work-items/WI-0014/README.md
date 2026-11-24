---
status: planned
workItemId: WI-0014
recordType: work-item-summary
---

# WI-0014 — Document and finalize the dynamic request-directory contract

## Status

`planned`. This record defines a bounded planning slice. It does not claim implementation, test execution, provider availability, production readiness, release, or commit.

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
| `10000000` | Define test strategy | none | Strategy only |
| `20000000` | Implement the declared feature slice | `10000000` | Planned implementation task |
| `80000000` | Validate implementation | `10000000`, `20000000` | Planned validation procedures |
| `90000000` | Review scope and coverage | `80000000` | Planned review gate |

## Test strategy expectation

The strategy must include at least one required executable provider-free test case per requirement and explicit mappings for every acceptance criterion. Validation must execute focused tests, package gates, and changed-path checks. Review must independently inspect scope, non-goals, and evidence limitations.

## Evidence boundary

These artifacts define future evidence; they do not report implementation, tests, validation, review, provider calls, deployment, release, or completion. No commit is authorized by this work item.
