# Dynamic request implementation decisions

This record tracks decisions for the WI-0015 through WI-0022 implementation
cycle. The authoritative contract remains
`/home/michael/src/github/llm/requests/README.md`.

## D01 — Task source alternatives

Each request must provide exactly one task source: `<request-name>.prompt.md` or
`<request-name>.task.json`. Both or neither is invalid. `task.json` is a JSON
object task and requires `taskSchema.json`; `prompt.md` is a text task and may
use an optional task schema.

## D02 — Optional system prompt

`<request-name>.prompt.system.md` is optional. When absent, the request uses
`systemPrompt: null`. Providers omit the system message or may use the explicit
provider fallback `You are a helpful assistant.` when required.

## D03 — Parameter metadata and custom validation

`x-llm-req-parameter` is the one supported JSON Schema extension metadata key for
parameter metadata. Its first use case is custom validation that ordinary JSON
Schema cannot express. The validator function is evaluated and invoked directly with `context` and the
fully resolved `parameters`. The minimum context includes request-directory file
contents; the return contract is deferred and is expected to communicate success
or bounded failure errors. Security implications are accepted limitations for
this planned feature. WI-0023 records the request; a separately qualified
implementation work item must own the approved custom-validation implementation
and tests.

## D04 — README consistency gate

The request README is authoritative and must be internally consistent before
downstream work proceeds. The specified asset list, task alternatives, optional
system prompt, defaults, files, metadata, processing order, and output rules
must agree across all sections.

## D05 — Additional files

Dynamic requests use the existing summarize source pattern. One `--path` file or
directory, or one `--content` value, may add input files to `LlmRequest.files`.
Directory traversal, regular-file handling, symlink behavior, deterministic
ordering, and synthetic content-file behavior match summarize. Additional files
may be anywhere on disk; relative paths resolve from application CWD.

## D06 — Summarize compatibility

`llm summarize` remains valid without a system-prompt asset and must retain its
current source and output behavior. This is an explicit compatibility
requirement. Its transition to `llm req summarize` should require no or minimal changes because the generic loader supplies the default
system prompt.

## D07 — Section-addressable task references

Every WI-0015 through WI-0022 `work-item.json` and every associated task must
reference `/home/michael/src/github/llm/requests/README.md` and cite the exact
Markdown section(s) implementing its behavior.

## D08 — Contract iteration

The README is iterated as an explicit, human-confirmed contract activity. The
decision log and work-item records preserve why a contract revision was made;
implementation agents do not revise it opportunistically. The current revision
is this D01–D13 decision set.

## D09 — Baseline meaning

The `baseline` field records when the work item was declared. It is historical
coordination metadata and is not a processing blocker for this implementation
effort. A stale baseline alone must not block processing.

## D10 — Contract authority

`requests/README.md` is authoritative for this batch. If a task record conflicts
with it, processing stops for human reconciliation rather than silently choosing
the older task wording. Contract changes require explicit human operator
confirmation.

## D11 — Evidence persistence

The earlier no-commit restriction is removed for this validation gate. Task
implementation, validation, review, and completion evidence may be persisted and
committed under the applicable governance contract; no release or publication is
implied.

## D12 — Human confirmation for contract edits

All work-item records and tasks must state that explicit human operator
confirmation is required before modifying `requests/README.md`.

## D13 — Full-suite continuation gate

Every validation task must require and record:

```text
npm run typecheck && npm test && npm run build && git diff --check
```

The full suite must pass before the current work item is considered complete or
the next work item begins. Focused tests supplement but never replace this gate.
