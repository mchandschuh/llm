---
status: planned
workItemId: WI-0015
recordType: work-item-summary
---

# WI-0015 — Implement request-directory discovery and asset loading

## Status

`planned`. This record defines a bounded planning slice. It does not claim implementation, test execution, provider availability, production readiness, release, or commit.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0015/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0015/steps/`
- Baseline: `51984b6064503b576c52ca460d7cf21cc356f52b`

## Authoritative request contract

This work item implements these exact sections of [`requests/README.md`](../../../requests/README.md): [Request bundle layout](../../../requests/README.md#request-bundle-layout), [Asset mapping and optionality](../../../requests/README.md#asset-mapping-and-optionality), [Processing order](../../../requests/README.md#processing-order), [Request-name and filesystem safety](../../../requests/README.md#request-name-and-filesystem-safety). The contract is authoritative for this batch. Explicit human operator confirmation is required before any work-item or task modifies `/home/michael/src/github/llm/requests/README.md`; implementation and validation agents may persist evidence in their governed task records.

The decision log is [`requests/decisions.md`](../../../requests/decisions.md). Historical `baseline` values record declaration time and are not processing blockers.

## Intended outcome

Resolve a safe request name beneath configured requestsDirectory, discover recognized assets, parse contents, and report bounded configuration failures before completion.

## Scope

- **safe-resolution:** A request name resolves only to a safe child directory beneath configured requestsDirectory. Request names are user-controlled selectors.
- **asset-set:** The loader recognizes exactly one task source (prompt.md or task.json), an optional system prompt, defaults, schemas, and bounded asset alternatives defined by requests/README.md.
- **parsing-errors:** Malformed or wrong-shaped assets fail with bounded errors identifying request and asset kind. Invalid configuration must stop before completion.
- **configuration-reuse:** Configured requestsDirectory continues using the existing shared boundary. Users must not receive command-specific lookup behavior.

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

The strategy must include at least one required executable provider-free test case per requirement and explicit mappings for every acceptance criterion. Validation must execute the full repository gate `npm run typecheck && npm test && npm run build && git diff --check`; focused tests are additional evidence. The full suite must pass before this work item is complete or the next work item begins, followed by `sdlc work-item validate --work-item WI-0015`. Review must independently inspect scope, non-goals, and evidence limitations.

## Evidence boundary

These artifacts define future evidence; they do not report implementation, tests, validation, review, provider calls, deployment, release, or completion. Implementation, validation, review, and completion evidence may be committed under the governed task records. Contract-document edits still require explicit human operator confirmation.
