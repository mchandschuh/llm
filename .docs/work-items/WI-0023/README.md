---
status: planned
workItemId: WI-0023
recordType: work-item-summary
---

# WI-0023 — Define and implement x-llm-req-parameter.validation.function

## Status

`planned`. This record defines a bounded planning slice. It does not claim
implementation, test execution, provider availability, production readiness,
release, or commit.

## Authority

- Repository: `/home/michael/src/github/llm`
- Request: `/home/michael/src/github/llm/.docs/work-items/WI-0023/work-item-request.md`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0023/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0023/steps/`

The operator clarified the request: support
`x-llm-req-parameter.validation.function` as an inline JavaScript function with
access to enough context to perform bespoke validation. The operator also
confirmed the matching `requests/README.md` contract changes for this work item.

## Authoritative request contract

This work item implements these sections of
[`requests/README.md`](../../../requests/README.md):
[x-llm-req-parameter metadata](../../../requests/README.md#x-llm-req-parameter-metadata),
[Processing order](../../../requests/README.md#processing-order),
[Request-name and filesystem safety](../../../requests/README.md#request-name-and-filesystem-safety),
and [Evidence boundary](../../../requests/README.md#evidence-boundary).

## Intended outcome

A parameter schema node may declare:

```json
{
  "x-llm-req-parameter": {
    "validation": {
      "function": "(value, context) => context.fs.isFile(value) || `not a file: ${value}`",
      "message": "Optional default failure message"
    }
  }
}
```

`completeRequest` runs every declared function after JSON Schema validation and
before file materialization, placeholder substitution, and provider delegation.
CLI and library callers use the same path.

## Design decisions

- `function` is a JavaScript function-expression string or an array of lines
  joined with newlines. `message` is optional. No other members are accepted.
- Allowed positions are the schema root, `properties` (recursively), and array
  `items`, where the function runs once per element. Other positions, such as
  `oneOf` or `$defs`, fail closed.
- The function is called as `fn(value, context)`. The frozen `context` contains
  `path`, `value`, `parameters` (a deep-frozen copy), `schema` (the node),
  `request: { name, directory }`, `workingDirectory`, and the read-only
  `fs: { resolve, exists, isFile, isDirectory, readText }` helpers. `readText`
  is limited to 1 MiB.
- `true` or `undefined` passes. `false` fails with `message` or a default
  message. A non-empty string fails with that string. A thrown error fails with
  its message. Any other result, including a thenable, is a configuration
  error.
- Execution is synchronous. Each call runs in a fresh `node:vm` context with no
  `require`, `process`, timers, or string code generation, and a 1000 ms
  timeout.
- This isolation is **not** a security boundary. Request bundles are trusted
  configuration, like any other code the operator installs.

## Scope

- **metadata-contract:** validation metadata shape, positions, and fail-closed handling.
- **invocation-context:** a frozen, sufficient context with read-only filesystem helpers.
- **result-semantics:** deterministic outcomes, isolation, and the timeout.
- **pipeline-integration:** the shared completeRequest boundary, run before materialization and provider use.
- **documentation-and-compatibility:** contract and docs updates; existing behavior stays green.

## Non-goals

- No security sandbox claim, validator modules, asynchronous validators, or filesystem writes.
- No request-name special cases or summarize asset changes.
- No authenticated provider calls, publication, deployment, or production claims.

## Ordered task graph

| Order | Task | Dependency | Evidence |
| --- | --- | --- | --- |
| `10000000` | Define test strategy | none | Strategy only |
| `20000000` | Implement validation functions | `10000000` | Planned implementation task |
| `80000000` | Validate implementation | `10000000`, `20000000` | Planned validation procedures |
| `90000000` | Review scope and coverage | `80000000` | Planned review gate |

## Evidence boundary

The full repository gate
`npm run typecheck && npm test && npm run build && git diff --check` must pass
before this work item is complete. Provider-free evidence does not establish
sandbox security, authenticated provider behavior, deployment, release, or
production readiness.
