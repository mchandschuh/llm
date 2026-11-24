# Dynamic request-directory contract

This directory contains named, provider-agnostic request bundles. The contract
below is the source of truth for the request loader, the `completeRequest`
library boundary, and the `llm req` command. The loader and command are planned
as subsequent implementation slices; this document does not claim that those
interfaces are available in the current release.

## Supported tree

`requestsDirectory` is the configured root. Each request is one direct child
directory whose name is the request name:

```text
requestsDirectory/
└── <request-name>/
    ├── <request-name>.defaults.json
    ├── <request-name>.prompt.md
    ├── <request-name>.prompt.system.md
    ├── <request-name>.taskSchema.json
    ├── <request-name>.parameters.schema.json
    └── <request-name>.outputSchema.json
```

The six filenames are recognized by exact, case-sensitive match. The prefix
must equal the containing request directory name. Unknown files are ignored by
the request loader and are not implicitly added to the request. A request may
also contain supporting files for later, explicitly declared features, but no
supporting file is read by this contract.

### Asset mapping and optionality

| Asset | Required | Resulting request value | Format |
| --- | --- | --- | --- |
| `<request-name>.defaults.json` | No | Request defaults merged before completion | JSON object |
| `<request-name>.prompt.md` | Yes | `LlmRequest.task` | UTF-8 text |
| `<request-name>.prompt.system.md` | Yes | `LlmRequest.systemPrompt` | UTF-8 text |
| `<request-name>.taskSchema.json` | No | `LlmRequest.taskSchema` | JSON Schema object |
| `<request-name>.parameters.schema.json` | No | Parameter grammar and validation | JSON Schema object |
| `<request-name>.outputSchema.json` | No | `LlmRequest.outputSchema` | JSON Schema object |

Missing optional assets have no value; they are not replaced with an empty
object or an empty string. The two prompt assets are required because the
existing `LlmRequest` contract requires both `task` and `systemPrompt`.
Missing required assets, duplicate/ambiguous recognized assets, malformed JSON,
and a recognized asset with the wrong shape are configuration errors reported
before provider invocation.

`prompt.md` is the task, not the system instruction. Its complete UTF-8 text
becomes `LlmRequest.task` as a string, including Markdown formatting and
trailing newlines. `prompt.system.md` becomes `LlmRequest.systemPrompt` as a
string. The loader must not infer either field from the other asset, invert the
mapping, or silently add a system instruction.

The JSON assets are parsed as follows:

- `defaults.json` is a JSON object containing only supported request defaults.
- `taskSchema.json`, `parameters.schema.json`, and `outputSchema.json` are JSON
  Schema objects. They are compiled/validated before completion.
- A schema asset is not a parameter value and is never sent as an arbitrary
  provider setting.
- Credentials are never read from a request asset. They must remain an
  in-memory completion option or an approved external provider configuration.

The supported defaults are the existing request settings: `provider`, `model`,
`thinking`, `maxFailedAttempts`, and `maxIterations`. Defaults do not add new
`LlmRequest` fields and do not permit `credentials`, `files`, `messages`,
`toolOptions`, arbitrary provider options, or unknown properties. Runtime
defaults apply when neither an asset default nor an explicit completion option
sets a value.

## Processing order

Implementations must use this order and fail closed at each boundary:

1. Resolve the configured `requestsDirectory` using the existing shared
   configuration convention. Do not introduce a command-specific configuration
   lookup.
2. Validate `<request-name>` and resolve exactly one direct child directory
   beneath `requestsDirectory`.
3. Discover only the six recognized assets for that request and reject missing
   required assets, ambiguity, unsafe paths, unreadable files, malformed JSON,
   wrong-shaped JSON, and invalid schemas.
4. Construct the parameter object from `parameters.schema.json` and the CLI or
   library parameter input. If no parameters schema exists, no parameter
   assignments are accepted and the parameter object is `{}`.
5. Apply `$${variableName}$$` substitution to every recognized asset's raw
   content, including Markdown and JSON, before parsing or constructing the
   request. Resolve nested paths from the completed parameter object.
6. Parse the substituted JSON assets, validate the completed parameter object,
   and construct the existing `LlmRequest` shape with `REQUEST_SCHEMA`.
7. Resolve request-relative file references, if a later request feature adds
   declared references, beneath the request directory and pass the resulting
   configuration root to the existing completion boundary.
