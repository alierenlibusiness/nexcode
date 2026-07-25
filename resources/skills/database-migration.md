---
name: database-migration
description: Change schema without losing data or downtime
keywords: migration, alter table, backfill, rollback
kinds: plan, implement, review
---

# Database Migration

## When to use

Any change to a live schema.

## Checklist

- Write migrations forward-only and idempotent; never edit a shipped migration.
- Split destructive change into expand → backfill → contract across releases.
- Backfill in batches so the table is never locked for long.
- Test the migration against a copy of realistic data volume.
- State the rollback plan; irreversible steps require explicit human approval.

## Verification

- Run the migration twice and confirm the second run is a no-op.
- Confirm the previous application version still works mid-migration.
