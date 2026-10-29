---
name: llm
description: >-
  Use the provider-agnostic llm CLI and Node.js library for bounded,
  schema-aware language-model completions.
metadata:
  category:
    - cli
    - llm
    - nodejs
  tags:
    - llm
    - completion
    - structured-output
    - openrouter
    - typescript
    - cli
  triggers:
    - "llm CLI"
    - "llm tool"
    - "llm library"
    - "structured completion"
    - "schema-aware completion"
    - "OpenRouter completion"
  file_patterns:
    - "**/llm/**"
    - "**/request.schema.json"
    - "**/response.schema.json"
  intent_patterns:
    - complete
    - summarize
    - assess
    - generate
    - validate
    - invoke
  priority: 0.95
  auto_activate: true
  capabilities:
    - bounded_llm_completion
    - structured_output_validation
    - cli_invocation
    - nodejs_library_usage
    - provider_injection
  failure_modes:
    - invalid_request_schema
    - unsafe_source_path
    - missing_provider_credentials
    - provider_failure
    - invalid_model_output
  token_budget: medium
  anti_triggers:
    - "generic language-model theory without a completion task"
  activation:
    min_similarity: 0.75
    require_file_match: false
    require_intent_match: false
auto_load: true
---

# `llm` CLI and Node.js library

This skill describes the implementation in `/home/michael/src/github/llm`. The
canonical skill document is the repository file; the global
`/home/michael/.cline/skills/llm/SKILL.md` path should remain a symlink to it.

Use this tool for one bounded, provider-backed completion when the result should
be plain text or validated against a JSON Schema. Prefer an injected provider in
tests and local deterministic workflows. Do not use it as an unrestricted shell,
file-reading, or credential-storage mechanism.

## Runtime and project commands

- Node.js `>=22` is required.
- The package uses native ESM and TypeScript.
- npm is the repository package manager; `package-lock.json` is authoritative.
- Build output is generated in `dist/` and dependencies are in `node_modules/`;
  both are ignored by Git.

From `/home/michael/src/github/llm`:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

The installed command is available as `llm` when the user-local link is present.
To register or repair that link with npm 11:

```bash
npm_config_prefix="$HOME/.local" npm link --no-save
```

Ensure `$HOME/.local/bin` is on `PATH`. Build before invoking the linked command,
because `bin/cli.js` loads compiled modules from `dist/`.

## CLI usage

```text
llm <request.json>
llm --config <request.json>
llm --help
llm --version
```

The request path is resolved relative to the current working directory. The
`--config` form requires exactly one path argument. A request produces one JSON
response envelope on stdout. Help and version exit successfully without
initializing the provider.

Exit codes:

- `0`: help, version, or a completion with `status: "success"`.
- `1`: an unreadable/malformed request or any non-success completion status.
- `2`: invalid CLI argument shape.

The minimal request is:

```json
{
  "schema": "https://schemas.handschuh.dev/llm/request/v1",
  "task": "Summarize the current work item.",
  "systemPrompt": "Return a concise plain-text summary."
}
```

The complete request contract is
`schemas/request/v1/request.schema.json`. Requests are closed objects: unknown
properties are rejected.

## Request fields

- `schema` is required and must be exactly
  `https://schemas.handschuh.dev/llm/request/v1`.
- `task` and `systemPrompt` are required non-empty strings. If a value names an
  existing permitted regular file under the configuration root, its UTF-8
  contents are loaded; otherwise the value is treated as a literal string.
- `provider` defaults to `openrouter`.
- `model` defaults to `openai/gpt-5.6-luna`.
- `thinking` accepts `minimal`, `low`, `medium`, `high`, or `xhigh`, and defaults
  to `high`.
- `maxFailedAttempts` defaults to `3` and must be an integer from `0` through
  `10`. It counts provider invocations that fail before returning usable text.
- `maxIterations` defaults to `3` and must be an integer from `1` through `10`.
  It counts successful provider roundtrips, including correction attempts.
- `taskSchema` is optional inline JSON Schema text or a permitted file reference.
  When present, the resolved task must be valid JSON and satisfy this schema
  before the provider is called.
- `outputSchema` is optional inline JSON Schema text or a permitted file
  reference. When present, provider output must be JSON and satisfy it.
- `files` is an ordered list of `{ name, path, type, purpose }` reference
  descriptors. Every `path` must resolve to a permitted regular file.
- `credentials` may contain an in-memory `apiKey` or `accessToken`, but do not
  put credentials in committed or persistent request files.

The CLI uses the directory containing the request file as the configuration
root. Library callers should pass `configurationRoot` or
`configurationFilePath` when a request refers to local files; otherwise the
current working directory is used.

