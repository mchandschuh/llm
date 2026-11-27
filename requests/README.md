# Dynamic request-directory contract

This document is the authoritative contract for the dynamic request loader,
`completeRequest`, and `llm req`. The contract is sectioned so work-item records
can cite the exact behavior they implement. It is a source of truth for this
implementation batch; later work items may not silently change it.

## Authority and operator edit gate

The authoritative contract is `/home/michael/src/github/llm/requests/README.md`.
Any change to this file requires explicit human operator confirmation before the
change is made. Work-item agents may read and implement this contract, but they
must not revise it as an incidental part of runtime implementation, testing, or
validation. A requested contract change is a separate controlled documentation
action and must be recorded in
`/home/michael/src/github/llm/requests/decisions.md`.

The request that introduced the `x-llm-req-parameter` metadata decision is
recorded at `/home/michael/src/github/llm/.docs/work-items/WI-0023/work-item-request.md`.
WI-0023 specifies inline validation functions, and WI-0024 specifies the
schema-declared file-binding extension. Validation-function source is the only
request-asset content that is executed.

## Request bundle layout

`requestsDirectory` is the configured root. Each request is one direct child
directory whose name is the request name:

```text
requestsDirectory/
└── <request-name>/
    ├── <request-name>.defaults.json
    ├── <request-name>.prompt.md            # exactly one task source
    ├── <request-name>.task.json             # exactly one task source
    ├── <request-name>.prompt.system.md     # optional
    ├── <request-name>.taskSchema.json
    ├── <request-name>.parameters.schema.json
    └── <request-name>.outputSchema.json
```

