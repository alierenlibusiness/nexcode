---
name: dependency-review
description: Judge a new dependency before adopting it
keywords: dependency, package, npm, supply chain, license
kinds: review, research
---

# Dependency Review

## When to use

A change that adds or upgrades a dependency.

## Checklist

- Ask whether the standard library or existing code already covers it.
- Check maintenance signals: last release, open critical issues, maintainer count.
- Check the licence against the project's distribution model.
- Review the transitive footprint and install-time scripts.
- Prefer a small, focused package over a framework for a single function.

## Verification

- Run the project's audit command and report findings.
- Confirm the lockfile change is limited to the intended package.