8. Delegate once to the existing `complete` function. Invalid configuration,
   parameters, schemas, or substitutions must produce zero provider calls.
9. Serialize the response through the existing output contract. No provider,
   protocol, or response-envelope variant is invented by dynamic requests.

Parameter validation occurs before placeholder substitution so that a malformed
or schema-invalid value cannot be smuggled into an asset. Substitution occurs
before JSON parsing so a JSON value can be supplied by a parameter and so JSON
syntax errors identify the substituted asset.

## Parameters

The parameter schema defines the request-specific root namespace. Parameter
assignment names use a dot/index path grammar:

```text
root
root.child
root.items[0]
root.items.0
root.map[key]
```

The implementation must support:

- direct root properties, such as `--temperature 0.2`;
- nested object properties, such as `--person.name Ada`;
- array indexes, such as `--messages[0].role user`;
- map keys, such as `--labels[release] stable`;
- JSON object or array values, supplied as one JSON value, such as
  `--metadata '{"team":"platform"}'`; and
- one complete JSON parameter object supplied with `--parameters`.

The CLI form is:

```text
llm req <request-name> [--parameters <json>] [--<path> <value> ...] [--format=raw|full] [--debug]
```

The command parser forwards request-specific parameter tokens without trying to
interpret them against a schema. The request loader owns grammar, scalar
conversion, JSON parsing, duplicate detection, and schema validation. `--format`
and `--debug` are common CLI controls and are not parameter assignments.

### Conversion and precedence

Scalar CLI values are converted according to the target schema: strings remain
strings, JSON booleans become booleans, JSON `null` becomes `null`, and valid
JSON numbers become numbers. A value beginning with `{` or `[` must parse as a
complete JSON object or array; malformed JSON is an input error rather than a
literal fallback. Quoted JSON strings may be used when a string contains JSON
syntax. No JavaScript expressions, shell evaluation, or environment expansion
is performed.

Precedence is deterministic:

1. runtime defaults from the existing normalizer;
2. values in `<request-name>.defaults.json`;
3. the complete object supplied by `--parameters`; and
4. individual path assignments on the command line, in argument order.

Thus an individual assignment overrides the same path in `--parameters`, and a
request default never overrides an explicit caller value. The library API uses
the same order: runtime defaults, asset defaults, complete parameter object,
then explicit path assignments when represented by its parameter input.

Duplicate assignments to the same path are errors, including duplicate
`--parameters` options and repeated individual path options. A path conflict
such as assigning `a` a scalar and then assigning `a.b` is also an error; the
implementation must not silently replace a scalar with an object or corrupt a
sibling. `parameter` is reserved and cannot be a root property or an assignment
path because it is the complete-object option name. Unknown roots, invalid
indexes, sparse/negative array indexes, empty path segments, and assignments
outside the schema fail before substitution.

Examples:

```text
# direct scalar
llm req summarize --style concise

# nested object and array paths
llm req report --filters.owner michael --sections[0].title Overview

# object-valued assignment
llm req deploy --metadata '{"environment":"test","region":"us-east-1"}'

# complete object, with a targeted override
llm req report \
  --parameters '{"audience":"engineering","sections":[{"title":"Status"}]}' \
  --audience public
```

The final parameter object is validated against
`<request-name>.parameters.schema.json` before any asset is substituted. The
schema is authoritative for required properties, types, enums, array bounds,
additional properties, and nested constraints. A request without a parameter
schema accepts only an empty parameter object.

## Placeholder substitution

The only placeholder syntax is exactly:

```text
$${variableName}$$
```

`variableName` is a parameter path using the same nested dot/index notation as
CLI assignments. For example, `$${person.name}$$` resolves `person.name` and
`$${items[0]}$$` resolves the first array element. A missing path, an unresolved
placeholder, an invalid path, or a value that cannot be serialized is a bounded
configuration/input error. Near misses such as `${name}`, `$${name}`, or
`$${name}$` are ordinary text and do not receive partial substitution.

Replacement uses JSON serialization for values:

| Value | Replacement |
| --- | --- |
| string | The string value |
| number, boolean, or `null` | JSON scalar text |
| object or array | Compact `JSON.stringify` output |

