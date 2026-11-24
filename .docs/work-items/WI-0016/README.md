---
status: planned
workItemId: WI-0016
recordType: work-item-summary
---

# WI-0016 — Implement schema-aware request parameter construction

## Status

`planned`. This record defines a bounded planning slice. It does not claim implementation, test execution, provider availability, production readiness, release, or commit.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0016/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0016/steps/`
- Baseline: `51984b6064503b576c52ca460d7cf21cc356f52b`

## Authoritative request contract

This work item implements these exact sections of [`requests/README.md`](../../../requests/README.md): [Request defaults and parameter defaults](../../../requests/README.md#request-defaults-and-parameter-defaults), [Parameter contract](../../../requests/README.md#parameter-contract), [x-llm-req-parameter metadata](../../../requests/README.md#x-llm-req-parameter-metadata). The contract is authoritative for this batch. Explicit human operator confirmation is required before any work-item or task modifies `/home/michael/src/github/llm/requests/README.md`; implementation and validation agents may persist evidence in their governed task records.

The decision log is [`requests/decisions.md`](../../../requests/decisions.md). Historical `baseline` values record declaration time and are not processing blockers.

## Intended outcome

Construct and validate parameters from a flat schema, nested dot/index assignments, and full --parameters JSON with deterministic precedence and errors.

## Scope

- **root-properties:** Flat root properties are exposed as CLI parameters and parameter is reserved. The schema defines the request-specific namespace.
- **nested-paths:** Dot notation and array/map indexes update nested values without corrupting siblings. Structured request parameters need navigable assignment.
- **full-object:** --parameters accepts full JSON and individual assignments follow documented precedence. Full-object callers and targeted operators both need deterministic behavior.
- **schema-validation:** The complete object is validated against parameters.schema.json, including x-llm-req-parameter metadata, before substitution. Schema violations must not invoke completion.

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

The strategy must include at least one required executable provider-free test case per requirement and explicit mappings for every acceptance criterion. Validation must execute the full repository gate `npm run typecheck && npm test && npm run build && git diff --check`; focused tests are additional evidence. The full suite must pass before this work item is complete or the next work item begins, followed by `sdlc work-item validate --work-item WI-0016`. Review must independently inspect scope, non-goals, and evidence limitations.

## Evidence boundary

These artifacts define future evidence; they do not report implementation, tests, validation, review, provider calls, deployment, release, or completion. Implementation, validation, review, and completion evidence may be committed under the governed task records. Contract-document edits still require explicit human operator confirmation.
