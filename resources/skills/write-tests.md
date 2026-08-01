---
name: write-tests
description: Add the missing tests for existing code
keywords: test coverage, missing tests, backfill
kinds: implement
---

# Write Tests

## When to use

Code that works but is unverified.

## Checklist

- Read the code and list its actual behaviours before writing any test.
- Start with the behaviour whose breakage would hurt most.
- Write the test against current behaviour first, then judge whether that behaviour is correct.
- Do not refactor while backfilling tests; land the tests, then refactor safely.
- Cover error paths: untested error handling is usually where the bugs are.

## Verification

- Every new test fails when its behaviour is deliberately broken.
- The suite passes on unmodified code.
