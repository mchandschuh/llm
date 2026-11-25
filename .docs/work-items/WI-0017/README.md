---
status: complete
workItemId: WI-0017
recordType: work-item-summary
---

# WI-0017 — Implement request-variable substitution

## Status

`complete` for the bounded request-variable substitution scope. The substitution functions, provider-free focused tests, validation evidence, and review record are present. No authenticated provider, deployment, publication, production-readiness, or Git commit claim is made.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0017/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0017/steps/`
- Baseline: `51984b6064503b576c52ca460d7cf21cc356f52b`

## Authoritative request contract

This work item implements these exact sections of [`requests/README.md`](../../../requests/README.md): [Placeholder substitution](../../../requests/README.md#placeholder-substitution), [Processing order](../../../requests/README.md#processing-order). The contract is authoritative for this batch. Explicit human operator confirmation is required before any work-item or task modifies `/home/michael/src/github/llm/requests/README.md`; implementation and validation agents may persist evidence in their governed task records.

The decision log is [`requests/decisions.md`](../../../requests/decisions.md). Historical `baseline` values record declaration time and are not processing blockers.

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
| `10000000` | Define test strategy | none | Complete strategy |
| `20000000` | Implement the declared feature slice | `10000000` | Complete substitution functions and tests |
| `80000000` | Validate implementation | `10000000`, `20000000` | Passed provider-free validation |
| `90000000` | Review scope and coverage | `80000000` | Accepted review |

## Test strategy expectation

The strategy includes one required executable provider-free test case per requirement and explicit mappings for every acceptance criterion. The implementation maps all four cases to task-ID-prefixed trace-marked tests in `tests/request-variables.test.ts`. Validation executed the focused substitution tests, full repository gate, and changed-path checks; review independently inspected scope, non-goals, and evidence limitations.

## Evidence boundary

Evidence is local and provider-free. It establishes exact placeholder substitution, nested lookup, safe serialization, complete asset-map replacement, bounded missing-variable errors, and package gates for this bounded scope. It does not establish authenticated provider behavior, deployment, publication, downstream integration, or production readiness. Changes remain uncommitted for human operator review. The authoritative contract was not modified.
