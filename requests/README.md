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
That request is intake evidence, not permission to execute arbitrary code from a
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

`prompt.system.md` is optional. When it exists, its complete UTF-8 text becomes
`LlmRequest.systemPrompt`. When it is absent, the loader supplies this exact
non-empty default so the existing `LlmRequest` boundary remains valid:

```text
Follow the task instructions and return the requested result.
```

No request is required to provide a system-prompt file. The loader must not
invert task and system instructions or silently use the task content as the
system prompt.

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
llm req report --filters.owner michael --sections[0].title Overview
llm req deploy --metadata '{"environment":"test","region":"us-east-1"}'
llm req report \
  --parameters '{"audience":"engineering","sections":[{"title":"Status"}]}' \
  --audience public
```

Scalar values are converted according to the target schema. Objects and arrays
must be valid JSON. No shell expansion, JavaScript evaluation, or environment
expansion occurs. `parameter` is reserved as a root property and cannot be an
assignment path. Unknown roots, invalid indexes, sparse/negative indexes, empty
segments, duplicate assignments, and conflicts fail before substitution.

The complete parameter object is validated against
`<request-name>.parameters.schema.json` before any placeholder substitution.
Required properties, types, enums, array bounds, additional properties, nested
constraints, and custom metadata validation are all part of this gate. A request
without a parameter schema accepts only an empty parameter object.

## x-llm-req-parameter metadata

`x-llm-req-parameter` is the one supported JSON Schema extension metadata key for
parameter metadata. It is declared inside
`<request-name>.parameters.schema.json`. Its first use case is custom validation
that ordinary JSON Schema cannot express.

The metadata shape is:

```json
{
  "x-llm-req-parameter": {
    "validation": {
      "function": "<approved custom-validation function reference>"
    }
  }
}
```

The `function` value is a reference/intent for an approved validation
implementation; it is not JavaScript source and must never be evaluated with
`eval`, `Function`, a shell, a module path, or an arbitrary child process. The
custom validator runs only after ordinary JSON Schema validation and before
substitution. It receives the completed parameter object, returns a bounded
pass/fail result, and cannot read credentials, escape the request root, or make
provider calls. Unsupported or malformed metadata fails closed before provider
invocation. The WI-0023 request identifies the follow-up; a separately qualified
implementation work item must own the extension details and tests. WI-0015
through WI-0022 preserve the metadata and validation boundary without inventing
a second key.

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
5. Validate JSON Schema and approved `x-llm-req-parameter` metadata before
   substitution.
6. Apply `$${variableName}$$` substitution to every recognized asset's raw
   content, including Markdown and JSON, before parsing or constructing the
   request.
7. Resolve additional input files using
   [Additional input files](#additional-input-files), construct the existing
   `LlmRequest` with `REQUEST_SCHEMA`, and keep files under the permitted root.
8. Delegate once to the existing `complete` function. Invalid configuration,
   parameters, metadata, schemas, or substitutions produce zero provider calls.
9. Serialize through the existing raw/full response contract.

## Additional input files

Dynamic requests use the same source behavior as `llm summarize`. A request may
provide either one `--path <path>` source or one `--content <text>` source per
invocation; the two modes cannot be combined. With neither option, the request
has no additional files. These source options add files; they do not replace the
request task or request assets.

`--path` accepts a regular file or a directory. A directory is traversed
recursively in deterministic sorted order. Regular files and final symlink files
are included; symlink directories are not traversed, broken links are skipped,
and a directly supplied symlink directory is rejected. Each included file is
attached to `LlmRequest.files` with a stable relative name, path, MIME type, and
purpose. Relative paths resolve from the current working directory using the
same boundary as summarize, then remain contained by the permitted source root.

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

## Library and CLI boundaries

The shared library API is:

```ts
completeRequest(requestDirectory, parameters, options?)
```

It loads one already-selected request bundle, applies the processing order,
constructs the existing `LlmRequest`, attaches any additional source files, and
delegates once to `complete`. `options` passes through the injected provider,
configuration root, debug sink, cancellation signal, and other existing
completion controls. The CLI and library share this construction path.

The CLI form is:

```text
llm req <request-name> [--parameters <json>] [--<path> <value> ...] [--path <path> | --content <text>] [--format=raw|full] [--debug]
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
  systemPrompt: promptSystemMdTextOrDefault,
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

The existing `llm summarize` command remains valid without a system-prompt
asset and must retain its current source and output behavior. This is an
explicit compatibility requirement; its current
`--path`, recursive directory, symlink-file, `--content`, raw, and full behavior
is unchanged. It will transition to `llm req summarize` with no or minimal
changes because the generic loader uses the same source boundary and supplies
the default system prompt when `summarize.prompt.system.md` is absent.

## Request-name and filesystem safety

Request names are selectors, not paths. The loader rejects absolute paths,
traversal, path separators, empty names, missing directories, symlinked
directories, non-directory targets, and assets outside the selected request
directory. It rejects `.env`, `.env.*`, `credentials/`, and `secrets/` paths.

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
