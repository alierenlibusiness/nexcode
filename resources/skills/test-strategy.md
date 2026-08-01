---
name: test-strategy
description: Decide what to test, at which level, and why
keywords: test plan, strategy, coverage, pyramid
kinds: plan
---

# Test Strategy

## When to use

Planning verification for a feature or a release.

## Checklist

- Map each acceptance criterion to the cheapest level that can prove it.
- Push logic tests down to unit level; keep e2e for the few critical journeys.
- Name explicitly what will NOT be tested and why.
- Identify the risky areas: new boundaries, data loss, auth; and over-cover those.
- State the command that runs each level.

## Verification

- Every acceptance criterion maps to at least one named check.
- The plan names the exact commands to run.
