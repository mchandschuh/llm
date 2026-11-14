---
status: planned
workItemId: WI-0008
recordType: work-item-summary
---

# WI-0008 — Consolidate completion contracts around capability-driven tool options

## Status

`planned` for the requested repository work-item preparation. No implementation,
validation, review, or delivery claim is made by this record.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0008/work-item.json`
- Classification: `/home/michael/src/github/llm/.docs/work-items/WI-0008/classification-result.json`
- Baseline: `9dfa166396a9b68e6a1b6b4e63585ec738618bc4`

## Intended outcome

Use one composite request object based on the existing request/v1 contract.
Ordinary requests omit `toolOptions`; tool-capable requests provide:

```json
{
  "toolOptions": {
    "tools": [],
    "autoInvoke": false,
    "maxRounds": 3,
    "maxCalls": 128
  }
}
```

The package should expose one `complete` function, one `LlmProvider.complete`
method, and one `OpenRouterProvider.complete` implementation. Tool behavior is
selected from `toolOptions`, not from a version-specific function, schema branch,
or provider discriminator.

The response model remains behavior-complete: ordinary output, tool calls,
pending/manual execution, automatic execution, tool results, cancellation,
validation failures, bounded retries, and diagnostics must all remain represented
by one version-neutral response contract.

## Ordered tasks

| Order | Task | Status | Dependency |
| --- | --- | --- | --- |
| `00000000` | Define unified completion-contract test strategy | `planned` | none |
| `10000000` | Implement composite request, unified runtime, and repository migration | `planned` | `00000000` |
| `80000000` | Independently validate contracts, regressions, generated output, and legacy removal | `planned` | `10000000` |
| `90000000` | Review exact implementation and validation evidence | `planned` | `80000000` |
| `91000000` | Record local release and final audit | `planned` | `90000000` |

The implementation task is contract-bearing: it repeats the exact `toolOptions`
field names and defaults, requires one public `complete`, one provider method,
one response contract, capability-driven dispatch, and removal of all legacy
version-specific artifacts. The test-strategy and validation tasks separately
require positive behavior checks and negative repository-wide removal scans.

## Repository migration boundary

The implementation must inspect and migrate all current-tree artifacts, including:

1. TypeScript request, normalized-request, provider-request, response, option, and
   public API types.
2. Request and response JSON Schemas, schema loaders, validators, examples, and
   negative examples.
3. Completion dispatch, normalization, OpenRouter transport, provider fixtures,
   exports, generated declarations, and CLI-facing behavior.
4. Unit tests, sample programs, sample filenames, sample discovery assertions,
   and public `SKILL.md` documentation.
5. Existing checked-out `.docs/work-items/` prose and verification references,
   without rewriting immutable Git history.

## Verification obligations

The future ordered steps must provide evidence for all of the following:

- request/v1 accepts both ordinary and nested-tool-options requests;
- old top-level tool controls and unknown request properties are rejected;
- default and bounded `toolOptions` values are normalized correctly;
- one `complete` entry point dispatches ordinary and tool-capable behavior;
- one provider method carries both plain and tool-capable transport;
- ordinary and tool-capable response examples validate through one schema;
- tool validation, pending behavior, automatic invocation, parallel batches,
  finish reasons, cancellation, retries, and result preservation regressions pass;
- executable samples use the unified request and entry point;
- generated declarations contain no obsolete version-specific names;
- no legacy version markers, schema paths, identifiers, old field names, or old
  sample filenames remain in the accepted current-tree scan scope;
- `npm run typecheck`, `npm test`, `npm run build`, sample integration, schema
  validation, `git diff --check`, conflict-marker scanning, and changed-path review
  all pass.

## Explicit non-claims

- No authenticated provider request is claimed.
- No real external tool invocation or side effect is claimed.
- No package publication, deployment, production readiness, or downstream
  integration evidence is included.
- This record is preparation only; later task records must establish implementation,
  validation, review, and delivery evidence separately.