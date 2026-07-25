---
name: release-readiness
description: Decide whether this build is safe to ship
keywords: release, checklist, rollout, rollback, go-live
kinds: plan, review
---

# Release Readiness

## When to use

Before a release goes out.

## Checklist

- Confirm every acceptance criterion is met and verified.
- Confirm migrations are reversible or explicitly approved as irreversible.
- Confirm the rollback path is tested, not just documented.
- Check monitoring and alerting cover the new surface.
- Confirm the changelog and any breaking-change notice are ready.
- Name the owner watching the rollout.

## Verification

- Every checklist item has a named person and an observed result.
