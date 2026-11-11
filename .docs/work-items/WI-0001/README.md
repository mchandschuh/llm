# WI-0001 — Add bounded tool calling to the structured `llm` package

## Status

`active` — implementation is being performed as ordered, scoped commits in the
repository-local work-item record.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0001/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0001/steps/`
- Baseline: `2d5b20625570a33a16b644dd38d6e5e759f81856`
- Historical lineage: WI-0002/WI-0008 records under `/home/michael/.cline/skills/.docs/work-items/`

## Decisions

1. Existing `llm/request/v1` and `llm/response/v1` remain unchanged.
2. Tool calling uses versioned v2 request/response contracts.
3. The public nested collection is named `tool_calls` and contains ordered
   **parallel tool call batches**. Calls inside one batch may run in parallel;
   batches execute sequentially.
4. A provider response is validated completely before invocation. A tool-round
   limit violation is an unvalidated response: the library executes zero tool
   calls from that response.
5. Tool execution is supplied through an injected in-memory `ToolInvoker`; the
   package does not discover tools or execute shell/module paths.
6. No live provider calls or real tool side effects are permitted in this work item.

## Ordered steps

| Order | Task | Scope | Commit subject |
| --- | --- | --- | --- |
| `00000000` | Design | Contracts, lifecycle, invariants, and migration boundary | `WI-0001: 01: design(llm): define bounded tool calling` |
| `10000000` | Schema/types | v2 schemas, public types, and schema registry | `WI-0001: 02: feat(llm): add tool calling contracts` |
| `20000000` | Provider transport | OpenRouter and injected provider normalization | `WI-0001: 03: feat(llm): add provider tool transport` |
| `30000000` | Orchestration | Manual/automatic invocation and parallel batches | `WI-0001: 04: feat(llm): add bounded tool orchestration` |
| `70000000` | Test strategy | Required deterministic coverage and evidence plan | `WI-0001: 05: test(llm): define tool calling evidence` |
| `80000000` | Validation | Execute schemas, tests, typecheck, build, and CLI checks | `WI-0001: 06: test(llm): validate bounded tool calling` |
| `90000000` | Review | Scope, compatibility, security, and evidence review | `WI-0001: 07: review(llm): assess bounded tool calling` |
| `91000000` | Delivery | Final package/release handoff and limitations | `WI-0001: 08: chore(llm): record tool calling delivery` |

Each step is designed, implemented where applicable, reviewed, tested, reviewed again,
and committed with its exact governed subject. A later step may not silently repair an
earlier step's scope without recording the correction.

## Explicit non-claims

- No authenticated OpenRouter request is claimed.
- No real tool invocation is claimed.
- No shell, filesystem, network, or module execution is introduced by the package.
- No Vector AgentWork or Cline integration is included.
- Passing provider-free tests does not establish production readiness.