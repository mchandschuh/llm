---
status: complete
workItemId: WI-0016
recordType: work-item-summary
---

# WI-0016 — Implement schema-aware request parameter construction

## Status

`complete` for the bounded schema-aware parameter-construction scope. The constructor, provider-free focused tests, validation evidence, and review record are present. No authenticated provider, deployment, publication, production-readiness, or Git commit claim is made.

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
| `10000000` | Define test strategy | none | Complete strategy |
| `20000000` | Implement the declared feature slice | `10000000` | Complete parameter constructor and tests |
| `80000000` | Validate implementation | `10000000`, `20000000` | Passed provider-free validation |
| `90000000` | Review scope and coverage | `80000000` | Accepted review |

## Test strategy expectation

The strategy includes one required executable provider-free test case per requirement and explicit mappings for every acceptance criterion. The implementation maps all four cases to task-ID-prefixed trace-marked tests in `tests/request-parameters.test.ts`. Validation executed the focused constructor tests, full repository gate, and changed-path checks; review independently inspected scope, non-goals, and evidence limitations.

## Evidence boundary

Evidence is local and provider-free. It establishes schema-aware root/nested/full-object parameter construction, deterministic errors and precedence, final schema validation, and package gates for this bounded scope. It does not establish authenticated provider behavior, deployment, publication, downstream integration, or production readiness. Changes remain uncommitted for human operator review. The authoritative contract was not modified.
