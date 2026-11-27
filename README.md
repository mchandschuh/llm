# llm

Provider-agnostic structured LLM completion CLI and Node.js library.

## Agent skill installation

The repository includes an installer for the agent skill, its local JSON schemas,
and the terminal CLI registration. Clone the repository and pass the parent skills
directory as the installer's only argument:

```bash
git clone https://github.com/mchandschuh/llm.git
cd llm
./scripts/install_agent_skill.mjs /path/to/agent-skills
```

The installer runs `npm ci`, builds `dist/`, registers the package with npm's
user-local prefix (`$HOME/.local` by default), verifies the `llm` command, and
creates:

```text
$HOME/.cline/skills/llm/SKILL.md -> <this checkout>/SKILL.md
$HOME/.cline/skills/llm/schemas  -> <this checkout>/schemas
```

Both links are siblings under the installed `llm` directory so relative schema
references such as `./schemas/request/v1/request.schema.json` continue to work
when an agent loads the linked `SKILL.md`. The installer is safe to rerun when
the expected links already exist and refuses to overwrite unexpected files,
directories, or links to another source.

The destination directory may be anywhere:

```bash
./scripts/install_agent_skill.mjs /path/to/agent-skills
```

This produces `<agent-skills>/llm/SKILL.md` and
`<agent-skills>/llm/schemas` pointing back to the checkout containing the
installer. The installer is safe to rerun when the expected links already exist
and refuses to overwrite unexpected files, directories, or links to another
source.

## Development

```bash
npm ci
npm run typecheck
npm test
# Run only tests whose names match a regular expression. Quote patterns with spaces or shell metacharacters.
npm run test:pattern -- 'provider validation fails'
# Equivalent native Node test-runner form:
npm test -- --test-name-pattern='provider validation fails'
npm run build
```

The CLI is available as `llm` when the user-local npm link is installed. See
`SKILL.md` for request/response contracts, CLI usage, provider configuration,
and Node.js library examples.

## One-shot prompt and process-per-turn chat

The CLI supports one stateless prompt mode and a locally persisted chat mode:

```text
llm -p <prompt> [--format=full|raw]
llm --prompt <prompt> [--format=full|raw]
llm -c <prompt> [--format=full|raw] [--print-chat-id]
llm -c --chat-id <id> <prompt> [--format=full|raw] [--print-chat-id]
llm <prompt> [--format=full|raw]  # continue the active LLM_CHAT_ID session
```

Successful completions use `raw` by default. `--format=raw` prints exactly the
model's completion text; `--format=full` prints the versioned response envelope
with status, output, counters, and errors. Both formats print
errors as JSON, so error output is always deserializable. The legacy `--json`
selector is not supported.

`-p/--prompt` performs exactly one completion. It never reads, writes, resumes,
or depends on chat-session state or `LLM_CHAT_ID`, so it can be interspersed
with chat commands safely.

Every `-c/--chat <prompt>` invocation starts a new chat session. Without
`--chat-id`, it generates a safe ID; with `--chat-id`, the supplied ID is only
the destination for that new session. Existing contents at that ID are not
rehydrated and are replaced after the turn. State is persisted as validated
provider-neutral JSON under the configured session-store root.

The chat CLI selects a session store from layered configuration. `config.json`
is read from `.config` in the current directory, then `~/.llm`, then the
directory named by the optional absolute `LLM_CONFIG` environment variable;
later layers override earlier layers. The relevant shape is:

```json
{
  "chatSessionStore": {
    "type": "file",
    "rootDirectory": "/var/tmp/llm/chat"
  }
}
```

The built-in `tempFile` store is the default and uses `/tmp/.llm/chat`. The
persistent `file` store defaults to `~/.llm/chat`. `LLM_CHAT_SESSION_STORE` and
the absolute `LLM_CHAT_SESSION_ROOT` environment variable override file
configuration.

