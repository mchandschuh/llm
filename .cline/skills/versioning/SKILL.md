---
name: versioning
description: Apply Semantic Versioning 2.0.0 consistently to package metadata, releases, and compatibility decisions.
category: [release, version-control, maintenance]
tags: [semver, semantic-versioning, version, release, package]
triggers: ["semantic versioning", "SemVer", "version bump", "release version", "package version"]
file_patterns: ["package.json", "package-lock.json", "CHANGELOG.md", "**/VERSION", "**/version"]
intent_patterns: [version, release, publish, bump, upgrade, deprecate]
priority: 0.9
auto_load: false
metadata:
  importance: high
  always_load: false
  current_version: 0.3.0
  semver_specification: 2.0.0
  relevance: Applies when selecting, documenting, validating, or committing a project version.
capabilities:
  - semantic-version classification
  - package metadata synchronization
  - release version validation
  - compatibility and deprecation guidance
failure_modes:
  - changing a released version in place
  - using a patch bump for an incompatible public API change
  - adding leading zeroes or invalid identifiers
  - leaving package metadata and lockfiles inconsistent
token_budget: small
---

# Semantic Versioning

This project follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
The current project version is **0.3.0**.

## Version format

A normal version MUST be `MAJOR.MINOR.PATCH`, where each component is a
non-negative integer without leading zeroes. Components increase numerically.
For this npm project, the canonical version is recorded in:

- `/home/michael/src/github/llm/package.json` (`version`);
- `/home/michael/src/github/llm/package-lock.json` (root `version` and
  `packages[""].version`).

Keep these values synchronized in the same commit. Do not edit generated
`/home/michael/src/github/llm/dist/` artifacts because that directory is ignored.

## Selecting the increment

| Change | Required increment | Example |
| --- | --- | --- |
| Incompatible public API or behavior change | MAJOR | `1.4.2` -> `2.0.0` |
| Backward-compatible functionality or public API addition | MINOR | `0.1.1` -> `0.2.0` |
| Backward-compatible bug fix or internal maintenance | PATCH | `0.2.0` -> `0.2.1` |

Version `0.y.z` denotes initial development. The public API still must be
identified and changes must be classified deliberately; a zero major version
does not make compatibility impact irrelevant. When uncertain, document the
compatibility decision in the release notes or commit body.

## Pre-release and build metadata

Optional pre-release identifiers follow a hyphen:

```text
1.2.0-alpha.1
1.2.0-rc.1
```

Pre-release identifiers consist of dot-separated ASCII alphanumeric and hyphen
components. Numeric identifiers MUST NOT contain leading zeroes. A pre-release
has lower precedence than the associated normal version, so `1.2.0-rc.1` is
lower than `1.2.0`.

Optional build metadata follows a plus sign:

```text
1.2.0+build.20261117
```

Build metadata does not affect version precedence or compatibility. Do not use
build metadata to communicate a public API change.

## Release workflow

1. Identify the public API and classify the change as MAJOR, MINOR, or PATCH.
2. Update the canonical package version and the lockfile root versions together.
3. Search the repository for stale version references that are intended to track
   the release.
4. Run the project validation commands before committing:

   ```bash
   npm run typecheck
   npm test
   npm run build
   git diff --check
   ```

5. Commit the version change with a release-oriented subject and include the
   compatibility rationale in the body when the increment is non-obvious.
6. Never rewrite the contents of an already released version. Any correction to
   released contents requires a new version.

## Validation

The SemVer 2.0.0 normal-version shape is:

```regex
^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$
```

This expression validates only normal `MAJOR.MINOR.PATCH` versions. Use the
full SemVer 2.0.0 grammar from the linked specification when pre-release or
build metadata is present.

Version validation proves metadata syntax and synchronization only. It does not
prove API compatibility, release publication, registry availability, or that a
consumer can upgrade safely; those claims require the corresponding tests and
release evidence.