---
status: complete
workItemId: WI-0021
recordType: work-item-summary
---

# WI-0021 — Migrate and validate the summarize request example

## Status

`complete` for the summarize compatibility adapter, the generic summarize request example, the corrected contract sections, and the provider-free validation and review evidence recorded in the ordered task files. Review finding WI-0021-90000000_FIND-001 (a stale contract-table anchor outside WI-0021's sections) is deferred to WI-0022. It does not claim authenticated provider availability, production readiness, release, deployment, or publication.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0021/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0021/steps/`
- Baseline: `51984b6064503b576c52ca460d7cf21cc356f52b`

## Authoritative request contract

This work item implements these exact sections of [`requests/README.md`](../../../requests/README.md): [Prompt, schema, and summarize compatibility](../../../requests/README.md#prompt-schema-and-summarize-compatibility), [Additional input files](../../../requests/README.md#additional-input-files). The contract is authoritative for this batch. Explicit human operator confirmation is required before any work-item or task modifies `/home/michael/src/github/llm/requests/README.md`; implementation and validation agents may persist evidence in their governed task records.

The decision log is [`requests/decisions.md`](../../../requests/decisions.md). Historical `baseline` values record declaration time and are not processing blockers.

## Intended outcome

Make summarize an explicit generic request example while preserving specialized path/content source behavior, output formats, and compatibility.

## Scope

- **generic-example:** Summarize assets execute through llm req with documented parameters. A real example validates the contract.
- **compatibility:** Existing llm summarize remains valid without a system-prompt asset and delegates to or clearly wraps generic behavior without semantic drift.
- **source-regressions:** Path, directory, symlink, content, raw, and full cases remain covered. Specialized source behavior is outside generic substitution.
- **example-quality:** Assets and tests introduce no unrelated scope or provider claims. Examples are public contract artifacts.

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

The strategy must include at least one required executable provider-free test case per requirement and explicit mappings for every acceptance criterion. Validation must execute the full repository gate `npm run typecheck && npm test && npm run build && git diff --check`; focused tests are additional evidence. The full suite must pass before this work item is complete or the next work item begins, followed by `sdlc work-item validate --work-item WI-0021`. Review must independently inspect scope, non-goals, and evidence limitations.

## Evidence boundary

These artifacts define future evidence; they do not report implementation, tests, validation, review, provider calls, deployment, release, or completion. Implementation, validation, review, and completion evidence may be committed under the governed task records. Contract-document edits still require explicit human operator confirmation.
