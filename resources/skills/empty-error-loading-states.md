---
name: empty-error-loading-states
description: Design the three states everyone forgets
keywords: empty state, loading, error, skeleton, fallback
kinds: implement, review
---

# Empty Error Loading States

## When to use

Any view that fetches or lists data.

## Checklist

- Empty state explains what belongs here and offers the action that creates it.
- Loading state preserves layout to avoid a shift when data arrives.
- Error state says what failed, whether it is retryable, and offers the retry.
- Distinguish empty from filtered-empty: they need different guidance.
- Never show a bare spinner as a terminal state.

## Verification

- Force each of the three states and screenshot them.
- Confirm no layout shift between loading and loaded.
