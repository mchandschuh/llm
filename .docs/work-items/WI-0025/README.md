---
status: complete
workItemId: WI-0025
recordType: work-item-summary
---

# WI-0025 — Return structured validation results from x-llm-req-parameter.validation.function

## Status

`complete` for structured validation result objects, `ParameterValidationFailure`,
and per-issue `llm req` error output. The provider-free validation and an
accepted review are recorded in the ordered task files. All independent review
findings were fixed in rework commit dbbe9ea. This status does not claim
sandbox security, authenticated provider availability, production readiness,
release, deployment, or publication.

## Authority

- Repository: `/home/michael/src/github/llm`
- Request: `/home/michael/src/github/llm/.docs/work-items/WI-0025/work-item-request.md`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0025/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0025/steps/`

This work item extends the WI-0023 contract in
[Validation functions](../../../requests/README.md#validation-functions) and the
error output in
[Schema-declared files and library/CLI boundaries](../../../requests/README.md#schema-declared-files-and-librarycli-boundaries).

## Intended outcome

A validation function may return a well-defined result object whose errors tell
users and agents what is wrong with a parameter and how to fix it:

```json
{
  "valid": false,
  "errors": [
    {
      "message": "notes.md does not exist",
      "path": "path",
      "remediation": "Pass an existing file with --p-path <file>."
    }
  ]
}
```

## Design decisions

- `valid` is a required boolean.
  - `valid: true` passes, and `errors` must then be absent or empty.
  - `valid: false` requires 1 to 20 errors.
- Each error has a required `message`, plus an optional `remediation` and an
  optional `path`. `path` defaults to the validator's concrete `context.path`,
  so root validators can point at a specific field.
- Strings are non-empty and bounded. The shape is closed: unknown members are
  rejected.
- The result is read through own data properties only. Accessors and malformed
  shapes are configuration errors, so validator getters never run outside the
  vm timeout.
- The existing returns keep working: `true`, `undefined`, `false`, a string,
  and a thrown error.
- Validation metadata gains an optional `remediation`, used for `false` and
  string returns.
- Every validator-driven failure raises an exported `ParameterValidationFailure`.
  It extends `LlmFailure`, keeps code `CONFIGURATION_INVALID`, and carries
  `issues: { path, message, remediation? }[]`.
- `llm req` writes one JSON error entry per issue:
  `{ code, phase, message, parameterPath, remediation? }`. The field is named
  `parameterPath` so it is not mistaken for a file path. Other failures keep
  the existing single-entry shape.
- The first failing validator still stops validation, but one validator may
  report several issues.

## Non-goals

- No aggregation across validators.
- No change to the response schema, error codes, or non-request commands.
- No authenticated provider calls, publication, deployment, or production claims.

## Ordered task graph

| Order | Task | Dependency | Evidence |
| --- | --- | --- | --- |
| `10000000` | Define test strategy | none | Strategy only |
| `20000000` | Implement structured results | `10000000` | Planned implementation task |
| `80000000` | Validate implementation | `10000000`, `20000000` | Planned validation procedures |
| `90000000` | Review scope and coverage | `80000000` | Planned review gate |

## Evidence boundary

The full repository gate
`npm run typecheck && npm test && npm run build && git diff --check` must pass
before this work item is complete. Provider-free evidence does not establish
sandbox security, authenticated provider behavior, deployment, release, or
production readiness.
