---
status: planned
workItemId: WI-0024
recordType: work-item-summary
---

# WI-0024 — Add schema-declared request parameter file bindings

## Status

`planned`. This work item captures the complete contract and implementation plan
for reusable schema-declared parameter file bindings. It does not claim
implementation, test execution, provider availability, production readiness,
release, or deployment.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0024/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0024/steps/`
- Contract: `/home/michael/src/github/llm/requests/README.md`
- Decision record: `/home/michael/src/github/llm/requests/decisions.md`
- Baseline: `a1519eb493cbc357a336711e9cb7c689e6075d0a`

## Authoritative request contract

This work item updates and implements these exact sections of
[`requests/README.md`](../../../requests/README.md): [x-llm-req-parameter metadata](../../../requests/README.md#x-llm-req-parameter-metadata), [Processing order](../../../requests/README.md#processing-order), [Additional input files](../../../requests/README.md#additional-input-files), [Schema-declared files and library/CLI boundaries](../../../requests/README.md#schema-declared-files-and-librarycli-boundaries), [Prompt, schema, and summarize compatibility](../../../requests/README.md#prompt-schema-and-summarize-compatibility), and [Request-name and filesystem safety](../../../requests/README.md#request-name-and-filesystem-safety). Explicit human operator confirmation is required before modifying `/home/michael/src/github/llm/requests/README.md`; that confirmation is supplied by this request.

The decision log records the contract revision as D14. The work item must not
silently broaden the contract beyond the sections listed above.

## Intended outcome

Allow any dynamic request to declare that a parameter field materializes input
files. The declaration is schema-owned and request-name agnostic. `llm req`
passes `--p-<parameter-path>` values into the ordinary parameter object;
`completeRequest` resolves the parameter object and schema-declared file bindings,
merges them with explicit additional files, and sends all materialized content
through the existing `LlmRequest.files` → prompt XML `<files>` → provider HTTP
projection path.

## Binding contract

The supported metadata is attached to a parameter schema node:

```json
{
  "type": "string",
  "minLength": 1,
  "x-llm-req-parameter": {
    "file": {
      "mode": "path",
      "type": "text/plain",
      "purpose": "Source files supplied to the request"
    }
  }
}
```

`file` supports:

- `mode: "path"`: the parameter value is one non-empty path to a regular file
  or directory. Directory traversal, ordering, final-file symlinks, broken
  links, direct symlink-directory rejection, MIME handling, and external CWD
  resolution reuse the existing additional-file behavior.
- `mode: "content"`: the parameter value is one non-empty inline string. The
  runtime creates one temporary UTF-8 file using the declared `name`, `type`,
  and `purpose`.
- `type` and `purpose` are required metadata; `encoding` is optional and uses
  existing MIME defaults when omitted. `name` is required for content bindings
  and is not used for path bindings.

The first implementation supports scalar string parameter nodes only. Binding
metadata on arrays, objects, or unsupported schema compositions is a bounded
configuration error. Unknown metadata members, malformed metadata, invalid
MIME types, and unsupported executable validation metadata fail before provider
invocation. Custom validation-function execution remains outside this work item.

The summarize example declares `path` and `content` properties in
`requests/summarize/summarize.parameters.schema.json`; its ordinary JSON Schema
uses `oneOf` so exactly one source is required. The generic request command uses:

```text
llm req summarize --p-path <path>
llm req summarize --p-content <text>
```

The parameter object contains `path` or `content` without the `p-` transport
prefix. No code may branch on `requestName === "summarize"` to assign file
semantics.

## Shared execution design

1. The parser continues to use the loaded parameter schema to discover valid
   `--p-` roots and returns parameter assignments without interpreting their
   names.
2. `completeRequest` becomes the single parameter-resolution and
   schema-declared-file-materialization boundary. Extend its options so the CLI
   can pass raw `--parameters` JSON and assignments without constructing a
   second parameter object in the CLI. Existing library callers supplying a
   resolved parameter object remain supported.
3. A reusable file-materialization module walks the parameter schema in stable
   declaration order, finds `x-llm-req-parameter.file` bindings, reads the
   resolved parameter paths/values, and returns `ReferenceFile` descriptors plus
   cleanup ownership for temporary content files.
4. Explicit `--path`/`--content` additional files remain an additive channel.
   They use shared source/file preparation primitives and are merged after
   schema-declared files in deterministic order.
5. The normalized files flow unchanged through `normalizeRequest`,
   `composeRequestPrompt`, and `OpenRouterHttpProjection`. The feature must not
   create a second XML format, provider API, or request-name registry.
6. Temporary resources are cleaned up on success, provider failure, validation
   failure, and thrown exceptions. Invalid metadata and parameter values produce
   zero provider calls.

## Scope

- **schema-contract:** Define and validate `x-llm-req-parameter.file`, including
  path/content modes, metadata, supported schema-node shapes, and errors.
- **shared-materialization:** Implement one reusable materialization boundary
  shared by `completeRequest` and the CLI-facing execution path.
- **parameter-api:** Pass raw parameter JSON/assignments through the shared
  request boundary so parameters are constructed once and file bindings are
  materialized centrally.
- **summarize-example:** Add summarize parameter schema assets and exercise
  `--p-path`/`--p-content` without a summarize-specific runtime branch.
- **compatibility:** Preserve explicit additional files, existing prompt XML,
  provider projection, output formats, path safety, and `llm summarize` behavior.
- **evidence:** Add provider-free tests for generic bindings, summarize, errors,
  ordering, cleanup, and the no-provider-call boundary.

## Non-goals

- Do not execute JavaScript, custom validation functions, shell text, templates,
  or module paths from request assets.
- Do not infer file behavior from request names, parameter names, or conventions
  outside declared schema metadata.
- Do not support parameter arrays/objects as file bindings in this work item.
- Do not redesign the prompt XML schema, provider interfaces, OpenRouter HTTP
  projection, credentials, output envelope, or unrelated CLI commands.
- Do not remove explicit `--path`/`--content` additional-file compatibility.
- Do not make authenticated provider calls, publish, deploy, or claim production
  readiness.

## Ordered task graph

| Order | Task | Dependency | Evidence |
| --- | --- | --- | --- |
| `10000000` | Define test strategy | none | Strategy contract |
| `20000000` | Implement schema-declared file bindings | `10000000` | Production code, assets, and tests |
| `80000000` | Validate implementation | `10000000`, `20000000` | Provider-free package gate |
| `90000000` | Review scope and evidence | `80000000` | Independent review |

## Test strategy expectation

The strategy must include at least one executable provider-free test case for
every requirement, explicit acceptance-criterion mappings, and negative cases for
both/none source modes, malformed metadata, unsupported schema nodes, unsafe
paths, cleanup, ordering, generic request names, and zero provider calls.
Validation must execute:

```text
npm run typecheck && npm test && npm run build && git diff --check
```

Focused tests supplement but never replace the full gate. Test source should use
stable task-ID-prefixed names and trace markers.

## Evidence boundary

Local tests and package validation can establish schema parsing, parameter
resolution, file materialization, prompt XML inclusion, provider-free delegation,
cleanup, and compatibility. They cannot establish authenticated provider
behavior, network transport success, deployment, publication, downstream
integration, or production readiness.