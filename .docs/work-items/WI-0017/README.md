---
status: planned
workItemId: WI-0017
recordType: work-item-summary
---

# WI-0017 — Implement request-variable substitution

## Status

`planned`. This record defines a bounded planning slice. It does not claim implementation, test execution, provider availability, production readiness, release, or commit.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0017/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0017/steps/`
- Baseline: `51984b6064503b576c52ca460d7cf21cc356f52b`

## Intended outcome

Replace every $${variableName}$$ placeholder across request assets using constructed parameters, JSON-serializing complex values and failing on unresolved variables.

## Scope

- **exact-syntax:** The engine matches exact syntax and resolves nested parameter paths. The syntax avoids interpolation collisions.
- **value-serialization:** Primitive and complex values render predictably through safe JSON serialization. Files must receive valid inspectable content.
- **complete-asset-pass:** Every configured asset receives replacement before parsing. Variables can occur in every supported file.
- **missing-values:** Missing variables fail before completion and no unresolved placeholder reaches the request. Explicit failure is safer than silent configuration drift.

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
