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
