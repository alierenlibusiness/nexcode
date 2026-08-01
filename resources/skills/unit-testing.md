---
name: unit-testing
description: Test one unit's behaviour, fast and in isolation
keywords: test, unit, vitest, jest, mock, coverage
kinds: implement, review
---

# Unit Testing

## When to use

Adding tests for a function, class or module.

## Checklist

- Test observable behaviour, not private implementation detail.
- Name each test after the behaviour it pins: what, under which condition, expecting what.
- One logical assertion per test; a failing name should identify the defect.
- Cover the edge cases that actually break: empty, boundary, duplicate, unicode, null.
- Keep tests deterministic: inject clocks, randomness and I/O.
- Do not mock what you own unless it crosses a real boundary.

## Verification

- Run the new tests and confirm they pass.
- Break the implementation deliberately and confirm a test fails.
