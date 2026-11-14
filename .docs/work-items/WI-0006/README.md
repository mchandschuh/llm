# WI-0006 — Add executable feature samples and sample integration coverage

## Status

`planned` for the bounded local package scope. This work item defines a
provider-free executable sample set and a discovery-based integration test; it
does not claim implementation, provider, production, or downstream integration
evidence yet.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0006/work-item.json`
- Classification: `/home/michael/src/github/llm/.docs/work-items/WI-0006/classification-result.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0006/steps/`
- Baseline: `a34095bd29a9130976856403ca1c41a9198b8488`

## Intended sample matrix

The implementation should add focused executable `.mjs` scripts under
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

Each sample should emit exactly one JSON result envelope to stdout, use only
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

The test must not require network credentials or real external tool effects.

## Explicit non-claims

- No authenticated provider request is required or claimed.
- No real external tool invocation or side effect is included.
- No LangGraph, persistence, checkpointing, deployment, or downstream
  application integration is included.
- Passing sample execution proves executable documentation and local package
  behavior only; it does not establish production readiness.