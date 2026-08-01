---
name: ci-pipeline-design
description: A pipeline that is fast, reliable and honest
keywords: ci, pipeline, github actions, build, cache
kinds: plan, implement, review
---

# Ci Pipeline Design

## When to use

Creating or changing continuous integration.

## Checklist

- Fail fast: lint and typecheck before the long test job.
- Make the pipeline reproducible: pinned versions, frozen lockfile, no network surprises.
- Cache dependencies by lockfile hash, not by branch.
- Never allow a flaky test to be retried into green; fix or quarantine it explicitly.
- Run security and secret scanning on every pull request.
- Keep the critical path under ten minutes.

## Verification

- Run the pipeline twice on the same commit and confirm identical results.
- Confirm a deliberately broken commit fails.
