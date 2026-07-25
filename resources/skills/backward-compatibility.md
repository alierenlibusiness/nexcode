---
name: backward-compatibility
description: Change without breaking existing callers
keywords: compatibility, breaking change, deprecation, migration
kinds: plan, implement, review
---

# Backward Compatibility

## When to use

Changing a shape other code or stored data depends on.

## Checklist

- Enumerate every consumer of the surface you are changing before editing.
- Prefer additive change; make new fields optional with safe defaults.
- Keep the old path working through a deprecation window when consumers are external.
- Migrate persisted data forward-only and idempotently.
- Document the change, its reason, its impact and its migration path.

## Verification

- Load data written by the previous version and confirm it still works.
- Run the existing test suite unchanged.
