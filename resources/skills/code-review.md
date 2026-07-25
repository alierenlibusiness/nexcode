---
name: code-review
description: Review a change for correctness, scope and regression risk
keywords: review, diff, regression, correctness
kinds: review
---

# Code Review

## When to use

Reviewing a diff before it is accepted.

## Checklist

- Read the diff and every call site it touches, not just the changed lines.
- Check the change actually implements the stated behaviour; run the narrowest test that proves it.
- Look for regressions in adjacent behaviour the diff did not intend to touch.
- Flag scope creep: unrelated refactors, renames or new dependencies.
- Verify error paths and edge cases, not only the happy path.
- Rate each finding CRITICAL/HIGH/MEDIUM/LOW; only CRITICAL and HIGH block.

## Verification

- Run the project's targeted test for the touched module.
- Re-read the diff once more after the findings list is written.
