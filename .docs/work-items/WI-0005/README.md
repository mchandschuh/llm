# WI-0005 — Add v2 tool-loop observability and monitor cancellation

## Status

`complete` for the bounded local package scope. Additive v2 runtime observability
and cooperative cancellation, validation, review, and delivery records are
committed. No provider, production, or downstream integration evidence is
claimed.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0005/work-item.json`
- Classification: `/home/michael/src/github/llm/.docs/work-items/WI-0005/classification-result.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0005/steps/`
- Baseline: `ea14ac30326171742d6a5feb92692772bc56b16e`

## Intended outcome

Extend the existing runtime `DebugSink` so v2 automatic tool loops expose
bounded tool-call lifecycle events, and add monitor-triggered cancellation
through the existing runtime `AbortSignal` option. Cancellation must propagate
to provider fetches and injected tools, stop future model/tool work, preserve
completed bounded results, and return a versioned v2 `cancelled` terminal
response. The event stream remains diagnostic and JSONL-compatible; this work
does not add a second observer API.

## Design boundaries

1. `llm/request/v1` and `llm/response/v1` remain unchanged.
2. Callback values do not enter the serializable request schema. `DebugSink`
   remains supplied through runtime completion options.
3. Tool lifecycle events reuse the existing sanitized `DebugSink` and
   `stderrDebugSink` behavior.
4. `AbortController`/`AbortSignal` is the cancellation control plane;
   `DebugSink` is only the observation path that lets a monitor decide when to
   abort its associated run.
5. Cancellation prevents further orchestration but cannot undo an external side
   effect or forcibly terminate an uncooperative JavaScript tool.
6. No LangGraph dependency or embedded graph runtime is added to `llm`.
7. The two pre-existing request-schema modifications remain outside this work
   item and must not be staged by its implementation.

## Ordered steps

| Order | Task | Commit |
| --- | --- | --- |
| `00000000` | Design v2 observability and cancellation boundary | `587eabb` |
| `10000000` | Implement DebugSink tool events and cancellation | `19be7c6` |
| `80000000` | Validate event ordering, cancellation, and scope | `314552d` |
| `90000000` | Review compatibility, safety, and evidence limits | `e12620f` |
| `91000000` | Record local delivery and limitations | delivery commit |

## Explicit non-claims

- No authenticated provider request is claimed.
- No real external tool invocation or side effect is claimed.
- No persistence, checkpointing, resume, interrupt protocol, or production
  deployment is included.
- Cancellation is cooperative for provider fetches and injected tools; it is
  not a rollback or process-kill guarantee.
- Provider-free tests and local build evidence will not establish operational or
  production readiness.