Continuation is a separate subsequent `llm <prompt>` process. It requires the
active `LLM_CHAT_ID` and rehydrates the corresponding validated JSON session.
An executable cannot mutate its parent shell, so use the export-only handoff:

```bash
eval "$(llm -c 'Start a conversation.' --print-chat-id 2>/dev/null)"
llm 'Continue using the active chat.'
llm -p 'Perform an unrelated one-shot query.'
```

With `--print-chat-id`, stdout contains only the shell export and model output
is sent to stderr. Invalid IDs and invalid persisted state are rejected.

Each invocation accepts one prompt and exits. This feature intentionally has no
REPL, interactive chat loop, long-lived process, TTY/readline requirement,
stdin-driven message loop, slash-command exit interface, or promptless chat
start.

## Providers

Completions use the `claude` provider by default. It runs the installed Claude
Code CLI (`claude -p`) non-interactively with the `sonnet` model, using the
CLI's own sign-in. Select OpenRouter with `"provider": "openrouter"`, which
needs `OPENROUTER_API_KEY`. Set `LLM_CLAUDE_EXECUTABLE` to use a different
`claude` executable and `LLM_CLAUDE_TIMEOUT_MS` to change the 10-minute
per-completion timeout. See `SKILL.md` for the exact invocation, structured
output, and tool calling through the claude provider.

`npm test` loads `tests/support/claude-guard.ts`, which points the claude
provider at a fake CLI. The suite therefore never starts the real `claude`,
even on machines where it is installed.

`npm run test:live:claude` builds the package and runs `tests/live/claude-live.mjs`
against the real `claude` CLI. It uses that CLI's sign-in and costs money, so it
is never part of `npm test`. The checks cover:

- a text completion;
- structured output with `$defs`;
- `llm summarize` through the compiled CLI;
- a chat session that uses sandboxed `read_file` and `write_file` tools across
  two tool rounds and a follow-up turn.

Each check prints one JSON line, and the command exits non-zero if any check
fails.

## Dynamic requests

`llm req` runs a named request bundle from the configured request directory:

```text
llm req <request-name> [--parameters <json>] [--p-<path> <value>] [--format=full|raw] [--debug]
llm req <request-name> -h|--help
llm req -h|--help
```

`llm req -h` lists every resolvable request in the configured request directory
with its parameters-schema description, and lists request directories that fail
to load under "Unavailable requests" with the loader reason.
`llm req <request-name> -h` prints that request's parameters: each one as
`--p-<path> <value>` with its type or allowed values, required or optional
status, `defaults.json` default, description, and examples; nested
`--p-<parent>.<child>` and `--p-<array>[<index>]` paths; `oneOf`/`anyOf`
requirement groups; `x-llm-req-parameter` annotations such as file bindings
(mode, MIME type, purpose) and validation functions; and the request settings
from `defaults.json`. Help is read-only and never starts a provider. It is
recognized only immediately after `req` or after the request name; an unknown
or invalid request prints a `configuration_error` JSON entry and exits 1.

The request directory is the `requestsDirectory` value in the layered
`config.json` (`.config` in the current directory, then `~/.llm`, then the
directory named by `LLM_CONFIG`). It must be an absolute directory path. Each
direct child directory is one request whose assets
(`<name>.prompt.md`, `<name>.parameters.schema.json`, `<name>.defaults.json`,
and others) become the request task, settings, and schemas.

Request parameters come from `--parameters` (one complete JSON object) and
`--p-<path> <value>` assignments, validated against the request's parameter
schema. Assignment paths support nested (`--p-filters.owner`) and indexed
(`--p-sections[0].title`) forms. A parameter whose schema declares
`x-llm-req-parameter.file` is resolved into a file under the request's
`<files>`. Unprefixed options that name a schema parameter are rejected with a
`--p-` suggestion.

A schema node can also declare bespoke validation with
`x-llm-req-parameter.validation.function`, an inline JavaScript function called
as `fn(value, context)` before any file or provider work:

