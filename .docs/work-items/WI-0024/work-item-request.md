# Add schema-declared request parameter file bindings

Define and implement a reusable request-system feature for parameter fields that
represent files. The binding must be declared by
`x-llm-req-parameter.file` metadata in each request's parameter schema, not by
request-name conditionals. Support path-backed files/directories and synthetic
inline-content files, preserve the existing `<files>` prompt XML and provider
projection boundaries, make `llm req summarize` use `--p-path` and
`--p-content`, and document the contract in `requests/README.md`.

The feature must be shared by `completeRequest` and the CLI, fail closed before
provider use, preserve explicit additional-file flags, and include provider-free
tests for generic and summarize-shaped request bundles.