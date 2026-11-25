---
status: planned
workItemId: WI-0020
recordType: work-item-summary
---

# WI-0020 — Integrate llm req execution and output

## Status

`complete` for the bounded `llm req` execution and output slice. Implementation, provider-free focused tests, validation evidence, and review evidence are recorded. No authenticated provider, deployment, publication, production-readiness, or Git commit claim is made.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0020/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0020/steps/`
- Baseline: `51984b6064503b576c52ca460d7cf21cc356f52b`

## Authoritative request contract

This work item implements these exact sections of [`requests/README.md`](../../../requests/README.md): [Additional input files](../../../requests/README.md#additional-input-files), [Library and CLI boundaries](../../../requests/README.md#library-and-cli-boundaries), [Request-name and filesystem safety](../../../requests/README.md#request-name-and-filesystem-safety). The contract is authoritative for this batch. Explicit human operator confirmation is required before any work-item or task modifies `/home/michael/src/github/llm/requests/README.md`; implementation and validation agents may persist evidence in their governed task records.

The decision log is [`requests/decisions.md`](../../../requests/decisions.md). Historical `baseline` values record declaration time and are not processing blockers.

## Intended outcome

Resolve configured request directories, construct parameters, call completeRequest, and print dynamic responses using existing output and exit semantics.

## Scope

- **configured-lookup:** llm req resolves configured root and request name before loading and supports summarize-compatible additional input files.
- **shared-completion:** Valid input constructs parameters and calls completeRequest once. Shared behavior is central.
- **output-contract:** Raw/full success and JSON failure output follow existing writers and exit codes. Callers need stable serialization.
- **cli-regression:** Existing command behavior remains covered. Integration must not regress current modes.

## Non-goals

- Do not make authenticated provider calls, publish, deploy, or claim production readiness.
- Do not expand into unrelated commands, providers, schemas, or persistence.

## Ordered task graph

| Order | Task | Dependency | Evidence |
| --- | --- | --- | --- |
| `10000000` | Define test strategy | none | Strategy only |
| `20000000` | Implement the declared feature slice | `10000000` | Implemented request command and tests |
| `80000000` | Validate implementation | `10000000`, `20000000` | Passed provider-free validation |
| `90000000` | Review scope and coverage | `80000000` | Accepted review |

## Test strategy expectation

The strategy includes one required executable provider-free test case per requirement and explicit mappings for every acceptance criterion. The implementation maps all four cases to task-ID-prefixed trace-marked tests in `tests/request-cli.test.ts`. Validation executed the focused request CLI tests, full repository gate, and changed-path checks; review inspected scope, non-goals, and evidence limitations. Whole-work-item validation remains unavailable because the installed SDLC registry lacks `sdlc-task-test-strategy/v2`.

## Evidence boundary

Evidence is local and provider-free. It establishes configured request lookup, additional path/content files, schema-aware parameter construction, one shared completion delegation, raw/full output, JSON failures, existing-mode compatibility, and package gates for this bounded scope. It does not establish authenticated provider behavior, deployment, publication, downstream integration, or production readiness. Changes remain uncommitted for human operator review. Contract-document edits still require explicit human operator confirmation.
