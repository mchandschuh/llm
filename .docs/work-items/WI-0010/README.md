---
status: planned
workItemId: WI-0010
recordType: work-item-summary
---

# WI-0010 — Add prompt and persistent chat CLI modes

## Status

`planned`. This work item has no design task. The test-strategy task is the
first ordered task, followed by the required CLI architecture refactor and the
feature implementation tasks.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0010/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0010/steps/`
- Required CLI guidance: `/home/michael/.cline/skills/nodejs-cli-pattern/SKILL.md`
- Baseline: `02a5a6f7ae3042208ecff3687e18558898ca0b92`

## Intent

Expose convenient `llm -p/--prompt` one-shot execution and `llm -c/--chat`
session execution while preserving the existing request-file CLI. Chat sessions
are persisted locally under `/tmp/.llm/chat-sessions/{chat-id}.json` and may be
resumed through an explicit chat identifier.

Prompt mode is strictly stateless: it must not create, read, mutate, resume, or
depend on a chat-session file or chat-session environment variable.

## Environment handoff constraint

An executable child process cannot mutate the environment of its invoking parent
shell. The implementation must therefore provide an explicit shell integration
or export/handoff mechanism for `LLM_CHAT_ID`; it must not claim that a plain
`llm -c ...` child process can directly set the parent shell variable. The
supported mechanism and its exact invocation must be documented and tested.

## Ordered tasks

| Order | Task | Status | Dependency |
| --- | --- | --- | --- |
| `00000000` | Define CLI/session persistence evidence strategy | `planned` | none |
| `10000000` | Refactor CLI into nodejs-cli-pattern modules | `planned` | `00000000` |
| `20000000` | Implement secure local chat-session persistence and rehydration | `planned` | `10000000` |
| `30000000` | Add prompt/chat commands and shell/session UX | `planned` | `20000000` |
| `80000000` | Independently validate CLI modes, persistence, security, and compatibility | `planned` | `30000000` |
| `90000000` | Review implementation and automated coverage | `planned` | `80000000` |
| `91000000` | Record local delivery and final audit | `planned` | `90000000` |

## CLI contract boundary

The existing request-file interface remains supported:

```text
llm <request.json>
llm --config <request.json>
```

The new modes are intentionally separate:

```text
llm -p <prompt>                 # one stateless completion
llm --prompt <prompt>          # one stateless completion
llm -c <prompt>                # start/resume persisted chat mode
llm --chat <prompt>            # start/resume persisted chat mode
llm -c --chat-id <id> <prompt> # explicit chat selection
```

`-p/--prompt` never reads or writes chat state. `-c/--chat` owns session state
and may persist under `/tmp/.llm/chat-sessions/`. If continuation depends on an
ambient `LLM_CHAT_ID`, the implementation must provide an explicit shell
handoff/source mechanism because a child process cannot mutate its parent shell
environment.

## Required implementation guidance

The first implementation task must read and follow:

```text
/home/michael/.cline/skills/nodejs-cli-pattern/SKILL.md
```

The current CLI does not yet use that module-oriented pattern, so the first
implementation task is an explicit refactor before feature work.

## Non-claims

- No design task is required for this work item.
- No remote or durable service-backed conversation storage is in scope.
- No authenticated provider behavior or production shell-installation claim is
  made by local tests.
- `-p/--prompt` does not create or use chat-session state.
- Chat persistence is local, bounded, validated JSON state only; no arbitrary
  executable, shell, credential, or provider state is stored.