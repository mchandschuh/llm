---
status: planned
workItemId: WI-0012
recordType: work-item-summary
---

# WI-0012 — Add the `llm summarize` command and configured request assets

## Status

`planned`. This intake record defines the requested summarize command and its
request assets only. It does not implement source changes, create the request
assets, call a provider, publish a package, or claim production readiness.

## Authority

- Repository: `/home/michael/src/github/llm`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0012/work-item.json`
- Classification: `/home/michael/src/github/llm/.docs/work-items/WI-0012/classification-result.json`
- Baseline: `d3267e3cc3fc7ba87d1ce271f9e8a546a14dcd4a`

## Intended command boundary

The only new command behavior is:

```text
llm summarize --path <path> [--format=raw|full]
llm summarize --content <text> [--format=raw|full]
```

Exactly one of `--path` or `--content` is required. The command uses the
existing LLM completion boundary and common output behavior; it does not add a
new provider or response envelope.

## Request assets

The implementation must add exactly the requested summarize asset directory
and named files:

```text
requests/summarize/summarize.prompt.md
requests/summarize/summarize.outputSchema.json
```

The prompt instructs the agent to summarize `<files>` content. The output schema
is the output contract used to construct and validate the summarize request.

## Request and configuration boundary

The command resolves `requestsDirectory` with the shared `nodejs-common`
configuration convention, then resolves the two summarize assets beneath that
directory. It must not hard-code this checkout or invent a second precedence
model. If no usable configuration is found, the error must direct the user to
configure:

```text
~/.llm/config.json:requestsDirectory
```

to point to the llm repository's request directory.

The constructed request supplies the source through `<files>`. In `--content`
mode it includes a file named `content`, uses the exact command-line text as
that entry's content, and includes metadata/purpose/attribute text saying that
it is not a filesystem file and is content supplied by the command line.

## Explicit scope guard

No other command, source mode, request asset, schema redesign, provider change,
configuration-convention change, package/release change, deployment, or
unrelated refactor may be added without human operator approval. Path handling
must use the existing request/source boundary; this work item does not authorize
recursive discovery, multiple new path syntaxes, or arbitrary file access.

## Evidence boundary

Later implementation and validation records must use deterministic tests with an
injected/provider-free completion boundary where possible. They must prove source
option validation, request asset resolution, `<files>` construction and inline
content metadata, missing-configuration guidance, one completion call, raw/full
terminal output, regression compatibility, and changed-path scope review. No
live provider, downstream integration, deployment, or production claim is
included in this planned work item.
