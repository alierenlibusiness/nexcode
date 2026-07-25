---
name: supply-chain-security
description: Prevent a dependency from compromising the build
keywords: supply chain, lockfile, provenance, install script
kinds: review, plan
---

# Supply Chain Security

## When to use

Changing dependencies or the build pipeline.

## Checklist

- Commit the lockfile and install with the frozen-lockfile flag in CI.
- Review install-time scripts of any newly added package.
- Pin actions and base images by digest, not by mutable tag.
- Restrict CI token scope and never expose secrets to fork builds.
- Audit on every build and fail on known-critical advisories.

## Verification

- Run the audit command and report unresolved advisories.
- Confirm CI uses a frozen lockfile.
