# WI-0011 — Encapsulate configurable chat-session stores

## Status

Complete local implementation and delivery record. No publication or deployment
was performed.

## Scope

WI-0011 replaces the module-level chat-session persistence functions with a
`ChatSessionStore` interface and factory boundary. It adds inclusive time-range
querying, the `tempFile` and persistent `file` implementations, layered store
configuration, package exports, CLI integration, security/regression coverage,
and the associated major-version metadata.

The configuration lookup follows the reviewed `nodejs-common` convention:
current-directory `.config`, home `.llm`, then an optional absolute `LLM_CONFIG`
environment root, with later layers overriding earlier layers. Explicit
`LLM_CHAT_SESSION_STORE` and `LLM_CHAT_SESSION_ROOT` values have highest
precedence.

## Task graph

| Order | Task | Type | Status |
| --- | --- | --- | --- |
| `00000000` | Enumerate complete session-store test strategy | test-strategy | complete |
| `80000000` | Validate implementation, package, and work-item coverage | validation | complete |
| `90000000` | Review API break, configuration, security, and evidence | review | complete |
| `91000000` | Record major-version delivery | delivery | complete |

There is intentionally no design task for this work item.

## Compatibility decision

This is a major release because `loadChatSession` and `saveChatSession` are
removed from the public API. The package and lockfile were advanced from
`0.2.0` to `1.0.0` together.

## Evidence boundary

Evidence is provider-free and local. It establishes the TypeScript API, file
security behavior, configuration precedence, CLI integration, package gates,
and work-item enumeration. It does not establish authenticated provider
behavior, deployment, registry publication, or downstream consumer migration.