## Source safety boundary

The source resolver intentionally rejects:

- absolute paths and `..` traversal;
- path segments named `.env`, `.env.*`, `credentials`, or `secrets`;
- symbolic links in any path component;
- directories, non-regular files, unreadable files, and paths outside the
  configuration root.

Keep reference files inside the request’s permitted root. Do not work around
these checks by changing the working directory or embedding secrets in prompt
content.

## Provider and credentials

The built-in `OpenRouterProvider` sends a request to OpenRouter’s chat
completion endpoint. It uses, in order:

1. `request.credentials.apiKey`;
2. `request.credentials.accessToken`;
3. the `OPENROUTER_API_KEY` environment variable.

Credentials are not persisted, logged, prompted for, or returned by the
library. Prefer the environment variable for CLI use and an in-memory value for
library use. A missing credential returns a bounded configuration error rather
than prompting.

Only the `openrouter` adapter is built in. A non-OpenRouter provider name
requires an injected `LlmProvider`; otherwise the completion returns
`configuration_error` without making a provider request.

## Response contract and retry behavior

The response contract is
`schemas/response/v1/response.schema.json`. Every normal completion returns:

```json
{
  "schema": "https://schemas.handschuh.dev/llm/response/v1",
  "status": "success",
  "output": {
    "$type": "string",
    "schema": null,
    "value": "..."
  },
  "failedAttempts": 0,
  "iterations": 1,
  "errors": []
}
```

Possible statuses are:

- `success`: usable raw text or schema-validated structured output is available.
- `input_invalid`: request shape or task-schema validation failed.
- `configuration_error`: configuration, source, schema, or adapter setup failed.
- `provider_error`: part of the public response contract; the built-in
  provider-call path retries ordinary provider failures and returns
  `attempts_exhausted` when the failed-attempt limit is reached.
- `output_invalid`: output was not valid JSON or did not satisfy `outputSchema`
  after the iteration limit was reached.
- `attempts_exhausted`: provider failures reached `maxFailedAttempts`.

Provider failures and successful iterations are counted separately. When an
output schema is configured and a provider returns invalid output, the library
constructs a bounded correction prompt and tries again until `maxIterations`.
Errors are sanitized and bounded; at most ten are returned and each message is
limited to 500 characters.

## Node.js library usage

The public package entry point is `dist/index.js`, exposed through the package
root after `npm run build`:

```ts
import { complete } from 'llm';

const result = await complete({
  schema: 'https://schemas.handschuh.dev/llm/request/v1',
  task: 'Return a concise status.',
  systemPrompt: 'Use plain text and do not invent facts.',
});

if (result.status === 'success') {
  console.log(result.output?.value);
} else {
  console.error(result.errors);
}
```

The public exports also include:

- `normalizeRequest` for request preparation and source resolution;
- `composePrompt`, `composeRequestPrompt`, and `composeCorrectionPrompt`;
- `OpenRouterProvider`;
- `LlmFailure`;
- the request, response, provider, output, and configuration TypeScript types.

For deterministic tests, inject a small provider instead of making a network
call:

```ts
import { complete } from 'llm';
import type { LlmProvider } from 'llm';

const provider: LlmProvider = {
  async complete() {
    return JSON.stringify({ ok: true });
  },
};

const result = await complete(
  {
    schema: 'https://schemas.handschuh.dev/llm/request/v1',
    task: '{"operation":"test"}',
    systemPrompt: 'Return the requested result.',
    outputSchema: JSON.stringify({
      $id: 'https://example.test/output',
      type: 'object',
      required: ['ok'],
      additionalProperties: false,
      properties: { ok: { type: 'boolean' } },
    }),
  },
  { provider },
);
```

An injected provider receives a normalized `ProviderCompletionRequest` and must
return raw completion text. It is the preferred seam for unit tests and local
adapters. Do not instantiate network providers in tests unless an integration
test explicitly requires that evidence.

## Agent workflow

1. Read the request and response schemas before composing a request.
2. Keep task data, system instructions, reference files, and output schemas
   explicit and bounded.
3. Use `outputSchema` whenever downstream code needs structured data; treat
   `output.value` as untrusted until the response status is `success`.
4. Keep credentials outside committed files and inspect the sanitized response,
   not provider-specific exceptions or raw network errors.
5. For code changes, run `npm run typecheck`, `npm test`, and `npm run build`.
6. For a CLI registration problem, verify `command -v llm`, rebuild, then run
   `npm_config_prefix="$HOME/.local" npm link --no-save`.

Do not claim a successful command exit alone proves a successful completion:
inspect the response envelope’s `status`, `output`, counters, and `errors`.
