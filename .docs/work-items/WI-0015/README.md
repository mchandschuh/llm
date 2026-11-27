---
status: complete
workItemId: WI-0015
recordType: work-item-summary
---

# WI-0015 — Implement request-directory discovery and asset loading

## Status

`complete` for the bounded request-directory discovery and asset-loading scope. The loader, provider-free focused tests, validation evidence, and review record are present. No authenticated provider, deployment, publication, production-readiness, or Git commit claim is made.

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
| `10000000` | Define test strategy | none | Complete strategy |
| `20000000` | Implement the declared feature slice | `10000000` | Complete loader and test implementation |
| `80000000` | Validate implementation | `10000000`, `20000000` | Passed provider-free validation |
| `90000000` | Review scope and coverage | `80000000` | Accepted review |

## Test strategy expectation

The strategy includes one required executable provider-free test case per requirement and explicit mappings for every acceptance criterion. The implementation maps all four cases to trace-marked tests in `tests/request-directory.test.ts`. Validation executed the focused loader tests, full repository gate, and changed-path checks; review independently inspected scope, non-goals, and evidence limitations.

## Evidence boundary

Evidence is local and provider-free. It establishes safe request-directory resolution, recognized asset discovery, bounded parsing failures, configuration reuse, and package gates for this bounded scope. It does not establish authenticated provider behavior, deployment, publication, downstream integration, or production readiness. Changes remain uncommitted for human operator review. The authoritative contract was not modified.
