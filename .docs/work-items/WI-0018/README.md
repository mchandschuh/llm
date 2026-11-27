---
status: complete
workItemId: WI-0018
recordType: work-item-summary
---

# WI-0018 — Add the shared completeRequest library boundary

## Status

`complete` for the bounded completeRequest library scope. The exported boundary, provider-free focused tests, validation evidence, and review record are present. No authenticated provider, deployment, publication, production-readiness, or Git commit claim is made.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0018/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0018/steps/`
- Baseline: `51984b6064503b576c52ca460d7cf21cc356f52b`

## Authoritative request contract

This work item implements these exact sections of [`requests/README.md`](../../../requests/README.md): [Library and CLI boundaries](../../../requests/README.md#library-and-cli-boundaries), [Prompt, schema, and summarize compatibility](../../../requests/README.md#prompt-schema-and-summarize-compatibility), [Additional input files](../../../requests/README.md#additional-input-files). The contract is authoritative for this batch. Explicit human operator confirmation is required before any work-item or task modifies `/home/michael/src/github/llm/requests/README.md`; implementation and validation agents may persist evidence in their governed task records.

The decision log is [`requests/decisions.md`](../../../requests/decisions.md). Historical `baseline` values record declaration time and are not processing blockers.

## Intended outcome

Expose completeRequest(options: CompleteRequestOptions) that resolves requestName, constructs a ProviderCompletionRequest, invokes provider.complete, and returns ProviderCompletionResponse.

## Scope

- **exported-api:** completeRequest is exported with usable types and accepts directory, parameters, and completion controls. Consumers need a stable programmatic boundary.
- **constructed-request:** The function creates a valid existing LlmRequest from assets and parameters. The dynamic layer must not invent a parallel contract.
- **single-delegation:** Valid input delegates once and invalid input produces zero provider calls. CLI and library behavior must align.
- **relative-root:** CompleteRequestOptions.files and CompletionOptions.files resolve relative paths from application CWD; additional files may be anywhere on disk.

## Non-goals

- Do not make authenticated provider calls, publish, deploy, or claim production readiness.
- Do not expand into unrelated commands, providers, schemas, or persistence.

## Ordered task graph

| Order | Task | Dependency | Evidence |
| --- | --- | --- | --- |
| `10000000` | Define test strategy | none | Complete strategy |
| `20000000` | Implement the declared feature slice | `10000000` | Complete completeRequest boundary and tests |
| `80000000` | Validate implementation | `10000000`, `20000000` | Passed provider-free validation |
| `90000000` | Review scope and coverage | `80000000` | Accepted review |

## Test strategy expectation

The strategy includes one required executable provider-free test case per requirement and explicit mappings for every acceptance criterion. The implementation maps all four cases to task-ID-prefixed trace-marked tests in `tests/request.test.ts`. Validation executed the focused completeRequest tests, full repository gate, and changed-path checks; review independently inspected scope, non-goals, and evidence limitations.

## Evidence boundary

Evidence is local and provider-free. It establishes the exported completeRequest boundary, existing provider request composition, single delegation, external file/control passthrough, and package gates for this bounded scope. It does not establish authenticated provider behavior, deployment, publication, downstream integration, or production readiness. Changes remain uncommitted for human operator review. The authoritative contract was not modified.