Quotes, dollar signs, newlines, Unicode, and other content in a string are
preserved as data. A complex value inserted into a JSON asset must be placed in
a context where the resulting JSON remains valid; the asset parser reports an
error otherwise. Repeated placeholders resolve identically. Replacement is
performed across all six recognized assets before any of them is parsed, so a
parameter may be used in a prompt, system prompt, defaults file, or schema.
Credentials and secret material must not be supplied as parameter values.

## Library and CLI boundaries

The shared library API is:

```ts
completeRequest(requestDirectory, parameters, options?)
```

`requestDirectory` is one already-selected request bundle directory, not the
parent `requestsDirectory`. `parameters` is the complete parameter input for
the bundle, and `options` passes through the existing completion controls,
including an injected provider for deterministic tests, configuration root,
debug sink, cancellation signal, and output-related completion options. The
function loads assets, constructs the existing `LlmRequest`, and calls
`complete` once. The library and CLI must share this path rather than maintain
separate request construction behavior.

The CLI resolves a request name beneath configured `requestsDirectory`, forwards
the request-specific parameter tail, invokes the same library boundary, and
uses the existing response writer. It does not expose a second provider or
configuration protocol.

Successful output preserves the existing formats:

- `--format=raw` writes the successful model output only (the default for
  successful completions); and
- `--format=full` writes the versioned response envelope, including status,
  output, counters, and errors.

Errors remain JSON in either format and use the existing nonzero exit-code
conventions. Usage/argument errors are input errors; request asset, parameter,
schema, and substitution failures are configuration/input failures before a
provider call.

## Prompt, schema, and summarize compatibility

Dynamic requests preserve the existing `LlmRequest` boundary:

```ts
{
  schema: REQUEST_SCHEMA,
  task: promptMdText,
  systemPrompt: promptSystemMdText,
  taskSchema?: parsedTaskSchema,
  outputSchema?: parsedOutputSchema,
  provider?: defaults.provider,
  model?: defaults.model,
  thinking?: defaults.thinking,
  maxFailedAttempts?: defaults.maxFailedAttempts,
  maxIterations?: defaults.maxIterations,
}
```

The dynamic layer does not create a generic replacement for `LlmRequest`, swap
task and system prompt, or pass parameter-schema metadata to the provider.

The existing `llm summarize` command remains a compatibility wrapper around its
specialized source preparation until the summarize migration task is complete.
Its `--path` and `--content` source modes, recursive directory collection,
final symlink-file behavior, completion boundary, and raw/full output semantics
remain owned by that command. The current summarize assets are therefore not
silently reinterpreted as generic request assets in this documentation task;
the later summarize migration must explicitly map them and add a validated
`llm req` example.

## Request-name and filesystem safety

Request names are selectors, not paths. A valid name is one safe, non-empty
single directory name beneath the configured `requestsDirectory`. The loader
rejects absolute paths, `.` and `..`, path separators, empty names, names that
escape the configured root, missing directories, directories reached through
symlinks, and non-directory targets before reading assets.

Recognized assets must be regular readable files beneath the selected request
directory. No path is resolved from the process working directory, and no
request asset may read `.env`, `.env.*`, `credentials/`, or `secrets/` content.
The loader does not execute shell text, JavaScript, module paths, templates, or
provider configuration found in an asset. Error messages are bounded and
sanitized through the existing error boundary.

## Evidence boundary and later work

This README defines the contract; it is not implementation or execution
evidence. The later work-item sequence owns the corresponding behavior:

| Work item | Boundary |
| --- | --- |
| WI-0015 | Safe request resolution, asset discovery, parsing, and bounded errors |
| WI-0016 | Schema-aware direct, nested, indexed, object-valued, and full-object parameters |
| WI-0017 | Exact placeholder substitution and complex-value serialization |
| WI-0018 | Exported `completeRequest` library boundary and single delegation |
| WI-0019 | `llm req` argument parsing and parameter forwarding |
| WI-0020 | CLI execution, response output, and exit-code integration |
| WI-0021 | Summarize generic-example migration and compatibility regressions |
| WI-0022 | Full provider-free matrix, package gates, declarations, documentation, and scope review |

Evidence for these later tasks must remain provider-free wherever possible and
must include negative/security cases, no-provider-call assertions, typechecking,
tests, build/declaration checks, documentation checks, and changed-path review.
No task in this sequence authorizes authenticated provider calls, deployment,
publication, production-readiness claims, credentials in committed assets, or
changes to unrelated commands, providers, schemas, or persistence.
