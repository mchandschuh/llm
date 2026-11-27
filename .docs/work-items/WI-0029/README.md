---
status: complete
workItemId: WI-0029
recordType: work-item-summary
---

# WI-0029 — Support multiple request directories

## Status

`complete`. `~/.llm/config.json` can name request directories through
`requestsDirectory`, `requestDirectories`, or both, and `llm req`, request
help, `llm summarize`, and `completeRequest` search every configured directory.
All 16 provider-free strategy cases pass with trace markers, the full suite
passes, and the review was accepted with one advisory finding. This status
does not claim production readiness.

## Authority

- Repository: `/home/michael/src/github/llm`
- Request: `/home/michael/src/github/llm/.docs/work-items/WI-0029/work-item-request.md`
- Work-item record: `/home/michael/src/github/llm/.docs/work-items/WI-0029/work-item.json`
- Steps: `/home/michael/src/github/llm/.docs/work-items/WI-0029/steps/`
- Contract decision: `/home/michael/src/github/llm/requests/decisions.md` (D20)

## Outcome

- Directories are searched with `requestsDirectory` first, then
  `requestDirectories` in array order; entries that resolve to the same real
  directory are searched once. Malformed values fail with `CONFIGURATION_INVALID`
  naming the key or index, and the guidance names both keys.
- A request name in more than one directory fails with a configuration error
  naming every matching directory; `llm req -h` lists it under "Duplicate
  requests". A request's parameter schemas resolve only within its own
  directory.
- `llm req <request-name>` now reports configuration failures and ambiguous
  names as a `configuration_error` with exit 1 instead of the generic usage
  error. Single-directory output and messages are unchanged.
- README.md, SKILL.md (including repository-prefixed request naming, such as
  `sdlc-work-item-expand`), the operator-confirmed `requests/README.md`
  passages, and D20 document the change.

## Notes

- WI-0029-90000000_FIND-001 (advisory, open): an unknown request name on the
  `llm req` command line still gets the generic exit-2 usage error.
- `~/.llm/config.json` and the sdlc repository were not changed.
