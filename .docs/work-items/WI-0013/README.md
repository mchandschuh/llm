---
status: planned
workItemId: WI-0013
recordType: work-item-summary
---

# WI-0013 — Add configurable summarize settings

## Status

`planned`. This work item defines the summarize settings asset, default-setting
resolution, and summarize-specific command-line overrides. It does not implement
the change, publish a package, call a provider, or claim production readiness.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0013/work-item.json`
- Classification: `/home/michael/src/github/llm/.docs/work-items/WI-0013/classification-result.json`
- Baseline: `ecfd8be`

## Intended outcome

The `llm summarize` command will be able to load default provider settings from
the configured summarize request assets and accept command-line overrides for
settings such as provider, model, and thinking. The constructed request will
retain the existing summarize source modes, request assets, completion boundary,
and raw/full output behavior.

## Naming clarification required by the request

The canonical asset selected for this work is
`requests/summarize/summarize.defaults.json`. The request also mentioned
`summarize.settings.json`; that alternate name is not created or consulted.

## Scope

- Add one repository-owned summarize settings/defaults JSON asset under the
  configured `requests/summarize` directory.
- Resolve default provider, model, and thinking settings through the existing
  requests-directory configuration boundary.
- Add summarize-specific command-line settings overrides, including
  `--provider`, `--model`, and `--thinking`.
- Define and test precedence between command-line values, the settings asset,
  and existing runtime defaults.
- Preserve the existing `--path` and `--content` source modes, recursive
  directory handling, symlink-file behavior, completion boundary, and output
  formats.

## Explicit non-goals

- Do not change the generic request schema or provider interface.
- Do not add settings resolution to prompt, chat, continuation, or request-file
  commands.
- Do not invent a second configuration lookup mechanism or change the
  `nodejs-common` requests-directory precedence.
- Do not add arbitrary settings passthrough, credentials in files, interactive
  prompts, or environment-variable precedence unless separately approved.
- Do not publish, deploy, or make authenticated provider calls as part of this
  work item.

## Evidence boundary

Validation must be deterministic and provider-free where possible. It must prove
asset resolution, naming clarification, JSON/settings validation, precedence,
CLI parsing, provider-boundary request construction, existing summarize
regressions, typechecking, tests, build, and changed-path scope. It does not
establish provider availability, registry publication, deployment, or production
readiness.