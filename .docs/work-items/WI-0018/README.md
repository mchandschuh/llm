---
status: planned
workItemId: WI-0018
recordType: work-item-summary
---

# WI-0018 — Add the shared completeRequest library boundary

## Status

`planned`. This record defines a bounded planning slice. It does not claim implementation, test execution, provider availability, production readiness, release, or commit.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0018/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0018/steps/`
- Baseline: `51984b6064503b576c52ca460d7cf21cc356f52b`

## Intended outcome

Expose completeRequest(requestDirectory, parameters, options) that loads assets, substitutes values, constructs an existing LlmRequest, and delegates to complete.

## Scope

- **exported-api:** completeRequest is exported with usable types and accepts directory, parameters, and completion controls. Consumers need a stable programmatic boundary.
- **constructed-request:** The function creates a valid existing LlmRequest from assets and parameters. The dynamic layer must not invent a parallel contract.
- **single-delegation:** Valid input delegates once and invalid input produces zero provider calls. CLI and library behavior must align.
- **relative-root:** Relative sources and completion options use requestDirectory and pass through controls. Bundles need safe local references and runtime controls.

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
