# WI-0007 — Harden v2 cancellation races and lifecycle events

## Status

`planned` for the bounded local package scope. This work item follows WI-0005
and addresses cancellation race correctness, explicit cancellation lifecycle
events, error-phase consistency, and focused regression coverage. It does not
claim implementation, provider, production, or downstream integration evidence.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0007/work-item.json`
- Classification: `/home/michael/src/github/llm/.docs/work-items/WI-0007/classification-result.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0007/steps/`
- Baseline: `06834ddd9bf5966a3057ad4aaf809cd1bf1e9836`
- Predecessor: `WI-0005` — v2 tool-loop observability and monitor cancellation

## Intended outcome

Harden the completed v2 cancellation behavior so a monitor abort observed after
`llm.provider.response` cannot fall through to terminal success, cancellation
observed during `llm.tool.call` prevents later unstarted parallel calls, and the
runtime emits explicit `llm.cancel.observed` and `llm.cancelled` events. The
`CANCELLED` response diagnostic receives a dedicated cancellation phase, and
focused deterministic tests prove the race and event-ordering invariants.

## Design boundaries

1. This is an additive v2 correctness follow-up to WI-0005; it does not redesign
   the DebugSink or cancellation control plane.
2. `DebugSink` remains the only event transport and `AbortSignal` remains the
   cancellation control mechanism.
3. v1 request/response contracts remain unchanged.
4. Cancellation remains cooperative and does not roll back side effects or
   forcibly terminate uncooperative tools.
5. No LangGraph, persistence, checkpointing, resume, interrupt/resume, provider
   expansion, or real external tool execution is added.
6. WI-0006 sample documentation and its planned scope remain separate.

## Ordered steps

| Order | Task | Commit |
| --- | --- | --- |
| `00000000` | Design cancellation race and lifecycle-event hardening | planned |
| `10000000` | Implement cancellation hardening and explicit events | planned |
| `80000000` | Validate race behavior, schema, tests, and scope | planned |
| `90000000` | Review correctness, compatibility, and evidence limits | planned |
| `91000000` | Record local delivery and limitations | planned |

## Explicit non-claims

- No authenticated provider request is claimed.
- No real external tool invocation or side effect is claimed.
- No rollback or forced termination guarantee is claimed.
- No persistence, checkpointing, resume, interrupt/resume, production, or
  downstream integration evidence is included.