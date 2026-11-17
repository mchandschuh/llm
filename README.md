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

Successful completions use `full` by default. `--format=full` prints the
versioned response envelope with status, output, counters, and errors;
`--format=raw` prints exactly the model's completion text. Both formats print
errors as JSON, so error output is always deserializable. The legacy `--json`
selector is not supported.

`-p/--prompt` performs exactly one completion. It never reads, writes, resumes,
or depends on chat-session state or `LLM_CHAT_ID`, so it can be interspersed
with chat commands safely.

Every `-c/--chat <prompt>` invocation starts a new chat session. Without
`--chat-id`, it generates a safe ID; with `--chat-id`, the supplied ID is only
the destination for that new session. Existing contents at that ID are not
rehydrated and are replaced after the turn. State is persisted as validated
provider-neutral JSON under `/tmp/.llm/chat/{chat-id}.json`.

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