The loader recognizes the exact, case-sensitive filenames in this section. The
prefix must equal the containing request directory name. Unknown files are not
implicitly loaded as request configuration. Additional input files are supplied
through [Additional input files](#additional-input-files), not by adding
arbitrary asset suffixes.

## Asset mapping and optionality

| Asset | Required | Resulting request value | Format |
| --- | --- | --- | --- |
| `<request-name>.defaults.json` | No | Request settings and parameter defaults | JSON object |
| `<request-name>.prompt.md` | Exactly one task source | `LlmRequest.task` as text | UTF-8 Markdown |
| `<request-name>.task.json` | Exactly one task source | `LlmRequest.task` as JSON object | JSON object |
| `<request-name>.prompt.system.md` | No | `LlmRequest.systemPrompt` | UTF-8 text |
| `<request-name>.taskSchema.json` | Required when `task.json` exists; otherwise optional | `LlmRequest.taskSchema` | JSON Schema object |
| `<request-name>.parameters.schema.json` | No | Parameter grammar and validation | JSON Schema object |
| `<request-name>.outputSchema.json` | No | `LlmRequest.outputSchema` | JSON Schema object |

Exactly one of `prompt.md` and `task.json` must exist. Both present is an
ambiguous configuration error. Neither present is a missing-task error.

`prompt.md` becomes the complete string value of `LlmRequest.task`, including
Markdown and trailing newlines. `task.json` becomes the structured object value
of `LlmRequest.task`. When `task.json` is used, `taskSchema.json` is required and
validates the structured task before completion. A task schema is optional for a
text prompt, but if present it validates the resulting task value.

`<request-name>.prompt.system.md` is optional. When it exists, its complete UTF-8 text becomes
`LlmRequest.systemPrompt`. When it is absent, the request uses `systemPrompt: null`.
The provider adapter omits the system message when the value is null, or may use
the provider-specific fallback `You are a helpful assistant.` when the provider
explicitly requires a system prompt. The loader must not silently replace null
with a generic prompt.

Missing optional assets have no value and are not replaced with an empty object.
Missing required assets, both task sources present, malformed JSON, unreadable
assets, wrong-shaped assets, and invalid schemas fail before provider
invocation. The loader reports a bounded configuration/input error identifying
the request and asset kind without exposing secrets.

## Request defaults and parameter defaults

`<request-name>.defaults.json` is a JSON object with two separate namespaces:

```json
{
  "provider": "openrouter",
  "model": "openai/gpt-5.6-luna",
  "thinking": "high",
  "maxFailedAttempts": 3,
  "maxIterations": 3,
  "parameters": {
    "audience": "engineering"
  }
}
```

The supported request-setting keys are `provider`, `model`, `thinking`,
`maxFailedAttempts`, and `maxIterations`. The only parameter-default key is
`parameters`; its value must be an object. Unknown top-level settings and
credentials are rejected. Parameter defaults are validated against
`parameters.schema.json` together with caller-supplied values.

Request-setting precedence is runtime normalizer defaults, then values from
`defaults.json`, then explicit completion/CLI settings. Parameter precedence is
`defaults.parameters`, then the complete object supplied by `--parameters`,
then individual path assignments in command-line order. An explicit caller
value always overrides an asset default. Duplicate assignments and scalar/object
path conflicts are errors rather than last-write-wins behavior.

## Parameter contract

The parameter schema defines the request-specific root namespace. Assignment
names use this dot/index path grammar:

```text
root
root.child
root.items[0]
root.items.0
root.map[key]
```

The implementation supports direct roots, nested objects, array indexes, map
keys, JSON object/array values, and one complete JSON object through
`--parameters`:

```text
llm req report --p-filters.owner michael --p-sections[0].title Overview
llm req deploy --p-metadata '{"environment":"test","region":"us-east-1"}'
llm req report \
  --parameters '{"audience":"engineering","sections":[{"title":"Status"}]}' \
  --p-audience public
```

Scalar values are converted according to the target schema. Objects and arrays
must be valid JSON. No shell expansion, JavaScript evaluation, or environment
expansion occurs. `parameter` is reserved as a root property and cannot be an
assignment path. Unknown roots, invalid indexes, sparse/negative indexes, empty
segments, duplicate assignments, and conflicts fail before substitution.

The complete parameter object is validated against
`<request-name>.parameters.schema.json` before any placeholder substitution.
Required properties, types, enums, array bounds, additional properties, nested
constraints, and supported parameter metadata are all part of this gate. A
request without a parameter schema accepts only an empty parameter object.

## x-llm-req-parameter metadata

`x-llm-req-parameter` is the supported JSON Schema extension namespace for
request-parameter metadata. It is declared inside
`<request-name>.parameters.schema.json` and supports two members: `file`, which
binds a parameter to `<files>`, and `validation`, which declares an inline
JavaScript validation function. Unknown members fail before provider
invocation.

### File bindings

The `file` property gives a parameter field file semantics
without coupling behavior to a request name; a request named `summarize` and a
request named `review` use the same materialization boundary when their schemas
declare the same binding.

The metadata shape is:

```json
{
  "x-llm-req-parameter": {
    "file": {
      "mode": "path",
      "type": "text/plain",
      "purpose": "Source files supplied to the request"
    }
  }
}
```

`file` is valid on a parameter schema node whose effective value is either one
non-empty string or an array of non-empty strings (`type: "array"` with
`items.type: "string"`). Array elements are materialized independently in their
JSON array order. Its fields are:

- `mode` is required and is either `path` or `content`.
- `type` is required and is a valid MIME type used for every materialized file.
- `purpose` is required and is copied to each resulting `ReferenceFile`.
- `name` is required for `content` and is the synthetic file name. It is not
  used for `path`; path-backed names use the existing stable relative-path
  naming rules. For array-valued `content` bindings, the zero-based element
  index is inserted before the extension (`content-0.txt`, `content-1.txt`).
- `encoding` is optional and is either `utf8` or `base64`; when absent, the
  existing MIME-based encoding default applies.

For example, the generic summarize request declares its two source modes as:

```js
{
  "properties": {
    "path": {
      "type": "string",
      "minLength": 1,
      "x-llm-req-parameter": {
        "file": {
          "mode": "path",
          "type": "text/plain",
          "purpose": "Files supplied for summarization"
        }
      }
    },
    "content": {
      "type": "string",
      "minLength": 1,
      "x-llm-req-parameter": {
        "file": {
          "mode": "content",
          "name": "content",
          "type": "text/plain",
          "purpose": "Content supplied for summarization"
        }
      }
    }
  },
  "oneOf": [
    { "required": ["path"] },
    { "required": ["content"] }
  ]
}
```

The parameter schema's ordinary JSON Schema constraints, including `oneOf`,
remain responsible for cardinality and value validation. In the example, an
empty object and an object containing both `path` and `content` are invalid.

Malformed `file` metadata fails before provider invocation.

### Validation functions

`validation` declares bespoke validation that JSON Schema cannot express. It may
appear on the parameter schema root, on any node reached through `properties`,
and on array `items`, where it runs once per element. It is rejected under every
other subschema keyword, such as `oneOf`, `anyOf`, `allOf`, `not`,
`if`/`then`/`else`, `contains`, `propertyNames`, `additionalProperties`,
`patternProperties`, `$defs`, or tuple-form `items`. It may share a node with
`file`. Schemas reached only through an external `$ref` are not inspected, so
declare validators in the parameter schema itself.

```json
{
  "x-llm-req-parameter": {
    "validation": {
      "function": "(value, context) => context.fs.isFile(value) || `not a file: ${value}`",
      "message": "Optional failure message used when the function returns false"
    }
  }
}
```

- `function` is required. It is a JavaScript function expression, either as one
  string or as an array of strings joined with newlines. It must compile and
  evaluate to a callable function, not a class, before any value is
  validated.
- `message` is optional and must be a non-empty string.
- `remediation` is optional and must be a non-empty string. It tells the user
  or agent how to fix the parameter when the function returns `false` or a
  string.
- No other members are accepted.

Each function is called as `fn(value, context)` after the complete parameter
object passes JSON Schema validation. Validators run in schema declaration
order: a node's own validator runs before its descendants. Values absent from
the resolved parameters are skipped. `context` is frozen and contains:

| Member | Value |
| --- | --- |
| `path` | Concrete parameter path, such as `sections[0].title`; `''` for the root. Property names that are not identifiers are quoted, as in `["a.b"]` |
| `value` | The validated value, the same as the first argument |
| `parameters` | A deep-frozen copy of the complete resolved parameter object |
| `schema` | A deep-frozen copy of the declaring schema node |
| `request` | `{ name, directory }` of the selected request bundle |
| `workingDirectory` | The application current working directory |
| `fs` | Read-only helpers that resolve relative paths from `workingDirectory` |

The `fs` helpers are `fs.resolve(path)`, `fs.exists(path)`, `fs.isFile(path)`,
`fs.isDirectory(path)`, and `fs.readText(path)`. `fs.readText` returns UTF-8
text from a regular file of at most 1048576 bytes.

The return value decides the outcome:

- `true` or `undefined` passes.
- `false` fails with `message`, or a default message, plus
  `validation.remediation` when it is declared.
- A non-empty string fails with that string as the message, plus
  `validation.remediation` when it is declared.
- A validation result object passes or fails as described in
  [Validation result objects](#validation-result-objects).
- A thrown error fails with the error's message.
- Any other result, including a promise or other thenable, is a configuration
  error. Validators must be synchronous.
- A promise that the function creates and that rejects without a handler
  fails validation with the rejection message. It does not surface as an
  unhandled rejection.

A failure stops the request before file materialization, placeholder
substitution, and provider invocation. The first failing validator stops
validation, but one validator may report several issues.

#### Validation result objects

A validation function can return a well-defined result object. Its errors tell
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

- `valid` is a required boolean.
  - `valid: true` passes, and `errors` must then be absent or empty.
  - `valid: false` requires 1 to 20 entries in `errors`.
- Each entry in `errors` has:
  - `message` (required): a non-empty string saying what is wrong.
  - `path` (optional): the parameter path the error refers to. It defaults to
    the validator's `context.path`, and `''` names the root.
  - `remediation` (optional): a non-empty string saying how to fix it.
- No other members are accepted. Messages, remediations, and paths are
  sanitized and truncated to 500 characters.
- The object is read through own data properties only. An accessor, an
  unknown member, or a wrong type is a configuration error naming the
  validator, and validator getters never run outside the timeout.

Every validator-driven failure raises `ParameterValidationFailure`, exported
from the package entry point. This covers result objects, `false`, strings,
thrown errors, and rejected promises. It extends `LlmFailure`, keeps code
`CONFIGURATION_INVALID` and phase `configuration`, and carries
`issues: { path, message, remediation? }[]`. Its `message` summarizes the first
issue and counts the rest. Malformed metadata or results raise a plain
`LlmFailure` instead.

`llm req` writes one JSON error entry per issue:

```json
{
  "status": "configuration_error",
  "errors": [
    {
      "code": "CONFIGURATION_INVALID",
      "phase": "configuration",
      "message": "Request parameters are invalid. Validation of 'path' failed: notes.md does not exist",
      "parameterPath": "path",
      "remediation": "Pass an existing file with --p-path <file>."
    }
  ]
}
```

`parameterPath` is a request parameter path, not a file path. `remediation`
appears only when the validator supplied it.

Each call runs in a fresh `node:vm` context with a 1000 ms timeout that also
covers the context's promise jobs. The context has no `require`, `process`,
`module`, timers, or `fetch`, and string code generation (`eval`, `Function`)
is disabled. Returned and thrown values are inspected without running their
getters outside the timeout. Known Node limitation: when the timeout fires
inside a promise job while the host process tracks async context (for example
under `node:test` or with `AsyncLocalStorage`), Node 24 may abort the process
instead of reporting the timeout. The `llm` CLI is not affected. This isolation prevents
accidental use of Node APIs; it is not a security boundary. Treat request
bundles as trusted code with the same privileges as the `llm` process, and
only configure a `requestsDirectory` whose contents you trust.

## Processing order

Implementations must use this order and fail closed at each boundary:

1. Resolve the configured `requestsDirectory` through the existing shared
   configuration convention.
2. Validate `<request-name>` and resolve exactly one direct child directory
   beneath `requestsDirectory`.
3. Discover the exact assets in [Request bundle layout](#request-bundle-layout)
   and enforce the task-source, optionality, and schema rules in
   [Asset mapping and optionality](#asset-mapping-and-optionality).
4. Construct request settings and the complete parameter object using
   [Request defaults and parameter defaults](#request-defaults-and-parameter-defaults)
   and [Parameter contract](#parameter-contract).
5. Load and validate `<request-name>.parameters.schema.json` before parameter
   resolution. This asset cannot contain placeholders and is never substituted.
6. Resolve parameters, validate them against the parameter schema, and
   validate supported `x-llm-req-parameter.file` and
   `x-llm-req-parameter.validation` metadata. Malformed metadata fails here.
7. Run every `x-llm-req-parameter.validation.function` in schema declaration
   order, as described in [Validation functions](#validation-functions). A
   failing validator stops the request before file access.
8. Discover schema-declared `x-llm-req-parameter.file` bindings and materialize
   their resolved parameter values as reference files in deterministic schema
   declaration order. A `path` binding accepts a regular file or directory and
   uses the existing recursive file and symlink rules; each array element is
   processed in order. A `content` binding creates one temporary UTF-8 file
   with its declared name, or one indexed file per array element. File-binding
   temporary resources are owned by the completion operation and are cleaned up
   after provider delegation, including failure paths.
9. Apply `$${variableName}$$` substitution to every other recognized asset's raw
   content, including Markdown and JSON, before parsing or constructing the
   request.
10. Resolve explicit additional input files using
   [Additional input files](#additional-input-files), construct the existing
   `LlmRequest` with `REQUEST_SCHEMA`, and merge them after schema-declared files
   in deterministic order. Both file sources resolve from the application
   current working directory and are available to the existing prompt composer.
11. Delegate once to the existing `complete` function. Invalid configuration,
   parameters, metadata, validation functions, schemas, or substitutions
   produce zero provider calls.
12. Serialize through the existing raw/full response contract.

## Additional input files

Explicit additional input files are a library boundary. A `completeRequest`
caller may supply `files: readonly ReferenceFile[]`; each entry already carries
its stable name, path, MIME type, purpose, and optional encoding. Explicit files
add to the request; they do not replace the request task or request assets.
They are separate from schema-declared file bindings, may be combined with
them, and are merged after schema-declared files in caller order. With no
`files` option, explicit additional files are absent.

`llm req` has no separate explicit-file options. The CLI accepts only
`--parameters`, `--p-<path>` assignments, and the common output flags. A request
receives command-line files only when its parameter schema declares a parameter
with `x-llm-req-parameter.file`; for example, `--p-path` and `--p-content` are
file inputs for `summarize` only because
`requests/summarize/summarize.parameters.schema.json` declares those properties
as `path` and `content` file bindings. An unprefixed option that names a schema
parameter, such as `llm req summarize --path notes.md`, is rejected with a usage
error that suggests the `--p-` form. Any other unrecognized option is rejected.

A `mode: path` file binding accepts a regular file or a directory. A directory
is traversed recursively in deterministic sorted order. Regular files and final
symlink files are included; symlink directories are not traversed, broken links
are skipped, and a directly supplied symlink directory is rejected. Each
included file is attached to `LlmRequest.files` with a stable name, path, MIME
type, and purpose. Relative paths resolve from the application current working
directory. Absolute paths are also allowed. Explicit and schema-declared files
are not required to be contained within the request directory or repository;
request asset files remain subject to the request-directory safety rules.

A `mode: content` file binding creates one synthetic file with the declared
`name` and `purpose`. All files are passed to completion under `<files>` and are
available to the provider without being parsed as request assets.

## Placeholder substitution

The only placeholder syntax is exactly:

```text
$${variableName}$$
```

`variableName` is a parameter path using the grammar in
[Parameter contract](#parameter-contract). Missing paths, unresolved
placeholders, invalid paths, and unserializable values are bounded errors.
Near misses such as `${name}`, `$${name}`, and `$${name}$` remain ordinary text.

Strings are inserted as string data; numbers, booleans, and `null` use JSON
scalar text; objects and arrays use compact `JSON.stringify` output. Quotes,
dollar signs, newlines, and Unicode survive safely. Repeated and cross-file
placeholders resolve consistently. No unresolved placeholder reaches the
provider.

## Schema-declared files and library/CLI boundaries

Schema-declared file bindings are materialized by the shared request-completion
boundary, not by a request-name conditional in the CLI. The CLI's
`--p-<path> <value>` syntax strips only the `p-` transport prefix; the resulting
parameter path is validated against the request schema. If the target schema
node declares `x-llm-req-parameter.file`, `completeRequest` interprets the
resolved value according to that declaration and appends the resulting files to
`LlmRequest.files`.

The same behavior applies to every request name and to library callers of
`completeRequest`. The CLI and library therefore share parameter validation,
file materialization, path safety, ordering, temporary-resource cleanup, prompt
XML generation, and provider delegation. The parameter value itself is not
inserted into `<files>`; the materialized `ReferenceFile` content is.

The shared library API is:

```ts
interface CompleteRequestOptions {
  requestName: string;
  parameters?: string | Record<string, unknown>; // complete JSON object
  assignments?: readonly { path: string; value: string }[];
  files?: readonly ReferenceFile[]; // explicit additional files
}

completeRequest(options: CompleteRequestOptions): Promise<ProviderCompletionResponse>
```

The function resolves `requestName` beneath the configured requests directory,
loads assets, applies the processing order, materializes schema-declared files,
merges explicit `files`, constructs a `ProviderCompletionRequest`, invokes
`provider.complete`, and returns that provider result. `files` are explicit
additional files resolved from application current working directory and are not
repository-contained. The CLI resolves the request directory and schema first,
parses dynamic parameters, then invokes
`completeRequest({ requestName, parameters, files, ... })`; it does not interpret
any request name specially.

The CLI form is:

```text
llm req <request-name> [--parameters <json>] [--p-<path> <value> ...] [--format=raw|full] [--debug]
```

Successful `--format=raw` output is the model output only. `--format=full`
prints the versioned response envelope. Errors are JSON in either format and
use existing nonzero exit conventions. Parameter validation failures add
`parameterPath` and `remediation` fields to their error entries, as described in
[Validation result objects](#validation-result-objects).

## Prompt, schema, and summarize compatibility

Dynamic requests preserve the existing `LlmRequest` boundary:

```ts
{
  schema: REQUEST_SCHEMA,
  task: promptMdTextOrTaskJson,
  systemPrompt: promptSystemMdTextOrNull,
  taskSchema?: parsedTaskSchema,
  files?: sourceFiles,
  outputSchema?: parsedOutputSchema,
  provider?: defaults.provider,
  model?: defaults.model,
  thinking?: defaults.thinking,
  maxFailedAttempts?: defaults.maxFailedAttempts,
  maxIterations?: defaults.maxIterations,
}
```

The `requests/summarize/summarize.parameters.schema.json` asset declares
`path` and `content` file bindings with an exclusive `oneOf` source contract.
The generic form is:

```text
llm req summarize --p-path <path> [--format=raw|full]
llm req summarize --p-content <text> [--format=raw|full]
```

The resulting parameter object contains `path` or `content` without the `p-`
prefix. The shared materializer turns that value into the request's `<files>`
collection. No summarize-specific branch is permitted in the generic request
loader or completion boundary.

The existing `llm summarize` command remains valid without a system-prompt
asset. It is a compatibility adapter over `llm req summarize`, not a separate
implementation. The adapter owns only the legacy command spelling:

| `llm summarize` option | Generic request input |
| --- | --- |
| `--path <path>` | parameter `{ "path": "<path>" }` |
| `--content <text>` | parameter `{ "content": "<text>" }` |
| `--provider <provider>` | request setting `provider` |
| `--model <model>` | request setting `model` |
| `--thinking <thinking>` | request setting `thinking` |
| `--format=raw\|full`, `--debug` | the same `llm req` output and debug flags |

Exactly one of `--path` and `--content` is required, and each option may appear
once. The adapter resolves the configured `requestsDirectory` and delegates to
the same request command and `completeRequest` boundary as
`llm req summarize`. Request loading, parameter validation, recursive directory
and symlink handling, file materialization, prompt composition, provider
delegation, and raw/full/error output are therefore identical to the generic
form. Legacy `--provider`, `--model`, and `--thinking` values are explicit
settings and override `summarize.defaults.json`. The summarize prompt, output
schema, and defaults come only from `requests/summarize/`; the adapter adds no
prompt text, system prompt, or source handling of its own.

## Request-name and filesystem safety

Request names are selectors, not paths. The loader rejects absolute paths,
traversal, path separators, empty names, missing directories, symlinked
directories, non-directory targets, and assets outside the selected request
directory. Request asset loading rejects `.env`, `.env.*`, `credentials/`, and
`secrets/` paths. Additional `LlmRequest.files` inputs are intentionally exempt
from repository/request-directory containment and resolve from application CWD.

The loader does not execute shell text, module paths, templates, or provider
configuration found in an asset. The only JavaScript executed from a request
bundle is `x-llm-req-parameter.validation.function` source, run as described in
[Validation functions](#validation-functions). That isolation is not a security
boundary, so a request bundle is trusted code. Error messages are bounded and sanitized through the existing error
boundary.

## Work-item contract references and edit gate

Every WI-0015 through WI-0022 work-item record and every associated task must
cite the exact section(s) it implements. The authoritative section mapping is:

| Work item | Required contract sections |
| --- | --- |
| WI-0015 | [Request bundle layout](#request-bundle-layout), [Asset mapping and optionality](#asset-mapping-and-optionality), [Processing order](#processing-order), [Request-name and filesystem safety](#request-name-and-filesystem-safety) |
| WI-0016 | [Request defaults and parameter defaults](#request-defaults-and-parameter-defaults), [Parameter contract](#parameter-contract), [x-llm-req-parameter metadata](#x-llm-req-parameter-metadata) |
| WI-0017 | [Placeholder substitution](#placeholder-substitution), [Processing order](#processing-order) |
| WI-0018 | [Schema-declared files and library/CLI boundaries](#schema-declared-files-and-librarycli-boundaries), [Prompt, schema, and summarize compatibility](#prompt-schema-and-summarize-compatibility), [Additional input files](#additional-input-files) |
| WI-0019 | [Schema-declared files and library/CLI boundaries](#schema-declared-files-and-librarycli-boundaries), [Parameter contract](#parameter-contract) |
| WI-0020 | [Additional input files](#additional-input-files), [Schema-declared files and library/CLI boundaries](#schema-declared-files-and-librarycli-boundaries), [Request-name and filesystem safety](#request-name-and-filesystem-safety) |
| WI-0021 | [Prompt, schema, and summarize compatibility](#prompt-schema-and-summarize-compatibility), [Additional input files](#additional-input-files) |
| WI-0022 | [Work-item validation gates](#work-item-validation-gates), [Evidence boundary](#evidence-boundary) |
| WI-0023 | [x-llm-req-parameter metadata](#x-llm-req-parameter-metadata), [Processing order](#processing-order), [Request-name and filesystem safety](#request-name-and-filesystem-safety), [Evidence boundary](#evidence-boundary) |
| WI-0024 | [x-llm-req-parameter metadata](#x-llm-req-parameter-metadata), [Schema-declared files and library/CLI boundaries](#schema-declared-files-and-librarycli-boundaries), [Additional input files](#additional-input-files), [Prompt, schema, and summarize compatibility](#prompt-schema-and-summarize-compatibility), [Request-name and filesystem safety](#request-name-and-filesystem-safety) |

Explicit human operator confirmation is required before any work-item or task
modifies this README. This gate applies even when the modification is intended
to clarify an implementation. Contract changes require explicit human operator
confirmation. Work-item agents may persist implementation,
validation, review, and completion evidence in their governed task records and
may commit those records according to repository governance.

## Work-item validation gates

Each work item is a mandatory gate in order. Before the next work item may begin,
the current work item must have a passing validation task and a passing full
repository suite. The required package gate is:

```text
npm run typecheck && npm test && npm run build && git diff --check
```

`npm test` means the entire repository test suite, not only a focused selector.
Focused tests are additional evidence and do not replace the full suite. The
validation task must record the full-suite command, its passing result, and any
limitations. A failed or unrun full suite blocks continuation to the next work
item. After the package gate, run `sdlc work-item validate --work-item WI-####`
for the current work item and preserve its result before continuing.

## Evidence boundary

The contract and work-item records define provider-free implementation and
validation evidence. They do not establish authenticated provider availability,
deployment, publication, production readiness, or external service behavior.
No credentials may be committed. Validation-function evidence is provider-free
and local. It does not establish that the `node:vm` isolation is a security
sandbox.
