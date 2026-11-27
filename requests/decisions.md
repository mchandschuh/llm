# Dynamic request implementation decisions

This record tracks decisions for the WI-0015 through WI-0024 implementation
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

`x-llm-req-parameter` is the supported JSON Schema extension namespace for
parameter metadata. WI-0023 records the earlier custom-validation request, but
custom validation-function execution remains reserved and unsupported. WI-0024
defines the supported `x-llm-req-parameter.file` binding for declarative path and
content file materialization. Any future custom-validation implementation must
be separately qualified and owned by its own work item.

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
is this D01–D14 decision set.

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

## D14 — Schema-declared parameter file bindings

`x-llm-req-parameter.file` is the request-schema declaration for turning a
resolved string or string-array parameter into one or more `LlmRequest.files`
reference files. Array elements are materialized independently in declaration
and element order.
The declaration is interpreted by the shared `completeRequest` boundary, not by
the request name or a summarize-specific CLI branch. `mode: path` uses the
existing external path/directory traversal and source-safety behavior;
`mode: content` creates one declared-name temporary file for scalar bindings or
one indexed temporary file per array element. The materialized files
are merged with explicit additional files before normalization and prompt
composition, and temporary resources are cleaned up on all completion paths.
Malformed or unsupported file metadata, invalid annotated values, and parameter
schema violations fail before provider invocation. The current contract
supports scalar string and string-array file fields; custom validation-function
execution and object file-binding values remain outside this work item.

## D15 — CLI files come only from schema-declared bindings

Confirmed by the human operator during WI-0021: `requests/README.md` documents
current `llm req` behavior and is updated when it disagrees with the
implementation. `llm req` has no explicit `--path`/`--content` file options.
Command-line files reach `<files>` only through parameters that the request's
parameter schema declares with `x-llm-req-parameter.file`. `--p-path` and
`--p-content` are file inputs for `summarize` only because its parameter schema
declares them. Explicit additional files remain a library-only
`completeRequest({ files })` option. `llm summarize` is a compatibility adapter
that maps `--path`/`--content` to the generic `path`/`content` parameters and
maps `--provider`/`--model`/`--thinking` to explicit request settings.

## D16 — Contract-reference anchors

During WI-0022 documentation validation, the work-item contract-reference
table's stale `#library-and-cli-boundaries` links were retargeted to the
current [Schema-declared files and library/CLI boundaries] section. The cited
behavior is unchanged. Every in-document anchor in `requests/README.md` is now
checked by `WI-0022-10000000_TC-DOCUMENTATION-CONSISTENCY`.

## D17 — Inline parameter validation functions

Confirmed by the human operator for WI-0023. This supersedes the earlier
decisions that kept `x-llm-req-parameter.validation` reserved and unsupported.
A parameter schema may declare `x-llm-req-parameter.validation.function` as an
inline JavaScript function expression. The shared `completeRequest` boundary
calls it as `fn(value, context)` after JSON Schema validation and before file
materialization, placeholder substitution, and provider delegation. The frozen
context exposes the parameter path, value, a deep-frozen copy of the resolved
parameters, the schema node, request identity, working directory, and read-only
filesystem helpers. Validators are synchronous and run in a fresh `node:vm`
context without Node globals or string code generation, with a 1000 ms
timeout. That isolation is not a security boundary: request bundles are trusted
code. Validator modules, asynchronous validators, and filesystem writes remain
out of scope.

## D18 — Structured validation results

Requested for WI-0025. A validation function may return the closed object
`{ valid, errors: [{ message, path?, remediation? }] }`. When `valid` is false,
the object carries 1 to 20 errors, and text is truncated to 500 characters.
The object is read only through own data properties, so validator getters
never run outside the vm timeout. Validation metadata gains an optional
`remediation` for `false` and string returns. Every validator-driven failure
raises the exported `ParameterValidationFailure` with normalized `issues`.
`llm req` writes one error entry per issue with `parameterPath` and
`remediation`. The first failing validator still stops validation, and the
response schema and error codes are unchanged.

## D19 — claude is the default provider

Requested for WI-0026. A built-in `claude` provider runs the Claude Code CLI
non-interactively (`claude -p --output-format json --safe-mode`, no built-in or
MCP tools, no session persistence, with the request on stdin). It is the
default provider, with default model `sonnet`, while `openrouter` keeps
`openai/gpt-5.6-luna`. Provider names resolve through one registry, and the
bundled summarize request no longer pins openrouter. Tool calling through
claude uses the existing tool schemas: definitions are listed in the prompt,
and `--json-schema` constrains replies to a stop/output or continue/toolCalls
envelope. The test suite always points the provider at a fake CLI.

WI-0026 review follow-up: generated `--json-schema` envelopes keep a flat
object root and hoist embedded caller schemas into `$defs`, rewriting their
local refs. Each completion has a 10-minute default timeout
(`LLM_CLAUDE_TIMEOUT_MS`) with SIGKILL escalation. Removing the summarize
openrouter pins changes `llm summarize --provider openrouter` from
`openai/gpt-5-nano` to `openai/gpt-5.6-luna`; pass `--model` to keep the old
model.
