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
The schema-declared file-binding extension is specified by WI-0024. These records
are intake and contract evidence; neither permits arbitrary code execution from a
request asset.

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
`<request-name>.parameters.schema.json`. The `file` property is the supported
runtime binding in this contract. It gives a parameter field file semantics
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

The `validation` member remains reserved for a separately qualified future
feature. This runtime does not evaluate function references or execute code from
request assets. Unknown `x-llm-req-parameter` members and malformed `file`
metadata fail before provider invocation.

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
6. Resolve parameters, validate supported `x-llm-req-parameter.file` metadata,
   and reject unsupported executable validation metadata before file access.
7. Discover schema-declared `x-llm-req-parameter.file` bindings and materialize
   their resolved parameter values as reference files in deterministic schema
   declaration order. A `path` binding accepts a regular file or directory and
   uses the existing recursive file and symlink rules; each array element is
   processed in order. A `content` binding creates one temporary UTF-8 file
   with its declared name, or one indexed file per array element. File-binding
   temporary resources are owned by the completion operation and are cleaned up
   after provider delegation, including failure paths.
8. Apply `$${variableName}$$` substitution to every other recognized asset's raw
   content, including Markdown and JSON, before parsing or constructing the
   request.
9. Resolve explicit additional input files using
   [Additional input files](#additional-input-files), construct the existing
   `LlmRequest` with `REQUEST_SCHEMA`, and merge them after schema-declared files
   in deterministic order. Both file sources resolve from the application
   current working directory and are available to the existing prompt composer.
10. Delegate once to the existing `complete` function. Invalid configuration,
   parameters, metadata, schemas, or substitutions produce zero provider calls.
11. Serialize through the existing raw/full response contract.

## Additional input files

Dynamic requests use the same source behavior as `llm summarize`. A request may
provide either one explicit `--path <path>` source or one explicit
`--content <text>` source per invocation; the two modes cannot be combined. With
neither option, explicit additional files are absent. These source options add
files; they do not replace the request task or request assets. They are separate
from schema-declared file bindings and may be combined with them.

`--path` accepts a regular file or a directory. A directory is traversed
recursively in deterministic sorted order. Regular files and final symlink files
are included; symlink directories are not traversed, broken links are skipped,
and a directly supplied symlink directory is rejected. Each included file is
attached to `LlmRequest.files` with a stable name, path, MIME type, and purpose.
Relative paths resolve from the application current working directory. Absolute
paths are also allowed. Additional files are not required to be contained within
the request directory or repository; request asset files remain subject to the
request-directory safety rules.

`--content` creates one synthetic UTF-8 file named `content` and marks its
purpose as command-line content rather than a filesystem file. The source files
are passed to completion under `<files>` and are available to the provider
without being parsed as request assets.

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
llm req <request-name> [--parameters <json>] [--p-<path> <value> ...] [--path <path> | --content <text>] [--format=raw|full] [--debug]
```

Successful `--format=raw` output is the model output only. `--format=full`
prints the versioned response envelope. Errors are JSON in either format and
use existing nonzero exit conventions.

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
asset and must retain its current source and output behavior. This is an
explicit compatibility requirement; its current
`--path`, recursive directory, symlink-file, `--content`, raw, and full behavior
is unchanged. It will transition to `llm req summarize` with no or minimal
changes because the generic loader uses the same source boundary and supplies
null system prompt when `summarize.prompt.system.md` is absent.

## Request-name and filesystem safety

Request names are selectors, not paths. The loader rejects absolute paths,
traversal, path separators, empty names, missing directories, symlinked
directories, non-directory targets, and assets outside the selected request
directory. Request asset loading rejects `.env`, `.env.*`, `credentials/`, and
`secrets/` paths. Additional `LlmRequest.files` inputs are intentionally exempt
from repository/request-directory containment and resolve from application CWD.

The loader does not execute shell text, JavaScript source, module paths,
templates, metadata function source, or provider configuration found in an
asset. Error messages are bounded and sanitized through the existing error
boundary.

## Work-item contract references and edit gate

Every WI-0015 through WI-0022 work-item record and every associated task must
cite the exact section(s) it implements. The authoritative section mapping is:

| Work item | Required contract sections |
| --- | --- |
| WI-0015 | [Request bundle layout](#request-bundle-layout), [Asset mapping and optionality](#asset-mapping-and-optionality), [Processing order](#processing-order), [Request-name and filesystem safety](#request-name-and-filesystem-safety) |
| WI-0016 | [Request defaults and parameter defaults](#request-defaults-and-parameter-defaults), [Parameter contract](#parameter-contract), [x-llm-req-parameter metadata](#x-llm-req-parameter-metadata) |
| WI-0017 | [Placeholder substitution](#placeholder-substitution), [Processing order](#processing-order) |
| WI-0018 | [Library and CLI boundaries](#library-and-cli-boundaries), [Prompt, schema, and summarize compatibility](#prompt-schema-and-summarize-compatibility), [Additional input files](#additional-input-files) |
| WI-0019 | [Library and CLI boundaries](#library-and-cli-boundaries), [Parameter contract](#parameter-contract) |
| WI-0020 | [Additional input files](#additional-input-files), [Library and CLI boundaries](#library-and-cli-boundaries), [Request-name and filesystem safety](#request-name-and-filesystem-safety) |
| WI-0021 | [Prompt, schema, and summarize compatibility](#prompt-schema-and-summarize-compatibility), [Additional input files](#additional-input-files) |
| WI-0022 | [Work-item validation gates](#work-item-validation-gates), [Evidence boundary](#evidence-boundary) |
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
No credentials may be committed. Custom validation metadata is a bounded
extension point; its approved implementation is separately owned by the
WI-0023 request and must remain fail-closed until implemented and tested.
