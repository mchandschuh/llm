---
status: planned
workItemId: WI-0020
recordType: work-item-summary
---

# WI-0020 — Integrate llm req execution and output

## Status

`planned`. This record defines a bounded planning slice. It does not claim implementation, test execution, provider availability, production readiness, release, or commit.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0020/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0020/steps/`
- Baseline: `51984b6064503b576c52ca460d7cf21cc356f52b`

## Intended outcome

Resolve configured request directories, construct parameters, call completeRequest, and print dynamic responses using existing output and exit semantics.

## Scope

- **configured-lookup:** llm req resolves configured root and request name before loading. Bundles must not be hard-coded.
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
| `20000000` | Implement the declared feature slice | `10000000` | Planned implementation task |
| `80000000` | Validate implementation | `10000000`, `20000000` | Planned validation procedures |
| `90000000` | Review scope and coverage | `80000000` | Planned review gate |

## Test strategy expectation

The strategy must include at least one required executable provider-free test case per requirement and explicit mappings for every acceptance criterion. Validation must execute focused tests, package gates, and changed-path checks. Review must independently inspect scope, non-goals, and evidence limitations.

## Evidence boundary

These artifacts define future evidence; they do not report implementation, tests, validation, review, provider calls, deployment, release, or completion. No commit is authorized by this work item.
