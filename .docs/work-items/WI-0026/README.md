---
status: planned
workItemId: WI-0026
recordType: work-item-summary
---

# WI-0026 — Add claude provider

## Status

`planned`. This record defines a bounded planning slice. It does not claim
implementation, test execution, provider availability, production readiness,
release, or commit.

## Authority

- Repository: `/home/michael/src/github/llm`
- Request: `/home/michael/src/github/llm/.docs/work-items/WI-0026/work-item-request.md`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0026/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0026/steps/`

Operator decisions recorded with the request:

- The claude default model is `sonnet`.
- The bundled summarize request switches to claude.
- Tool calling incorporates the existing tool schemas: tools go into the prompt
  and task side, and tool calls into the output schema. This must be documented
  in `SKILL.md`.

## Intended outcome

`provider: "claude"` and the new default both run the Claude Code CLI as:

```text
claude -p "<fixed instruction>" --output-format json --model <model> \
  --effort <thinking> --system-prompt <system prompt> --safe-mode \
  --tools "" --strict-mcp-config --disallowedTools "mcp__*" \
  --no-session-persistence [--json-schema <schema>]
```

The `llmPrompt`, conversation turns, tools, and tool results are written to
stdin.

## Design decisions

- **Efficient and safe invocation.** `--safe-mode` skips CLAUDE.md, hooks,
  plugins, skills, MCP servers, and auto memory, while authentication still
  works. It also prevents project hooks in arbitrary working directories from
  running. `--bare` is not used because it breaks subscription logins.
- **No tools or sessions.** Built-in tools and MCP tools are disabled, and
  sessions are not persisted.
- **System prompt.** `--system-prompt` replaces the default Claude Code prompt.
  It uses the request or chat system prompt, falling back to
  `You are a helpful assistant.`
- **Effort.** Thinking maps to `--effort`; `minimal` maps to `low`.
- **Executable.** `LLM_CLAUDE_EXECUTABLE` overrides the executable, which
  defaults to `claude` on `PATH`. `validate()` fails closed when it cannot be
  resolved.
- **Result parsing.** The JSON result envelope is parsed defensively, together
  with the exit code. An `error_*` subtype, `is_error: true`, a non-zero exit,
  or a missing `structured_output` when a schema was supplied each produce a
  bounded `PROVIDER_REQUEST_FAILED`.
- **Structured output.** `outputSchema` maps to `--json-schema`, and the
  validated `structured_output` is returned as JSON content. A schema whose
  root is not an object is wrapped in `{ value }`.
- **Tool calling.** Tool-capable requests describe the tool definitions, using
  the existing tool-definition fields, in the stdin prompt.
  - `--json-schema` constrains the reply to one of two shapes:
    `{ decision: "stop", output }`, where `output` follows the `outputSchema`
    (or is a string), or `{ decision: "continue", toolCalls: [...] }`.
  - Each tool call has the existing `{ id, name, arguments }` shape, with
    `arguments` constrained by that tool's `inputSchema`.
  - Prior assistant tool calls and tool results are replayed in the prompt for
    later rounds.
- **Provider registry.** A registry maps `claude` and `openrouter` to adapters.
  - `complete`, `completeRequest`, chat sessions, and CLI `--provider`
    overrides all resolve through it.
  - Injected providers still win.
  - Unknown names fail with a configuration error that lists the available
    providers.
- **Defaults.**
  - Requests that omit a provider default to `claude` with model `sonnet`.
  - `openrouter` without a model keeps `openai/gpt-5.6-luna`.
  - The summarize defaults drop their openrouter provider and model pins.
- **Images.** Base64 image attachments are rejected by the claude provider.
- **Test isolation.** Tests use a fake `claude` executable. The full suite is
  also run with a fake `claude` first on `PATH` to prove that no test reaches
  the real CLI.

## Non-goals

- No image attachments, stream-json input, or OpenRouter redesign.
- No authenticated calls from automated tests.
- No publication, deployment, tagging, or production claims.

## Ordered task graph

| Order | Task | Dependency | Evidence |
| --- | --- | --- | --- |
| `10000000` | Define test strategy | none | Strategy only |
| `20000000` | Implement the claude provider | `10000000` | Planned implementation task |
| `80000000` | Validate implementation | `10000000`, `20000000` | Planned validation procedures |
| `90000000` | Review scope and coverage | `80000000` | Planned review gate |

## Evidence boundary

The full repository gate
`npm run typecheck && npm test && npm run build && git diff --check` must pass
before this work item is complete. Provider-free evidence does not establish
that the real claude CLI, Anthropic authentication, or model behavior work as
expected; any live smoke run is reported separately.