```json
"path": {
  "type": "string",
  "x-llm-req-parameter": {
    "validation": { "function": "(value, context) => context.fs.exists(value) || `missing: ${value}`" }
  }
}
```

A validator can also return
`{ valid: false, errors: [{ message, path?, remediation? }] }` to tell users
and agents how to fix a parameter. `llm req` prints one JSON error entry per
issue with `parameterPath` and `remediation`, and library callers catch a
`ParameterValidationFailure` whose `issues` carry the same fields.

Validators run synchronously with a 1000 ms timeout and a frozen context
(`path`, `value`, `parameters`, `schema`, `request`, `workingDirectory`, and
read-only `fs` helpers). The vm isolation is not a security sandbox, so only
configure request directories you trust.

The bundled `summarize` request declares `path` and `content` file parameters:

```text
llm req summarize --p-path notes.md
llm req summarize --p-content 'Inline text to summarize.' --format=full
```

`llm summarize --path <path> | --content <text>` remains as a compatibility
form. It maps `--path`/`--content` to those parameters and
`--provider`/`--model`/`--thinking` to request settings, then runs the same
`summarize` request.

Library callers use `completeRequest`, which applies the same loading,
parameter validation, file materialization, and single provider delegation:

```ts
import { completeRequest } from 'llm';

const result = await completeRequest({
  requestName: 'summarize',
  parameters: { path: 'notes.md' },
});
console.log(result.content);
```

[`requests/README.md`](requests/README.md) is the authoritative contract for
request bundles, parameters, placeholder substitution, and file bindings.

## Chat-session store API

The package exposes the complete session-store boundary through
`ChatSessionStoreFactory`; module-level persistence functions are intentionally
not exported:

```js
import { ChatSessionStoreFactory } from 'llm';

const store = ChatSessionStoreFactory.createChatSessionStore({
  type: 'file',
  rootDirectory: '/var/tmp/llm/chat',
});

const session = await store.load('chat-1');
const ids = await store.query({ from: new Date('2026-01-01T00:00:00Z') });
```

`ChatSessionStore` provides `load`, `save`, and `query` operations. `query`
accepts inclusive `from` and `to` `Date` bounds and returns sorted chat IDs.
Custom implementations can be registered by name with
`ChatSessionStoreFactory.register(type, factory)`.

## Session-scoped chat

The package also exposes `chatFactory.createSession(...)` for one independent,
append-only conversation:

```js
import { chatFactory } from 'llm';

const session = chatFactory.createSession({
  request: {
    schema: 'https://schemas.handschuh.dev/llm/request/v1',
    task: { operation: 'chat' },
    systemPrompt: 'Answer briefly.',
  },
});

const turn = await session.sendUserMessage('Hello.');
console.log(turn.response.status, session.history);
```

`LlmChatSession` owns its initial task context and ordered system, user,
assistant, and tool history. A later provider request receives the complete
history, including assistant tool calls before their matching tool results.
`task` and `taskSchema` remain separate from `messages`.

Callers must serialize mutations and turn submissions for one session. The
session deliberately does not add a mutex, queue, or automatic concurrency
control; a concurrent mutation throws an error. Set
`userMessageInterruptsToolRound: true` to obtain an isolated response-only
interrupt while a tool remains pending. The default `false` returns a blocked
turn without mutating canonical history.

History accumulates for the lifetime of the session. Persistence, checkpointing,
restore, compaction, truncation, and memory retrieval are explicit non-goals of
this boundary. The provider remains stateless and tools are injected by the
caller, which keeps samples and tests provider-free.

Provider projection details are documented in
`schemas/request/v1/request.schema.md`; the generated prompt XML contract is in
`schemas/prompt/v1/llm-prompt.xsd`.

Provider-free executable session examples are available under `samples/`:

- `chat-conversation.mjs` — ordinary back-and-forth with retained history;
- `chat-interruptible-tool-round.mjs` — isolated user response during pending work;
- `chat-blocked-tool-round.mjs` — default blocked user-message behavior during a
  bounded approximately three-second tool.
