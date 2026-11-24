---
status: planned
workItemId: WI-0021
recordType: work-item-summary
---

# WI-0021 — Migrate and validate the summarize request example

## Status

`planned`. This record defines a bounded planning slice. It does not claim implementation, test execution, provider availability, production readiness, release, or commit.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0021/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0021/steps/`
- Baseline: `51984b6064503b576c52ca460d7cf21cc356f52b`

## Intended outcome

Make summarize an explicit generic request example while preserving specialized path/content source behavior, output formats, and compatibility.

## Scope

- **generic-example:** Summarize assets execute through llm req with documented parameters. A real example validates the contract.
- **compatibility:** Existing llm summarize delegates to or clearly wraps generic behavior without semantic drift. Existing behavior must remain predictable.
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

The strategy must include at least one required executable provider-free test case per requirement and explicit mappings for every acceptance criterion. Validation must execute focused tests, package gates, and changed-path checks. Review must independently inspect scope, non-goals, and evidence limitations.

## Evidence boundary

These artifacts define future evidence; they do not report implementation, tests, validation, review, provider calls, deployment, release, or completion. No commit is authorized by this work item.
