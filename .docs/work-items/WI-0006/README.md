# WI-0006 — Add executable feature samples and sample integration coverage

## Status

`complete` for the bounded local package scope. Provider-free executable samples,
the discovery integration harness, validation, review, and delivery records are
committed. No live provider, production, or downstream integration evidence is
claimed.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0006/work-item.json`
- Classification: `/home/michael/src/github/llm/.docs/work-items/WI-0006/classification-result.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0006/steps/`
- Baseline: `a34095bd29a9130976856403ca1c41a9198b8488`

## Commit chain

| Stage | Commit |
| --- | --- |
| Preparation | `06834dd` |
| Design | `7b5c890`, `0bc01bb` |
| Individual samples | `91ac71a`, `f7af067`, `eafbb56`, `2621cd1`, `b217f9b`, `57f949e`, `9586055`, `11c289d`, `46ad488` |
| Integration/implementation | `061dff3` |
| Validation | `b14a06e` |
| Review | `2bb5298` |
| Delivery | Recorded by the final WI-0006 delivery commit |

## Intended sample matrix

The implementation added focused executable `.mjs` scripts under
`/home/michael/src/github/llm/samples/` for:

1. CLI `--help` and `--version` provider-free behavior.
2. v1 raw-text completion with an injected provider.
3. v1 structured output validated by `outputSchema`.
4. v2 manual tool-call pending behavior.
5. v2 automatic tool invocation and ordered `toolResults`.
6. OpenRouter `finish_reason` normalization using mocked transport.
7. DebugSink tool lifecycle events and sanitization.
8. Cooperative v2 cancellation and preserved completed results.
9. One unified raw `LlmProvider.complete` implementation serving v1 and v2.

Each sample emits exactly one JSON result envelope to stdout, uses only
provider-free deterministic fixtures or temporary bounded files, and be directly
executable with Node.js after `npm run build`.

## Integration harness

Add `/home/michael/src/github/llm/tests/samples.test.ts`. The test should:

- discover sorted `samples/*.mjs` files dynamically;
- assert that the sample set is non-empty;
- execute every sample in a child process from the repository root;
- assert zero exit status, empty stderr unless explicitly documented, and one
  parseable JSON stdout envelope;
- validate stable result fields such as sample identifier, `ok`, feature area,
  and assertions; and
- fail if a new sample is added but cannot run successfully.

The test does not require network credentials or real external tool effects.

## Explicit non-claims

- No authenticated provider request is required or claimed.
- No real external tool invocation or side effect is included.
- No LangGraph, persistence, checkpointing, deployment, or downstream
  application integration is included.
- Passing sample execution proves executable documentation and local package
  behavior only; it does not establish production readiness.