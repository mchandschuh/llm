---
status: planned
workItemId: WI-0019
recordType: work-item-summary
---

# WI-0019 — Add llm req CLI argument parsing

## Status

`planned`. This record defines a bounded planning slice. It does not claim implementation, test execution, provider availability, production readiness, release, or commit.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0019/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0019/steps/`
- Baseline: `51984b6064503b576c52ca460d7cf21cc356f52b`

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
| `10000000` | Define test strategy | none | Strategy only |
| `20000000` | Implement the declared feature slice | `10000000` | Planned implementation task |
| `80000000` | Validate implementation | `10000000`, `20000000` | Planned validation procedures |
| `90000000` | Review scope and coverage | `80000000` | Planned review gate |

## Test strategy expectation

The strategy must include at least one required executable provider-free test case per requirement and explicit mappings for every acceptance criterion. Validation must execute focused tests, package gates, and changed-path checks. Review must independently inspect scope, non-goals, and evidence limitations.

## Evidence boundary

These artifacts define future evidence; they do not report implementation, tests, validation, review, provider calls, deployment, release, or completion. No commit is authorized by this work item.
