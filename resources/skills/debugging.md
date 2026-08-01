---
name: debugging
description: Isolate a defect to its root cause before changing code
keywords: bug, defect, root cause, reproduce, stack trace
kinds: implement, research
---

# Debugging

## When to use

A reported failure whose cause is not yet known.

## Checklist

- Reproduce the failure deterministically before touching anything.
- Narrow the input until the smallest failing case remains.
- Read the actual stack trace and the code at that line; do not guess from the symptom.
- Form one hypothesis at a time and test it; revert probes that disprove it.
- Fix the cause, not the symptom: a guard that hides the error is not a fix.
- Add a regression test that fails before the fix and passes after.

## Verification

- The new regression test fails on the original code.
- The original reproduction no longer fails.
