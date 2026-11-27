---
status: complete
workItemId: WI-0019
recordType: work-item-summary
---

# WI-0019 — Add llm req CLI argument parsing

## Status

`complete` for the bounded llm req argument-parsing scope. The parser branch, provider-free focused tests, validation evidence, and review record are present. No authenticated provider, deployment, publication, production-readiness, or Git commit claim is made.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0019/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0019/steps/`
- Baseline: `51984b6064503b576c52ca460d7cf21cc356f52b`

## Authoritative request contract

This work item implements these exact sections of [`requests/README.md`](../../../requests/README.md): [Library and CLI boundaries](../../../requests/README.md#library-and-cli-boundaries), [Parameter contract](../../../requests/README.md#parameter-contract). The contract is authoritative for this batch. Explicit human operator confirmation is required before any work-item or task modifies `/home/michael/src/github/llm/requests/README.md`; implementation and validation agents may persist evidence in their governed task records.

The decision log is [`requests/decisions.md`](../../../requests/decisions.md). Historical `baseline` values record declaration time and are not processing blockers.

## Intended outcome

Recognize llm req <request-name> <request-parameters> while preserving current modes and common format/debug flags.

## Scope

- **req-shape:** The parser recognizes req with a request name and parameter tail. The command needs unambiguous syntax.
- **common-output-flags:** Dynamic requests accept existing raw/full and debug controls in common positions. Output must remain consistent.
- **parameter-forwarding:** The parser forwards --parameters and arbitrary property tokens without schema interpretation. Request-specific schemas remain dynamic.
- **existing-modes:** Existing parser modes retain their shapes and exit codes. The new branch must be additive.

## Non-goals

- Do not make authenticated provider calls, publish, deploy, or claim production readiness.
- Do not expand into unrelated commands, providers, schemas, or persistence.

## Ordered task graph

| Order | Task | Dependency | Evidence |
| --- | --- | --- | --- |
| `10000000` | Define test strategy | none | Complete strategy |
| `20000000` | Implement the declared feature slice | `10000000` | Complete req parser and tests |
| `80000000` | Validate implementation | `10000000`, `20000000` | Passed provider-free validation |
| `90000000` | Review scope and coverage | `80000000` | Accepted review |

## Test strategy expectation

The strategy includes one required executable provider-free test case per requirement and explicit mappings for every acceptance criterion. The implementation maps all four cases to task-ID-prefixed trace-marked tests in `tests/cli.test.ts`. Validation executed the focused req parser tests, full repository gate, and changed-path checks; review independently inspected scope, non-goals, and evidence limitations.

## Evidence boundary

Evidence is local and provider-free. It establishes req argument recognition, common flag preservation, schema-root-driven dynamic token forwarding, existing-mode compatibility, and package gates for this bounded scope. It does not establish authenticated provider behavior, deployment, publication, downstream integration, or production readiness. Changes remain uncommitted for human operator review. The authoritative contract was not modified.
