---
name: semantic-versioning
description: Communicate compatibility through the version number
keywords: semver, version, breaking change, release
kinds: review, implement
---

# Semantic Versioning

## When to use

Choosing a version for a release.

## Checklist

- Major for any breaking change to the public surface, however small.
- Minor for backward-compatible additions; patch for fixes only.
- Treat behaviour changes as breaking even when types are unchanged.
- Pre-release tags for anything not yet stable.
- Keep the version in one place and derive everything else from it.

## Verification

- Diff the public API against the previous tag and confirm the bump matches.
