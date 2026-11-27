---
status: planned
workItemId: WI-0027
recordType: work-item-summary
---

# WI-0027 — Fix claude provider schema dialect handling and add live claude tests

## Status

`planned`. This record defines a bounded planning slice. It does not claim
implementation, test execution, provider availability, production readiness,
release, or commit.

## Authority

- Repository: `/home/michael/src/github/llm`
- Request: `/home/michael/src/github/llm/.docs/work-items/WI-0027/work-item-request.md`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0027/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0027/steps/`

## Background

The operator asked for live testing of the WI-0026 claude provider. They also
asked that read_file/write_file chat-session tests work with it; no such tests
existed in the repository. The live run with the real Claude Code CLI 2.1.332
showed:

- **Passed:** plain text completion, `llm -p`, structured output with `$defs`,
  a read_file/write_file chat session (two tool rounds plus a follow-up turn
  answered from history), and persisted chat continuation.
- **Failed:** `llm summarize` and `llm req summarize`. The CLI rejected the
  bundled summarize `outputSchema` with
  `--json-schema is not a valid JSON Schema: no schema with key or ref
  "https://json-schema.org/draft/2020-12/schema"`, because the schema declares
  that `$schema` dialect and the provider passed object-root schemas through
  unchanged.

## Design decisions

- Remove `$schema` keywords from every schema passed as `--json-schema`. The
  removal recurses through subschemas, but keys inside name maps such as
  `properties`, `patternProperties`, `$defs`, `definitions`, and
  `dependentSchemas` are never deleted. `$schema` only selects a dialect and
  does not constrain values, so validation semantics stay the same.
- Add `tests/live/claude-live.mjs` and `npm run test:live:claude`. The suite
  runs text completion, structured output with `$defs`, `llm summarize` through
  the compiled CLI, and a read_file/write_file chat session. File tools are
  confined to a temporary sandbox.
- The live suite is outside the `tests/*.test.ts` glob, so `npm test` never
  runs it. Running it uses the installed CLI's sign-in and costs money.

## Ordered task graph

| Order | Task | Dependency | Evidence |
| --- | --- | --- | --- |
| `10000000` | Define test strategy | none | Strategy only |
| `20000000` | Implement the fix and live suite | `10000000` | Planned implementation task |
| `80000000` | Validate implementation | `10000000`, `20000000` | Planned validation procedures |
| `90000000` | Review scope and coverage | `80000000` | Planned review gate |

## Evidence boundary

The full repository gate
`npm run typecheck && npm test && npm run build && git diff --check` must pass
before this work item is complete. Live results are operational evidence for
the run that produced them only. They do not establish production readiness,
cost, or behavior of other CLI versions.
