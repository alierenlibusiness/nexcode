---
name: refactoring
description: Change structure without changing behaviour
keywords: refactor, cleanup, restructure, extract
kinds: implement
---

# Refactoring

## When to use

Improving structure where behaviour must stay identical.

## Checklist

- Establish a passing test baseline before the first edit.
- Make one mechanical transformation at a time; keep the suite green between steps.
- Do not mix a behaviour change into a refactor commit.
- Preserve the public surface unless the task explicitly changes it.
- Delete the old path once the new one is used; do not leave both.

## Verification

- The same test suite passes before and after, unchanged.
- The public API diff is empty unless the task required a change.
