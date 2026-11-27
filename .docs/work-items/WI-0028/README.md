---
status: complete
workItemId: WI-0028
recordType: work-item-summary
---

# WI-0028 — Improve llm req -h response

## Status

`complete`. `llm req -h|--help` lists the resolvable requests and
`llm req <request-name> -h|--help` prints a request's parameters, how to set
them on the command line, and their annotations. All 14 provider-free strategy
cases pass with trace markers, the full suite passes, and the review was
accepted. This status does not claim production readiness.

## Authority

- Repository: `/home/michael/src/github/llm`
- Request: `/home/michael/src/github/llm/.docs/work-items/WI-0028/work-item-request.md`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0028/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0028/steps/`

## Outcome

- `llm req -h` prints req usage, the resolved requests directory, every
  resolvable request with its parameters-schema description (or title), and
  request directories that fail to load under "Unavailable requests".
- `llm req <request-name> -h` prints each parameter as `--p-<path> <value>`
  with its type or allowed values, required or optional status, defaults.json
  default, description, examples, nested and array element paths, oneOf/anyOf
  requirement groups, `--parameters` usage, request settings, and
  `x-llm-req-parameter` file bindings and validation functions.
- Help is provider-free, recognized only immediately after `req` or the request
  name, and reports unknown or invalid requests as a `configuration_error`
  entry with exit 1. `requests/README.md` is unchanged.

## Notes

- The request text ends mid-sentence ("such as file."); file bindings were
  taken as the named annotation.
- `$ref` parameter schemas are named rather than expanded.
